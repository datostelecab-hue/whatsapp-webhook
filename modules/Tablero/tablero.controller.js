// ============================================================
// EL TABLERO DE TAREAS — sus rutas (/tablero, db/251, ítem 1)
// ============================================================
// La API (1a) y la pantalla (1b): Mi tablero, el del equipo, lo que hay por
// repartir y la lista. Quién ve y quién puede qué lo decide
// services/tablero.js con las funciones de Organización (A5), no esta ruta:
// por eso /tablero no está en el catálogo de permisos (entra cualquiera con
// sesión, y cada tarjeta se comprueba).
//
//   GET  /tablero/api/tarjetas?vista=mias|equipo|pendientes     las de una vista
//   GET  /tablero/api/tarjetas/:id                              la ficha, con su historia
//   POST /tablero/api/tarjetas                                  una tarea a mano
//   POST /tablero/api/tarjetas/:id/aprobar | rechazar           (quien aprueba)
//   POST /tablero/api/tarjetas/:id/asignar | reasignar | plazo  (quien reparte)
//   POST /tablero/api/tarjetas/:id/mover | cerrar | anular
//   POST /tablero/api/tarjetas/:id/comentarios                  { texto }
//   POST /tablero/api/comentarios/:id/anular                    el suyo
//   POST /tablero/api/tarjetas/:id/colaboradores                { usuarioId, quitar }
//   GET  /tablero/api/personas                                  a quién se le puede dar una
//   GET  /tablero/api/yo                                        si aprueba, si reparte, si lo ve todo
//   GET  /tablero                                               la pantalla (1b)
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const tablero = require('../../services/tablero');
require('../Ticketera/tarjetas');   // el tipo «ticket», por si se carga antes que la ticketera

const yo = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** Responde con lo que devuelva `fn`, o con el error en JSON (sin enseñar los de la base). */
const responde = fn => async (req, res) => {
  try {
    res.json({ status: 'ok', ...(await fn(await yo(req), req)) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('❌ [Tablero]', e.stack || e.message);
    const msg = e.status ? e.message : 'No se ha podido hacer: ha fallado algo en el servidor. Si se repite, avisa al desarrollador.';
    res.status(e.status || 500).json({ status: 'error', msg });
  }
};
const cuerpo = req => req.body || {};

// ── La pantalla (entrega 1b) ───────────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('tablero', { titulo: 'Tablero de tareas', seccion: 'tablero', layout: 'layout-gestion' });
});

// Qué hace quien mira en el tablero: si aprueba, si reparte, si lo ve todo.
router.get('/api/yo', responde(async id => ({ yo: await tablero.quienSoy(id) })));

router.get('/api/tarjetas', responde(async (id, req) => ({
  tarjetas: await tablero.listar(id, { vista: req.query.vista || 'mias', acabadasDias: req.query.acabadas }),
})));
router.get('/api/tarjetas/:id(\\d+)', responde(async (id, req) => ({ tarjeta: await tablero.ficha(id, req.params.id) })));
router.post('/api/tarjetas', responde(async (id, req) => ({ tarjeta: await tablero.crear(id, cuerpo(req)) })));

const accion = (nombre, fn) => router.post(`/api/tarjetas/:id(\\d+)/${nombre}`,
  responde(async (id, req) => ({ tarjeta: await fn(id, req.params.id, cuerpo(req)) })));
accion('aprobar', tablero.aprobar);
accion('rechazar', tablero.rechazar);
accion('asignar', tablero.asignar);
accion('reasignar', tablero.reasignar);
accion('plazo', tablero.cambiarPlazo);
accion('mover', tablero.mover);
accion('cerrar', tablero.cerrar);
accion('anular', tablero.anular);
accion('comentarios', tablero.comentar);
accion('colaboradores', tablero.colaborador);

router.post('/api/comentarios/:id(\\d+)/anular', responde(async (id, req) => ({
  tarjeta: await tablero.anularComentario(id, req.params.id, cuerpo(req)),
})));
router.get('/api/personas', responde(async () => ({ personas: await tablero.personas() })));

module.exports = router;
