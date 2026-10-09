// ============================================================
// QUIÉN APRUEBA LAS VACACIONES — una sola persona
// ============================================================
// Camilo, 09/10/2026: «el departamento de Laura será el único que apruebe
// vacaciones; el resto puede verlas pero no aprobarlas. Laura Blanco será la
// única».
//
// Aprobar unas vacaciones es PONERLAS en la ficha de la persona, por cualquier
// camino: aplicar el ticket que las pide, cerrarlo (aprobado, rechazado, no
// procede), sacarlo de la bandeja de vacaciones, o poner, corregir o borrar un
// tramo de vacaciones desde Plantilla. Todo eso lo exige aquí el servidor; la
// pantalla solo esconde los botones.
//
// La llave es '/vacaciones/aprobar' y la tiene UNA persona (db/189,
// uq_permiso_vacaciones_aprobar), como la de los fichajes: para dársela a otra
// hay que quitársela antes a quien la tenga. Y se mira EN SU MATRIZ DE VERDAD:
// ni el superadmin ni el desarrollador aprueban por su rol.

const db = require('./db');
const permisos = require('./permisos');

const LLAVE = '/vacaciones/aprobar';
const ESTADO = 'vacaciones';     // la situación de la ficha (cat_estado_conductor)
const SUBTIPO = 'VACACIONES';    // el tipo de ticket (cat_ticket_subtipo)

/** ¿Tiene la llave? Ante cualquier fallo, no: aprobar de más es peor que de menos. */
async function puede(usuarioId) {
  const id = Number(usuarioId);
  if (!Number.isInteger(id) || id <= 0) return false;
  try { return (await permisos.clavesDe(id)).has(LLAVE); }
  catch (e) { console.error('❌ [Vacaciones] no se pudo mirar la llave:', e.message); return false; }
}

/** Quién la tiene, con su nombre, o null si no la tiene nadie. */
async function quien() {
  try {
    const r = await db.consulta(
      `SELECT btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS nombre
         FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
        WHERE p.clave = $1 AND u.estado <> 'bloqueado' LIMIT 1`, [LLAVE]);
    return r.rows[0] ? r.rows[0].nombre : null;
  } catch (_) { return null; }
}

/** Lo que necesita una pantalla: si quien mira aprueba, y quién lo hace. */
async function paraLaPantalla(usuarioId) {
  const [p, q] = await Promise.all([puede(usuarioId), quien()]);
  return { puede: p, quien: q };
}

/** Lanza, con un mensaje que dice a quién acudir, si no tiene la llave. */
async function exigir(usuarioId) {
  if (await puede(usuarioId)) return;
  const q = await quien();
  throw new Error(q
    ? `Las vacaciones solo las aprueba ${q}. Puedes verlas, pero no aprobarlas, rechazarlas ni cambiarlas.`
    : 'Nadie tiene la llave de aprobar vacaciones: hay que dársela a alguien en Usuarios y permisos.');
}

module.exports = { LLAVE, ESTADO, SUBTIPO, puede, quien, paraLaPantalla, exigir };
