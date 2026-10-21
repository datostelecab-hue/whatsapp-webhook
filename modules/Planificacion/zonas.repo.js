// ============================================================
// LAS ZONAS — las bases del planificador
// ============================================================
// Una zona (`base_zona`) es una base de Madrid: Alcobendas, Getafe… Cada
// cuadrante es de una y sus coches van con él (db/91): la zona de un coche es
// la de su cuadrante. Hasta el 21/10/2026 solo se daban de alta por SQL; desde
// entonces se crean, se renombran y se cambian de sitio desde el planificador
// («Zonas»), y a un cuadrante se le cambia la zona desde su cabecera. Lo pidió
// Camilo el día que los coches de Usera pasaron a Getafe y hubo que abrir
// Aravaca.
//
// SOLO LAS ACTIVAS. Una zona inactiva no es una base: Barcelona existe como
// etiqueta de sus coches y nace `activa = false` a propósito (db/76), para que
// nadie mande allí un coche de Madrid por un clic de más. Aquí ni se renombra
// ni se elige.
//
// Cada cambio se apunta en `cambio_campo` (services/repo/auditoria) con quién
// lo hizo: la tabla de zonas no tiene columnas para eso, y una zona que cambia
// de nombre cambia en todas las pantallas a la vez.

const db = require('../../services/db');
const audit = require('../../services/repo/auditoria');

// «Sin base» es lo que pinta el planificador para los coches que no tienen
// ninguna: una zona que se llamara así se confundiría con ellos.
const RESERVADOS = new Set(['sin base']);

/** El nombre tal y como se va a guardar: sin espacios de más. */
function limpiarNombre(nombre) {
  const n = String(nombre == null ? '' : nombre).replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Falta el nombre de la zona');
  if (n.length < 2) throw new Error('El nombre de la zona es demasiado corto');
  if (n.length > 80) throw new Error('El nombre de la zona no puede pasar de 80 letras');
  if (RESERVADOS.has(n.toLowerCase())) throw new Error(`«${n}» no puede ser el nombre de una zona: es como se llaman los coches que no tienen ninguna`);
  return n;
}

/**
 * Que el nombre no lo tenga ya otra zona. La tabla también lo impide
 * (`uq_base_nombre_norm`), pero con un error que no se puede enseñar; y si la
 * que lo tiene es una inactiva, hay que decir por qué no sale en la lista.
 */
async function nombreLibre(q, nombre, menosId) {
  const r = await q(
    `SELECT id, nombre, activa FROM base_zona
      WHERE nombre_norm = lower(btrim($1)) AND ($2::smallint IS NULL OR id <> $2)`,
    [nombre, menosId || null]);
  const otra = r.rows[0];
  if (!otra) return;
  throw new Error(otra.activa
    ? `Ya hay una zona que se llama «${otra.nombre}»`
    : `«${otra.nombre}» ya existe, pero no es una base del planificador (está retirada a propósito). Elige otro nombre.`);
}

/** Una zona nueva, activa y sin cuadrantes. */
async function crearZona({ nombre, lat, lng }, { usuarioId } = {}) {
  const n = limpiarNombre(nombre);
  return db.transaccion(async cli => {
    const q = (s, p) => cli.query(s, p);
    await nombreLibre(q, n);
    const r = await q(
      `INSERT INTO base_zona (nombre, lat, lng) VALUES ($1, $2, $3)
       RETURNING id, nombre, lat::float AS lat, lng::float AS lng`, [n, lat, lng]);
    const z = r.rows[0];
    await audit.registrar({
      tabla: 'base_zona', id: z.id, usuarioId, cli,
      cambios: [{ campo: 'alta', antes: null, ahora: `${z.nombre} (${z.lat}, ${z.lng})` }],
    });
    return { zona: { id: z.id, nombre: z.nombre } };
  });
}

/** Cambiar el nombre o la ubicación de una zona activa. */
async function editarZona(id, { nombre, lat, lng }, { usuarioId } = {}) {
  const zid = Number(id);
  if (!Number.isInteger(zid) || zid <= 0) throw new Error('Falta la zona');
  const n = limpiarNombre(nombre);
  return db.transaccion(async cli => {
    const q = (s, p) => cli.query(s, p);
    const antes = (await q(
      'SELECT id, nombre, lat::float AS lat, lng::float AS lng FROM base_zona WHERE id = $1 AND activa FOR UPDATE',
      [zid])).rows[0];
    if (!antes) throw new Error('Esa zona no existe o no es una base del planificador');
    await nombreLibre(q, n, zid);
    const ahora = (await q(
      `UPDATE base_zona SET nombre = $2, lat = $3, lng = $4 WHERE id = $1
       RETURNING id, nombre, lat::float AS lat, lng::float AS lng`, [zid, n, lat, lng])).rows[0];
    await audit.registrar({ tabla: 'base_zona', id: zid, antes, ahora, usuarioId, cli });
    return { zona: { id: ahora.id, nombre: ahora.nombre }, antes: antes.nombre };
  });
}

/**
 * Pasar un cuadrante (vivo) a otra zona (activa). Sus coches van con él: no
 * llevan zona propia, la de un coche es la de su cuadrante (db/91).
 */
async function cambiarZonaCuadrante(cuadranteId, zonaId, { usuarioId } = {}) {
  const cid = Number(cuadranteId), zid = Number(zonaId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el cuadrante');
  if (!Number.isInteger(zid) || zid <= 0) throw new Error('Elige la zona');
  return db.transaccion(async cli => {
    const q = (s, p) => cli.query(s, p);
    const cu = (await q(
      `SELECT cu.id, cu.base_zona_id, bz.nombre AS zona
         FROM cuadrante cu LEFT JOIN base_zona bz ON bz.id = cu.base_zona_id
        WHERE cu.id = $1 AND cu.baja_at IS NULL FOR UPDATE OF cu`, [cid])).rows[0];
    if (!cu) throw new Error('Ese cuadrante no existe o ya se borró');
    const z = (await q('SELECT id, nombre FROM base_zona WHERE id = $1 AND activa', [zid])).rows[0];
    if (!z) throw new Error('Esa zona no existe o no es una base del planificador');
    if (Number(cu.base_zona_id) === z.id) return { cambiado: false, zona: z.nombre };
    await q('UPDATE cuadrante SET base_zona_id = $2 WHERE id = $1', [cid, z.id]);
    await audit.registrar({
      tabla: 'cuadrante', id: cid, usuarioId, cli,
      cambios: [{ campo: 'zona', antes: cu.zona || null, ahora: z.nombre }],
    });
    return { cambiado: true, zona: z.nombre, antes: cu.zona || '' };
  });
}

module.exports = { crearZona, editarZona, cambiarZonaCuadrante, limpiarNombre };
