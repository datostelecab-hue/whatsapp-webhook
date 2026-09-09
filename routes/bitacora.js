const express = require('express');
const router = express.Router();
// Bitácora desde PostgreSQL (antes: hoja VISTA_FINAL en services/bitacora.js).
const { leerBitacora, leerVacaciones, marcarLibranza, quitarLibranza, sellarHoras } = require('../services/repo/bitacora');
const repoJust = require('../services/repo/justificantes');
const actor = require('../services/repo/actor');
const sesion = require('../services/sesion');   // para el guard del desarrollador

// La bitácora se rehace en cada carga; se cachea unos minutos para no repetir la
// consulta en cada refresco. Al justificar se invalida, para que la 'J' salga ya.
let cache = null, ts = 0;
const TTL = 3 * 60 * 1000;

router.get('/', (req, res) => {
  // Quién puede ESCRIBIR en la bitácora (justificar, anular, marcar libranza)
  // sale de la matriz de permisos, no de una lista de roles. `permisos` en
  // null es acceso total (superadmin y desarrollador).
  const mias = res.locals.permisos;
  res.render('bitacora', {
    titulo: 'Bitácora', seccion: 'bitacora', layout: 'layout-gestion',
    rol: (req.usuario && req.usuario.rol) || '',
    puedeJustificar: !mias || mias.includes('/bitacora/justificar'),
  });
});

router.get('/api/datos', async (req, res) => {
  try {
    if (!cache || Date.now() - ts > TTL) { cache = await leerBitacora(); ts = Date.now(); }
    res.json({ status: 'ok', ...cache });
  } catch (error) {
    console.error('❌ [Bitácora] /api/datos:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

// Las vacaciones de la plantilla vigente (disfrutadas + programadas) por meses.
let cacheVac = null, tsVac = 0;
router.get('/api/vacaciones', async (req, res) => {
  try {
    if (!cacheVac || Date.now() - tsVac > TTL) { cacheVac = await leerVacaciones(); tsVac = Date.now(); }
    res.json({ status: 'ok', ...cacheVac });
  } catch (e) {
    console.error('❌ [Bitácora] /api/vacaciones:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Justificar un día concreto de un conductor, con HORAS EXACTAS (no fijas de 8).
// Escribe el justificante + la 'J' en la bitácora (PostgreSQL). Por conductor_id,
// que es lo que trae la vista.
router.post('/api/justificar', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await repoJust.guardarPorId({
      conductorId: b.conductorId,
      diaIso: b.dia,
      horas: (b.horas == null || b.horas === '') ? '' : Number(b.horas),
      observacion: b.observacion,
      usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req),
    });
    cache = null;   // que la próxima carga muestre la 'J' recién puesta
    console.log(`📝 [Bitácora] Justificante PG ${b.dia} · conductor ${r.conductorId}` +
                `${b.horas ? ` (${b.horas} h)` : ''}`);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    console.error('❌ [Bitácora] /api/justificar:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Marcar (o quitar, con {quitar:true}) una LIBRANZA manual desde el panel del día:
// "ese día le tocaba librar". Vive en bitacora_dia; el planificador no se toca.
router.post('/api/libranza', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.quitar) await quitarLibranza(b.conductorId, b.dia);
    else await marcarLibranza(b.conductorId, b.dia);
    cache = null;
    console.log(`📓 [Bitácora] Libranza manual ${b.quitar ? 'quitada' : 'puesta'} · conductor ${b.conductorId} · ${b.dia}`);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('❌ [Bitácora] /api/libranza:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Anular el justificante vivo de un día (quita la J; el registro queda anulado, no borrado).
// REHACER el histórico sellado de un rango. Es la salida para cuando cambia algo
// que afecta al pasado a propósito: se enlaza una cuenta de BOLT que faltaba, se
// corrige un id mal puesto. Fuera de eso el pasado NO se toca, que es justo lo
// que hace que un mes cerrado siga diciendo lo mismo mañana.
// Solo el desarrollador: reescribe histórico.
router.post('/api/resellar', sesion.requiereDesarrollador, async (req, res) => {
  try {
    const b = req.body || {};
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    if (!ISO.test(b.desde || '') || !ISO.test(b.hasta || '')) {
      throw new Error('Hacen falta desde y hasta en formato AAAA-MM-DD');
    }
    const r = await sellarHoras(b.desde, b.hasta);
    console.log(`📒 [Bitácora] Resellado a mano ${r.desde} → ${r.hasta}: ${r.filas} fila(s) · ${(req.usuario || {}).nombre || ''}`);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

router.post('/api/anular-justificante', async (req, res) => {
  try {
    const b = req.body || {};
    const r = await repoJust.anularPorId({ conductorId: b.conductorId, diaIso: b.dia });
    cache = null;
    console.log(`🗑️ [Bitácora] Justificante anulado · conductor ${b.conductorId} · ${b.dia}`);
    res.json({ status: 'ok', ...r });
  } catch (e) {
    console.error('❌ [Bitácora] /api/anular-justificante:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
