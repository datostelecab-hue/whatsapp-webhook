// ============================================================
// COMBUSTIBLE · EL CORREO DE PETROPRIX (PREPARADO, SIN ESTRUCTURA)
// ============================================================
// Petroprix también mandará un correo por repostaje, pero el 22/10/2026 aún no
// ha llegado ninguno y no se sabe cómo es. Este lector existe para que, cuando
// lleguen, NO SE PIERDAN: se reconocen por la dirección (cualquiera de su
// dominio), se guardan como «no_leido» con este motivo y con su texto, y el día
// que se escriba su `leer` y suba `version`, la siguiente pasada los vuelve a
// leer desde lo guardado, sin ir al buzón (combustible.service, releer).
//
// Para escribirlo: mirar uno de verdad en /combustible (la ficha enseña el texto
// del correo), copiar el patrón de lector.ballenoil.js —las etiquetas y qué es
// obligatorio— y subir VERSION a 1. Y sus casos, a scripts/comprobar-combustible.js.

const VERSION = 0;

/** Cualquier dirección de su dominio: la de los repostajes aún no se sabe. */
const esRemitente = de => /@(?:[a-z0-9-]+\.)*petroprix\.(?:es|com)$/i.test(String(de || '').trim());

function leer() {
  return {
    ok: false,
    motivo: 'Todavía no sabemos leer los correos de Petroprix: se guarda su texto y se leerá solo cuando esté su lector',
    faltan: [],
    datos: {},
    version: VERSION,
  };
}

module.exports = {
  codigo: 'petroprix',
  nombre: 'Petroprix',
  version: VERSION,
  esRemitente,
  // Sin asunto conocido no se reconoce uno reenviado por la oficina: llega por
  // su dirección o no llega. Cuando se sepa, va aquí, como en Ballenoil.
  asunto: null,
  leer,
};
