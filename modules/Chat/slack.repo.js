// ============================================================
// LA MIGRACIÓN DE SLACK — el SQL (db/259 y db/260)
// ============================================================
// Solo consultas. Qué se trae y cómo lo decide slack.service.js. Lo que escribe
// recibe el `cli` de la transacción firmada (libro.conFirma).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, vals) => (cli || { query: (s, v) => db.consulta(s, v) }).query(sql, vals);
const NOMBRE = a => `btrim(${a}.nombre || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), ''))`;

/** Los usuarios del ERP, para saber quién es quién (con si son de la oficina). */
async function usuariosErp() {
  const r = await db.consulta(
    `SELECT u.id, u.nombre, u.apellidos, ${NOMBRE('u')} AS completo, lower(u.email) AS email, u.estado,
            NOT EXISTS (SELECT 1 FROM rol r WHERE r.id = u.rol_id AND r.codigo = 'conductor') AND u.estado <> 'bloqueado' AS oficina
       FROM usuario u ORDER BY u.id`);
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}

/** Lo apuntado de cada persona de Slack: Map(slack_id → fila). */
async function personasSlack() {
  const r = await db.consulta(
    `SELECT s.*, ${NOMBRE('u')} AS usuario_nombre FROM chat_slack_usuario s LEFT JOIN usuario u ON u.id = s.usuario_id`);
  return new Map(r.rows.map(x => [x.slack_id, { ...x, usuario_id: x.usuario_id == null ? null : Number(x.usuario_id) }]));
}
/** Apunta (o pone al día) a una persona de Slack. Lo puesto «a mano» no se pisa con una propuesta. */
async function apuntarPersona(cli, { slackId, nombre, email, usuarioId, como, esBot }) {
  await q(cli,
    `INSERT INTO chat_slack_usuario (slack_id, nombre, email, usuario_id, como, es_bot) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slack_id) DO UPDATE SET
       nombre = EXCLUDED.nombre, email = EXCLUDED.email, es_bot = EXCLUDED.es_bot,
       usuario_id = CASE WHEN chat_slack_usuario.como = 'a mano' THEN chat_slack_usuario.usuario_id ELSE EXCLUDED.usuario_id END,
       como = CASE WHEN chat_slack_usuario.como = 'a mano' THEN chat_slack_usuario.como ELSE EXCLUDED.como END,
       actualizado_at = now()`,
    [slackId, nombre, email || null, usuarioId || null, usuarioId ? como : null, !!esBot]);
}
/** Lo corrige el desarrollador en la pantalla. */
async function ponerUsuario(cli, slackId, usuarioId) {
  const r = await q(cli,
    `UPDATE chat_slack_usuario SET usuario_id = $2, como = CASE WHEN $2::int IS NULL THEN NULL ELSE 'a mano' END, actualizado_at = now()
      WHERE slack_id = $1 RETURNING slack_id`, [slackId, usuarioId || null]);
  return r.rows.length > 0;
}

// ── Los canales ────────────────────────────────────────────────────────────
async function canalPorSlack(cli, slackId) {
  const r = await q(cli, 'SELECT * FROM chat_canal WHERE slack_id = $1', [slackId]);
  return r.rows[0] || null;
}
async function canalPorNombre(cli, nombre) {
  const r = await q(cli, 'SELECT * FROM chat_canal WHERE nombre = $1', [nombre]);
  return r.rows[0] || null;
}
async function directoPorClave(cli, clave) {
  const r = await q(cli, 'SELECT * FROM chat_canal WHERE clave_directo = $1', [clave]);
  return r.rows[0] || null;
}
/** Le apunta de qué conversación de Slack viene. */
async function enlazarCanal(cli, canalId, { slackId }) {
  await q(cli, 'UPDATE chat_canal SET slack_id = $2 WHERE id = $1 AND slack_id IS DISTINCT FROM $2', [canalId, slackId]);
}
async function crearCanal(cli, { tipo, nombre = null, claveDirecto = null, creadoPor = null, creadoAt = null }) {
  const r = await q(cli,
    `INSERT INTO chat_canal (tipo, nombre, clave_directo, creado_por, creado_at) VALUES ($1, $2, $3, $4, COALESCE($5, now())) RETURNING *`,
    [tipo, nombre, claveDirecto, creadoPor, creadoAt]);
  return r.rows[0];
}
/** Mete a alguien en un canal (si no estaba). Entra con todo leído. */
async function meter(cli, canalId, usuarioId) {
  const r = await q(cli,
    `INSERT INTO chat_miembro (canal_id, usuario_id, ultimo_leido_id)
     VALUES ($1, $2, COALESCE((SELECT max(id) FROM chat_mensaje WHERE canal_id = $1), 0))
     ON CONFLICT (canal_id, usuario_id) DO NOTHING RETURNING usuario_id`, [canalId, usuarioId]);
  return r.rows.length > 0;
}
async function idsMiembros(cli, canalId) {
  const r = await q(cli, 'SELECT usuario_id FROM chat_miembro WHERE canal_id = $1 AND salido_at IS NULL', [canalId]);
  return r.rows.map(x => Number(x.usuario_id));
}

// ── Los mensajes ───────────────────────────────────────────────────────────
/** Los ya traídos de una conversación de Slack: Map(ts → { id }). */
async function traidos(cli, slackCanal) {
  const r = await q(cli, 'SELECT id, slack_ts FROM chat_mensaje WHERE slack_canal = $1 AND slack_ts IS NOT NULL', [slackCanal]);
  return new Map(r.rows.map(x => [x.slack_ts, { id: Number(x.id) }]));
}
/** Un mensaje de Slack. Si ya estaba (mismo canal y ts), nada. → id nuevo o null. */
async function importarMensaje(cli, { canalId, autorId, autorExterno, padreId, texto, creadoAt, editadoAt, conAdjuntos, slackCanal, slackTs }) {
  const r = await q(cli,
    `INSERT INTO chat_mensaje (canal_id, autor_id, autor_externo, padre_id, texto, creado_at, editado_at, con_adjuntos, slack_canal, slack_ts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (slack_canal, slack_ts) WHERE slack_ts IS NOT NULL DO NOTHING
     RETURNING id`,
    [canalId, autorId, autorExterno, padreId, texto, creadoAt, editadoAt, !!conAdjuntos, slackCanal, slackTs]);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}
async function mencionar(cli, mensajeId, { usuarios = [], todos = false }) {
  for (const u of usuarios) {
    await q(cli, 'INSERT INTO chat_mencion (mensaje_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [mensajeId, u]);
  }
  if (todos) await q(cli, 'INSERT INTO chat_mencion (mensaje_id, todos) VALUES ($1, TRUE) ON CONFLICT DO NOTHING', [mensajeId]);
}
async function reaccionar(cli, mensajeId, usuarioId, emoji, puestaAt) {
  await q(cli,
    `INSERT INTO chat_reaccion (mensaje_id, usuario_id, emoji, puesta_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [mensajeId, usuarioId, emoji, puestaAt]);
}
/** Al acabar un canal: cuántas respuestas tiene cada hilo y la fecha de lo último. */
async function recontar(cli, canalId) {
  await q(cli,
    `UPDATE chat_mensaje p SET respuestas = x.n, ultima_respuesta_at = x.ultima
       FROM (SELECT padre_id, count(*)::int AS n, max(creado_at) AS ultima FROM chat_mensaje
              WHERE canal_id = $1 AND padre_id IS NOT NULL GROUP BY padre_id) x
      WHERE p.id = x.padre_id AND (p.respuestas, p.ultima_respuesta_at) IS DISTINCT FROM (x.n, x.ultima)`, [canalId]);
  await q(cli,
    `UPDATE chat_canal c SET ultimo_mensaje_at = GREATEST(c.ultimo_mensaje_at, (SELECT max(creado_at) FROM chat_mensaje WHERE canal_id = c.id))
      WHERE c.id = $1`, [canalId]);
}

// ── Los ficheros (db/260) ──────────────────────────────────────────────────
/** Apunta un fichero de Slack con su mensaje (si ya estaba, nada). */
async function apuntarFichero(cli, { slackId, mensajeId, nombre, mime }) {
  await q(cli,
    `INSERT INTO chat_slack_fichero (slack_id, mensaje_id, nombre, mime) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slack_id) DO NOTHING`, [slackId, mensajeId, nombre, String(mime).slice(0, 150)]);
}
async function cuentaFicheros() {
  const r = await db.consulta(
    `SELECT count(*)::int AS total, (count(*) FILTER (WHERE adjunto_id IS NULL))::int AS pendientes FROM chat_slack_fichero`);
  return r.rows[0];
}
async function ficherosPendientes() {
  const r = await db.consulta('SELECT slack_id, nombre FROM chat_slack_fichero WHERE adjunto_id IS NULL ORDER BY slack_id');
  return r.rows.map(x => ({ id: x.slack_id, nombre: x.nombre }));
}
/** Uno, con el autor de su mensaje (quien lo subió en Slack). */
async function fichero(slackId) {
  const r = await db.consulta(
    `SELECT f.*, m.autor_id FROM chat_slack_fichero f JOIN chat_mensaje m ON m.id = f.mensaje_id WHERE f.slack_id = $1`, [slackId]);
  return r.rows[0] || null;
}
async function ficheroSubido(cli, slackId, adjuntoId) {
  await q(cli, 'UPDATE chat_slack_fichero SET adjunto_id = $2 WHERE slack_id = $1', [slackId, adjuntoId]);
}

module.exports = {
  usuariosErp, personasSlack, apuntarPersona, ponerUsuario,
  canalPorSlack, canalPorNombre, directoPorClave, enlazarCanal, crearCanal, meter, idsMiembros,
  traidos, importarMensaje, mencionar, reaccionar, recontar,
  apuntarFichero, cuentaFicheros, ficherosPendientes, fichero, ficheroSubido,
};
