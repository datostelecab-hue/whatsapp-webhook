// ============================================================
// CUMPLEAÑOS — repositorio
// ============================================================
// Quién cumple años un día: los conductores con contrato abierto (su ficha ya
// trae la fecha de nacimiento) y la gente de oficina que la ha puesto en
// Configuración → Mi perfil (db/204). Solo se compara el día y el mes.

const db = require('../../services/db');

// Los del 29 de febrero, en un año que no es bisiesto, lo celebran el 28.
const COINCIDE = col => `(
  (EXTRACT(MONTH FROM ${col}) = $1 AND EXTRACT(DAY FROM ${col}) = $2)
  OR ($3::boolean AND EXTRACT(MONTH FROM ${col}) = 2 AND EXTRACT(DAY FROM ${col}) = 29))`;

/** Los conductores en plantilla (propia o ETT) que cumplen ese día. Nombre de BOLT primero. */
async function conductores(mes, dia, del29) {
  const r = await db.consulta(
    `SELECT DISTINCT ON (c.id) c.id,
            COALESCE(NULLIF(btrim(ext.externo_nombre), ''), NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
            e.tipo
       FROM conductor c
       JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL AND e.alta <= CURRENT_DATE
       LEFT JOIN LATERAL (
         SELECT externo_nombre FROM conductor_externo
          WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
          ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
      WHERE NOT c.es_centinela AND c.fecha_nacimiento IS NOT NULL
        AND ${COINCIDE('c.fecha_nacimiento')}
      ORDER BY c.id`, [mes, dia, !!del29]);
  return r.rows.map(x => ({ id: Number(x.id), nombre: x.nombre, ett: x.tipo === 'ett' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** La gente de oficina (usuarios activos) que cumple ese día. Sin db/204, nadie. */
async function oficina(mes, dia, del29) {
  try {
    const r = await db.consulta(
      `SELECT u.id, u.nombre, COALESCE(u.apellidos, '') AS apellidos, r.etiqueta AS rol
         FROM usuario u
         JOIN rol r ON r.id = u.rol_id
        WHERE u.estado = 'activo' AND u.fecha_nacimiento IS NOT NULL
          AND ${COINCIDE('u.fecha_nacimiento')}
        ORDER BY u.nombre, u.apellidos`, [mes, dia, !!del29]);
    return r.rows.map(x => ({ id: Number(x.id), nombre: x.nombre, apellidos: x.apellidos, rol: x.rol }));
  } catch (e) {
    if (e.code === '42703') return [];   // sin la columna (db/204)
    throw e;
  }
}

// ── LAS FELICITACIONES (db/205) ─────────────────────────────────────────────
// Sin la tabla (la migración sin aplicar) no se rompe nada: no hay ninguna, y
// felicitar avisa de que falta.
const SIN_TABLA = e => e.code === '42P01';

/** Apunta una felicitación. Una por quien felicita y cumpleaños: la segunda no hace nada. */
async function felicitar(paraId, deId, dia) {
  try {
    const r = await db.consulta(
      `INSERT INTO felicitacion (para_usuario_id, de_usuario_id, dia) VALUES ($1, $2, $3::date)
       ON CONFLICT (para_usuario_id, de_usuario_id, dia) DO NOTHING RETURNING id`,
      [Number(paraId), Number(deId), dia]);
    return { nueva: r.rows.length > 0 };
  } catch (e) {
    if (SIN_TABLA(e)) throw new Error('Todavía no se puede felicitar: falta aplicar la migración db/205');
    throw e;
  }
}

/** A quién ha felicitado ya alguien por el cumpleaños de ese día. */
async function yaFelicitados(deId, dia) {
  try {
    const r = await db.consulta(
      'SELECT para_usuario_id FROM felicitacion WHERE de_usuario_id = $1 AND dia = $2::date', [Number(deId), dia]);
    return new Set(r.rows.map(x => Number(x.para_usuario_id)));
  } catch (e) { if (SIN_TABLA(e)) return new Set(); throw e; }
}

/**
 * Las felicitaciones que alguien todavía no ha visto, de su último cumpleaños
 * (de la última semana: quien cumple puede no entrar hasta días después).
 */
async function pendientes(paraId) {
  try {
    const r = await db.consulta(
      `SELECT f.id, to_char(f.dia, 'YYYY-MM-DD') AS dia, u.nombre, COALESCE(u.apellidos, '') AS apellidos
         FROM felicitacion f
         JOIN usuario u ON u.id = f.de_usuario_id
        WHERE f.para_usuario_id = $1 AND f.visto_at IS NULL AND f.dia >= CURRENT_DATE - 7
        ORDER BY f.creado_at`, [Number(paraId)]);
    return r.rows.map(x => ({ id: Number(x.id), dia: x.dia, nombre: x.nombre, apellidos: x.apellidos }));
  } catch (e) { if (SIN_TABLA(e)) return []; throw e; }
}

/** Las marca como vistas (solo las suyas). */
async function marcarVistas(paraId, ids) {
  if (!ids.length) return 0;
  try {
    const r = await db.consulta(
      `UPDATE felicitacion SET visto_at = now()
        WHERE para_usuario_id = $1 AND id = ANY($2::bigint[]) AND visto_at IS NULL`, [Number(paraId), ids]);
    return r.rowCount;
  } catch (e) { if (SIN_TABLA(e)) return 0; throw e; }
}

module.exports = { conductores, oficina, felicitar, yaFelicitados, pendientes, marcarVistas };
