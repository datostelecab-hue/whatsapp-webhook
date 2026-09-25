// ============================================================
// FICHAJE — controlador
// ============================================================
// Traduce HTTP a llamadas al servicio. No decide nada.
//
// ── LOS CANDADOS, QUE NO SON IGUALES ────────────────────────────────────────
//
//   FICHAR   lo puede hacer cualquiera que haya entrado y tenga el fichaje
//            activado en su ficha. `/fichaje` NO está en el catálogo de
//            permisos a propósito (ver db/106): si fichar necesitara un permiso
//            habría que concedérselo a cada uno, y sería una forma más de que
//            alguien no pueda fichar el día que le toca.
//
//            Quien ficha puede además PEDIR que se corrija lo suyo (db/159):
//            viene con el fichaje, sin llave aparte.
//
//   REVISAR  (ver el registro de todos) es de quien tenga la llave
//            '/fichaje/revisar', y de los roles de acceso total.
//
//   APROBAR  (corregir a mano, confirmar horas y aprobar o rechazar lo que pide
//            cada uno) es SOLO de quien tiene esa llave en su matriz: una sola
//            persona, que la base no deja que sean dos. Ni superadmin ni
//            desarrollador aprueban por su rol. Lo exige el servicio.
//
//            No hace falta poner un middleware en cada ruta: TODO lo que cuelga
//            de '/fichaje/revisar/' lo cierra ya el control de acceso general
//            (services/sesion.controlAcceso) por prefijo. Por eso estas rutas
//            viven ahí y no en '/api': el día que alguien añada un endpoint
//            nuevo bajo ese prefijo, nace cerrado sin acordarse de nada.

const express = require('express');
const router = express.Router();
const fichaje = require('./fichaje.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

const responde = fn => async (req, res) => {
  try { res.json({ status: 'ok', ...(await fn(req)) }); }
  catch (e) {
    console.error('❌ [FICHAJE]', req.method, req.path + ':', e.message);
    res.status(400).json({ status: 'error', msg: e.message });
  }
};

const quien = async req => (req.usuario && req.usuario.id) || await actor.idDe(req);

/** Si este usuario lleva el módulo: mirar el registro de todos y aprobarlo. */
async function puedeRevisar(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await quien(req);
    return id ? (await permisos.clavesDe(id)).has('/fichaje/revisar') : false;
  } catch (_) { return false; }
}

// ── La pantalla ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const yo = await quien(req);
  res.render('fichaje', {
    titulo: 'Fichar jornada', seccion: 'fichaje', layout: 'layout-gestion',
    // El panel del registro solo lo ve quien lleva el módulo. Es la misma
    // llave que cierra las rutas: si se pintara con otra condición, habría
    // botones que dan 403.
    puedeRevisar: await puedeRevisar(req),
    // Los botones de corregir y aprobar, solo a quien tiene la llave de
    // verdad: al resto el servicio se lo negaría.
    puedeAprobar: await fichaje.tieneLlave(yo).catch(() => false),
    quienAprueba: ((await fichaje.quienAprueba().catch(() => null)) || {}).quien || null,
  });
});

// ── Fichar ─────────────────────────────────────────────────────────────────
// Lo llama la barra de arriba en CADA pantalla, así que responde lo justo.
router.get('/api/estado', responde(async req => {
  const yo = await quien(req);
  const e = await fichaje.estado(yo);
  // A quien aprueba, cuántas correcciones le esperan: sale en el menú.
  if (await fichaje.tieneLlave(yo).catch(() => false)) e.correccionesPorAprobar = await fichaje.cuantasCorrecciones();
  return e;
}));

router.post('/api/entrar', responde(async req =>
  ({ fichaje: await fichaje.entrar(await quien(req), (req.body || {}).ubicacion) })));

router.post('/api/salir', responde(async req =>
  ({ fichaje: await fichaje.salir(await quien(req), (req.body || {}).ubicacion) })));

// Su propia semana. Cada uno ve la suya y solo la suya: el id sale de la
// SESIÓN, nunca de la petición, o cualquiera podría pedir la de otro cambiando
// un número. `?dia=AAAA-MM-DD` elige la semana; por omisión, la de hoy.
router.get('/api/mi-semana', responde(async req => fichaje.miSemana(await quien(req), req.query.dia)));

// Pedir que se corrija una jornada propia (o una que no se fichó), y retirar
// la petición mientras nadie la haya resuelto. Como la semana, el id sale de la
// sesión: cada uno corrige lo suyo.
router.post('/api/correcciones', responde(async req => {
  const b = req.body || {};
  return fichaje.pedirCorreccion(await quien(req),
    { fichajeId: b.fichajeId, entrada: b.entrada, salida: b.salida, motivo: b.motivo });
}));

router.post('/api/correcciones/:id/retirar', responde(async req =>
  fichaje.retirarCorreccion(await quien(req), req.params.id)));

// ── Lo que solo puede quien lleva el módulo ────────────────────────────────
// Cuelgan de '/fichaje/revisar' porque ESE es el nombre del permiso: el prefijo
// las cierra solo (ver la cabecera).
router.get('/revisar/parte', responde(async req => fichaje.parteDelDia(req.query.dia)));

router.get('/revisar/sin-cerrar', responde(async () => ({ filas: await fichaje.sinCerrar() })));

router.get('/revisar/pendientes', responde(async () => fichaje.pendientes()));

router.get('/revisar/semana', responde(async req => fichaje.semanaDeTodos(req.query.dia)));

router.post('/revisar/corregir', responde(async req => {
  const b = req.body || {};
  const f = await fichaje.corregir(
    { id: b.id, usuarioId: b.usuarioId, entrada: b.entrada, salida: b.salida },
    { autor: await quien(req), motivo: b.motivo });
  console.log(`✏️  [FICHAJE] Corregido el fichaje ${f.id} — por ${req.usuario.email}: ${b.motivo}`);
  return { fichaje: f };
}));

// Lo que ha pedido corregir cada uno. Mirarlo va con la ruta; aprobar o
// rechazar, con la llave de verdad (lo exige el servicio).
router.get('/revisar/correcciones', responde(async () => fichaje.correccionesPendientes()));

router.post('/revisar/correcciones/:id', responde(async req => {
  const b = req.body || {};
  return fichaje.resolverCorreccion(req.params.id, { aprobar: b.aprobar, respuesta: b.respuesta }, await quien(req));
}));

router.post('/revisar/aprobar', responde(async req => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids : [];
  const r = await fichaje.aprobar(ids, await quien(req));
  console.log(`✅ [FICHAJE] ${r.aprobados} jornada(s) confirmadas por ${req.usuario.email}`);
  return r;
}));

module.exports = router;
