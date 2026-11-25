// ============================================================
// FALTAS Y SANCIONES — las rutas (módulo 3, db/295)
// ============================================================
// Se monta en `/disciplina` (`/sanciones` es la de los excesos de velocidad).
// Llaves: '/disciplina' (mirar), '/disciplina/abrir' (la oficina),
// '/disciplina/aprobar' (Ángel, William, Ignacio) y '/disciplina/carta' (Diana).
'use strict';

const express = require('express');
const router = express.Router();
const sanciones = require('./sanciones.service');
const actor = require('../../services/repo/actor');

const quien = async req => ({ usuarioId: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: (req.usuario || {}).rol || '' });

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Sanciones]', req.method, req.path + ':', e.message);
    res.status(e.status && e.status < 500 ? e.status : 400).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  const q = await quien(req);
  const [abrir, aprobar, carta] = await Promise.all([
    sanciones.puede(q, sanciones.CLAVE_ABRIR), sanciones.puede(q, sanciones.CLAVE_APROBAR), sanciones.puede(q, sanciones.CLAVE_CARTA),
  ]);
  res.render('sanciones', { titulo: 'Faltas y sanciones', seccion: 'disciplina', layout: 'layout-gestion', puede: { abrir, aprobar, carta } });
});

router.get('/api/lista', responde(async req => sanciones.lista(await quien(req))));
router.get('/api/catalogo', responde(async req => sanciones.catalogo(await quien(req))));
router.get('/api/sancion/:id', responde(async req => ({ ficha: await sanciones.ficha(req.params.id, await quien(req)) })));
router.post('/api/sancion', responde(async req => sanciones.crear(req.body || {}, await quien(req))));
router.post('/api/sancion/:id/abrir', responde(async req => sanciones.abrir(req.params.id, req.body || {}, await quien(req))));
router.post('/api/sancion/:id/aprobar', responde(async req => sanciones.aprobar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/sancion/:id/descartar', responde(async req => sanciones.descartar(req.params.id, req.body || {}, await quien(req))));
router.post('/api/sancion/:id/carta', responde(async req => sanciones.mandarAFirma(req.params.id, req.body || {}, await quien(req))));

module.exports = router;
