// ============================================================
// LA ORGANIZACIÓN — la pantalla /organizacion (db/248)
// ============================================================
// Áreas, superiores y quién hace qué, para cada persona de la oficina. El
// catálogo de funciones y las reglas viven en services/organizacion.js, que usa
// todo el ERP; aquí solo la pantalla.
//
// Quién entra: los mismos que en Usuarios y permisos (el desarrollador, o quien
// tenga la llave '/usuarios': Ignacio). Quién cambia sale de la sesión, nunca
// del cuerpo de la petición.

const express = require('express');
const router = express.Router();
const sesion = require('../../services/sesion');
const organizacion = require('../../services/organizacion');
const actor = require('../../services/repo/actor');

router.use(sesion.requiereGestorUsuarios);

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Organización]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

router.get('/', (req, res) => {
  res.render('organizacion', { titulo: 'Organización', seccion: 'organizacion', layout: 'layout-gestion' });
});

router.get('/api/lista', responde(async () => {
  const o = await organizacion.organigrama();
  return { filas: o.personas, areas: o.areas, funciones: o.funciones, sinNadie: o.sinNadie };
}));

router.get('/api/ficha/:id', responde(async req => ({ ficha: await organizacion.ficha(req.params.id) })));

router.post('/api/area/:id', responde(async req => {
  const b = req.body || {};
  return { ficha: await organizacion.ponerArea(req.params.id,
    { area: b.area || null, superiorId: b.superiorId || null, responsable: b.responsable === true || b.responsable === 'si' },
    { quien: await quienEs(req) }) };
}));

router.post('/api/funcion/:id', responde(async req => {
  const b = req.body || {};
  return { ficha: await organizacion.darFuncion(req.params.id, b.funcion,
    { suplente: b.suplente === true || b.suplente === 'si', nota: b.nota }, { quien: await quienEs(req) }) };
}));

router.post('/api/funcion/:asignacion/quitar', responde(async req => ({
  ficha: await organizacion.quitarFuncion(req.params.asignacion, (req.body || {}).motivo, { quien: await quienEs(req) }),
})));

module.exports = router;
