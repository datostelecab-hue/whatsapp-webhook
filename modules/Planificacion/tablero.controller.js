// ============================================================
// PLANIFICADOR — controlador
// ============================================================
// Se monta en `/planificador` y en `/planificador-v2`: el front llama al
// segundo desde siempre y el primero es el que la gente tiene en favoritos.
//
// El V2 tiene su propia API y lee de PostgreSQL. Se separó del planificador
// viejo (sobre la hoja) por dos razones, y la segunda es la de peso:
//
//   · El viejo se queda quieto mientras se migra, sin tocarle una línea.
//   · Compartirla obligaba a que los dos hablasen el mismo idioma, y ya no lo
//     hablan: el viejo se entiende por el NOMBRE de BOLT y este por el id del
//     conductor. Mezclarlos sería arrastrar la limitación que veníamos a quitar.
//
// Aquí todo es traducción. Las reglas están en `tablero.service` y las de
// verdad —quién cubre qué día— en la base.

const express = require('express');
const router = express.Router();
const tablero = require('./tablero.service');
const actor = require('../../services/repo/actor');
const permisos = require('../../services/permisos');

// Los que lo abren todo sin filas en la matriz.
const ADMIN_TOTAL = ['superadmin', 'desarrollador'];

/**
 * Quien puede TOCAR el tablero, y no solo mirarlo.
 *
 * El candado de verdad no esta aqui: lo pone `controlAcceso` sobre cualquier
 * peticion que no sea un GET al planificador. Esto es para que la pantalla no
 * mienta —que no ensene botones que van a contestar 403— y se pinte en modo
 * solo lectura.
 */
async function puedeEditar(req) {
  const u = req.usuario || {};
  if (ADMIN_TOTAL.includes(u.rol)) return true;
  try {
    const id = await actor.idDe(req);
    return id ? (await permisos.clavesDe(id)).has('/planificador/editar') : false;
  } catch (_) { return false; }
}

const responde = fn => async (req, res) => {
  try {
    const r = await fn(req, res);
    if (!res.headersSent) res.json({ status: 'ok', ...(r && typeof r === 'object' ? r : {}) });
  } catch (e) {
    console.error(`❌ [TABLERO] ${req.method} ${req.path}: ${e.message}`);
    // Un "el coche ya lo lleva otro" NO es un error a secas: es una pregunta. Se
    // devuelve con su código y la comprobación entera para que la pantalla
    // ofrezca planificar a la fuerza sin tener que volver a consultar.
    res.status(400).json({
      status: 'error', msg: e.message,
      ...(e.codigo ? { codigo: e.codigo } : {}), ...(e.plan ? { plan: e.plan } : {}),
    });
  }
};

/** Quién firma el movimiento. Todo lo que escribe pasa por aquí. */
const quien = async req => ({ usuarioId: await actor.idDe(req) });

router.get('/', async (req, res) => {
  res.render('planificadorV2', {
    titulo: 'Planificador', seccion: 'planificador', layout: 'layout-gestion',
    puedeEditar: await puedeEditar(req),
    ...(await tablero.paraLaPantalla()),
  });
});

// ── El tablero de una semana ───────────────────────────────────────────────
// `?dia=AAAA-MM-DD` decide qué semana se pinta. Por omisión, hoy.
router.get('/api/tablero', responde(req => tablero.tablero({ dia: req.query.dia })));

// ── Guardar ────────────────────────────────────────────────────────────────

router.post('/api/guardar', responde(async req =>
  tablero.guardar((req.body || {}).cambios, (req.body || {}).dia, await quien(req))));

router.post('/api/comprobar', responde(async req => ({ plan: await tablero.comprobar(req.body) })));

router.post('/api/relevo/:id/quitar', responde(req =>
  tablero.quitarRelevo(req.params.id, (req.body || {}).dia)));

router.post('/api/cambiar-coche', responde(async req => {
  const b = req.body || {};
  return tablero.cambiarCoche({ de: b.de, a: b.a, dia: b.dia, turno: b.turno, forzar: b.forzar },
    await quien(req));
}));

router.post('/api/reemplazar-matricula', responde(async req => {
  const b = req.body || {};
  return tablero.reemplazarMatricula({ de: b.de, a: b.a, dia: b.dia }, await quien(req));
}));

router.post('/api/descanso', responde(async req => {
  const b = req.body || {};
  return tablero.fijarDescanso({ vehiculoId: b.vehiculoId, dias: b.dias, dia: b.dia }, await quien(req));
}));

router.post('/api/cubrir', responde(async req => tablero.cubrirAusencia(req.body || {}, await quien(req))));

router.post('/api/libranza-excepcional', responde(async req =>
  tablero.libranzaExcepcional(req.body || {}, await quien(req))));

router.delete('/api/libranza-excepcional/:id', responde(req =>
  tablero.borrarLibranzaExcepcional(req.params.id, req.query.dia)));

// ── Cuadrantes: el grupo de coches que comparte correturnos ────────────────

router.get('/api/cuadrantes', responde(() => tablero.cuadrantes()));

router.post('/api/cuadrantes', responde(async req =>
  tablero.crearCuadrante((req.body || {}).zonaId, await quien(req))));

router.delete('/api/cuadrantes/:id', responde(req =>
  tablero.borrarCuadrante(req.params.id, req.query.dia)));

// Añadir un bloque (matrícula + días de libranza) a un cuadrante.
router.post('/api/cuadrante/bloque', responde(async req => {
  const b = req.body || {};
  return tablero.anadirBloque(
    { cuadranteId: b.cuadranteId, vehiculoId: b.vehiculoId, dias: b.dias, dia: b.dia },
    await quien(req));
}));

// Meter (o sacar, con cuadranteId vacío) un coche de un cuadrante.
router.post('/api/cuadrante/coche', responde(req => tablero.meterCoche(req.body || {})));

// Asignar (o quitar) el CT de un cuadrante: se reparte entre sus coches.
router.post('/api/cuadrante/ct', responde(async req =>
  tablero.asignarCT(req.body || {}, await quien(req))));

// ── Modo eventos ───────────────────────────────────────────────────────────

router.get('/api/eventos', responde(req => tablero.eventoEstado(req.query.dia)));

router.post('/api/eventos', responde(async req =>
  tablero.crearEvento(req.body || {}, await quien(req))));

router.post('/api/eventos/:id', responde(req => tablero.editarEvento(req.params.id, req.body || {})));

router.post('/api/eventos/:id/cancelar', responde(async req =>
  tablero.cancelarEvento(req.params.id, req.body || {}, await quien(req))));

// Devolver el cuadrante a la normalidad a mano (el repaso de las 05:10 lo hace
// solo, pero a veces hace falta ya).
router.post('/api/eventos/:id/restaurar', responde(async req =>
  tablero.restaurarEvento(req.params.id, req.body || {}, await quien(req))));

// El mensaje que recibiría un conductor por WhatsApp durante el evento. Para
// poder LEERLO antes de mandarlo: es el que explica la vuelta a la normalidad.
router.get('/api/eventos/mensaje', responde(async req =>
  ({ mensaje: await tablero.mensajeDeEvento(req.query.telefono) })));

// ── Incorporaciones ────────────────────────────────────────────────────────
// La alerta que no se va hasta aceptarla o rechazarla. Sustituye al módulo
// /incorporaciones.

router.get('/api/incorporaciones', responde(() => tablero.incorporaciones()));

router.post('/api/incorporaciones/:id/aceptar', responde(async req =>
  tablero.aceptarIncorporacion(req.params.id, (req.body || {}).dia, await quien(req))));

router.post('/api/incorporaciones/:id/rechazar', responde(async req =>
  tablero.rechazarIncorporacion(req.params.id, (req.body || {}).motivo, await quien(req))));

// ── El barrio del conductor (su zona de casa: "Aluche", "San Blas"…) ───────

router.post('/api/barrio', responde(async req => {
  const b = req.body || {};
  return tablero.guardarBarrio(b.conductorId, b.barrio, {
    usuarioId: await actor.idDe(req), rol: (req.usuario && req.usuario.rol) || '',
  });
}));

module.exports = router;
