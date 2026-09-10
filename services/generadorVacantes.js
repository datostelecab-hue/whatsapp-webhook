// ============================================================
// GENERADOR DE VACANTES
// ============================================================
// Arma el puesto que hay que salir a cubrir. Dos maneras, y la segunda es nueva:
//
//   · HUECO — la de siempre. Un correturnos se monta encadenando los días de
//     descanso de varias matrículas: los turnos fijos libran 2 días y en esos 2
//     entra el CT, así que cada matrícula aporta un BLOQUE que se coge entero.
//     Se pide por CONTRATO (32 h = 4 días = 2 bloques; 40 h = 6 días = 3), lo
//     dice `cat_jornada` y no una lista escrita aquí. Los bloques tienen que
//     tener días DISJUNTOS —nadie está en dos coches el mismo día— y se prefiere
//     la misma zona; si no completa, se propone la más cercana por coordenadas.
//
//   · RECAMBIO — a alguien se le va a sacar y hay que buscar quien lo sustituya.
//     No es un hueco: la plaza TIENE dueño. Se elige a la persona y la vacante
//     sale sola de lo que ocupa hoy —sus plazas, su zona, sus libranzas, los días
//     que cubre— y con el contrato que corresponde a eso. Esto antes no se podía
//     ni escribir: el generador solo sabía mirar plazas vacías.
//
// La fuente es el tablero de POSTGRESQL (repo/planificador): un HUECO de CT es
// un día en que el coche descansa (sus fijos libran) y el tramo de ese turno se
// queda sin nadie según f_cobertura.
//
// Y lo que se guarda son PLAZAS, no matrículas. La vacante apunta a la plaza
// real desde el primer momento, así que el planificador puede pintarla reservada
// y al colocar al candidato no hay que salir a buscar sitio: ya estaba dicho.

const plani = require('./repo/planificador');
const vacantes = require('./repo/vacantes');
const db = require('./db');

const DIAS_SEM = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (la2 - la1) * rad, dLon = (lo2 - lo1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const normZona = z => String(z || '').trim().toLowerCase();

async function cargarCochesBases() {
  const [tab, basesQ] = await Promise.all([
    plani.tablero({}),
    db.consulta('SELECT nombre, lat::float AS lat, lng::float AS lng FROM base_zona WHERE activa'),
  ]);
  // La zona del coche es la de su CUADRANTE cuando el coche no la lleva puesta;
  // desde db/91 la resuelve `v_plaza`, así que el tablero ya viene con ella.
  const zonaCua = new Map((tab.cuadrantes || []).map(cu => [String(cu.id), cu.zona || '']));
  const coches = (tab.coches || [])
    .filter(c => c.operativo && c.matricula)
    .map(c => {
      const zona = c.zona || (c.cuadranteId && zonaCua.get(String(c.cuadranteId))) || '';
      // HUECO de CT = día de descanso del coche (1-7) cuyo tramo de ese turno se
      // queda SIN NADIE en la semana del tablero (la verdad de f_cobertura).
      const huecos = [];
      (c.descanso || []).forEach(d => {
        ['Día', 'Noche'].forEach((turno, off) => {
          const celda = (c.semana || [])[(Number(d) - 1) * 2 + off] || {};
          if (!celda.id) huecos.push({ dia: Number(d) - 1, turno });
        });
      });
      // LA PLAZA, no solo la matrícula. La de CT que esté libre (la primera de
      // las dos) y la de fijo con su ocupante, si lo tiene.
      const plazaCt = {}, plazaFijo = {};
      ['Día', 'Noche'].forEach(t => {
        const ct = (c.personas || []).find(x => x.rol === 'CT' && x.turno === t && !x.id && x.plazaId);
        plazaCt[t] = ct ? ct.plazaId : null;
        const fj = (c.personas || []).find(x => x.rol === 'FIJO' && x.turno === t && x.plazaId);
        plazaFijo[t] = fj ? { plazaId: fj.plazaId, ocupa: fj.id || '', nombre: fj.nombre || '' } : null;
      });
      return {
        vehiculoId: String(c.vehiculoId), matricula: c.matricula, zona,
        cuadrante: c.cuadrante || '', personas: c.personas || [], huecos, plazaCt, plazaFijo,
      };
    });
  return { coches, bases: basesQ.rows };
}

/** Cuántos días trabaja el contrato (32 h → 4, 40 h → 6): lo dice cat_jornada. */
const contratos = () => vacantes.jornadas().then(js => js.map(j => ({
  horas: j.horas, etiqueta: j.etiqueta, dias: j.dias,
})));

/** Matrículas ya reservadas en una vacante VIVA, por turno (Set por turno). */
async function reservadasPorTurno() {
  const dia = new Set(), noche = new Set();
  try {
    (await vacantes.comprometidas()).forEach(c => {
      (c.turno === 'Noche' ? noche : dia).add(c.matricula);
    });
  } catch (e) {
    console.error('⚠️  [Generador] no se pudieron leer las reservas:', e.message);
  }
  return { dia, noche };
}

/** Nombre de los DOS fijos de un coche (día y noche); '' si no tiene. */
function fijosDe(coche) {
  const nombre = t => {
    const p = (coche.personas || []).find(x => x.rol === 'FIJO' && x.turno === t && x.id);
    return p ? (p.nombre || p.id) : '';
  };
  return { fijoDia: nombre('Día'), fijoNoche: nombre('Noche') };
}

/** Bloque por matrícula = sus días de hueco de ese turno, con AMBOS fijos. */
function bloquesDe(coches, turno) {
  return coches.map(c => {
    const dias = (c.huecos || []).filter(h => h.turno === turno)
      .map(h => h.dia).sort((a, b) => a - b);
    if (!dias.length) return null;
    return {
      matricula: c.matricula, vehiculoId: c.vehiculoId,
      zona: c.zona || '(sin zona)', cuadrante: c.cuadrante,
      plazaId: c.plazaCt[turno] || null,
      dias, ...fijosDe(c),
    };
  }).filter(Boolean);
}

/** Devuelve fn(zonaA, zonaB) → km entre sus bases (Infinity si falta alguna). */
function distanciaEntreZonas(bases) {
  const coord = new Map();
  bases.forEach(b => coord.set(normZona(b.nombre), { lat: b.lat, lng: b.lng }));
  return (zA, zB) => {
    const a = coord.get(normZona(zA)), b = coord.get(normZona(zB));
    return (a && b) ? haversine(a.lat, a.lng, b.lat, b.lng) : Infinity;
  };
}

/** Busca una combinación EXACTA (días disjuntos) que sume `objetivo`, empezando
 *  por `inicio`. Prueba los candidatos en el orden dado (misma zona → cercanas),
 *  así prefiere completar en la propia zona. Devuelve el array o null. */
function buscarExacto(inicio, candidatos, objetivo) {
  const usados = new Set(inicio.dias);
  const elegidos = [inicio];
  function rec() {
    if (usados.size === objetivo) return true;
    for (const b of candidatos) {
      if (elegidos.includes(b)) continue;
      if (usados.size + b.dias.length > objetivo) continue;
      if (b.dias.some(d => usados.has(d))) continue;
      b.dias.forEach(d => usados.add(d)); elegidos.push(b);
      if (rec()) return true;
      elegidos.pop(); b.dias.forEach(d => usados.delete(d));
    }
    return false;
  }
  return rec() ? elegidos.slice() : null;
}

/** Relleno voraz cuando no hay combinación exacta: mete bloques disjuntos en
 *  orden de preferencia hasta donde llegue, sin pasarse del objetivo. */
function rellenoParcial(inicio, candidatos, objetivo) {
  const usados = new Set(inicio.dias);
  const elegidos = [inicio];
  for (const b of candidatos) {
    if (usados.size >= objetivo) break;
    if (usados.size + b.dias.length > objetivo) continue;
    if (b.dias.some(d => usados.has(d))) continue;
    b.dias.forEach(d => usados.add(d)); elegidos.push(b);
  }
  return elegidos;
}

/**
 * Genera una propuesta de vacante de HUECO.
 * @param {{zona, turno, dias, contrato, matricula}} opt
 */
async function generarVacante(opt = {}) {
  const zona = String(opt.zona || '').trim();
  const turno = opt.turno === 'Noche' ? 'Noche' : 'Día';
  const cts = await contratos();
  const ct = cts.find(c => c.horas === Number(opt.contrato)) || null;
  const objetivo = ct ? ct.dias
    : ([2, 4, 6].includes(Number(opt.dias)) ? Number(opt.dias) : 6);
  const matricula = String(opt.matricula || '').trim();
  if (!zona || !matricula) throw new Error('Faltan la zona y la matrícula de partida');

  const { coches, bases } = await cargarCochesBases();
  const reservadas = (await reservadasPorTurno())[turno === 'Noche' ? 'noche' : 'dia'];
  if (reservadas.has(matricula)) {
    throw new Error(`La matrícula ${matricula} ya está reservada en una vacante abierta de ${turno}`);
  }
  const bloques = bloquesDe(coches, turno).filter(b => !reservadas.has(b.matricula));
  const inicio = bloques.find(b => b.matricula === matricula && b.zona === zona);
  if (!inicio) throw new Error(`La matrícula ${matricula} no tiene huecos de ${turno} en ${zona}`);

  const dist = distanciaEntreZonas(bases);
  const candidatos = bloques.filter(b => b !== inicio).sort((a, b) => {
    const sa = a.zona === zona, sb = b.zona === zona;
    if (sa !== sb) return sa ? -1 : 1;
    if (sa) return a.matricula.localeCompare(b.matricula);
    return dist(zona, a.zona) - dist(zona, b.zona);
  });

  const exacto = buscarExacto(inicio, candidatos, objetivo);
  const elegidos = exacto || rellenoParcial(inicio, candidatos, objetivo);

  const aSalida = b => ({
    matricula: b.matricula, vehiculoId: b.vehiculoId, plazaId: b.plazaId,
    zona: b.zona, cuadrante: b.cuadrante,
    fijoDia: b.fijoDia, fijoNoche: b.fijoNoche,
    sugerido: b.zona !== zona,
    km: b.zona !== zona ? Math.round(dist(zona, b.zona) * 10) / 10 : 0,
    dias: b.dias.map(d => ({ dia: d, nombre: DIAS_SEM[d] })),
  });

  const pool = [inicio, ...candidatos].slice(0, 60).map(aSalida);

  return {
    zona, turno, objetivo,
    contrato: ct ? ct.horas : null,
    propuesta: elegidos.map(b => b.matricula),
    pool,
  };
}

/** Datos para la interfaz: zonas → matrículas con sus huecos (por turno) y si ya
 *  están dentro de una vacante viva (para saber qué queda pendiente). */
async function datosGenerador() {
  const { coches } = await cargarCochesBases();
  const { dia: cubDia, noche: cubNoche } = await reservadasPorTurno();

  const zonasMap = new Map();
  coches.forEach(c => {
    const z = c.zona || '(sin zona)';
    const dia = (c.huecos || []).filter(h => h.turno === 'Día').map(h => h.dia);
    const noche = (c.huecos || []).filter(h => h.turno === 'Noche').map(h => h.dia);
    // Un coche interesa si tiene hueco de CT **o la plaza de un FIJO vacía**.
    // Antes solo contaba lo primero, y un coche sin fijo —pero con el descanso
    // cubierto por el correturnos— no salía NI en el desplegable de "Fijo" ni en
    // Pendientes: invisible justo el hueco más gordo.
    const fijos = fijosDe(c);
    if (!dia.length && !noche.length && fijos.fijoDia && fijos.fijoNoche) return;
    if (!zonasMap.has(z)) zonasMap.set(z, []);
    zonasMap.get(z).push({
      matricula: c.matricula, vehiculoId: c.vehiculoId, dia, noche, ...fijos,
      // La plaza de fijo de cada turno, para poder guardar una vacante de fijo
      // apuntando a la plaza y no a un texto.
      plazaFijoDia: (c.plazaFijo['Día'] || {}).plazaId || null,
      plazaFijoNoche: (c.plazaFijo['Noche'] || {}).plazaId || null,
      plazaCtDia: c.plazaCt['Día'] || null,
      plazaCtNoche: c.plazaCt['Noche'] || null,
      enVacanteDia: cubDia.has(c.matricula), enVacanteNoche: cubNoche.has(c.matricula),
    });
  });
  const zonas = [...zonasMap.entries()]
    .map(([zona, matriculas]) => ({ zona, matriculas: matriculas.sort((a, b) => a.matricula.localeCompare(b.matricula)) }))
    .sort((a, b) => a.zona.localeCompare(b.zona, 'es'));
  return { zonas, dias: DIAS_SEM, contratos: await contratos() };
}

// ── Guardar ─────────────────────────────────────────────────────────────────

/**
 * Resuelve la PLAZA de una matrícula para un rol y turno.
 *
 * Si la pantalla ya mandó `plazaId`, se respeta (viene del tablero y es la
 * buena). Si no —o si esa plaza ya se ocupó entre medias—, se busca:
 *   · FIJO → su única plaza de ese turno.
 *   · CT   → la primera de las dos que esté libre y sin comprometer.
 */
async function resolverPlaza({ matricula, plazaId, rol, turno, permitirOcupada }) {
  const r = await db.consulta(
    `SELECT p.plaza_id, p.matricula, p.orden_ct,
            (SELECT a.conductor_id FROM asignacion a
              WHERE a.plaza_id = p.plaza_id AND a.hasta IS NULL AND a.retirada_at IS NULL
              LIMIT 1) AS ocupa,
            EXISTS (SELECT 1 FROM v_plaza_comprometida c WHERE c.plaza_id = p.plaza_id) AS comprometida
       FROM v_plaza p
      WHERE p.matricula = $1 AND p.rol = $2 AND p.turno = $3
      ORDER BY p.orden_ct NULLS FIRST, p.slot`,
    [String(matricula || '').trim().toUpperCase(), rol, turno]);
  if (!r.rows.length) throw new Error(`${matricula} no tiene plaza de ${rol} ${turno}`);

  const pedida = plazaId && r.rows.find(x => String(x.plaza_id) === String(plazaId));
  const vale = x => !x.comprometida && (permitirOcupada || !x.ocupa);
  const elegida = (pedida && vale(pedida)) ? pedida : r.rows.find(vale);
  if (!elegida) {
    const razon = r.rows.every(x => x.comprometida)
      ? 'ya está prometida en otra vacante'
      : 'ya tiene a alguien';
    throw new Error(`La plaza de ${rol === 'CT' ? 'correturnos' : 'fijo'} ${turno} de ${matricula} ${razon}`);
  }
  return String(elegida.plaza_id);
}

/**
 * Guarda la vacante que armó Tráfico en el generador (modo HUECO).
 * @param {{tipo:'fijo'|'ct', turno, contrato, matriculas:[{matricula,plazaId,dias:[0..6],zona}], notas}} data
 */
async function guardar(data = {}, quien = {}) {
  const esFijo = data.tipo === 'fijo';
  const turno = data.turno === 'Noche' ? 'Noche' : 'Día';
  const rol = esFijo ? 'FIJO' : 'CT';
  const mats = (data.matriculas || [])
    .map(m => ({
      matricula: String(m.matricula || '').trim().toUpperCase(),
      plazaId: m.plazaId || null,
      // La pantalla habla en índices 0..6; la base, en ISODOW 1..7.
      dias: (m.dias || []).map(d => Number(d) + 1).filter(d => d >= 1 && d <= 7).sort((a, b) => a - b),
      zona: m.zona || '',
    }))
    .filter(m => m.matricula);
  if (!mats.length) throw new Error('La vacante no tiene matrículas');
  if (esFijo && mats.length > 1) throw new Error('Una vacante de fijo es de UNA matrícula');

  const plazas = [];
  for (const m of mats) {
    // Un fijo llega sin días de la pantalla; `crear` los deriva del descanso del
    // coche (todos menos los que descansa). No se fuerzan a vacío aquí: eso era
    // lo que dejaba la vacante anunciando que se libraba la semana entera.
    plazas.push({
      plazaId: await resolverPlaza({ ...m, rol, turno }),
      dias: m.dias,
    });
  }

  const zonaId = await db.consulta(
    'SELECT base_zona_id FROM v_plaza WHERE plaza_id = $1', [plazas[0].plazaId]);

  const v = await vacantes.crear({
    rol, motivo: 'nueva', turnoId: null,
    zonaId: (zonaId.rows[0] || {}).base_zona_id || null,
    jornadaHoras: [32, 40].includes(Number(data.contrato)) ? Number(data.contrato) : null,
    notas: data.notas,
    plazas,
  }, quien);

  const ficha = await vacantes.ficha(v.id);
  return {
    id: ficha.codigo, vacanteId: ficha.id, puesto: ficha.puesto, turno: ficha.turno,
    zonas: ficha.zonas, libranzas: ficha.libranzas, dias: ficha.dias,
    jornadaHoras: ficha.jornadaHoras, matriculas: ficha.matriculas,
  };
}

/**
 * Guarda una vacante de RECAMBIO a partir de la propuesta.
 *
 * Se acepta que las plazas estén OCUPADAS —es el punto: el dueño se va— pero no
 * que estén ya prometidas en otra vacante.
 */
async function guardarRecambio(data = {}, quien = {}) {
  const cid = Number(data.conductorId);
  if (!cid) throw new Error('Falta el conductor al que se sustituye');
  const p = await vacantes.propuestaRecambio(cid);
  if (p.yaTiene && !data.forzar) {
    throw new Error(`${p.conductor.nombre} ya tiene la vacante ${p.yaTiene} abierta para sustituirlo`);
  }

  // Se pueden quitar plazas: a veces se sustituye solo una parte del correturno.
  const pedidas = Array.isArray(data.plazas) && data.plazas.length
    ? new Set(data.plazas.map(String))
    : new Set(p.plazas.map(x => x.plazaId));
  // Los días van TAL CUAL, también los de un fijo: `propuestaRecambio` ya los
  // calcula como "todos menos el descanso del coche", que es lo que cubre. Antes
  // se vaciaban por ser fijo y la vacante salía diciendo que libraba la semana
  // entera.
  const plazas = p.plazas
    .filter(x => pedidas.has(x.plazaId))
    .map(x => ({ plazaId: x.plazaId, dias: (x.dias || []).slice() }));
  if (!plazas.length) throw new Error('No queda ninguna plaza en el recambio');

  const v = await vacantes.crear({
    rol: p.rol, motivo: 'recambio',
    turnoId: p.turnoId, zonaId: p.zonaId,
    sustituyeA: cid,
    salidaPrevista: data.salidaPrevista || null,
    notas: data.notas || `Recambio de ${p.conductor.nombre}`,
    plazas,
  }, quien);

  const ficha = await vacantes.ficha(v.id);
  return { ...ficha, sustituyeNombre: p.conductor.nombre };
}

module.exports = {
  generarVacante, datosGenerador, guardar, guardarRecambio, contratos,
  // El recambio se lee del repositorio: aquí solo se guarda.
  plantillaPlanificada: vacantes.plantillaPlanificada,
  propuestaRecambio: vacantes.propuestaRecambio,
};
