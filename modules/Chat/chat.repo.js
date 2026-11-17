// ============================================================
// EL CHAT INTERNO — el SQL (db/256, ítem 2)
// ============================================================
// Solo consultas. Quién ve qué y quién puede qué lo decide chat.service.js.
// Lo que escribe recibe el `cli` de la transacción firmada (libro.conFirma).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, vals) => (cli || { query: (s, v) => db.consulta(s, v) }).query(sql, vals);
const NOMBRE = a => `btrim(${a}.nombre || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), ''))`;
// Quién es de la oficina: con sesión en la gestión (no los conductores) y sin bloquear.
const OFICINA = a => `${a}.estado <> 'bloqueado' AND NOT EXISTS (SELECT 1 FROM rol r WHERE r.id = ${a}.rol_id AND r.codigo = 'conductor')`;

/** La gente de la oficina, para mencionar y para los directos. */
async function personas() {
  const r = await db.consulta(
    `SELECT u.id, ${NOMBRE('u')} AS nombre, p.nombre AS puesto
       FROM usuario u LEFT JOIN puesto p ON p.codigo = u.puesto_codigo
      WHERE ${OFICINA('u')}
      ORDER BY u.nombre, u.apellidos`);
  return r.rows;
}

async function esDeLaOficina(usuarioId) {
  const r = await db.consulta(`SELECT 1 FROM usuario u WHERE u.id = $1 AND ${OFICINA('u')}`, [usuarioId]);
  return r.rows.length > 0;
}

/**
 * Mete a una persona en los públicos en los que no está (y no salió): quien
 * llega a la oficina entra solo. Lo de antes de entrar no le cuenta como no
 * leído. → cuántos.
 */
async function asegurarPublicos(usuarioId) {
  const r = await db.consulta(
    `INSERT INTO chat_miembro (canal_id, usuario_id, ultimo_leido_id)
     SELECT c.id, $1, COALESCE((SELECT max(m.id) FROM chat_mensaje m WHERE m.canal_id = c.id), 0)
       FROM chat_canal c
      WHERE c.tipo = 'publico' AND c.archivado_at IS NULL
        AND EXISTS (SELECT 1 FROM usuario u WHERE u.id = $1 AND ${OFICINA('u')})
     ON CONFLICT (canal_id, usuario_id) DO NOTHING
     RETURNING canal_id`, [usuarioId]);
  return r.rows.length;
}

const NO_LEIDOS = `
  (SELECT count(*) FROM chat_mensaje m
    WHERE m.canal_id = c.id AND m.padre_id IS NULL AND m.id > mi.ultimo_leido_id
      AND m.autor_id IS DISTINCT FROM mi.usuario_id AND m.anulado_at IS NULL)::int`;
// Mensajes que le mencionan (uno que le nombra y además dice @canal, cuenta una vez).
const MENCIONES = `
  (SELECT count(DISTINCT m.id) FROM chat_mencion x JOIN chat_mensaje m ON m.id = x.mensaje_id
    WHERE m.canal_id = c.id AND m.id > mi.ultimo_leido_id AND m.autor_id IS DISTINCT FROM mi.usuario_id
      AND m.anulado_at IS NULL AND (x.usuario_id = mi.usuario_id OR x.todos))::int`;

/** Los canales de una persona (en los que está), con sus no leídos y menciones. */
async function canalesDe(usuarioId) {
  const r = await db.consulta(
    `SELECT c.id, c.tipo, c.nombre, c.tema, c.descripcion, c.creado_por, c.ultimo_mensaje_at, mi.ultimo_leido_id,
            ${NO_LEIDOS} AS sin_leer, ${MENCIONES} AS menciones,
            (SELECT count(*) FROM chat_miembro o WHERE o.canal_id = c.id AND o.salido_at IS NULL)::int AS miembros,
            CASE WHEN c.tipo = 'directo' THEN
              (SELECT COALESCE(json_agg(json_build_object('id', u.id, 'nombre', ${NOMBRE('u')}) ORDER BY u.nombre), '[]')
                 FROM chat_miembro o JOIN usuario u ON u.id = o.usuario_id
                WHERE o.canal_id = c.id AND o.salido_at IS NULL AND o.usuario_id <> mi.usuario_id) END AS otros
       FROM chat_miembro mi
       JOIN chat_canal c ON c.id = mi.canal_id
      WHERE mi.usuario_id = $1 AND mi.salido_at IS NULL AND c.archivado_at IS NULL`, [usuarioId]);
  return r.rows;
}

/** Los números de una persona: no leídos de canales, de directos y menciones. */
async function resumen(usuarioId) {
  const r = await db.consulta(
    `SELECT COALESCE(sum(${NO_LEIDOS}) FILTER (WHERE c.tipo <> 'directo'), 0)::int AS canales,
            COALESCE(sum(${NO_LEIDOS}) FILTER (WHERE c.tipo = 'directo'), 0)::int AS directos,
            COALESCE(sum(${MENCIONES}) FILTER (WHERE c.tipo <> 'directo'), 0)::int AS menciones
       FROM chat_miembro mi JOIN chat_canal c ON c.id = mi.canal_id
      WHERE mi.usuario_id = $1 AND mi.salido_at IS NULL AND c.archivado_at IS NULL`, [usuarioId]);
  return r.rows[0];
}

async function canal(cli, id) {
  const r = await q(cli, `SELECT c.*, ${NOMBRE('u')} AS creado_por_nombre FROM chat_canal c LEFT JOIN usuario u ON u.id = c.creado_por WHERE c.id = $1`, [id]);
  return r.rows[0] || null;
}
async function canalPorNombre(cli, nombre) {
  const r = await q(cli, 'SELECT id FROM chat_canal WHERE nombre = $1', [nombre]);
  return r.rows[0] || null;
}
async function directoPorClave(cli, clave) {
  const r = await q(cli, 'SELECT id FROM chat_canal WHERE clave_directo = $1', [clave]);
  return r.rows[0] || null;
}

async function miembro(cli, canalId, usuarioId) {
  const r = await q(cli, 'SELECT * FROM chat_miembro WHERE canal_id = $1 AND usuario_id = $2', [canalId, usuarioId]);
  return r.rows[0] || null;
}
/** Los que están en un canal ahora, con su nombre. */
async function miembros(cli, canalId) {
  const r = await q(cli,
    `SELECT u.id, ${NOMBRE('u')} AS nombre, p.nombre AS puesto
       FROM chat_miembro mi JOIN usuario u ON u.id = mi.usuario_id LEFT JOIN puesto p ON p.codigo = u.puesto_codigo
      WHERE mi.canal_id = $1 AND mi.salido_at IS NULL AND u.estado <> 'bloqueado'
      ORDER BY u.nombre, u.apellidos`, [canalId]);
  return r.rows;
}
async function idsMiembros(cli, canalId) {
  const r = await q(cli, 'SELECT usuario_id FROM chat_miembro WHERE canal_id = $1 AND salido_at IS NULL', [canalId]);
  return r.rows.map(x => Number(x.usuario_id));
}

async function crearCanal(cli, { tipo, nombre = null, tema = null, descripcion = null, claveDirecto = null, creadoPor }) {
  const r = await q(cli,
    `INSERT INTO chat_canal (tipo, nombre, tema, descripcion, clave_directo, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [tipo, nombre, tema, descripcion, claveDirecto, creadoPor]);
  return Number(r.rows[0].id);
}

/** Entra (o vuelve) a un canal. Lo de antes de entrar, leído. */
async function meter(cli, canalId, usuarioId, anadidoPor) {
  await q(cli,
    `INSERT INTO chat_miembro (canal_id, usuario_id, anadido_por, ultimo_leido_id)
     VALUES ($1, $2, $3, COALESCE((SELECT max(id) FROM chat_mensaje WHERE canal_id = $1), 0))
     ON CONFLICT (canal_id, usuario_id) DO UPDATE
       SET salido_at = NULL, salido_por = NULL, desde_at = now(), anadido_por = EXCLUDED.anadido_por
     WHERE chat_miembro.salido_at IS NOT NULL`, [canalId, usuarioId, anadidoPor]);
}
/** Toda la oficina, dentro de un canal público. */
async function meterOficina(cli, canalId) {
  await q(cli,
    `INSERT INTO chat_miembro (canal_id, usuario_id)
     SELECT $1, u.id FROM usuario u WHERE ${OFICINA('u')}
     ON CONFLICT (canal_id, usuario_id) DO NOTHING`, [canalId]);
}
async function sacar(cli, canalId, usuarioId, por) {
  const r = await q(cli,
    `UPDATE chat_miembro SET salido_at = now(), salido_por = $3
      WHERE canal_id = $1 AND usuario_id = $2 AND salido_at IS NULL RETURNING usuario_id`, [canalId, usuarioId, por]);
  return r.rows.length > 0;
}

// ── Los mensajes ───────────────────────────────────────────────────────────
const COLUMNAS = `m.id, m.canal_id, m.autor_id, ${NOMBRE('u')} AS autor, m.padre_id, m.creado_at,
  CASE WHEN m.anulado_at IS NULL THEN m.texto ELSE NULL END AS texto,
  m.respuestas, m.ultima_respuesta_at, m.editado_at, m.anulado_at`;

/** Los de arriba de un canal (sin las respuestas de los hilos), los más nuevos primero. */
async function mensajes(canalId, { antes = null, despues = null, limite = 50 } = {}) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS} FROM chat_mensaje m LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE m.canal_id = $1 AND m.padre_id IS NULL
        AND ($2::bigint IS NULL OR m.id < $2) AND ($3::bigint IS NULL OR m.id > $3)
      ORDER BY m.id ${despues != null ? 'ASC' : 'DESC'} LIMIT $4`, [canalId, antes, despues, limite]);
  return r.rows;
}
async function mensaje(cli, id) {
  const r = await q(cli, `SELECT ${COLUMNAS} FROM chat_mensaje m LEFT JOIN usuario u ON u.id = m.autor_id WHERE m.id = $1`, [id]);
  return r.rows[0] || null;
}
async function respuestas(padreId) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS} FROM chat_mensaje m LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE m.padre_id = $1 ORDER BY m.id LIMIT 500`, [padreId]);
  return r.rows;
}

async function escribir(cli, { canalId, autorId, padreId = null, texto }) {
  const r = await q(cli,
    `INSERT INTO chat_mensaje (canal_id, autor_id, padre_id, texto) VALUES ($1, $2, $3, $4) RETURNING id`,
    [canalId, autorId, padreId, texto]);
  const id = Number(r.rows[0].id);
  if (padreId) {
    await q(cli, 'UPDATE chat_mensaje SET respuestas = respuestas + 1, ultima_respuesta_at = now() WHERE id = $1', [padreId]);
  }
  await q(cli, 'UPDATE chat_canal SET ultimo_mensaje_at = now() WHERE id = $1', [canalId]);
  // Lo que escribe uno, lo tiene leído.
  await q(cli, 'UPDATE chat_miembro SET ultimo_leido_id = GREATEST(ultimo_leido_id, $3) WHERE canal_id = $1 AND usuario_id = $2',
    [canalId, autorId, id]);
  return id;
}
async function mencionar(cli, mensajeId, { usuarios = [], todos = false }) {
  for (const u of usuarios) {
    await q(cli, 'INSERT INTO chat_mencion (mensaje_id, usuario_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [mensajeId, u]);
  }
  if (todos) await q(cli, 'INSERT INTO chat_mencion (mensaje_id, todos) VALUES ($1, TRUE) ON CONFLICT DO NOTHING', [mensajeId]);
}
/** Los mencionados de unos mensajes: { mensajeId: { usuarios: [ids], todos } }. */
async function mencionesDe(ids) {
  if (!ids.length) return new Map();
  const r = await db.consulta('SELECT mensaje_id, usuario_id, todos FROM chat_mencion WHERE mensaje_id = ANY($1::bigint[])', [ids]);
  const m = new Map();
  r.rows.forEach(x => {
    const k = Number(x.mensaje_id);
    if (!m.has(k)) m.set(k, { usuarios: [], todos: false });
    if (x.todos) m.get(k).todos = true; else m.get(k).usuarios.push(Number(x.usuario_id));
  });
  return m;
}

/** Leído hasta `hasta` (sin pasar del último del canal ni volver atrás). */
async function leer(canalId, usuarioId, hasta) {
  const r = await db.consulta(
    `UPDATE chat_miembro SET ultimo_leido_id = GREATEST(ultimo_leido_id,
            LEAST($3::bigint, COALESCE((SELECT max(id) FROM chat_mensaje WHERE canal_id = $1), 0)))
      WHERE canal_id = $1 AND usuario_id = $2 AND salido_at IS NULL
      RETURNING ultimo_leido_id`, [canalId, usuarioId, hasta]);
  return r.rows[0] ? Number(r.rows[0].ultimo_leido_id) : null;
}

module.exports = {
  personas, esDeLaOficina, asegurarPublicos, canalesDe, resumen, canal, canalPorNombre, directoPorClave,
  miembro, miembros, idsMiembros, crearCanal, meter, meterOficina, sacar,
  mensajes, mensaje, respuestas, escribir, mencionar, mencionesDe, leer,
};
