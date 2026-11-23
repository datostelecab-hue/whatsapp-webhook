// ============================================================
// EL CONTEXTO DE CADA PETICIÓN: QUIÉN Y DESDE DÓNDE (23/11/2026)
// ============================================================
// Para que el libro de auditoría (db/245, db/278) sepa QUIÉN hizo cada cambio
// sin que cada función tenga que pasarlo a mano. Camilo: «que se guarde en
// base de datos y ya. Que yo te pregunte (…) quién le cambió este dato a X
// conductor».
//
// app.js abre el contexto al llegar cada petición (la ruta) y le pone el
// usuario en cuanto se carga la sesión; el portal, la ficha del conductor; una
// tarea programada, su clave. services/db.js lo lee al escribir y se lo pasa a
// la base (telecab.usuario_id, telecab.origen), que es lo que lee el
// disparador del libro. Lo que firma el código a mano (libro.conFirma) manda
// sobre esto: se escribe después.
'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const almacen = new AsyncLocalStorage();

/** Ejecuta `fn` con este contexto: { usuarioId, origen }. */
const correr = (datos, fn) => almacen.run({ ...datos }, fn);

/** El contexto de ahora (o null fuera de una petición o tarea). */
const actual = () => almacen.getStore() || null;

/** Completa el contexto de ahora (p. ej. el usuario, cuando ya se sabe). */
function poner(datos) {
  const c = almacen.getStore();
  if (c) Object.assign(c, datos);
}

/** El middleware de Express: abre el contexto con la ruta. */
const middleware = (req, res, next) =>
  correr({ usuarioId: null, origen: `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`.slice(0, 60) }, next);

module.exports = { correr, actual, poner, middleware };
