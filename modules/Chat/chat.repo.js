// ============================================================
// EL CHAT INTERNO — el SQL (db/256 y db/257, ítem 2)
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

/** El nombre de una persona (para firmar lo que pone el sistema por ella). */
async function nombreDe(cli, usuarioId) {
  const r = await q(cli, `SELECT ${NOMBRE('u')} AS nombre FROM usuario u WHERE u.id = $1`, [usuarioId]);
  return r.rows[0] ? r.rows[0].nombre : null;
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
// El texto de un anulado no sale de aquí: se queda en la fila y en el libro.
const COLUMNAS = `m.id, m.canal_id, m.autor_id, ${NOMBRE('u')} AS autor, m.padre_id, m.creado_at,
  CASE WHEN m.anulado_at IS NULL THEN m.texto ELSE NULL END AS texto,
  m.respuestas, m.ultima_respuesta_at, m.editado_at, m.anulado_at, m.anulado_por,
  CASE WHEN m.anulado_por IS DISTINCT FROM m.autor_id THEN m.anulado_motivo END AS anulado_motivo,
  (SELECT ${NOMBRE('ua')} FROM usuario ua WHERE ua.id = m.anulado_por) AS anulado_por_nombre,
  m.con_adjuntos, CASE WHEN m.anulado_at IS NULL THEN m.enlace_url END AS enlace_url, m.evento`;

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
/** La fila entera (también el texto de un anulado): para decidir quién puede qué. */
async function mensajeCrudo(cli, id) {
  const r = await q(cli, 'SELECT * FROM chat_mensaje WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function respuestas(padreId) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS} FROM chat_mensaje m LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE m.padre_id = $1 ORDER BY m.id LIMIT 500`, [padreId]);
  return r.rows;
}

async function escribir(cli, { canalId, autorId, padreId = null, texto, conAdjuntos = false, enlaceUrl = null, evento = null }) {
  const r = await q(cli,
    `INSERT INTO chat_mensaje (canal_id, autor_id, padre_id, texto, con_adjuntos, enlace_url, evento)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [canalId, autorId, padreId, texto, !!conAdjuntos, enlaceUrl, evento]);
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

// ── Editar y anular (2b) ───────────────────────────────────────────────────
async function editar(cli, id, { texto, enlaceUrl }) {
  await q(cli, 'UPDATE chat_mensaje SET texto = $2, enlace_url = $3, editado_at = now() WHERE id = $1', [id, texto, enlaceUrl]);
}
async function anular(cli, id, { por, motivo }) {
  const r = await q(cli,
    `UPDATE chat_mensaje SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [id, por, motivo]);
  return r.rows.length > 0;
}

// ── Reacciones, fijados y guardados (2b): marcas con fecha, nada se borra ──
/** Pone la reacción, o la quita si ya estaba puesta. → true si queda puesta. */
async function reaccionar(cli, mensajeId, usuarioId, emoji) {
  const r = await q(cli,
    `INSERT INTO chat_reaccion (mensaje_id, usuario_id, emoji) VALUES ($1, $2, $3)
     ON CONFLICT (mensaje_id, usuario_id, emoji) DO UPDATE
       SET quitada_at = CASE WHEN chat_reaccion.quitada_at IS NULL THEN now() END,
           puesta_at  = CASE WHEN chat_reaccion.quitada_at IS NULL THEN chat_reaccion.puesta_at ELSE now() END
     RETURNING quitada_at IS NULL AS puesta`, [mensajeId, usuarioId, emoji]);
  return r.rows[0].puesta;
}
/** Las reacciones de unos mensajes: Map(id → [{ emoji, usuarios: [ids], nombres: [] }]), en orden de llegada. */
async function reaccionesDe(ids) {
  if (!ids.length) return new Map();
  const r = await db.consulta(
    `SELECT x.mensaje_id, x.emoji, array_agg(x.usuario_id ORDER BY x.puesta_at) AS usuarios,
            array_agg(${NOMBRE('u')} ORDER BY x.puesta_at) AS nombres, min(x.puesta_at) AS primera
       FROM chat_reaccion x JOIN usuario u ON u.id = x.usuario_id
      WHERE x.mensaje_id = ANY($1::bigint[]) AND x.quitada_at IS NULL
      GROUP BY x.mensaje_id, x.emoji ORDER BY primera`, [ids]);
  const m = new Map();
  r.rows.forEach(x => {
    const k = Number(x.mensaje_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push({ emoji: x.emoji, usuarios: x.usuarios.map(Number), nombres: x.nombres });
  });
  return m;
}

/** Fija un mensaje en su canal. → false si ya estaba fijado. */
async function fijar(cli, mensajeId, canalId, por) {
  const r = await q(cli,
    `INSERT INTO chat_fijado (mensaje_id, canal_id, fijado_por) VALUES ($1, $2, $3)
     ON CONFLICT (mensaje_id) DO UPDATE
       SET fijado_por = EXCLUDED.fijado_por, fijado_at = now(), quitado_por = NULL, quitado_at = NULL
     WHERE chat_fijado.quitado_at IS NOT NULL
     RETURNING mensaje_id`, [mensajeId, canalId, por]);
  return r.rows.length > 0;
}
async function desfijar(cli, mensajeId, por) {
  const r = await q(cli,
    'UPDATE chat_fijado SET quitado_at = now(), quitado_por = $2 WHERE mensaje_id = $1 AND quitado_at IS NULL RETURNING mensaje_id',
    [mensajeId, por]);
  return r.rows.length > 0;
}
/** Quién fijó cada uno de unos mensajes: Map(id → nombre). */
async function fijadosDe(ids) {
  if (!ids.length) return new Map();
  const r = await db.consulta(
    `SELECT f.mensaje_id, ${NOMBRE('u')} AS por FROM chat_fijado f LEFT JOIN usuario u ON u.id = f.fijado_por
      WHERE f.mensaje_id = ANY($1::bigint[]) AND f.quitado_at IS NULL`, [ids]);
  return new Map(r.rows.map(x => [Number(x.mensaje_id), x.por || 'alguien']));
}
async function cuantosFijados(canalId) {
  const r = await db.consulta(
    `SELECT count(*)::int AS n FROM chat_fijado f JOIN chat_mensaje m ON m.id = f.mensaje_id
      WHERE f.canal_id = $1 AND f.quitado_at IS NULL AND m.anulado_at IS NULL`, [canalId]);
  return r.rows[0].n;
}
/** Lo fijado en un canal, lo último primero. */
async function fijadosCanal(canalId) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS} FROM chat_fijado f JOIN chat_mensaje m ON m.id = f.mensaje_id LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE f.canal_id = $1 AND f.quitado_at IS NULL AND m.anulado_at IS NULL
      ORDER BY f.fijado_at DESC LIMIT 100`, [canalId]);
  return r.rows;
}

/** Guarda (o deja de guardar) un mensaje para una persona. → true si cambió algo. */
async function guardar(cli, usuarioId, mensajeId, si) {
  const r = si
    ? await q(cli,
      `INSERT INTO chat_guardado (usuario_id, mensaje_id) VALUES ($1, $2)
       ON CONFLICT (usuario_id, mensaje_id) DO UPDATE SET guardado_at = now(), quitado_at = NULL
       WHERE chat_guardado.quitado_at IS NOT NULL RETURNING mensaje_id`, [usuarioId, mensajeId])
    : await q(cli, 'UPDATE chat_guardado SET quitado_at = now() WHERE usuario_id = $1 AND mensaje_id = $2 AND quitado_at IS NULL RETURNING mensaje_id',
      [usuarioId, mensajeId]);
  return r.rows.length > 0;
}
/** Cuáles de unos mensajes tiene guardados esa persona: Set(ids). */
async function guardadosEntre(usuarioId, ids) {
  if (!ids.length) return new Set();
  const r = await db.consulta(
    'SELECT mensaje_id FROM chat_guardado WHERE usuario_id = $1 AND mensaje_id = ANY($2::bigint[]) AND quitado_at IS NULL', [usuarioId, ids]);
  return new Set(r.rows.map(x => Number(x.mensaje_id)));
}
/**
 * Lo que tiene guardado, lo último primero: solo de canales que aún puede ver
 * (los públicos, y los demás si sigue dentro) y sin los anulados.
 */
async function guardadosDe(usuarioId) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS}, c.tipo AS canal_tipo, c.nombre AS canal_nombre
       FROM chat_guardado g
       JOIN chat_mensaje m ON m.id = g.mensaje_id
       JOIN chat_canal c ON c.id = m.canal_id
       LEFT JOIN usuario u ON u.id = m.autor_id
      WHERE g.usuario_id = $1 AND g.quitado_at IS NULL AND m.anulado_at IS NULL
        AND (c.tipo = 'publico' OR EXISTS (SELECT 1 FROM chat_miembro mi WHERE mi.canal_id = c.id AND mi.usuario_id = $1 AND mi.salido_at IS NULL))
      ORDER BY g.guardado_at DESC LIMIT 200`, [usuarioId]);
  return r.rows;
}

/** La tarjeta del tablero de unos mensajes (la viva; si no, la última): Map(id → tarjeta). */
async function tareasDe(ids) {
  if (!ids.length) return new Map();
  const r = await db.consulta(
    `SELECT DISTINCT ON (t.origen_id) t.origen_id, t.id, t.estado, t.titulo, t.creada_por,
            to_char(t.vence_el, 'YYYY-MM-DD') AS vence_el, ${NOMBRE('u')} AS responsable
       FROM tarea t LEFT JOIN usuario u ON u.id = t.responsable_id
      WHERE t.tipo = 'mensaje' AND t.origen_id = ANY($1::text[])
      ORDER BY t.origen_id, (t.estado = 'anulada'), t.id DESC`, [ids.map(String)]);
  return new Map(r.rows.map(x => [Number(x.origen_id), x]));
}

/** Los ficheros de unos mensajes (sin los quitados): Map(id → [filas de adjunto]). */
async function adjuntosDe(ids) {
  if (!ids.length) return new Map();
  const r = await db.consulta(
    `SELECT a.id, a.dueno_id, a.nombre, a.mime, a.bytes, a.creado_at
       FROM adjunto a
      WHERE a.dueno_tipo = 'chat_mensaje' AND a.dueno_id = ANY($1::text[]) AND a.anulado_at IS NULL
      ORDER BY a.id`, [ids.map(String)]);
  const m = new Map();
  r.rows.forEach(x => {
    const k = Number(x.dueno_id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  });
  return m;
}

// ── La vista previa de los enlaces (2b) ────────────────────────────────────
async function enlace(url) {
  const r = await db.consulta('SELECT * FROM chat_enlace WHERE url = $1', [url]);
  return r.rows[0] || null;
}
async function enlacesDe(urls) {
  if (!urls.length) return new Map();
  const r = await db.consulta(`SELECT * FROM chat_enlace WHERE url = ANY($1::text[]) AND estado = 'ok'`, [urls]);
  return new Map(r.rows.map(x => [x.url, x]));
}
async function guardarEnlace(url, { estado, titulo = null, descripcion = null, sitio = null }) {
  await db.consulta(
    `INSERT INTO chat_enlace (url, estado, titulo, descripcion, sitio) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (url) DO UPDATE SET estado = EXCLUDED.estado, titulo = EXCLUDED.titulo,
       descripcion = EXCLUDED.descripcion, sitio = EXCLUDED.sitio, leido_at = now()`,
    [url, estado, titulo, descripcion, sitio]);
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
  personas, nombreDe, esDeLaOficina, asegurarPublicos, canalesDe, resumen, canal, canalPorNombre, directoPorClave,
  miembro, miembros, idsMiembros, crearCanal, meter, meterOficina, sacar,
  mensajes, mensaje, mensajeCrudo, respuestas, escribir, mencionar, mencionesDe, leer,
  editar, anular, reaccionar, reaccionesDe, fijar, desfijar, fijadosDe, cuantosFijados, fijadosCanal,
  guardar, guardadosEntre, guardadosDe, tareasDe, adjuntosDe, enlace, enlacesDe, guardarEnlace,
};
