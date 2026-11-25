// ============================================================
// QUIÉN VALIDA LOS PERMISOS RETRIBUIDOS (módulo 1, db/290, 25/11/2026)
// ============================================================
// El encargo: «Validador configurable (persona por definir; de momento,
// Diana)». Camilo, 25/11/2026: la llave en todas las puertas, también los
// asuntos propios.
//
// Validar un permiso es PONERLO, CAMBIARLO O BORRARLO en la ficha de la persona,
// por cualquier camino: Plantilla (añadir una ausencia, cambiar la situación,
// corregirla o borrarla), la Ticketera (aplicar el ticket) y Ausencias (abrir el
// permiso desde una ausencia). Todo eso lo exige aquí el servidor; la pantalla
// solo esconde los botones.
//
// La llave es '/permisos/aprobar'. No es de una sola persona como la de las
// vacaciones: se da a quien haga falta en /usuarios. Y como aquella, se mira EN
// SU MATRIZ DE VERDAD: ni el superadmin ni el desarrollador validan por su rol.
'use strict';

const permisos = require('./permisos');

const LLAVE = '/permisos/aprobar';
const ESTADOS = ['permiso', 'asuntos_propios'];   // las situaciones de la ficha que son un permiso

const codigo = x => String(x && typeof x === 'object' ? x.valor : (x || ''));
const esPermiso = estado => ESTADOS.includes(codigo(estado));

/** ¿Tiene la llave? Ante cualquier fallo, no. */
async function puede(usuarioId) {
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try { return (await permisos.clavesDe(id)).has(LLAVE); }
  catch (e) { console.error('❌ [Permisos] no se pudo mirar la llave:', e.message); return false; }
}

async function exigir(usuarioId) {
  if (await puede(usuarioId)) return;
  throw Object.assign(new Error('Los permisos retribuidos (y los asuntos propios) solo los pone, cambia o borra quien tiene la llave «Validar permisos». '
    + 'Se da en Usuarios.'), { status: 403 });
}

module.exports = { LLAVE, ESTADOS, esPermiso, puede, exigir };
