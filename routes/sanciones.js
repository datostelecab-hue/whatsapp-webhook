// ============================================================
// EXCESOS DE VELOCIDAD — rutas (Operaciones)
// ============================================================
// La ruta sigue llamándose /sanciones porque es la clave del permiso y la que
// tiene la gente guardada; el módulo ya no sanciona, avisa.
const express = require('express');
const router = express.Router();
const vel = require('../services/sanciones');

/**
 * El rango que se mira. Por defecto, los últimos 30 días: el módulo va de
 * acumulación —quién sigue corriendo después de que se le diga— y en una
 * ventana de un día eso no se ve.
 */
function rango(q) {
  const dia = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const atras = new Date(Date.now() - 30 * 86400000);
  const pordefecto = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(atras);
  const d = dia.test(q.desde || '') ? q.desde : pordefecto;
  const h = dia.test(q.hasta || '') ? q.hasta : hoy;
  // Se compara contra timestamps, así que el 'hasta' llega hasta el final del día.
  return { desde: `${d}T00:00:00+02:00`, hasta: `${h}T23:59:59+02:00`, d, h };
}

router.get('/', (req, res) => {
  res.render('sanciones', {
    titulo: 'Excesos de velocidad', seccion: 'sanciones', layout: 'layout-gestion',
    plantilla: vel.PLANTILLA_ADVERTENCIA,
  });
});

// Todo lo que pinta la pantalla, de una vez: las cifras, quién acumula avisos y
// el histórico. Son tres consultas a PostgreSQL, no una llamada a nadie.
router.get('/api/datos', async (req, res) => {
  try {
    const r = rango(req.query || {});
    const [resumen, conductores, historico] = await Promise.all([
      vel.resumen(r), vel.porConductor(r),
      vel.historico({ ...r, estado: req.query.estado, limite: 800 }),
    ]);
    // El spread va DELANTE a propósito: si va detrás, cualquier campo del
    // estado del módulo con el mismo nombre pisa al del rango, que es lo que
    // pinta la pantalla.
    res.json({
      status: 'ok', ...vel.estadoModulo(),
      desde: r.d, hasta: r.h, resumen, conductores, historico,
    });
  } catch (e) {
    console.error('❌ [VELOCIDAD] /api/datos:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// El histórico de UNA persona, para su ficha.
router.get('/api/conductor/:uuid', async (req, res) => {
  try {
    const r = rango(req.query || {});
    res.json({ status: 'ok', historico: await vel.historico({ ...r, driverUuid: req.params.uuid, limite: 500 }) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

// Procesar AHORA (lo normal lo hace el cron cada 15 min).
//
// Ya no sale a ninguna API: lee los excesos que trajo la ingesta de Mapon y
// resuelve el conductor con los tramos que trajo la de Bolt. Antes esta ruta
// podía tardar minutos —siete barridos paginados de state logs por exceso— y por
// eso el botón se quedaba pensando; ahora son consultas.
router.post('/api/procesar', async (req, res) => {
  try {
    const dias = Number((req.body || {}).dias) || undefined;
    res.json({ status: 'ok', ...(await vel.procesar({ dias })) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
