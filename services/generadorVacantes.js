// ============================================================
// GENERADOR DE VACANTES (correturnos)
// ============================================================
// Arma la semana de un conductor nuevo encadenando huecos de varias matrículas.
// Regla del negocio: los turnos fijos libran 2 días, y en esos 2 días entra el
// correturno. Por eso cada matrícula aporta un BLOQUE = sus días de hueco (2 en
// el caso normal), y se cogen enteros. La vacante se pide por CONTRATO: 32 h =
// 4 días (2 bloques), 40 h = 6 días (3 bloques) — lo dice cat_jornada, no una
// lista escrita aquí. Los bloques deben tener días DISJUNTOS (un conductor no
// puede estar en dos coches el mismo día). Prioriza la misma zona; si no
// completa, propone la zona más cercana (por coordenadas de base_zona), y
// Tráfico decide si la toma.
//
// La fuente es el tablero de POSTGRESQL (repo/planificador): un HUECO de CT es
// un día en que el coche descansa (sus fijos libran) y el tramo de ese turno se
// queda sin nadie según f_cobertura. Antes esto leía el tablero de la hoja, que
// se quedó congelado con la migración: generaba vacantes de un mundo que ya no
// existe.

const plani = require('./repo/planificador');
const db = require('./db');
const { leerVacantesGuardadas } = require('./vacantes');

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
  // La zona del coche es la de su CUADRANTE (la del coche a pelo suele venir vacía).
  const zonaCua = new Map((tab.cuadrantes || []).map(cu => [String(cu.id), cu.zona || '']));
  const coches = (tab.coches || [])
    .filter(c => c.operativo && c.matricula)
    .map(c => {
      const zona = (c.cuadranteId && zonaCua.get(String(c.cuadranteId))) || c.zona || '';
      // HUECO de CT = día de descanso del coche (1-7) cuyo tramo de ese turno se
      // queda SIN NADIE en la semana del tablero (la verdad de f_cobertura).
      const huecos = [];
      (c.descanso || []).forEach(d => {
        ['Día', 'Noche'].forEach((turno, off) => {
          const celda = (c.semana || [])[(Number(d) - 1) * 2 + off] || {};
          if (!celda.id) huecos.push({ dia: Number(d) - 1, turno });
        });
      });
      return { matricula: c.matricula, zona, personas: c.personas || [], huecos };
    });
  return { coches, bases: basesQ.rows };
}

// Cuántos días trabaja el contrato (32 h → 4, 40 h → 6): lo dice cat_jornada.
let _contratos = null;
async function contratos() {
  if (_contratos) return _contratos;
  const r = await db.consulta('SELECT horas::float AS horas, etiqueta, dias_ct FROM cat_jornada WHERE activa ORDER BY orden');
  _contratos = r.rows.map(x => ({ horas: Number(x.horas), etiqueta: x.etiqueta, dias: Number(x.dias_ct) }));
  return _contratos;
}

/** Matrículas ya reservadas en una vacante ABIERTA, por turno (Set por turno). */
async function reservadasPorTurno() {
  const dia = new Set(), noche = new Set();
  try {
    (await leerVacantesGuardadas())
      .filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta')
      .forEach(v => {
        const set = v.turno === 'Noche' ? noche : dia;
        (v.matriculas || []).forEach(m => set.add(m.m));
      });
  } catch (_) { /* si no se puede leer, no se reserva nada */ }
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
    return { matricula: c.matricula, zona: c.zona || '(sin zona)', dias, ...fijosDe(c) };
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
 * Genera una propuesta de vacante.
 * @param {{zona, turno, dias, matricula}} opt
 */
async function generarVacante(opt = {}) {
  const zona = String(opt.zona || '').trim();
  const turno = opt.turno === 'Noche' ? 'Noche' : 'Día';
  // La vacante se pide por CONTRATO (32/40 h) y el catálogo dice los días; se
  // admite `dias` a pelo por compatibilidad.
  const cts = await contratos();
  const ct = cts.find(c => c.horas === Number(opt.contrato)) || null;
  const objetivo = ct ? ct.dias
    : ([2, 4, 6].includes(Number(opt.dias)) ? Number(opt.dias) : 6);
  const matricula = String(opt.matricula || '').trim();
  if (!zona || !matricula) throw new Error('Faltan la zona y la matrícula de partida');

  const { coches, bases } = await cargarCochesBases();
  // Una matrícula ya reservada en otra vacante abierta NO se puede reutilizar (si
  // no, se crearían dos vacantes para el mismo coche/turno).
  const reservadas = (await reservadasPorTurno())[turno === 'Noche' ? 'noche' : 'dia'];
  if (reservadas.has(matricula)) {
    throw new Error(`La matrícula ${matricula} ya está reservada en una vacante abierta de ${turno}`);
  }
  const bloques = bloquesDe(coches, turno).filter(b => !reservadas.has(b.matricula));
  const inicio = bloques.find(b => b.matricula === matricula && b.zona === zona);
  if (!inicio) throw new Error(`La matrícula ${matricula} no tiene huecos de ${turno} en ${zona}`);

  const dist = distanciaEntreZonas(bases);
  // Candidatos ordenados por preferencia: misma zona primero, luego por cercanía.
  const candidatos = bloques.filter(b => b !== inicio).sort((a, b) => {
    const sa = a.zona === zona, sb = b.zona === zona;
    if (sa !== sb) return sa ? -1 : 1;
    if (sa) return a.matricula.localeCompare(b.matricula);
    return dist(zona, a.zona) - dist(zona, b.zona);
  });

  const exacto = buscarExacto(inicio, candidatos, objetivo);
  const elegidos = exacto || rellenoParcial(inicio, candidatos, objetivo);

  // Cada bloque en formato de salida (matrícula · ambos fijos · días · zona/km).
  const aSalida = b => ({
    matricula: b.matricula,
    zona: b.zona,
    fijoDia: b.fijoDia, fijoNoche: b.fijoNoche,
    sugerido: b.zona !== zona,
    km: b.zona !== zona ? Math.round(dist(zona, b.zona) * 10) / 10 : 0,
    dias: b.dias.map(d => ({ dia: d, nombre: DIAS_SEM[d] }))
  });

  // Pool = matrícula de partida + candidatos en orden de preferencia (misma zona,
  // luego por cercanía). El front lo usa para que Tráfico añada/quite a criterio.
  const pool = [inicio, ...candidatos].slice(0, 60).map(aSalida);

  return {
    zona, turno, objetivo,
    contrato: ct ? ct.horas : null,
    propuesta: elegidos.map(b => b.matricula),   // asignación automática (matrículas)
    pool
  };
}

/** Datos para la interfaz: zonas → matrículas con sus huecos (por turno) y si ya
 *  están dentro de una vacante guardada (para saber qué queda pendiente). */
async function datosGenerador() {
  const { coches } = await cargarCochesBases();

  // Matrículas ya reservadas por una vacante abierta, por turno.
  const { dia: cubDia, noche: cubNoche } = await reservadasPorTurno();

  const zonasMap = new Map();
  coches.forEach(c => {
    const z = c.zona || '(sin zona)';
    const dia = (c.huecos || []).filter(h => h.turno === 'Día').map(h => h.dia);
    const noche = (c.huecos || []).filter(h => h.turno === 'Noche').map(h => h.dia);
    if (!dia.length && !noche.length) return;
    if (!zonasMap.has(z)) zonasMap.set(z, []);
    zonasMap.get(z).push({
      matricula: c.matricula, dia, noche, ...fijosDe(c),
      enVacanteDia: cubDia.has(c.matricula), enVacanteNoche: cubNoche.has(c.matricula)
    });
  });
  const zonas = [...zonasMap.entries()]
    .map(([zona, matriculas]) => ({ zona, matriculas: matriculas.sort((a, b) => a.matricula.localeCompare(b.matricula)) }))
    .sort((a, b) => a.zona.localeCompare(b.zona, 'es'));
  return { zonas, dias: DIAS_SEM, contratos: await contratos() };
}

module.exports = { generarVacante, datosGenerador };
