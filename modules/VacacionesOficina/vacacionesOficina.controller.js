// ============================================================
// LAS VACACIONES DE LA OFICINA — sus rutas (/mis-vacaciones, db/263)
// ============================================================
// De toda la oficina, como /tablero: no está en el catálogo de permisos. Cada
// uno ve las suyas; quien tiene la llave de Usuarios y permisos (o el
// desarrollador), las de todos, y aprueba. Lo decide el servicio.
//
//   GET  /mis-vacaciones                         la pantalla
//   GET  /mis-vacaciones/api/mias                las mías: saldo, meses, vacaciones, reglas
//   GET  /mis-vacaciones/api/lista               toda la oficina (quien aprueba)
//   POST /mis-vacaciones/api/registrar     { usuarioId, desde, hasta, libra, nota }  unas ya disfrutadas (quien aprueba)
//   GET  /mis-vacaciones/api/calendario    «Vacaciones por meses» de la oficina: quién se va y cuándo (quien aprueba)
//   GET  /mis-vacaciones/api/personas/:id        las de una persona (quien aprueba, o uno mismo)
//   POST /mis-vacaciones/api/simular             { desde, hasta, libra: [d, d], usuarioId? }
//   POST /mis-vacaciones/api/pedir               { desde, hasta, libra, nota }
//   POST /mis-vacaciones/api/permisos/registrar { usuarioId, tipo, desde, hasta, fraccion, nota }  uno ya pasado (quien aprueba)
//   POST /mis-vacaciones/api/:id/aprobar
//   POST /mis-vacaciones/api/:id/rechazar        { motivo }
//   POST /mis-vacaciones/api/:id/retirar         (quien las pidió, mientras esperan)
//   POST /mis-vacaciones/api/:id/anular          { motivo }   (unas aprobadas, quien aprueba)
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const vac = require('./vacacionesOficina.service');

const quien = async req => ({ id: (req.usuario && req.usuario.id) || await actor.idDe(req), rol: req.usuario && req.usuario.rol });
const responde = fn => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', ...(await fn(await quien(req), req)) });
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('❌ [Vacaciones oficina]', e.stack || e.message);
    const msg = e.status ? e.message : 'No se ha podido hacer: ha fallado algo en el servidor. Si se repite, avisa al desarrollador.';
    res.status(e.status || 500).json({ status: 'error', msg });
  }
};
const b = req => req.body || {};

router.get('/', (req, res) => {
  res.render('misVacaciones', { titulo: 'Mis vacaciones', seccion: 'mis-vacaciones', layout: 'layout-gestion' });
});
router.get('/api/mias', responde(q => vac.mias(q)));
router.get('/api/lista', responde(q => vac.lista(q)));
router.get('/api/calendario', responde(q => vac.calendarioOficina(q)));
router.get('/api/personas/:id', responde((q, req) => vac.de(q, req.params.id)));
router.post('/api/simular', responde((q, req) => vac.simular(q, b(req)).then(simulacion => ({ simulacion }))));
router.post('/api/pedir', responde((q, req) => vac.pedir(q, b(req))));
router.post('/api/registrar', responde((q, req) => vac.registrar(q, b(req))));
// LOS PERMISOS (db/271, 18/11/2026): asuntos propios y teletrabajo, con su histórico.
router.get('/api/permisos/mios', responde(q => vac.permisosMios(q)));
router.get('/api/permisos/lista', responde((q, req) => vac.permisosLista(q, { estado: req.query.estado })));
router.post('/api/permisos/simular', responde((q, req) => vac.simularPermiso(q, b(req)).then(simulacion => ({ simulacion }))));
router.post('/api/permisos/pedir', responde((q, req) => vac.pedirPermiso(q, b(req))));
// Uno ya pasado, apuntado después (quien aprueba, 20/11/2026): nace aprobado.
router.post('/api/permisos/registrar', responde((q, req) => vac.registrarPermiso(q, b(req))));
router.post('/api/permisos/:grupo(\\d+)/aprobar', responde((q, req) => vac.resolverPermiso(q, req.params.grupo, 'aprobar', b(req))));
router.post('/api/permisos/:grupo(\\d+)/rechazar', responde((q, req) => vac.resolverPermiso(q, req.params.grupo, 'rechazar', b(req))));
router.post('/api/permisos/:grupo(\\d+)/anular', responde((q, req) => vac.resolverPermiso(q, req.params.grupo, 'anular', b(req))));
router.post('/api/permisos/:grupo(\\d+)/retirar', responde((q, req) => vac.resolverPermiso(q, req.params.grupo, 'retirar', b(req))));
router.post('/api/:id(\\d+)/aprobar', responde((q, req) => vac.aprobar(q, req.params.id)));
router.post('/api/:id(\\d+)/rechazar', responde((q, req) => vac.rechazar(q, req.params.id, b(req))));
router.post('/api/:id(\\d+)/retirar', responde((q, req) => vac.retirar(q, req.params.id)));
router.post('/api/:id(\\d+)/anular', responde((q, req) => vac.anular(q, req.params.id, b(req))));

module.exports = router;
