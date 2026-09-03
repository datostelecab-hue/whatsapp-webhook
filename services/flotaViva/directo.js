// ============================================================
// EN DIRECTO — la fusión: plan del Cuadrante × realidad viva
// ============================================================
// El cockpit de tráfico. Junta tres cosas que hasta ahora vivían separadas:
//
//   PLAN      quién DEBÍA ir hoy en cada coche, turno de día y de noche.
//             Sale del Cuadrante (planificador V2, Postgres) vía `tablero()`.
//   REALIDAD  quién está conectado AHORA, en qué (viaje/espera/descanso), cuánto
//             lleva y cuántos km. Sale de Flota Viva (`fv_ahora`).
//   ALERTAS   lo que hay que llamar: las incidencias abiertas del coche, con sus
//             botones (Justificar / He llamado) y el teléfono.
//
// NO SE HACE JOIN EN SQL entre los dos mundos. El Cuadrante vive en la base
// principal y Flota Viva puede vivir en otra (FLOTA_VIVA_DB_URL). Se piden por
// separado —cada uno a su pool— y se cruzan aquí en JS por matrícula normalizada,
// que es lo único que comparten. Así funciona apunten donde apunten las dos.

const panel = require('./panel');
const { normMat } = require('./fuentes');

const TZ = 'Europe/Madrid';

/** Hoy en Madrid, 'YYYY-MM-DD'. El plan y las incidencias son del día operativo. */
function hoyMadrid() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** El día anterior a una fecha 'YYYY-MM-DD'. */
function ayerDe(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D - 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Índice del día en la semana del Cuadrante: 0=Lunes … 6=Domingo. */
function idxDiaSemana(iso) {
  const [Y, M, D] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D, 12));
  return (d.getUTCDay() + 6) % 7;
}

/** El nombre de una celda de cobertura (semana[]) o '' si no hay nadie. */
function nombreCelda(celda) {
  return celda && celda.nombre ? String(celda.nombre) : '';
}

/**
 * Normaliza un nombre para cruzar el plan (agenda) con quien trabajó (BOLT): en
 * minúsculas, sin acentos y con los tokens ordenados, así "Juan Perez Gomez" y
 * "Gomez, Juan Pérez" caen en la misma clave. Es la misma idea que normClave, pero
 * local para no acoplar Flota Viva a services/conductores.
 */
function normNombre(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

/**
 * El estado de un coche de un vistazo. Es lo que pinta el chip.
 *
 * Precedencia pensada para tráfico: primero lo que exige acción (una alerta
 * abierta manda sobre todo lo demás), luego lo que está roto (fuera de servicio),
 * luego lo que rueda, y al final lo que debía salir y no aparece.
 */
function calcEstado({ plan, vivo, nIncidencias, operativo }) {
  const debia = !!(plan.dia || plan.noche);
  if (nIncidencias > 0) {
    return { codigo: 'alerta', etiqueta: nIncidencias + (nIncidencias > 1 ? ' avisos' : ' aviso'), tono: 'error' };
  }
  if (!operativo) return { codigo: 'fuera', etiqueta: 'Fuera de servicio', tono: 'muted' };
  if (vivo && vivo.conectado) {
    if (vivo.situacion === 'descanso') {
      return vivo.km
        ? { codigo: 'descanso_rodando', etiqueta: 'En descanso · rodando', tono: 'aviso' }
        : { codigo: 'descanso', etiqueta: 'En descanso', tono: 'ok' };
    }
    return { codigo: 'trabajando', etiqueta: vivo.etiqueta || 'Conectado', tono: 'ok' };
  }
  if (debia) return { codigo: 'sin_conexion', etiqueta: 'Debía salir · sin conexión', tono: 'aviso' };
  if (vivo) return { codigo: 'desconectado', etiqueta: 'Desconectado', tono: 'muted' };
  return { codigo: 'idle', etiqueta: '—', tono: 'muted' };
}

/**
 * El cockpit entero.
 *
 * Una fila por coche que importe AHORA: los que estaban planificados hoy, los que
 * están conectados aunque no tocara, y los que tienen una alerta abierta. Cada
 * fila trae su plan, su realidad y sus alertas ya cruzados.
 */
async function enDirecto({ dia } = {}) {
  const hoy = (dia && String(dia).slice(0, 10)) || hoyMadrid();
  const ayer = ayerDe(hoy);
  const idx = idxDiaSemana(hoy);

  // Las tablas fv_* tienen que existir antes de consultarlas. Es idempotente y
  // se cachea: solo hace algo la primera vez tras arrancar.
  await require('./db').preparar().catch(() => {});

  // Cada fuente a su pool. Si Flota Viva se cae, el plan se ve igual (y al revés).
  const plani = require('../repo/planificador');   // base principal (Cuadrante)
  const rutas = require('./rutas');
  const [tab, est, incHoy, incAyer, kmHoy, kmCond, horasCond] = await Promise.all([
    plani.tablero({ dia: hoy }).catch(e => { console.error('❌ [EN DIRECTO] Cuadrante:', e.message); return null; }),
    panel.estado().catch(e => { console.error('❌ [EN DIRECTO] Flota viva:', e.message); return null; }),
    // Las incidencias abiertas de hoy y de ayer: la franja de noche empieza hoy y
    // termina de madrugada con el día operativo de ayer, así que a las 02:00 lo
    // que sigue vivo es "de ayer". Se juntan las dos y se quitan duplicados.
    panel.incidencias({ dia: hoy }).catch(() => []),
    panel.incidencias({ dia: ayer }).catch(() => []),
    // Los km de hoy salen del NÚCLEO (fv_ruta, route/list), no del `mileage`
    // estancado. Si aún no se ha ingerido, sale vacío y el coche muestra 0.
    rutas.kmPorCoche(hoy).catch(() => new Map()),
    // Km y horas POR CONDUCTOR del día operativo (05→05), para detectar a quien
    // trabajó sin estar en el plan. Con matrícula: BOLT sabe con qué coche rodó.
    rutas.kmConectadoDesconectado(hoy, 'operativo').catch(() => ({ conductores: [] })),
    rutas.horasConectadasPorConductor(hoy, 'operativo').catch(() => new Map()),
  ]);

  // ── Realidad viva: matrícula normalizada → su fila de fv_ahora ──────────────
  const vivos = new Map();
  if (est) {
    [].concat(est.conectados || [], est.recienCaidos || [], est.parados || [])
      .forEach(v => { if (v.matricula) vivos.set(normMat(v.matricula), v); });
  }

  // ── Alertas abiertas: matrícula normalizada → [incidencias] ─────────────────
  const porInc = new Map();
  const vistas = new Set();
  [].concat(incAyer || [], incHoy || []).forEach(i => {
    if (vistas.has(i.id)) return;      // hoy pisa a ayer si por lo que sea saliera en las dos
    vistas.add(i.id);
    const k = normMat(i.matricula);
    if (!porInc.has(k)) porInc.set(k, []);
    porInc.get(k).push(i);
  });

  // ── El plan: una fila por coche del Cuadrante ───────────────────────────────
  const filas = [];
  const usadas = new Set();
  const coches = (tab && tab.coches) || [];
  coches.forEach(c => {
    const k = normMat(c.matricula);
    usadas.add(k);
    const plan = {
      dia: nombreCelda(c.semana && c.semana[idx * 2]),
      noche: nombreCelda(c.semana && c.semana[idx * 2 + 1]),
    };
    const vivo = vivos.get(k) || null;
    const incidencias = porInc.get(k) || [];
    const kmc = kmHoy.get(k) || {};
    filas.push({
      matricula: c.matricula, matriculaNorm: k,
      zona: c.zona || '', cuadrante: c.cuadrante || '',
      estadoVeh: c.estadoVeh || '', operativo: c.operativo !== false,
      plan, vivo, incidencias,
      km: kmc.km || 0, viajes: kmc.viajes || 0,
      enPlan: true,
      estado: calcEstado({ plan, vivo, nIncidencias: incidencias.length, operativo: c.operativo !== false }),
    });
  });

  // ── Los que ruedan (o avisan) sin estar en el plan de hoy ───────────────────
  // Un coche conectado que hoy no tocaba, o con una alerta y sin plaza en el
  // Cuadrante. Tráfico tiene que verlos igual: son justo los que se escapan.
  const extra = new Set();
  vivos.forEach((v, k) => { if (!usadas.has(k) && v.conectado) extra.add(k); });
  porInc.forEach((_, k) => { if (!usadas.has(k)) extra.add(k); });
  extra.forEach(k => {
    const vivo = vivos.get(k) || null;
    const incidencias = porInc.get(k) || [];
    const kmc = kmHoy.get(k) || {};
    const plan = { dia: '', noche: '' };
    filas.push({
      matricula: (vivo && vivo.matricula) || (incidencias[0] && incidencias[0].matricula) || k,
      matriculaNorm: k,
      zona: '', cuadrante: '', estadoVeh: '', operativo: true,
      plan, vivo, incidencias,
      km: kmc.km || 0, viajes: kmc.viajes || 0,
      enPlan: false,
      estado: calcEstado({ plan, vivo, nIncidencias: incidencias.length, operativo: true }),
    });
  });

  // Orden: primero lo que pide acción (alertas), luego descanso rodando, luego el
  // resto; dentro de cada grupo, por matrícula.
  const peso = { alerta: 0, descanso_rodando: 1, sin_conexion: 2, descanso: 3, trabajando: 4, desconectado: 5, fuera: 6, idle: 7 };
  filas.sort((a, b) =>
    (peso[a.estado.codigo] ?? 9) - (peso[b.estado.codigo] ?? 9) ||
    a.matricula.localeCompare(b.matricula));

  // ── TRABAJANDO SIN PLAN ─────────────────────────────────────────────────────
  // Conductores que hoy trabajaron (km en su día operativo) o están conectados
  // ahora, pero NO están en el Cuadrante. BOLT sabe con qué coche rodaron y cuánto,
  // aunque el plan no los tuviera — es justo el caso que hay que ver y luego cuadrar
  // en el reporte. Se cruza por nombre normalizado (plan de la agenda ↔ BOLT).
  const planificados = new Set();
  const anota = n => { const k = normNombre(n); if (k) planificados.add(k); };
  ((tab && tab.conductores) || []).forEach(c => { anota(c.nombre); anota(c.idBolt); });
  ((tab && tab.coches) || []).forEach(co => {
    (co.personas || []).forEach(p => anota(p && p.nombre));
    (co.semana || []).forEach(cell => anota(cell && cell.nombre));
  });
  // Y —clave— por el NOMBRE DE BOLT del planificado, resuelto por el enlace por
  // teléfono (conductor_externo → fv_conductor). El nombre de la plantilla y el de
  // BOLT pueden diferir (p.ej. "Tukieth" vs "Yulieth"); cruzar solo por el de la
  // plantilla marcaba como "sin plan" a alguien que SÍ está en el Cuadrante.
  try {
    // TODOS los conductor_id del plan: banquillo/lista (c.id), plazas fijas
    // (persona.id) y celdas de cuadrante/CT (celda.id). El id del tablero es `.id`.
    const idsPlan = new Set();
    const meter = v => { const n = Number(v); if (n) idsPlan.add(n); };
    ((tab && tab.conductores) || []).forEach(c => meter(c && c.id));
    ((tab && tab.coches) || []).forEach(co => {
      (co.personas || []).forEach(p => meter(p && p.id));
      (co.semana || []).forEach(cell => meter(cell && cell.id));
    });
    if (idsPlan.size) {
      // El nombre de BOLT del planificado sale DIRECTO de conductor_externo.externo_nombre
      // (lo sincroniza el cazamiento), sin depender de que fv_conductor tenga el uuid.
      const r = await require('../db').consulta(
        `SELECT externo_nombre AS bolt_nombre
           FROM conductor_externo
          WHERE sistema = 'bolt' AND externo_nombre IS NOT NULL
            AND conductor_id = ANY($1::bigint[])`, [[...idsPlan]]);
      r.rows.forEach(x => anota(x.bolt_nombre));
    }
  } catch (e) { console.error('⚠️  [EN DIRECTO] enganche BOLT-nombre del plan:', e.message); }
  const conectadosAhora = new Set();
  vivos.forEach(v => { if (v.conectado && v.conductor) conectadosAhora.add(normNombre(v.conductor)); });

  const sinPlan = ((kmCond && kmCond.conductores) || [])
    .filter(c => c.conductor && c.conductor !== '(sin conductor)')
    .filter(c => !planificados.has(normNombre(c.conductor)))
    .filter(c => (c.total || 0) > 0 || conectadosAhora.has(normNombre(c.conductor)))
    .map(c => ({
      conductor: c.conductor,
      matricula: c.matricula, matriculas: c.matriculas || [],
      enBolt: c.enBolt, desconectado: c.desconectado, total: c.total,
      minutos: horasCond.get(c.conductor) || 0,
      conectadoAhora: conectadosAhora.has(normNombre(c.conductor)),
    }))
    .sort((a, b) => Number(b.conectadoAhora) - Number(a.conectadoAhora) || b.total - a.total);

  const resumen = {
    coches: filas.length,
    enPlan: filas.filter(f => f.enPlan).length,
    conectados: filas.filter(f => f.vivo && f.vivo.conectado).length,
    enDescanso: filas.filter(f => f.estado.codigo === 'descanso' || f.estado.codigo === 'descanso_rodando').length,
    sinConexion: filas.filter(f => f.estado.codigo === 'sin_conexion').length,
    alertas: filas.reduce((s, f) => s + f.incidencias.length, 0),
    fueraDePlan: filas.filter(f => !f.enPlan).length,
    // Km de toda la flota hoy, del núcleo. Es el número que hoy salía en 0.
    kmHoy: Math.round(filas.reduce((s, f) => s + (f.km || 0), 0) * 10) / 10,
    // Conductores que trabajaron sin estar en el plan.
    sinPlan: sinPlan.length,
  };

  // ── POR TURNO, POR CONDUCTOR (pestañas Día / Noche / TodoTurno / NN) ─────────
  // Cada fila es una PERSONA del cuadrante de hoy (la celda día/noche del tablero,
  // que trae conductor_id + nombre), con su trazo VIVO cruzado por el enlace de BOLT
  // (conductor_externo → conductor_id): así sale su km/horas aunque el nombre de BOLT
  // y el de la plantilla difieran. Los NN = los que ruedan sin plan.
  const boltNombreAId = new Map();   // normNombre(nombre de BOLT) → conductor_id
  try {
    const rid = await require('../db').consulta(
      `SELECT conductor_id, externo_nombre FROM conductor_externo
        WHERE sistema = 'bolt' AND conductor_id IS NOT NULL AND externo_nombre IS NOT NULL`);
    rid.rows.forEach(x => boltNombreAId.set(normNombre(x.externo_nombre), Number(x.conductor_id)));
  } catch (e) { console.error('⚠️  [EN DIRECTO] mapa BOLT→id:', e.message); }

  const actividadPorId = new Map();   // conductor_id → {km, minutos, conectado, matriculas}
  ((kmCond && kmCond.conductores) || []).forEach(c => {
    const cid = boltNombreAId.get(normNombre(c.conductor));
    if (!cid) return;
    const a = actividadPorId.get(cid) || { km: 0, minutos: 0, conectado: false, matriculas: [] };
    a.km = Math.round((a.km + (c.total || 0)) * 10) / 10;
    a.minutos += horasCond.get(c.conductor) || 0;
    a.conectado = a.conectado || conectadosAhora.has(normNombre(c.conductor));
    (c.matriculas || []).forEach(m => { if (m && !a.matriculas.includes(m)) a.matriculas.push(m); });
    actividadPorId.set(cid, a);
  });

  // QUIÉN TRABAJA HOY, por turno — de la COBERTURA del día (c.semana), no del roster:
  // si el fijo libra hoy (su coche descansa), sale su CT que lo cubre, no el fijo. Se
  // agrupa POR CONDUCTOR (un CT cubre varios coches → una sola fila con sus matrículas).
  // El rol (FIJO/CT) se saca de las plazas del coche; el trazo vivo, por conductor_id.
  const crudo = { dia: [], noche: [], todoturno: [] };
  coches.forEach(c => {
    const rolDe = new Map();
    (c.personas || []).forEach(p => { if (p && p.id) rolDe.set(String(p.id), p.rol || ''); });
    const cd = (c.semana && c.semana[idx * 2]) || {};       // quién cubre DÍA hoy
    const cn = (c.semana && c.semana[idx * 2 + 1]) || {};    // quién cubre NOCHE hoy
    const add = (cell, turno) => {
      if (!cell.id && !cell.nombre) return;                  // sin cubrir hoy → nadie
      crudo[turno].push({
        conductorId: cell.id || '', conductor: cell.nombre || '', turno,
        rol: rolDe.get(String(cell.id)) || '',
        matricula: c.matricula, cuadrante: c.cuadrante || '',
        actividad: (cell.id && actividadPorId.get(Number(cell.id))) || null,
        incidencias: porInc.get(normMat(c.matricula)) || [],
      });
    };
    add(cd, 'dia'); add(cn, 'noche');
  });
  const agrupaConductor = plazas => {
    const m = new Map();
    plazas.forEach(p => {
      const clave = p.conductorId ? ('id:' + p.conductorId) : ('n:' + normNombre(p.conductor));
      if (!m.has(clave)) m.set(clave, { clave, conductorId: p.conductorId, conductor: p.conductor,
        turno: p.turno, roles: new Set(), matriculas: [], cuadrantes: new Set(), actividad: p.actividad, incidencias: [] });
      const f = m.get(clave);
      if (p.rol) f.roles.add(p.rol);
      if (p.matricula && !f.matriculas.includes(p.matricula)) f.matriculas.push(p.matricula);
      if (p.cuadrante) f.cuadrantes.add(p.cuadrante);
      if (!f.actividad && p.actividad) f.actividad = p.actividad;
      (p.incidencias || []).forEach(i => { if (!f.incidencias.some(x => x.id === i.id)) f.incidencias.push(i); });
    });
    return [...m.values()].map(f => {
      // El coche a trazar: el que de verdad rodó (actividad), o el primero asignado.
      const trazoMat = (f.actividad && (f.actividad.matriculas || [])[0]) || f.matriculas[0] || '';
      return {
        clave: f.clave, conductorId: f.conductorId, conductor: f.conductor, turno: f.turno,
        rol: f.roles.has('FIJO') ? 'FIJO' : (f.roles.has('CT') ? 'CT' : ''),
        matriculas: f.matriculas, trazoMat, matriculaNorm: trazoMat ? normMat(trazoMat) : '',
        cuadrante: [...f.cuadrantes][0] || '', cuadrantes: [...f.cuadrantes],
        actividad: f.actividad, incidencias: f.incidencias,
      };
    });
  };
  const porTurno = {
    dia: agrupaConductor(crudo.dia), noche: agrupaConductor(crudo.noche),
    todoturno: agrupaConductor(crudo.todoturno), nn: sinPlan,
  };
  const yaSalio = f => (f.actividad && f.actividad.conectado) ? 1 : 0;
  const ordena = arr => arr.sort((a, b) =>
    (a.cuadrante || '').localeCompare(b.cuadrante || '') ||
    (yaSalio(b) - yaSalio(a)) ||                                 // los que YA SALIERON, primero
    (a.conductor || '').localeCompare(b.conductor || ''));
  ordena(porTurno.dia); ordena(porTurno.noche); ordena(porTurno.todoturno);

  return {
    dia: hoy,
    fecha: hoy.split('-').reverse().join('/'),
    hayCuadrante: !!tab,
    hayFlotaViva: !!est,
    ultimaVuelta: est ? est.ultimaVuelta : null,
    resumen,
    coches: filas,
    sinPlan,
    porTurno,
  };
}

module.exports = { enDirecto };
