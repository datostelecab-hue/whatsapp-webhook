const express = require('express');
const router = express.Router();
const vis = require('../services/visibilidad');
const tendencia = require('../services/visibilidadTendencia');

// Mes 'YYYY-MM' de la query → {anio, mes}. Por defecto, el mes corriente en Madrid.
function mesPedido(req) {
  const q = String(req.query.mes || '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(q);
  if (m) return { anio: Number(m[1]), mes: Number(m[2]) };
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit' }).format(new Date());
  const [Y, M] = hoy.split('-').map(Number);
  return { anio: Y, mes: M };
}

// La pantalla. El front pinta los KPIs y los gráficos llamando a las APIs de abajo.
router.get('/', (req, res) => {
  res.render('visibilidad', { titulo: 'Visibilidad', seccion: 'visibilidad', layout: 'layout-gestion' });
});

// KPIs en vivo: mes, hoy, semana, turno actual y turno anterior.
router.get('/api/resumen', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await vis.resumen()) });
  } catch (e) {
    console.error('❌ [Visibilidad] /api/resumen:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// Serie del mes para los gráficos (por día, acumulado, ideal, crítico, brecha).
router.get('/api/serie', async (req, res) => {
  try {
    const { anio, mes } = mesPedido(req);
    res.json({ status: 'ok', ...(await vis.serieMes(anio, mes)) });
  } catch (e) {
    console.error('❌ [Visibilidad] /api/serie:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

// LA TENDENCIA (25/10/2026): el gráfico de los días con rangos, «cómo vamos» y
// «cómo hemos crecido» (services/visibilidadTendencia.js). Sustituyen al viejo
// /api/ultimos (los últimos 15 días). Un parámetro que no vale es un 400 con el
// motivo, no un 500: lo que entra por la URL lo controla cualquiera.
const errorHttp = (res, ruta, e) => {
  if (!e.estado) console.error(`❌ [Visibilidad] ${ruta}:`, e.message);
  res.status(e.estado || 500).json({ status: 'error', msg: e.message });
};

//   ?ultimos=N | ?desde=AAAA-MM-DD|inicio [&hasta=AAAA-MM-DD] [&agrupar=dia|semana|mes]
router.get('/api/rango', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await tendencia.rango(req.query)) });
  } catch (e) { errorHttp(res, '/api/rango', e); }
});

router.get('/api/crecimiento', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await tendencia.crecimiento()) });
  } catch (e) { errorHttp(res, '/api/crecimiento', e); }
});

// La serie del mes de /api/serie, más el mes anterior y la comparación a la misma altura.
router.get('/api/como-vamos', async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await tendencia.comoVamos(req.query.mes)) });
  } catch (e) { errorHttp(res, '/api/como-vamos', e); }
});

// Guarda la config (capacidad, meta, vehículos, días) y devuelve la nueva → recalcula.
router.post('/api/config', async (req, res) => {
  try {
    const nueva = await vis.guardarConfig(req.body || {});
    res.json({ status: 'ok', config: nueva });
  } catch (e) {
    console.error('❌ [Visibilidad] /api/config:', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
});

// Rehace las fotos diarias de un mes a mano (por si hay que rellenar un hueco).
router.post('/api/capturar', async (req, res) => {
  try {
    const { anio, mes } = mesPedido(req);
    res.json({ status: 'ok', ...(await vis.backfillMes(anio, mes)) });
  } catch (e) {
    console.error('❌ [Visibilidad] /api/capturar:', e.message);
    res.status(500).json({ status: 'error', msg: e.message });
  }
});

module.exports = router;
