// ============================================================
// EXPLORADOR DE LA BASE DE DATOS — rutas (solo rol desarrollador)
// ============================================================
// Todo lo de aquí es de solo lectura, garantizado por la propia base. Aun así
// queda tras el rol más alto: ver todas las tablas incluye ver datos personales
// de la plantilla entera.
const express = require('express');
const router = express.Router();
const sesion = require('../services/sesion');
const exp = require('../services/explorador');

router.use(sesion.requiereDesarrollador);

router.get('/', (req, res) => {
  res.render('explorador', { titulo: 'Base de datos', seccion: 'explorador', layout: 'layout-gestion' });
});

const responder = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) { res.status(400).json({ status: 'error', msg: e.message }); }
};

router.get('/api/tablas',     responder(async () => ({ resumen: await exp.resumen(), tablas: await exp.tablas() })));
router.get('/api/estructura', responder(req => exp.estructura(req.query.tabla)));
router.get('/api/datos',      responder(req => exp.datos(req.query.tabla, {
  pagina: req.query.pagina, porPagina: req.query.porPagina,
  orden: req.query.orden, desc: req.query.desc === '1',
  busca: req.query.busca, filtroCol: req.query.filtroCol, filtroVal: req.query.filtroVal,
})));

// La consulta libre va por POST: no debe quedar en el historial del navegador
// ni dispararse al abrir una URL pegada.
router.post('/api/consulta', responder(async req => {
  const r = await exp.consultaLibre((req.body || {}).sql);
  console.log(`🔎 [BD] Consulta de ${(req.usuario || {}).email || '?'}: ${r.total} fila(s) en ${r.ms} ms`);
  return r;
}));

module.exports = router;
