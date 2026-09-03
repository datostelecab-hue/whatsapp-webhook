const express = require('express');
const router = express.Router();
const vis = require('../services/visibilidad');

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
