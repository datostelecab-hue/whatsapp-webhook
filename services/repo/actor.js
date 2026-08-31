// ============================================================
// ACTOR — quién está haciendo el cambio
// ============================================================
// Media docena de tablas guardan `usuario_id` para saber quién movió algo: el
// estado de un coche, el turno de un conductor, una asignación. Ese id es de
// PostgreSQL, mientras que la sesión del navegador todavía viene del sistema de
// usuarios antiguo, que solo lleva el correo.
//
// Esta es la traducción, en un solo sitio, para que ningún módulo la repita ni
// la invente. Mientras los usuarios no estén migrados devuelve NULL, que es lo
// que las tablas esperan: la columna es opcional y el cambio se guarda igual,
// solo que sin firmar. El día que se carguen, empieza a firmar sola.

const db = require('../db');

// Solo se recuerdan los ACIERTOS. Un correo que hoy no está en la base puede
// estar mañana, así que un fallo no se cachea: se vuelve a preguntar.
const cache = new Map();

/**
 * El id de PostgreSQL del usuario de la petición, o null.
 * Nunca lanza: que falle la firma no puede tumbar la operación de fondo.
 */
async function idDe(req) {
  const email = req && req.usuario && req.usuario.email;
  if (!email) return null;

  const k = String(email).toLowerCase();
  if (cache.has(k)) return cache.get(k);

  try {
    const r = await db.consulta('SELECT id FROM usuario WHERE lower(email) = $1', [k]);
    if (!r.rows.length) return null;
    cache.set(k, r.rows[0].id);
    return r.rows[0].id;
  } catch (e) {
    console.error('⚠️  [ACTOR] No se pudo resolver el usuario:', e.message);
    return null;
  }
}

/** Olvida lo cacheado. Para después de migrar o de tocar usuarios. */
function olvidar() { cache.clear(); }

module.exports = { idDe, olvidar };
