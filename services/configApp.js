// ============================================================
// CONFIG — los ajustes compartidos de la plataforma (clave/valor)
// ============================================================
// Preferencias que valen para todos y no para un navegador: el correo de
// procesos con su contraseña, el destinatario del parte de la ETT. Los secretos
// llegan aquí YA CIFRADOS (ver `services/cripto`); esta capa no sabe qué guarda,
// y así debe seguir.
//
// Vivían en una pestaña `CONFIG` de un Google Sheet. Desde el 15/09/2026 viven
// en PostgreSQL (`config_app`), por dos razones y la segunda pesa más:
//
//   1. DE ESTO CUELGA EL CORREO. `services/correo.js` lee la configuración cada
//      vez que manda algo, así que enviar un correo pasaba por Google. Si Sheets
//      tarda o falla, no es que no se pueda cambiar un ajuste: es que no sale el
//      correo.
//   2. AHÍ DENTRO HAY UNA CONTRASEÑA. Cifrada, sí, pero una hoja se comparte con
//      un clic y no deja rastro de quién la abrió.
//
// ── LA MUDANZA SE HACE SOLA, UNA VEZ ────────────────────────────────────────
// No hay script de migración ni "acuérdate de copiar los valores": la primera
// lectura que encuentre la tabla VACÍA se trae lo que haya en la hoja y lo
// guarda. A partir de ahí manda PostgreSQL y la hoja no se vuelve a mirar.
//
// Se hace así porque los valores solo se pueden leer desde donde hay
// credenciales de Google —el servidor—, y pedirle a alguien que lance una
// migración a mano es pedirle que se acuerde. Si la hoja no contesta, no pasa
// nada: se sigue con lo que haya en la base, aunque sea nada.

const db = require('./db');

// La hoja de la que se importó. Se conserva solo para el rescate de una vez.
const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'CONFIG';

/** Todo lo guardado, como objeto plano. */
async function deLaBase() {
  const r = await db.consulta('SELECT clave, valor FROM config_app');
  const o = {};
  for (const f of r.rows) o[f.clave] = f.valor == null ? '' : String(f.valor);
  return o;
}

/**
 * EL RESCATE, una sola vez: lo que hubiera en la hoja pasa a la tabla.
 *
 * Se llama solo cuando la tabla está vacía. Devuelve lo importado, o `null` si
 * no se pudo leer la hoja — que es lo normal fuera del servidor y no es un
 * error: significa que no hay nada que rescatar desde aquí.
 */
async function rescatarDeLaHoja() {
  try {
    const { readSheet } = require('./sheets');
    const filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:B`);
    const o = {};
    for (let i = 1; i < filas.length; i++) {
      const k = (filas[i][0] || '').toString().trim();
      if (k) o[k] = (filas[i][1] == null ? '' : filas[i][1]).toString();
    }
    if (!Object.keys(o).length) return null;
    await escribir(o, null);
    console.log(`⚙️  [CONFIG] ${Object.keys(o).length} ajuste(s) traídos de la hoja a PostgreSQL. ` +
      `La hoja CONFIG ya no se vuelve a leer.`);
    return o;
  } catch (e) {
    console.error('⚠️  [CONFIG] no se pudo mirar la hoja para el rescate:', e.message);
    return null;
  }
}

/** Escribe (o actualiza) un puñado de claves de una vez. */
async function escribir(cambios, usuarioId) {
  const claves = Object.keys(cambios || {});
  if (!claves.length) return;
  await db.consulta(
    `INSERT INTO config_app (clave, valor, usuario_id, actualizado_at)
     SELECT * FROM unnest($1::text[], $2::text[]) AS x(clave, valor),
                  LATERAL (SELECT $3::int, now()) AS y(usuario_id, actualizado_at)
     ON CONFLICT (clave) DO UPDATE
        SET valor = EXCLUDED.valor,
            usuario_id = EXCLUDED.usuario_id,
            actualizado_at = now()`,
    [claves, claves.map(k => (cambios[k] == null ? '' : String(cambios[k]))), usuarioId || null]);
}

/**
 * LOS AJUSTES. Si la tabla está vacía, se intenta el rescate de la hoja una vez.
 */
async function leerConfig() {
  const o = await deLaBase();
  if (Object.keys(o).length) return o;
  return (await rescatarDeLaHoja()) || o;
}

/**
 * Fusiona `cambios` con lo que haya y devuelve el resultado entero.
 *
 * Solo se tocan las claves que vienen: un ajuste que no se menciona se queda
 * como estaba. Antes esto reescribía la hoja completa, así que dos personas
 * guardando a la vez se pisaban entera la configuración; ahora cada clave es su
 * propia fila y solo chocan si tocan la misma.
 */
async function guardarConfig(cambios = {}, usuarioId = null) {
  await escribir(cambios, usuarioId);
  return deLaBase();
}

module.exports = { leerConfig, guardarConfig };
