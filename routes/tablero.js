// ============================================================
// PLANIFICADOR V2 — tablero visual de cuadrantes
// ============================================================
// Hasta ahora esto solo pintaba: leía y guardaba contra /planificador/api/*, la
// API del planificador viejo, que trabaja sobre la HOJA.
//
// Ya no. El V2 tiene su propia API y lee de PostgreSQL. Se separan por dos
// razones, y la segunda es la de peso:
//
//   · El viejo se queda quieto mientras se migra, sin tocarle una línea.
//   · Compartirla obligaba a que los dos hablasen el mismo idioma, y ya no lo
//     hablan: el viejo se entiende por el NOMBRE de BOLT y este por el id del
//     conductor. Mezclarlos sería arrastrar la limitación que veníamos a quitar.
//
// Todo lo que hay aquí es traducción: las reglas están en `repo/planificador` y,
// las de verdad —quién cubre qué día—, en la base.

const express = require('express');
const router = express.Router();

const plan = require('../services/repo/planificador');
const actor = require('../services/repo/actor');
const conds = require('../services/repo/conductores');

const db = require('../services/db');
const { DIAS_SEM, LETRAS_DIA } = require('../services/planificadorV2');

/**
 * Los estados de vehiculo, de la BASE.
 *
 * Antes salian de una lista de simbolos de la hoja ('✓', 'S', 'T'...) y el front
 * decidia si un coche estaba operativo comparando con el '✓'. En la base el
 * codigo es 'O' y quien dice que significa operativo es `cat_estado_vehiculo`,
 * asi que la lista viene de ahi con su bandera puesta.
 */
async function estadosVehiculo() {
  const r = await db.consulta(
    `SELECT codigo, etiqueta, es_operativo, visible_cobertura
       FROM cat_estado_vehiculo ORDER BY orden`);
  return r.rows;
}

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [TABLERO] ${req.method} ${req.path}: ${e.message}`);
    // Un "el coche ya lo lleva otro" NO es un error a secas: es una pregunta. Se
    // devuelve con su código y la comprobación entera para que la pantalla
    // ofrezca planificar a la fuerza sin tener que volver a consultar.
    res.status(400).json({ status: 'error', msg: e.message,
      ...(e.codigo ? { codigo: e.codigo } : {}), ...(e.plan ? { plan: e.plan } : {}) });
  }
};

router.get('/', async (req, res) => {
  let estados = [];
  try { estados = await estadosVehiculo(); }
  catch (e) { console.error('❌ [TABLERO] catálogo de estados:', e.message); }
  res.render('planificadorV2', {
    titulo: 'Planificador',
    seccion: 'planificador',
    layout: 'layout-gestion',
    diasSem: DIAS_SEM,
    letrasDia: LETRAS_DIA,
    estadosVehiculo: estados,
  });
});

// ── El tablero de una semana ───────────────────────────────────────────────
// `?dia=AAAA-MM-DD` decide qué semana se pinta. Por omisión, hoy.
router.get('/api/tablero', responde(async req => plan.tablero({ dia: req.query.dia })));

// ── Guardar ────────────────────────────────────────────────────────────────
// Lo que se guarde vale DESDE el día que se esté mirando, y lo que hubiera antes
// se cierra la víspera. Así se puede poner a uno el 25 y a otro el 28 en la misma
// plaza sin borrar lo del 25.
router.post('/api/guardar', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.guardar(b.cambios || [], { dia: b.dia, ...quien });
  console.log(`💾 [TABLERO] ${r.hechos.length} movimiento(s) con fecha ${r.dia}`);
  // Se devuelve el tablero ya recalculado: el front lo sustituye entero y así no
  // se queda pintando algo que la base ya no dice.
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// ── MODO EVENTOS: abrir las plazas de refuerzo unos días ──────────────────
// La F1, una marcha, un concierto: días en los que hay que sacar más coches.
// Abre CT2 de día y de noche con fecha de caducidad, y se cierra solo cuando
// termina el último turno planificado en ellas (los de noche, a las 05:00 del
// día siguiente). Ver services/repo/eventos.
const eventos = require('../services/repo/eventos');

router.get('/api/eventos', responde(async req => eventos.estado({ dia: req.query.dia })));

router.post('/api/eventos', responde(async req => {
  const b = req.body || {};
  const r = await eventos.crear(b, { usuarioId: await actor.idDe(req) });
  return { ...r, tablero: await plan.tablero({ dia: b.desde }) };
}));

router.post('/api/eventos/:id', responde(async req => {
  const b = req.body || {};
  const r = await eventos.editar(req.params.id, b);
  return { ...r, tablero: await plan.tablero({ dia: b.dia || b.desde }) };
}));

router.post('/api/eventos/:id/cancelar', responde(async req => {
  const b = req.body || {};
  const r = await eventos.cancelar(req.params.id, {
    usuarioId: await actor.idDe(req), nota: b.nota,
  });
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// ── ¿Se puede poner a esta persona aquí estos días? ───────────────────────
// Contesta con los días que va a trabajar en esa matrícula y, de cada uno, si
// choca con otro coche suyo (imposible) o si el coche ya tiene conductor (se
// puede forzar apartándolo). La pantalla lo pregunta ANTES de guardar.
router.post('/api/comprobar', responde(async req => {
  const b = req.body || {};
  return { plan: await plan.comprobarPlan(b) };
}));

// Deshacer un relevo: el del cuadrante vuelve a ser quien conduce ese día.
router.post('/api/relevo/:id/quitar', responde(async req => {
  const r = await plan.quitarRelevo(req.params.id);
  return { ...r, tablero: await plan.tablero({ dia: (req.body || {}).dia }) };
}));

// ── Un coche se cambia por otro y sus conductores se van con él ───────────
// Pasa a menudo —el coche entra en el taller— y hacerlo plaza por plaza son doce
// movimientos: basta equivocarse en uno para dejar a alguien sin coche.
router.post('/api/cambiar-coche', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.cambiarCoche({
    deVehiculoId: b.de, aVehiculoId: b.a, dia: b.dia, soloTurno: b.turno, forzar: !!b.forzar,
  }, quien);
  console.log(`🔁 [TABLERO] ${r.movidos.length} conductor(es) del coche ${b.de} al ${b.a} desde ${r.dia}`);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// ── Cuadrantes: el grupo de coches que comparte correturnos ────────────────
router.get('/api/cuadrantes', responde(async () => ({ cuadrantes: await plan.listarCuadrantes() })));

router.post('/api/cuadrantes', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.crearCuadrante({ zonaId: b.zonaId }, quien);
  console.log(`🧩 [TABLERO] Cuadrante ${r.numero} creado`);
  return { ...r, cuadrantes: await plan.listarCuadrantes() };
}));

// Anadir un bloque (matricula + dias de libranza) a un cuadrante.
router.post('/api/cuadrante/bloque', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.anadirBloque({ cuadranteId: b.cuadranteId, vehiculoId: b.vehiculoId, dias: b.dias }, { dia: b.dia, ...quien });
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

router.delete('/api/cuadrantes/:id', responde(async req => {
  const r = await plan.borrarCuadrante(req.params.id);
  return { ...r, tablero: await plan.tablero({ dia: req.query.dia }) };
}));

// Meter (o sacar, con cuadranteId vacío) un coche de un cuadrante.
router.post('/api/cuadrante/coche', responde(async req => {
  const b = req.body || {};
  const r = await plan.meterCoche(b.vehiculoId, b.cuadranteId || null);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// Asignar (o quitar) el CT de un cuadrante: se reparte entre sus coches.
router.post('/api/cuadrante/ct', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.asignarCTcuadrante({ cuadranteId: b.cuadranteId, turno: b.turno, conductorId: b.conductorId, vehiculos: b.vehiculos }, { dia: b.dia, ...quien });
  console.log(`🔗 [TABLERO] CT ${b.turno} del cuadrante ${b.cuadranteId} en ${r.coches} coche(s)`);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// ── Descanso de un coche: escribe la libranza de sus dos fijos ─────────────
router.post('/api/descanso', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.fijarDescanso(b.vehiculoId, b.dias, { dia: b.dia, ...quien });
  console.log(`🛌 [TABLERO] descanso del coche ${b.vehiculoId} = [${(r.dias || []).join(' ')}] desde ${r.dia}`);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// Reemplazar la matricula de un bloque por una de emergencia: la nueva hereda
// cuadrante, dias y tripulacion. Para cuando un coche se va a taller/siniestro.
router.post('/api/reemplazar-matricula', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.reemplazarMatricula(b.de, b.a, { dia: b.dia, ...quien });
  console.log(`🔧 [TABLERO] matrícula ${b.de} -> ${b.a} (bloque heredado, ${r.movidos} conductor(es)) desde ${r.dia}`);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// Cubrir a quien está de vacaciones sin quitarle la plaza: el sustituto entra
// mientras dura la ausencia y la plaza vuelve sola a su dueño el día que este
// regresa. Sin fechas, se cogen las de la ausencia.
router.post('/api/cubrir', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.cubrirAusencia({
    plazaId: b.plazaId, conductorId: b.conductorId,
    desde: b.desde || null, hasta: b.hasta === undefined ? undefined : (b.hasta || null),
    dias: b.dias,
  }, { dia: b.dia, ...quien });
  console.log(`🛟 [TABLERO] plaza ${b.plazaId} cubierta por ${b.conductorId} ` +
    `del ${r.cubierta.desde} al ${r.cubierta.hasta || 'sin fecha'}` +
    (r.vuelve ? ` · vuelve su titular el ${r.vuelve.desde}` : ' · SIN vuelta programada'));
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

// ── Libranza excepcional: el swap de una semana ────────────────────────────
router.post('/api/libranza-excepcional', responde(async req => {
  const b = req.body || {};
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await plan.crearLibranzaExcepcional({
    conductorId: b.conductorId, diaTrabaja: b.diaTrabaja, diaLibra: b.diaLibra, motivo: b.motivo,
  }, quien);
  console.log(`🔀 [TABLERO] libranza excepcional del conductor ${b.conductorId}: trabaja ${b.diaTrabaja}, libra ${b.diaLibra}`);
  return { ...r, tablero: await plan.tablero({ dia: b.dia }) };
}));

router.delete('/api/libranza-excepcional/:id', responde(async req => {
  const r = await plan.borrarLibranzaExcepcional(req.params.id);
  return { ...r, tablero: await plan.tablero({ dia: req.query.dia }) };
}));

// ── El barrio del conductor (su zona de casa: "Aluche", "San Blas"…) ───────
// Editable desde la carta del cuadrante y el banquillo. Escribe conductor.barrio
// (campo operativo de la ficha), NUNCA localidad (el municipio de la gestoría).
router.post('/api/barrio', responde(async req => {
  const b = req.body || {};
  const id = Number(b.conductorId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Falta el conductor');
  const barrio = String(b.barrio || '').trim().slice(0, 60);
  await conds.actualizar(id, { barrio },
    { usuarioId: await actor.idDe(req), rol: (req.usuario && req.usuario.rol) || '' });
  console.log(`📍 [TABLERO] barrio del conductor ${id} = "${barrio}"`);
  return { barrio };
}));

// ── Incorporaciones: la alerta que no se va hasta aceptarla o rechazarla ───
// Nace al dar de alta con vacante (ETT). Aceptar = auto-colocar en las plazas
// de la vacante (todo o nada); rechazar = queda en el banquillo y la vacante
// vuelve a Abierta. Sustituye al módulo /incorporaciones.
const inc = require('../services/repo/incorporaciones');

router.get('/api/incorporaciones', responde(async () => ({ incorporaciones: await inc.pendientes() })));

router.post('/api/incorporaciones/:id/aceptar', responde(async req => {
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await inc.aceptar(req.params.id, quien);
  console.log(`✅ [TABLERO] Incorporación ${req.params.id} aceptada (${r.plazas} plaza(s))`);
  return { ...r, tablero: await plan.tablero({ dia: (req.body || {}).dia }) };
}));

router.post('/api/incorporaciones/:id/rechazar', responde(async req => {
  const quien = { usuarioId: await actor.idDe(req) };
  const r = await inc.rechazar(req.params.id, { ...quien, motivo: (req.body || {}).motivo });
  console.log(`🚫 [TABLERO] Incorporación ${req.params.id} rechazada`);
  return r;
}));

module.exports = router;
