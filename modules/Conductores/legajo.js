// ============================================================
// EL LEGAJO, EN LIMPIO (db/284, 25/11/2026) — funciones puras
// ============================================================
// El legajo es el número de empleado de la gestoría («código gestoría»): seis
// cifras con ceros delante, como los 258 que había el 25/11. Lo usan la ficha
// (al guardarlo a mano) y la carga desde un Excel (legajos.service.js).
'use strict';

const CIFRAS = 6;

/** El legajo como se guarda: «57», «0057» o « 57 » → «000057». Lanza si no es un número de 1 a 6 cifras. */
function normalizar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\.0+$/, '');
  if (!s) return null;
  if (!/^\d{1,6}$/.test(s)) throw new Error(`El legajo es el número de empleado de la gestoría: de 1 a ${CIFRAS} cifras («${String(v).trim()}» no vale)`);
  return s.padStart(CIFRAS, '0');
}

/** El DNI o NIE para comparar: mayúsculas, sin espacios ni guiones, y sin ceros delante en un DNI. */
function claveDni(v) {
  let s = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (/^\d+[A-Z]$/.test(s)) s = s.replace(/^0+(?=\d)/, '');
  return s;
}

module.exports = { normalizar, claveDni, CIFRAS };
