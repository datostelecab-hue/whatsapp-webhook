// ============================================================
// EL TABLERO DE TAREAS — el SQL (db/251)
// ============================================================
// Solo consultas. Quién puede qué y cuándo lo decide services/tablero.js. Lo
// que escribe recibe el `cli` de la transacción firmada (libro.conFirma), para
// que la tarjeta, su evento y el libro entren juntos o no entre nada.
'use strict';

const db = require('../db');

const q = (cli, sql, vals) => (cli || { query: (s, v) => db.consulta(s, v) }).query(sql, vals);

const COLUMNAS = `
  t.id, t.tipo, t.origen_id, t.titulo, t.descripcion, t.enlace, t.sensible, t.estado,
  t.responsable_id, NULLIF(btrim(concat_ws(' ', r.nombre, r.apellidos)), '') AS responsable_nombre,
  t.creada_por, NULLIF(btrim(concat_ws(' ', c.nombre, c.apellidos)), '') AS creada_por_nombre, t.creada_at,
  t.plazo_dias, to_char(t.vence_el, 'YYYY-MM-DD') AS vence_el, t.plazo_desde,
  t.aprobada_at, t.aprobada_por, t.asignada_at, t.asignada_por, t.bloqueo_motivo,
  t.cerrada_at, t.cerrada_por, t.cierre_nota, t.motivo_demora, t.vencida_avisada_at, t.actualizada_at,
  COALESCE((SELECT array_agg(k.usuario_id ORDER BY k.id) FROM tarea_colaborador k
             WHERE k.tarea_id = t.id AND k.quitado_at IS NULL), '{}') AS colaboradores,
  (SELECT count(*)::int FROM tarea_comentario m WHERE m.tarea_id = t.id AND m.anulado_at IS NULL) AS comentarios`;
const DESDE = `FROM tarea t
  LEFT JOIN usuario r ON r.id = t.responsable_id
  LEFT JOIN usuario c ON c.id = t.creada_por`;

/** Una tarjeta. Con `bloquear`, la fila queda cogida hasta acabar la transacción. */
async function una(cli, id, { bloquear = false } = {}) {
  if (bloquear) await q(cli, 'SELECT id FROM tarea WHERE id = $1 FOR UPDATE', [id]);
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE} WHERE t.id = $1`, [id]);
  return r.rows[0] || null;
}

/** La tarjeta viva de una cosa de origen (el ticket 42), o null. */
async function porOrigen(cli, tipo, origenId) {
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE}
    WHERE t.tipo = $1 AND t.origen_id = $2 AND t.estado <> 'anulada'`, [tipo, String(origenId)]);
  return r.rows[0] || null;
}

/**
 * Las tarjetas que cumplen un filtro (lo pone services/tablero.js según quién
 * mira). Las abiertas siempre; las acabadas, las de los últimos `acabadasDias`.
 */
async function listar({ todas = false, responsables = null, usuarioId = null, estados = null, acabadasDias = 14, limite = 1000 } = {}) {
  const vals = [acabadasDias, limite];
  const filtros = [];
  if (!todas) {
    const o = [];
    if (usuarioId) {
      vals.push(usuarioId);
      const n = vals.length;
      o.push(`t.responsable_id = $${n}`, `t.creada_por = $${n}`,
        `EXISTS (SELECT 1 FROM tarea_colaborador k WHERE k.tarea_id = t.id AND k.usuario_id = $${n} AND k.quitado_at IS NULL)`);
    }
    if (responsables && responsables.length) { vals.push(responsables); o.push(`t.responsable_id = ANY($${vals.length}::int[])`); }
    if (estados && estados.length) { vals.push(estados); o.push(`t.estado = ANY($${vals.length}::text[])`); }
    if (!o.length) return [];
    filtros.push(`(${o.join(' OR ')})`);
  }
  filtros.push(`(t.estado NOT IN ('cerrada', 'rechazada', 'anulada') OR t.cerrada_at > now() - make_interval(days => $1::int))`);
  const r = await db.consulta(`SELECT ${COLUMNAS} ${DESDE}
    WHERE ${filtros.join(' AND ')}
    ORDER BY (t.estado IN ('cerrada', 'rechazada', 'anulada')), t.vence_el NULLS LAST, t.creada_at DESC
    LIMIT $2`, vals);
  return r.rows;
}

async function insertar(cli, x) {
  const r = await q(cli,
    `INSERT INTO tarea (tipo, origen_id, titulo, descripcion, enlace, sensible, estado, responsable_id, creada_por,
                        plazo_dias, vence_el, plazo_desde, aprobada_at, aprobada_por, asignada_at, asignada_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [x.tipo, x.origenId == null ? null : String(x.origenId), x.titulo, x.descripcion || null, x.enlace || null, !!x.sensible,
      x.estado, x.responsableId || null, x.creadaPor || null, x.plazoDias == null ? null : x.plazoDias, x.venceEl || null,
      x.plazoDesde || null, x.aprobadaAt || null, x.aprobadaPor || null, x.asignadaAt || null, x.asignadaPor || null]);
  return Number(r.rows[0].id);
}

const EDITABLES = new Set(['titulo', 'estado', 'responsable_id', 'plazo_dias', 'vence_el', 'plazo_desde', 'aprobada_at', 'aprobada_por',
  'asignada_at', 'asignada_por', 'bloqueo_motivo', 'cerrada_at', 'cerrada_por', 'cierre_nota', 'motivo_demora', 'vencida_avisada_at']);

/** Cambia las columnas dadas (solo las de EDITABLES) y la marca de actualizada. */
async function cambiar(cli, id, cambios) {
  const claves = Object.keys(cambios).filter(k => EDITABLES.has(k));
  if (!claves.length) return;
  const sets = claves.map((k, i) => `${k} = $${i + 2}`);
  await q(cli, `UPDATE tarea SET ${sets.join(', ')}, actualizada_at = now() WHERE id = $1`, [id, ...claves.map(k => cambios[k])]);
}

async function evento(cli, tareaId, { tipo, autorId = null, datos = {}, motivo = null }) {
  await q(cli, 'INSERT INTO tarea_evento (tarea_id, tipo, autor_id, datos, motivo) VALUES ($1, $2, $3, $4, $5)',
    [tareaId, tipo, autorId || null, JSON.stringify(datos || {}), motivo || null]);
}

async function eventos(tareaId) {
  const r = await db.consulta(
    `SELECT e.id, e.tipo, e.autor_id, NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS autor_nombre,
            e.en, e.datos, e.motivo
       FROM tarea_evento e LEFT JOIN usuario u ON u.id = e.autor_id
      WHERE e.tarea_id = $1 ORDER BY e.en, e.id`, [tareaId]);
  return r.rows;
}

async function comentar(cli, tareaId, autorId, texto, conAdjuntos = false) {
  const r = await q(cli, 'INSERT INTO tarea_comentario (tarea_id, autor_id, texto, con_adjuntos) VALUES ($1, $2, $3, $4) RETURNING id', [tareaId, autorId, texto, !!conAdjuntos]);
  return Number(r.rows[0].id);
}

// ── Los ficheros de un comentario (db/270) ──────────────────────────────────
// Se suben antes de mandar, a un borrador de quien escribe ('tarea_borrador',
// «<su id>-<al azar>»), igual que el chat. Al comentar, pasan al comentario.
/** Cuántos ficheros tiene ya el borrador (bloqueados hasta que acabe la transacción). */
async function ficherosDeBorrador(cli, borrador, autorId) {
  const r = await q(cli,
    `SELECT id FROM adjunto
      WHERE dueno_tipo = 'tarea_borrador' AND dueno_id = $1 AND creado_por = $2 AND anulado_at IS NULL
      FOR UPDATE`, [borrador, autorId]);
  return r.rows.length;
}

/** Los ficheros del borrador pasan al comentario. */
async function pasarBorrador(cli, borrador, autorId, tipo, duenoId) {
  const r = await q(cli,
    `UPDATE adjunto SET dueno_tipo = $4, dueno_id = $3
      WHERE dueno_tipo = 'tarea_borrador' AND dueno_id = $1 AND creado_por = $2 AND anulado_at IS NULL
      RETURNING id`, [borrador, autorId, String(duenoId), tipo]);
  return r.rows.length;
}

async function comentario(cli, id) {
  const r = await q(cli, 'SELECT id, tarea_id, autor_id, anulado_at FROM tarea_comentario WHERE id = $1', [id]);
  return r.rows[0] || null;
}

async function anularComentario(cli, id, { por, motivo }) {
  const r = await q(cli, `UPDATE tarea_comentario SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
    WHERE id = $1 AND anulado_at IS NULL`, [id, por, motivo]);
  return r.rowCount;
}

async function comentarios(tareaId) {
  const r = await db.consulta(
    `SELECT m.id, m.autor_id, NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS autor_nombre, m.texto, m.creado_at
       FROM tarea_comentario m LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE m.tarea_id = $1 AND m.anulado_at IS NULL ORDER BY m.creado_at, m.id`, [tareaId]);
  return r.rows;
}

async function ponerColaborador(cli, tareaId, usuarioId, por) {
  const r = await q(cli, `INSERT INTO tarea_colaborador (tarea_id, usuario_id, puesto_por) VALUES ($1, $2, $3)
    ON CONFLICT (tarea_id, usuario_id) WHERE quitado_at IS NULL DO NOTHING RETURNING id`, [tareaId, usuarioId, por]);
  return r.rowCount;
}

async function quitarColaborador(cli, tareaId, usuarioId, por) {
  const r = await q(cli, `UPDATE tarea_colaborador SET quitado_at = now(), quitado_por = $3
    WHERE tarea_id = $1 AND usuario_id = $2 AND quitado_at IS NULL`, [tareaId, usuarioId, por]);
  return r.rowCount;
}

/** Una persona que puede llevar tarjetas: activa y de la oficina (no un conductor). */
async function persona(id) {
  const r = await db.consulta(
    `SELECT u.id, NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS nombre, u.estado, ro.codigo AS rol
       FROM usuario u JOIN rol ro ON ro.id = u.rol_id WHERE u.id = $1`, [id]);
  return r.rows[0] || null;
}

/** Las personas a las que se puede dar una tarjeta (para los selectores). */
async function personas() {
  const r = await db.consulta(
    `SELECT u.id, NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS nombre, ro.codigo AS rol
       FROM usuario u JOIN rol ro ON ro.id = u.rol_id
      WHERE u.estado <> 'bloqueado' AND ro.codigo <> 'conductor'
      ORDER BY u.nombre, u.apellidos`);
  return r.rows;
}

/** Cuántas tiene: las suyas trabajándose (y vencidas), y las de las colas que reparte. */
async function cuentas(usuarioId, hoyIso) {
  const r = await db.consulta(
    `SELECT count(*) FILTER (WHERE responsable_id = $1 AND estado IN ('por_hacer', 'en_curso', 'bloqueada'))::int AS mias,
            count(*) FILTER (WHERE responsable_id = $1 AND estado IN ('por_hacer', 'en_curso', 'bloqueada')
                               AND vence_el < $2::date)::int AS vencidas,
            count(*) FILTER (WHERE estado = 'por_aprobar')::int AS por_aprobar,
            count(*) FILTER (WHERE estado = 'por_asignar')::int AS por_asignar
       FROM tarea WHERE estado IN ('por_aprobar', 'por_asignar', 'por_hacer', 'en_curso', 'bloqueada')`, [usuarioId, hoyIso]);
  return r.rows[0];
}

/** Las que vencieron antes de `hoy` y aún no se avisaron, cogidas para avisarlas. */
async function vencidasSinAviso(cli, hoyIso) {
  const r = await q(cli,
    `SELECT id, titulo, responsable_id, to_char(vence_el, 'YYYY-MM-DD') AS vence_el, sensible
       FROM tarea
      WHERE estado IN ('por_hacer', 'en_curso', 'bloqueada') AND vence_el < $1::date AND vencida_avisada_at IS NULL
      ORDER BY vence_el, id
      FOR UPDATE SKIP LOCKED`, [hoyIso]);
  return r.rows;
}

// ── Para las colas (entrega 1c, services/tableroColas.js) ──────────────────
/** Las tarjetas vivas de un tipo, con el id de su origen. */
async function vivasDe(tipo) {
  const r = await db.consulta(
    `SELECT id, origen_id FROM tarea
      WHERE tipo = $1 AND origen_id IS NOT NULL AND estado NOT IN ('cerrada', 'rechazada', 'anulada')`, [tipo]);
  return r.rows;
}

/** La última tarjeta (en cualquier estado) de cada uno de esos orígenes. */
async function deOrigenes(tipo, origenIds) {
  if (!origenIds.length) return [];
  const r = await db.consulta(
    `SELECT DISTINCT ON (origen_id) id, origen_id, estado, titulo, responsable_id, asignada_por
       FROM tarea WHERE tipo = $1 AND origen_id = ANY($2::text[])
      ORDER BY origen_id, id DESC`, [tipo, origenIds.map(String)]);
  return r.rows;
}

module.exports = {
  una, porOrigen, listar, insertar, cambiar, evento, eventos, comentar, comentario, anularComentario, comentarios,
  ponerColaborador, quitarColaborador, persona, personas, cuentas, vencidasSinAviso, vivasDe, deOrigenes,
  ficherosDeBorrador, pasarBorrador,
};
