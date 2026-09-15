// ============================================================
// FLOTA — controlador (lo que queda de "Flota Viva", 11/09/2026)
// ============================================================
// LAS DOS PANTALLAS YA NO EXISTEN: contaban un sistema de alertas de vehículo
// apagado desde el 08/09 y enseñaban una foto fija. Sus URLs redirigen para no
// romper favoritos. Lo que sigue vivo son las APIs, y las consume el cockpit de
// Control: la traza de un conductor, las incidencias del coche y su gestión.
//
// Se monta en `/flota-viva`. El prefijo se queda: cambiarlo obligaría a tocar
// las vistas y a romper enlaces guardados, y no gana nada.

const express = require('express');
const router = express.Router();
const flota = require('./flota.service');

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [FLOTA] ${req.method} ${req.path}: ${e.message}`);
    res.status(500).json({ status: 'error', msg: e.message });
  }
};

/**
 * Los backfills rehacen datos de meses enteros: solo desarrollador/superadmin.
 * Es autorización, así que va aquí y no en el servicio.
 */
const soloDev = fn => async (req, res) => {
  const rol = req.usuario && req.usuario.rol;
  if (rol !== 'superadmin' && rol !== 'desarrollador') {
    return res.status(403).json({ status: 'error', msg: 'Solo desarrollador/superadmin' });
  }
  return responde(fn)(req, res);
};

// Las dos pantallas retiradas. 301 no: un permanente se queda cacheado en el
// navegador para siempre y ata las manos si mañana hay que volver a usar la URL.
router.get('/', (req, res) => res.redirect(302, '/control'));
router.get('/partes', (req, res) => res.redirect(302, '/control/historico'));

// ── El panel ───────────────────────────────────────────────────────────────

router.get('/api/estado', responde(() => flota.estado()));

router.get('/api/historial/:matricula', responde(async req =>
  ({ historial: await flota.historial(req.params.matricula, req.query.dias) })));

// Como el anterior pero POR CONDUCTOR: sus trazos de hoy en cualquier coche.
router.get('/api/historial-conductor/:conductorId', responde(async req =>
  ({ historial: await flota.historialConductor(req.params.conductorId, req.query.dias) })));

// Fuerza una vuelta sin esperar al cron. Es lo que se pulsa cuando alguien dice
// "acabo de desconectarme y no salgo".
router.post('/api/refrescar', responde(() => flota.refrescar()));

// ── Las franjas críticas ───────────────────────────────────────────────────

router.get('/api/incidencias', responde(async req =>
  ({ incidencias: await flota.incidencias({ dia: req.query.dia, franja: req.query.franja, todas: req.query.todas }) })));

router.get('/api/incidencia/:id/clasificacion', responde(async req =>
  ({ clasificacion: await flota.clasificacionDe(req.params.id) })));

router.get('/api/franjas', responde(async () => ({ franjas: await flota.franjas() })));

router.get('/api/gestiones', responde(async () => ({ gestiones: await flota.gestiones() })));

/** Quién firma la gestión, tal y como se queda apuntado. */
const quienDe = req => (req.usuario && (req.usuario.nombre || req.usuario.email)) || '';

router.post('/api/incidencia/:id/justificar', responde(req =>
  flota.justificar(req.params.id, req.body || {}, quienDe(req))));

router.post('/api/incidencia/:id/he-llamado', responde(req =>
  flota.heLlamado(req.params.id, quienDe(req), (req.body || {}).nota)));

router.get('/api/incidencia/:id/seguimientos', responde(async req =>
  ({ seguimientos: await flota.seguimientos(req.params.id) })));

// El parte de una franja. Es lo que se mira al cierre.
router.get('/api/cierre', responde(req =>
  flota.cierre({ dia: req.query.dia, franja: req.query.franja })));

// Los partes de varios días, para elegir cuál mirar. La columna que importa es
// la de "sin revisar".
router.get('/api/partes', responde(async req =>
  ({ partes: await flota.partes({ desde: req.query.desde, hasta: req.query.hasta }) })));

// ── Depuración y relleno ───────────────────────────────────────────────────

router.get('/api/mapon/:matricula', responde(req => flota.maponDe(req.params.matricula)));

router.get('/api/mapon-rutas/:matricula', responde(req =>
  flota.maponRutas(req.params.matricula, req.query.horas)));

//   /flota-viva/api/ingestar-rutas?dias=2
//   /flota-viva/api/ingestar-rutas?desde=2026-09-01&hasta=2026-09-02T23:59:59Z
router.get('/api/ingestar-rutas', soloDev(req => flota.ingestarRutas({
  desde: req.query.desde, hasta: req.query.hasta, dias: req.query.dias, bg: req.query.bg,
})));

// Ej (migración): ?desde=2026-07-01
router.get('/api/backfill-tramos', soloDev(req => flota.backfillTramos({
  desde: req.query.desde, hasta: req.query.hasta, bg: req.query.bg,
})));

router.get('/api/backfill-orders', soloDev(req => flota.backfillOrders({
  desde: req.query.desde, hasta: req.query.hasta, bg: req.query.bg,
})));

router.get('/api/km-hoy', responde(req => flota.kmDeHoy(req.query.dia)));

module.exports = router;
