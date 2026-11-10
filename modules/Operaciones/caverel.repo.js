// ============================================================
// HORAS CAVEREL — lo que se lee y se escribe (db/238)
// ============================================================
// bitacora_caverel_mes: una fila por cuenta de BOLT y mes. La ficha del
// conductor se encuentra por el DNI (conductor.dni_nie, con el mismo
// upper(btrim()) que su índice único).

const db = require('../../services/db');

const DE_LA_FICHA = `LEFT JOIN conductor c ON c.dni_nie IS NOT NULL AND upper(btrim(c.dni_nie)) = upper(btrim(m.dni))`;

/**
 * Guarda las filas del archivo en UNA transacción: o entran todas o ninguna.
 * La misma cuenta y mes se sustituye (el archivo nuevo manda). Devuelve
 * { nuevas, cambiadas }.
 */
async function guardar(filas, usuarioId) {
  return db.transaccion(async cli => {
    let nuevas = 0, cambiadas = 0;
    // De mil en mil: unnest con 4.700 filas va sobrado, pero un archivo de
    // 60.000 no tiene por qué ir en una sola sentencia.
    for (let i = 0; i < filas.length; i += 1000) {
      const t = filas.slice(i, i + 1000);
      const r = await cli.query(
        `INSERT INTO bitacora_caverel_mes (mes, cuenta, nombre, dni, horas_online, ocupacion_pct, viajes, importado_por)
         SELECT x.mes, x.cuenta, x.nombre, x.dni, x.horas, x.ocupacion, x.viajes, $8
           FROM unnest($1::date[], $2::text[], $3::text[], $4::text[], $5::numeric[], $6::numeric[], $7::int[])
                AS x(mes, cuenta, nombre, dni, horas, ocupacion, viajes)
         ON CONFLICT (cuenta, mes) DO UPDATE
            SET nombre = EXCLUDED.nombre, dni = EXCLUDED.dni, horas_online = EXCLUDED.horas_online,
                ocupacion_pct = EXCLUDED.ocupacion_pct, viajes = EXCLUDED.viajes,
                importado_por = EXCLUDED.importado_por, importado_at = now()
         RETURNING (xmax = 0) AS nueva`,
        [t.map(f => f.mes), t.map(f => f.cuenta), t.map(f => f.nombre), t.map(f => f.dni),
          t.map(f => f.horas), t.map(f => f.ocupacion), t.map(f => f.viajes), usuarioId || null]);
      r.rows.forEach(x => { if (x.nueva) nuevas++; else cambiadas++; });
    }
    return { nuevas, cambiadas };
  });
}

/** Todas las filas, con la ficha si la hay. El orden es el de la pantalla. */
async function lista() {
  const r = await db.consulta(
    `SELECT m.id, to_char(m.mes, 'YYYY-MM-DD') AS mes, m.nombre, m.horas_online, m.ocupacion_pct, m.viajes,
            c.id AS conductor_id
       FROM bitacora_caverel_mes m ${DE_LA_FICHA}
      ORDER BY m.mes DESC, m.horas_online DESC, m.nombre`);
  return r.rows;
}

/**
 * Los meses de la persona de una fila: los de su DNI (todas sus cuentas) o, si
 * esa fila no lo trae, los de su cuenta. Del más nuevo al más viejo.
 */
async function dePersona(id) {
  const r = await db.consulta(
    `WITH f AS (SELECT cuenta, upper(btrim(dni)) AS dni FROM bitacora_caverel_mes WHERE id = $1)
     SELECT m.id, to_char(m.mes, 'YYYY-MM-DD') AS mes, m.cuenta, m.nombre, m.horas_online, m.ocupacion_pct, m.viajes,
            c.id AS conductor_id
       FROM bitacora_caverel_mes m CROSS JOIN f ${DE_LA_FICHA}
      WHERE m.cuenta = f.cuenta OR (f.dni IS NOT NULL AND f.dni <> '' AND upper(btrim(m.dni)) = f.dni)
      ORDER BY m.mes DESC, m.horas_online DESC`, [id]);
  return r.rows;
}

/** La última subida: cuándo y quién. null si no se ha subido nunca. */
async function ultimaImportacion() {
  const r = await db.consulta(
    `SELECT m.importado_at AS cuando, u.nombre AS quien, count(*) OVER ()::int AS filas
       FROM bitacora_caverel_mes m LEFT JOIN usuario u ON u.id = m.importado_por
      ORDER BY m.importado_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

module.exports = { guardar, lista, dePersona, ultimaImportacion };
