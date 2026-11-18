// ============================================================
// REMESAS — las rutas, dentro de /recaudacion (db/266, 18/11/2026)
// ============================================================
// Solo Madrid (Camilo: «solo Madrid por ahora»): las monta el controlador de
// la recaudación de Madrid. Entrar es la llave '/recaudacion'; lo que es de
// quien aprueba lo decide el servicio con la suya. Quién es cada uno sale de la
// sesión, nunca del cuerpo de la petición.
'use strict';

const remesas = require('./remesas.service');

module.exports = function montarRemesas(router, { quienEs }) {
  const ctx = async req => ({ usuario: req.usuario, usuarioId: await quienEs(req) });
  const responde = fn => async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json({ status: 'ok', ...(await fn(req, await ctx(req))) });
    } catch (e) {
      if (!e.status || e.status >= 500) console.error('❌ [Remesas]', req.method, req.path + ':', e.stack || e.message);
      res.status(e.status || 400).json({ status: 'error', msg: e.message });
    }
  };
  const b = req => req.body || {};

  router.get('/api/remesas', responde((req, c) => remesas.lista(c)));
  router.get('/api/remesas/conductores', responde(() => remesas.conductores()));
  router.get('/api/remesas/:id(\\d+)/iban', responde((req, c) => remesas.iban(req.params.id, c)));
  router.post('/api/remesas', responde((req, c) => remesas.crear(b(req), c)));
  router.post('/api/remesas/importar', responde((req, c) => remesas.importar(b(req), c)));
  router.post('/api/remesas/:id(\\d+)', responde((req, c) => remesas.editar(req.params.id, b(req), c)));
  router.post('/api/remesas/:id(\\d+)/estado', responde((req, c) => remesas.cambiarEstado(req.params.id, b(req), c)));
  router.post('/api/remesas/:id(\\d+)/anular', responde((req, c) => remesas.anular(req.params.id, b(req), c)));
  return router;
};
