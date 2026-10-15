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

module.exports = { conductores, oficina };
