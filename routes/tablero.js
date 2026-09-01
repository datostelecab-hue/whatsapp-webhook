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
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  let estados = [];
  try { estados = await estadosVehiculo(); }
  catch (e) { console.error('❌ [TABLERO] catálogo de estados:', e.message); }
  res.render('planificadorV2', {
    titulo: 'Cuadrante',
    seccion: 'planificador-v2',
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

module.exports = router;
