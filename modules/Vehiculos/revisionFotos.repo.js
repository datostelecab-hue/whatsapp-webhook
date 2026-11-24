// ============================================================
// REVISIÓN DE FOTOS — el SQL (db/282)
// ============================================================
// Los LOTES salen de `adjunto` (tipo `turno_fotos`: las cinco fotos que hace un
// conductor al desvincular en el portal) y de su `fichaje_turno`; las
// CALIFICACIONES, de `taller_revision_fotos`. Las parejas las arma el servicio.
'use strict';

const db = require('../../services/db');
const { SEDE_FLOTA } = require('../../services/nucleo');

const TIPO = 'turno_fotos';

// La tabla aún no existe (db/282 sin aplicar): la pantalla dice que falta, no se rompe.
const faltaMigracion = e => !!e && e.code === '42P01';

// Las fotos de cada turno, primero filtradas por tipo y LUEGO convertidas a
// número: así el JOIN con `fichaje_turno` va por su clave (y no convierte a
// texto la tabla entera).
const FOTOS_CTE = `
  fotos AS MATERIALIZED (
    SELECT a.dueno_id::bigint AS turno_id, a.id, a.nombre, a.creado_at
      FROM adjunto a
     WHERE a.dueno_tipo = '${TIPO}' AND a.anulado_at IS NULL AND a.dueno_id ~ '^[0-9]+$')`;

// El coche de un turno: el que apuntó el fichaje o, si no, el de su matrícula.
const COCHE_DEL_TURNO = `
  JOIN vehiculo v ON v.id = COALESCE(f.vehiculo_id,
    (SELECT x.id FROM vehiculo x
      WHERE x.matricula_norm = upper(regexp_replace(f.matricula, '[^A-Za-z0-9]', '', 'g'))
      ORDER BY x.id LIMIT 1))`;

/**
 * TODOS LOS LOTES de los coches de la flota (Madrid), del más viejo al más
 * nuevo dentro de cada coche: [{ turno, vehiculo_id, matricula, quien, …, n_fotos }].
 */
async function lotes() {
  const r = await db.consulta(
    `WITH ${FOTOS_CTE}
     SELECT f.id::text AS turno, v.id::text AS vehiculo_id, v.matricula, f.tipo,
            COALESCE(NULLIF(btrim(f.nombre), ''), 'Sin nombre') AS quien,
            f.conductor_id::text AS conductor_id,
            max(fo.creado_at) AS hecho_at,
            to_char(min(fo.creado_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            to_char(f.inicio AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS desde,
            to_char(COALESCE(f.fin, max(fo.creado_at)) AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS hasta,
            count(*)::int AS n_fotos
       FROM fotos fo
       JOIN fichaje_turno f ON f.id = fo.turno_id
       ${COCHE_DEL_TURNO}
      WHERE v.sede = $1
      GROUP BY f.id, v.id
      ORDER BY v.id, max(fo.creado_at), f.id`, [SEDE_FLOTA]);
  return r.rows;
}

/** Las fotos de esos turnos: [{ turno, adjunto, fichero }]. */
async function fotosDe(turnos) {
  const ids = [...new Set((turnos || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT a.dueno_id AS turno, a.id::text AS adjunto, a.nombre AS fichero
       FROM adjunto a
      WHERE a.dueno_tipo = $1 AND a.anulado_at IS NULL AND a.dueno_id = ANY($2::text[])
      ORDER BY a.dueno_id, a.nombre, a.id`, [TIPO, ids]);
  return r.rows;
}

/** Todas las calificaciones, con quién calificó. */
async function revisiones() {
  const r = await db.consulta(
    `SELECT r.turno_id::text AS turno, r.turno_anterior_id::text AS turno_anterior, r.resultado, r.nota,
            r.fotos, COALESCE(u.nombre, '') AS revisado_nombre,
            to_char(r.revisado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS revisado
       FROM taller_revision_fotos r
       LEFT JOIN usuario u ON u.id = r.revisado_por`);
  return r.rows;
}

/** Califica un lote (o cambia su calificación), dentro de la transacción firmada `cli`. */
async function guardar(cli, { turno, anterior, vehiculoId, resultado, nota, fotos, usuarioId }) {
  const r = await cli.query(
    `INSERT INTO taller_revision_fotos (turno_id, turno_anterior_id, vehiculo_id, resultado, nota, fotos, revisado_por)
     VALUES ($1::bigint, $2::bigint, $3::bigint, $4, $5, $6::smallint[], $7)
     ON CONFLICT (turno_id) DO UPDATE
        SET turno_anterior_id = EXCLUDED.turno_anterior_id, vehiculo_id = EXCLUDED.vehiculo_id,
            resultado = EXCLUDED.resultado, nota = EXCLUDED.nota, fotos = EXCLUDED.fotos,
            revisado_por = EXCLUDED.revisado_por, revisado_at = now()
     RETURNING id::text`,
    [turno, anterior || null, vehiculoId || null, resultado, nota || null, fotos || [], usuarioId || null]);
  return r.rows[0].id;
}

/**
 * Los turnos cuyas fotos NO se borran a los 20 días: los dos lotes de cada
 * pareja calificada «con daños». Sin la tabla (db/282 sin aplicar), ninguno.
 */
async function turnosProtegidos(cli = null) {
  const pedir = (q, p) => (cli ? cli.query(q, p) : db.consulta(q, p));
  // Se mira antes si la tabla existe: dentro de una transacción, un error la
  // dejaría rota aunque se capturase (y la purga va dentro de una).
  const hay = await pedir(`SELECT to_regclass('public.taller_revision_fotos') IS NOT NULL AS hay`);
  if (!hay.rows[0].hay) return [];
  const r = await pedir(
    `SELECT turno_id::text AS t FROM taller_revision_fotos WHERE resultado = 'danos'
     UNION SELECT turno_anterior_id::text FROM taller_revision_fotos
            WHERE resultado = 'danos' AND turno_anterior_id IS NOT NULL`);
  return r.rows.map(x => x.t);
}

module.exports = { lotes, fotosDe, revisiones, guardar, turnosProtegidos, faltaMigracion, TIPO };
