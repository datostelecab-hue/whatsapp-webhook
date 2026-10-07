// ============================================================
// WHATSAPP — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
//   /whatsapp                       la pantalla: conversaciones y chat
//   GET  /whatsapp/api/conversaciones?q=
//   GET  /whatsapp/api/chat?tel=&despues=&antes=   (abrirla la da por leída)
//   POST /whatsapp/api/enviar   { tel, texto }     escribir (ventana de 24 h)
//   POST /whatsapp/api/bot      { tel, pausar }    pausar el bot o devolverle la conversación
//
// Mirar va con la llave '/whatsapp'; todo lo que no es un GET, con
// '/whatsapp/escribir' (services/permisos.js).

const express = require('express');
const router = express.Router();
const svc = require('./whatsapp.service');
const actor = require('../../services/repo/actor');   // quién firma
const permisos = require('../../services/permisos');

const LAYOUT = 'layout-gestion';
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/**
 * Quien puede ESCRIBIR, y no solo leer. El candado de verdad lo pone
 * `controlAcceso` sobre todo lo que no es un GET; esto es para que la pantalla
 * no enseñe una caja de escribir que va a contestar 403 (como el planificador).
 */
async function puedeEscribir(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await actor.idDe(req);
    return id ? (await permisos.clavesDe(id)).has('/whatsapp/escribir') : false;
  } catch (_) { return false; }
}

/** Envoltorio: recoge el error y lo devuelve legible. */
const responde = (fn, codigo = 500) => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [WhatsApp] ${req.method} ${req.path}: ${e.stack || e.message}`);
    res.status(codigo).json({ status: 'error', msg: e.message });
  }
};

router.get('/', async (req, res) => {
  res.render('whatsapp', { titulo: 'WhatsApp', seccion: 'whatsapp', layout: LAYOUT, puedeEscribir: await puedeEscribir(req) });
});

router.get('/api/conversaciones', responde(req => svc.conversaciones({ buscar: req.query.q })));
router.get('/api/chat', responde(req => svc.abrir(req.query.tel, { despuesDe: req.query.despues, antesDe: req.query.antes }), 400));
router.post('/api/enviar', responde(async req => svc.enviar({ telefono: (req.body || {}).tel, texto: (req.body || {}).texto }, await actor.idDe(req)), 400));
router.post('/api/bot', responde(async req => svc.bot({ telefono: (req.body || {}).tel, pausar: !!(req.body || {}).pausar }, await actor.idDe(req)), 400));

module.exports = router;
