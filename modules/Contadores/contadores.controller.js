// ============================================================
// LOS CONTADORES — todos los números de una vez (/contadores, A9)
// ============================================================
//   GET /contadores/api   → { contadores: { clave: { n, tono?, titulo? } } }
//
// Los de quien mira y nada más: cada fuente (services/contadores.js) decide
// con su rol y sus llaves. Por eso /contadores no está en el catálogo de
// permisos: entra cualquiera con sesión.
'use strict';

const express = require('express');
const router = express.Router();
const actor = require('../../services/repo/actor');
const contadores = require('../../services/contadores');

router.get('/api', async (req, res) => {
  try {
    const id = (req.usuario && req.usuario.id) || await actor.idDe(req);
    const quien = {
      id: id ? Number(id) : null,
      rol: req.usuario ? req.usuario.rol : null,
      // Las llaves de esta persona, o null si su rol lo ve todo (sesion.cargarPermisos).
      permisos: res.locals.permisos === undefined ? [] : res.locals.permisos,
    };
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', contadores: await contadores.recuentos(quien) });
  } catch (e) {
    console.error('❌ [Contadores]:', e.stack || e.message);
    res.status(500).json({ status: 'error', msg: 'No se han podido leer los contadores' });
  }
});

module.exports = router;
