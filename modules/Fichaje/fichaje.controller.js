// ============================================================
// FICHAJE — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// ── LOS DOS CANDADOS, QUE NO SON IGUALES ────────────────────────────────────
//
//   FICHAR   lo puede hacer cualquiera que haya entrado y tenga el fichaje
//            activado en su ficha. `/fichaje` NO está en el catálogo de
//            permisos a propósito (ver db/106): si fichar necesitara un permiso
//            habría que concedérselo a cada uno, y sería una forma más de que
//            alguien no pueda fichar el día que le toca.
//
//   CORREGIR solo el DESARROLLADOR. No se reparte por casilla: la
//            responsabilidad del registro recae en una sola persona, y
//            repartirla la diluiría. Mismo candado que las migraciones.

const express = require('express');
const router = express.Router();
const fichaje = require('./fichaje.service');
const actor = require('../../services/repo/actor');
const sesion = require('../../services/sesion');

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [FICHAJE]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

// ── La pantalla ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  res.render('fichaje', {
    titulo: 'Fichar jornada', seccion: 'fichaje', layout: 'layout-gestion',
    // El panel de control del registro solo lo ve quien puede corregirlo.
    esDesarrollador: !!(req.usuario && req.usuario.rol === 'desarrollador'),
  });
});

// ── Fichar ─────────────────────────────────────────────────────────────────
// Lo llama la barra de arriba en CADA pantalla, así que responde lo justo.
router.get('/api/estado', responde(async req => fichaje.estado(await quien(req))));

router.post('/api/entrar', responde(async req =>
  ({ fichaje: await fichaje.entrar(await quien(req), (req.body || {}).ubicacion) })));

router.post('/api/salir', responde(async req =>
  ({ fichaje: await fichaje.salir(await quien(req), (req.body || {}).ubicacion) })));

// Su propio mes. Cada uno ve el suyo y solo el suyo: el id sale de la SESIÓN,
// nunca de la petición, o cualquiera podría pedir el de otro cambiando un número.
router.get('/api/mi-mes', responde(async req => fichaje.miMes(await quien(req), req.query.mes)));

// ── Lo que solo puede el desarrollador ─────────────────────────────────────
router.get('/api/parte', sesion.requiereDesarrollador,
  responde(async req => fichaje.parteDelDia(req.query.dia)));

router.get('/api/sin-cerrar', sesion.requiereDesarrollador,
  responde(async () => ({ filas: await fichaje.sinCerrar() })));

router.post('/api/corregir', sesion.requiereDesarrollador, responde(async req => {
  const b = req.body || {};
  const f = await fichaje.corregir(
    { id: b.id, usuarioId: b.usuarioId, entrada: b.entrada, salida: b.salida },
    { autor: await quien(req), motivo: b.motivo });
  console.log(`✏️  [FICHAJE] Corregido el fichaje ${f.id} — por ${req.usuario.email}: ${b.motivo}`);
  return { fichaje: f };
}));

module.exports = router;
