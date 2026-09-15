// ============================================================
// CONVENIO (RRHH) — controlador
// ============================================================
// Las cuatro pantallas del convenio VTC: la jornada del mes, el cierre de
// periodo, la nómina para la gestoría y el cuadro de absentismo.
//
// El acceso lo controla `controlAcceso` por el prefijo /convenio (rol oficina
// más los admin totales), como el resto de RRHH.

const express = require('express');
const router = express.Router();
const convenio = require('./convenio.service');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error(`❌ [CONVENIO] ${req.method} ${req.path}: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

/** Quién firma la escritura, tal y como queda en el registro. */
const quien = req => (req.usuario || {}).email;

/** Las cuatro pantallas son la misma con otra pestaña marcada. */
const pantalla = (vista, sub, titulo) => async (req, res) => {
  res.render(vista, {
    titulo, seccion: 'convenio', layout: 'layout-gestion', sub,
    ...(await convenio.paraLaPantalla()),
  });
};

router.get('/', pantalla('convenio', 'jornada', 'Convenio · Jornada'));
router.get('/cierre', pantalla('convenioCierre', 'cierre', 'Convenio · Cierre'));
router.get('/nomina', pantalla('convenioNomina', 'nomina', 'Convenio · Nómina'));
router.get('/absentismo', pantalla('convenioAbsentismo', 'absentismo', 'Convenio · Absentismo'));

// ── El panel de jornada ────────────────────────────────────────────────────

router.get('/api/trabajadores', responde(req => convenio.trabajadores(req.query)));
router.get('/api/ficha/:id', responde(req => convenio.ficha(req.params.id)));

// ── Cierre de periodo ──────────────────────────────────────────────────────

router.get('/api/periodos', responde(() => convenio.periodos()));
router.get('/api/periodo/:anio/:mes', responde(req =>
  convenio.fichaPeriodo(req.params.anio, req.params.mes)));

// Escritura: fotografía, congela y sella. Queda el rastro de quién.
router.post('/api/cerrar', responde(req => convenio.cerrar(req.body || {}, quien(req))));

router.post('/api/regularizar', responde(req => convenio.regularizar(req.body || {}, quien(req))));

// ── Cuadro de absentismo ───────────────────────────────────────────────────

router.get('/api/absentismo', responde(req => convenio.absentismo(req.query)));
router.get('/api/absentismo/:modulo', responde(req =>
  convenio.absentismoModulo(req.query, req.params.modulo)));

// ── Nómina del mes ─────────────────────────────────────────────────────────

router.get('/api/nomina', responde(req => convenio.nomina(req.query)));
router.get('/api/nomina/detalle/:id', responde(req =>
  convenio.nominaDetalle(req.query, req.params.id)));

// La descarga. No pasa por `responde` porque escribe el fichero, no JSON.
router.get('/api/nomina/export', async (req, res) => {
  try {
    const { bytes, nombre } = await convenio.nominaExcel(req.query, quien(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(bytes);
  } catch (e) {
    console.error(`❌ [CONVENIO] export: ${e.message}`);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
