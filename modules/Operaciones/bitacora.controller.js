// ============================================================
// BITÁCORA — controlador
// ============================================================
//   /bitacora           el día a día
//   /bitacora/general   la plantilla entera contra el calendario entero
//
// Las dos leen el MISMO /api/datos: son dos formas de mirar la misma rejilla.

const express = require('express');
const router = express.Router();
const bitacora = require('./bitacora.service');
const actor = require('../../services/repo/actor');
const sesion = require('../../services/sesion');   // para el guard del desarrollador

const responde = (fn, codigo = 400) => async (req, res) => {
  try {
    const r = await fn(req);
    res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [Bitácora] ${req.method} ${req.path}: ${e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

/** Quién firma. Por id de sesión, y por correo si la cookie es vieja. */
const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

router.get('/', (req, res) => {
  // Quién puede ESCRIBIR en la bitácora (justificar, anular, marcar libranza)
  // sale de la matriz de permisos, no de una lista de roles. `permisos` en null
  // es acceso total (superadmin y desarrollador).
  const mias = res.locals.permisos;
  res.render('bitacora', {
    titulo: 'Bitácora', seccion: 'bitacora', layout: 'layout-gestion',
    rol: (req.usuario && req.usuario.rol) || '',
    puedeJustificar: !mias || mias.includes('/bitacora/justificar'),
    // A quién se puede mandar una J desde aquí, y el nombre de todas (para
    // decir a quién fue una que vino de Control).
    destinosJ: bitacora.DESTINOS,
    tiposJ: require('../../services/repo/justificantes').TIPOS_J,
    casuisticasMenosJ: bitacora.CASUISTICAS_MENOS_J,
  });
});

router.get('/general', (req, res) => {
  res.render('bitacoraGeneral', {
    titulo: 'Bitácora general', seccion: 'bitacora', layout: 'layout-gestion',
  });
});

// ── Lectura ────────────────────────────────────────────────────────────────

router.get('/api/datos', responde(() => bitacora.datos(), 500));
router.get('/api/vacaciones', responde(() => bitacora.vacaciones(), 500));

// El historial de una J o una −J (db/228). Mirarlo es leer la bitácora.
router.get('/api/historial', responde(async req => ({
  historial: await require('../../services/repo/auditoriaJ').historial(req.query.entidad, req.query.id),
})));

router.get('/api/dia', responde(req =>
  bitacora.llamadasDelDia(req.query.conductor, req.query.dia)));

// ── Escritura ──────────────────────────────────────────────────────────────

router.post('/api/justificar', responde(async req => {
  const b = req.body || {};
  return bitacora.justificar(
    { conductorId: b.conductorId, dia: b.dia, horas: b.horas, observacion: b.observacion, tipo: b.tipo },
    await quien(req));
}));

// La −J (db/227): con el mismo permiso que justificar (services/permisos.js).
router.post('/api/menos-j', responde(async req => bitacora.ponerMenosJ(req.body || {}, await quien(req))));

router.post('/api/anular-justificante', responde(async req => {
  const b = req.body || {};
  return bitacora.anularJustificante({ conductorId: b.conductorId, dia: b.dia, motivo: b.motivo }, await quien(req));
}));

router.post('/api/libranza', responde(async req => {
  const b = req.body || {};
  return bitacora.libranza({ conductorId: b.conductorId, dia: b.dia, quitar: b.quitar }, await quien(req));
}));

// REHACER el histórico sellado. Solo el desarrollador: reescribe histórico.
router.post('/api/resellar', sesion.requiereDesarrollador, responde(req =>
  bitacora.resellar(req.body || {}, (req.usuario || {}).nombre)));

// ── «Vacaciones por meses», en Excel (12/11/2026) ──────────────────────────
// Camilo: «el excel lo quiero en base a esto [el calendario de la bitácora] …
// mes pasado, mes cursante y los próximos meses hasta el último que tenga
// vacaciones programadas». Es el mismo calendario que ya ve quien abre la
// bitácora: va con su llave.
router.get('/vacaciones/excel', async (req, res) => {
  try {
    const { bytes, nombre } = await bitacora.vacacionesExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(bytes);
  } catch (e) {
    console.error(`❌ [Bitácora] ${req.path}: ${e.stack || e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// ── Horas Caverel (db/238, 10/11/2026) ─────────────────────────────────────
// Las horas mensuales del informe de BOLT de antes. Mirarlas es mirar la
// bitácora; SUBIR el CSV es otra llave, '/bitacora/caverel/importar'
// (services/permisos.js), porque sustituye cifras.
const caverel = require('./caverel.service');

router.get('/caverel', (req, res) => {
  const mias = res.locals.permisos;
  res.render('bitacoraCaverel', {
    titulo: 'Horas Caverel', seccion: 'bitacora', layout: 'layout-gestion',
    puedeImportar: !mias || mias.includes('/bitacora/caverel/importar'),
  });
});
router.get('/caverel/api/lista', responde(() => caverel.lista(), 500));
router.get('/caverel/api/persona/:id', responde(req => caverel.persona(req.params.id)));

// El CSV viaja en base64 dentro del JSON, como el Excel de Combustible: la ruta
// está en SUBEN_ARCHIVOS de app.js (se salta el parser global de 2 MB) y pone el
// suyo. El de octubre de 2026 (23 meses, 4.715 filas) pesa 1,2 MB: 1,6 en base64.
const jsonCsv = express.json({ limit: '9mb' });
const leerCsv = (req, res, next) => jsonCsv(req, res, e => {
  if (!e) return next();
  const grande = e.type === 'entity.too.large';
  res.status(grande ? 413 : 400).json({ status: 'error', msg: grande
    ? 'El archivo es demasiado grande: el informe de 23 meses pesa 1,2 MB. ¿Es el CSV de BOLT? No se ha importado nada.'
    : 'No se pudo leer lo que se ha enviado. No se ha importado nada.' });
});
router.post('/caverel/api/importar', leerCsv, responde(async req =>
  ({ importacion: await caverel.importar(req.body || {}, await quien(req)) })));

module.exports = router;
