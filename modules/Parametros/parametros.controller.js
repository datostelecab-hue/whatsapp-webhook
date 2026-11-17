// ============================================================
// PARÁMETROS DE NEGOCIO — la pantalla /parametros (db/243)
// ============================================================
// Los números de las reglas de la hoja de ruta (plazos, topes, días del mes) y
// el horario de la oficina, con su historia. El catálogo y las cuentas viven en
// services/parametros.js, que usa todo el ERP; aquí solo la pantalla.
//
// Quién entra: el desarrollador por su rol, o quien tenga la llave '/parametros'
// (de inicio, Ignacio). El superadmin no entra por serlo. Camilo, 13/11/2026:
// «Llave propia: Ignacio y desarrollador».
//
// Quién cambia sale de la sesión, nunca del cuerpo de la petición.

const express = require('express');
const router = express.Router();
const sesion = require('../../services/sesion');
const parametros = require('../../services/parametros');
const actor = require('../../services/repo/actor');

router.use(sesion.requiereDesarrolladorOLlave('/parametros', 'Parámetros'));

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [Parámetros]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quienEs = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

router.get('/', (req, res) => {
  res.render('parametros', {
    titulo: 'Parámetros',
    seccion: 'parametros',
    layout: 'layout-gestion',
    diasSemana: parametros.DIAS_SEMANA,
  });
});

router.get('/api/lista', responde(async () => ({ filas: await parametros.lista() })));

router.get('/api/ficha/:clave', responde(async req => {
  const clave = req.params.clave;
  const fila = (await parametros.lista()).find(p => p.clave === clave);
  if (!fila) throw new Error(`No existe el parámetro «${clave}»`);
  return { ficha: { ...fila, historial: await parametros.historial(clave) } };
}));

router.post('/api/cambiar/:clave', responde(async req => {
  const b = req.body || {};
  const fila = await parametros.cambiar(req.params.clave, b.valor, { usuarioId: await quienEs(req), motivo: b.motivo });
  return { fila };
}));

module.exports = router;
