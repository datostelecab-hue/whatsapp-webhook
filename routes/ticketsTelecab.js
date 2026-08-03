const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const it = require('../services/ticketsIT');

// Todo el módulo es EXCLUSIVO del desarrollador (excluye incluso al superadmin).
router.use(sesion.requiereDesarrollador);

router.get('/', (req, res) => {
  res.render('tickets-telecab', { titulo: 'Tickets Telecab', seccion: 'tickets-telecab', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    const tickets = await it.leerTickets();
    const cuenta = (campo) => tickets.reduce((m, t) => { const k = (t[campo] || '').trim() || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const abiertos = tickets.filter(t => t.estado !== 'Resuelto' && t.estado !== 'Descartado');
    res.json({
      status: 'ok', tickets,
      opciones: { tipos: it.TIPOS, prioridades: it.PRIORIDADES, estados: it.ESTADOS },
      contadores: { total: tickets.length, abiertos: abiertos.length, nuevos: tickets.filter(t => t.estado === 'Nuevo').length },
      porEstado: cuenta('estado'), porTipo: cuenta('tipo')
    });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await it.cambiarEstado(b.id, String(b.estado || '').trim());
    res.json({ status: 'ok', estado: t.estado });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/notas', async (req, res) => {
  try {
    const b = req.body || {};
    await it.guardarNotas(b.id, b.notas);
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
