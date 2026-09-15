// ============================================================
// /tickets-telecab — la bandeja de soporte, solo del desarrollador
// ============================================================
// Todo lo que se ha reportado desde «Soporte técnico». La pantalla se queda como
// estaba; lo que cambia es de dónde salen los datos: la tabla `ticket`, la misma
// que los del formulario, en vez de una hoja propia.
//
// La primera vez que se abre se trae lo que hubiera en la hoja vieja. Ver
// `modules/Ticketera/rescateIT`.

const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const ticketera = require('../modules/Ticketera/ticketera.service');
const rescate = require('../modules/Ticketera/rescateIT');
const actor = require('../services/repo/actor');

router.use(sesion.requiereDesarrollador);

const quien = async req => ({
  usuarioId: await actor.idDe(req),
  nombre: `${(req.usuario && req.usuario.nombre) || ''} ${(req.usuario && req.usuario.apellidos) || ''}`.trim(),
});

router.get('/', (req, res) => {
  res.render('tickets-telecab', { titulo: 'Tickets Telecab', seccion: 'tickets-telecab', layout: 'layout-gestion' });
});

router.get('/api/datos', async (req, res) => {
  try {
    // Una sola vez: lo que quedara en la hoja vieja. Falla en silencio si no hay
    // credenciales de Google, que es lo normal fuera del servidor.
    await rescate.rescatar().catch(e => console.error('⚠️  [SOPORTE] rescate:', e.message));
    res.json({ status: 'ok', ...(await ticketera.bandejaIT()) });
  } catch (e) { res.status(500).json({ status: 'error', msg: e.message }); }
});

router.post('/estado', async (req, res) => {
  try {
    const b = req.body || {};
    const t = await ticketera.estadoIT(b.id, b, await quien(req));
    res.json({ status: 'ok', estado: b.estado, ticket: t.codigo });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

router.post('/notas', async (req, res) => {
  try {
    const b = req.body || {};
    await ticketera.notas(b.id, b.notas, await quien(req));
    res.json({ status: 'ok' });
  } catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
});

module.exports = router;
