// ============================================================
// EL CHAT DE WHATSAPP — repositorio (db/185)
// ============================================================
// Guarda cada mensaje que entra o sale por el número del bot y mantiene la fila
// de cada conversación (whatsapp_chat): el último mensaje, la ventana de 24 h,
// lo leído y la pausa del bot. Y lee lo que pinta el módulo /whatsapp.
//
// GUARDAR NUNCA LANZA: lo llaman el webhook y los envíos del bot, y un fallo aquí
// no puede dejar al bot mudo. Sin db/185 avisa una vez y sigue.

const db = require('../db');
const W = require('../whatsappChat');

let avisadoSinTabla = false;
const sinTabla = e => e && e.code === '42P01';

/**
 * Guarda un mensaje y pone al día su conversación. Devuelve el id, o null si ya
 * estaba (Meta repite a veces el mismo), si falta db/185 o si falló.
 */
async function guardar({ wamid = null, telefono, sentido, tipo, texto = null, detalle = null, origen,
  usuarioId = null, error = null, ocurridoAt = null, nombrePerfil = null }) {
  const tel = W.soloDigitos(telefono);
  if (!tel || !sentido || !tipo || !origen) return null;
  const cuando = ocurridoAt ? new Date(ocurridoAt) : new Date();
  try {
    const r = await db.consulta(
      `INSERT INTO whatsapp_mensaje (wamid, telefono, sentido, tipo, texto, detalle, origen, usuario_id, error, ocurrido_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       ON CONFLICT (wamid) WHERE wamid IS NOT NULL DO NOTHING
       RETURNING id`,
      [wamid, tel, sentido, tipo, texto, detalle ? JSON.stringify(detalle) : null, origen, usuarioId, error, cuando.toISOString()]);
    if (!r.rowCount) return null;
    // OJO con los tipos: $5 va a una columna varchar Y se compara con un texto.
    // Sin el cast, Postgres deduce dos tipos para el mismo parámetro y rechaza la
    // consulta entera («inconsistent types deduced for parameter $5»). Pasó del
    // 07/10 al arreglo de db/186: los mensajes entraban y su conversación no.
    await db.consulta(
      `INSERT INTO whatsapp_chat (telefono, nombre_perfil, ultimo_at, ultimo_texto, ultimo_sentido, ultima_entrante_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5::varchar = 'entrante' THEN $3::timestamptz END)
       ON CONFLICT (telefono) DO UPDATE SET
         nombre_perfil      = COALESCE(EXCLUDED.nombre_perfil, whatsapp_chat.nombre_perfil),
         ultimo_texto       = CASE WHEN EXCLUDED.ultimo_at >= whatsapp_chat.ultimo_at THEN EXCLUDED.ultimo_texto ELSE whatsapp_chat.ultimo_texto END,
         ultimo_sentido     = CASE WHEN EXCLUDED.ultimo_at >= whatsapp_chat.ultimo_at THEN EXCLUDED.ultimo_sentido ELSE whatsapp_chat.ultimo_sentido END,
         ultimo_at          = GREATEST(whatsapp_chat.ultimo_at, EXCLUDED.ultimo_at),
         ultima_entrante_at = GREATEST(whatsapp_chat.ultima_entrante_at, EXCLUDED.ultima_entrante_at)`,
      [tel, nombrePerfil ? String(nombrePerfil).slice(0, 120) : null, cuando.toISOString(),
        W.resumen({ tipo, texto }).slice(0, 300), sentido]);
    return r.rows[0].id;
  } catch (e) {
    if (sinTabla(e)) {
      if (!avisadoSinTabla) console.warn('⏸️  [WhatsApp] El chat se guardará en cuanto esté db/185 (falta whatsapp_mensaje)');
      avisadoSinTabla = true;
    } else {
      console.error('⚠️  [WhatsApp] No se pudo guardar un mensaje en el chat:', e.message);
    }
    return null;
  }
}

/** Hasta cuándo está el bot en pausa con ese teléfono (o null). Nunca lanza. */
async function pausaDe(telefono) {
  try {
    const r = await db.consulta(`SELECT bot_pausado_hasta FROM whatsapp_chat WHERE telefono = $1`, [W.soloDigitos(telefono)]);
    return r.rows[0] ? r.rows[0].bot_pausado_hasta : null;
  } catch (e) {
    return null;
  }
}

/** Pone (o alarga) la pausa del bot con un teléfono. */
async function pausar(telefono, minutos, usuarioId) {
  await db.consulta(
    `UPDATE whatsapp_chat SET bot_pausado_hasta = now() + make_interval(mins => $2::int), pausado_por = $3 WHERE telefono = $1`,
    [W.soloDigitos(telefono), Number(minutos) || W.PAUSA_MIN, usuarioId || null]);
}

/** Devuelve la conversación al bot. */
async function reanudar(telefono) {
  await db.consulta(`UPDATE whatsapp_chat SET bot_pausado_hasta = NULL, pausado_por = NULL WHERE telefono = $1`, [W.soloDigitos(telefono)]);
}

/** La oficina ha leído la conversación hasta ahora. */
async function marcarLeido(telefono) {
  await db.consulta(`UPDATE whatsapp_chat SET leido_at = now() WHERE telefono = $1`, [W.soloDigitos(telefono)]);
}

// QUIÉN ES CADA TELÉFONO, por sus últimos 9 dígitos, como el bot: primero el
// conductor con ficha (su teléfono vigente), luego un usuario del ERP y por último
// una cuenta de BOLT (también las de Barcelona). Si nada casa, el nombre que
// tenga puesto en WhatsApp.
// Y SU FOTO: la vigente de su ficha (documento tipo 'foto'), solo el id. La
// pantalla la pide aparte, con el id en la URL para poder guardarla en caché.
const FOTO = `(SELECT max(dc.id) FROM documento dc
                WHERE dc.conductor_id = q.conductor_id AND dc.tipo = 'foto' AND dc.vigente) AS foto_id`;

const QUIEN = `
  LEFT JOIN LATERAL (
    SELECT x.nombre, x.que, x.conductor_id FROM (
      SELECT 1 AS prio, btrim(concat_ws(' ', co.nombre, co.apellidos)) AS nombre, 'conductor' AS que, co.id AS conductor_id
        FROM conductor_telefono t JOIN conductor co ON co.id = t.conductor_id
       WHERE t.vigente_hasta IS NULL AND NOT co.es_centinela AND t.sufijo9 = right(c.telefono, 9)
      UNION ALL
      SELECT 2, btrim(concat_ws(' ', u.nombre, u.apellidos)), 'usuario', u.conductor_id
        FROM usuario u
       WHERE length(regexp_replace(COALESCE(u.telefono, ''), '[^0-9]', '', 'g')) >= 9
         AND right(regexp_replace(u.telefono, '[^0-9]', '', 'g'), 9) = right(c.telefono, 9)
      UNION ALL
      SELECT 3, btrim(ce.externo_nombre), CASE WHEN f.sede = 'barcelona' THEN 'bolt_barcelona' ELSE 'bolt' END, ce.conductor_id
        FROM conductor_externo ce LEFT JOIN flota f ON f.company_id = ce.bolt_company_id
       WHERE ce.sistema = 'bolt' AND ce.externo_sufijo9 = right(c.telefono, 9)
    ) x ORDER BY x.prio LIMIT 1
  ) q ON TRUE`;

/**
 * Las conversaciones, la más reciente primero, con quién es cada una, quién la
 * lleva, lo que la oficina no ha leído y la pausa del bot. `buscar` filtra por
 * nombre o teléfono; `filtro`: 'mias' (las que lleva `usuarioId`), 'libres' (las
 * que no lleva nadie) o nada (todas).
 */
async function conversaciones({ buscar = '', filtro = '', usuarioId = null, mantener = null, limite = 200 } = {}) {
  const q = String(buscar || '').trim();
  const f = ['mias', 'libres', 'noleidas'].includes(filtro) ? filtro : '';
  // «No leídas» filtra por lo que queda sin leer, que se calcula en la propia
  // fila: por eso va fuera, sobre la subconsulta. La conversación abierta
  // (`mantener`) no se cae de la lista al leerla, como en WhatsApp.
  const r = await db.consulta(
    `SELECT * FROM (
       SELECT c.telefono, c.nombre_perfil, c.ultimo_at, c.ultimo_texto, c.ultimo_sentido, c.ultima_entrante_at,
              c.bot_pausado_hasta, q.nombre, q.que, q.conductor_id, ${FOTO},
              c.asignado_a, btrim(concat_ws(' ', ua.nombre, ua.apellidos)) AS asignado,
              (SELECT count(*) FROM whatsapp_mensaje m
                WHERE m.telefono = c.telefono AND m.sentido = 'entrante'
                  AND m.ocurrido_at > COALESCE(c.leido_at, '-infinity'::timestamptz))::int AS sin_leer
         FROM whatsapp_chat c
         LEFT JOIN usuario ua ON ua.id = c.asignado_a
         ${QUIEN}
        WHERE ($1::text = '' OR c.telefono LIKE '%' || regexp_replace($1::text, '[^0-9]', '', 'g') || '%' AND regexp_replace($1::text, '[^0-9]', '', 'g') <> ''
               OR q.nombre ILIKE '%' || $1::text || '%' OR c.nombre_perfil ILIKE '%' || $1::text || '%')
          AND ($3::text IN ('', 'noleidas') OR ($3::text = 'mias' AND c.asignado_a = $4::bigint) OR ($3::text = 'libres' AND c.asignado_a IS NULL))
     ) x
     WHERE $3::text <> 'noleidas' OR x.sin_leer > 0 OR x.telefono = $5::varchar
     ORDER BY x.ultimo_at DESC
     LIMIT $2`, [q, limite, f, usuarioId == null ? null : Number(usuarioId), mantener ? W.soloDigitos(mantener) : null]);
  return r.rows;
}

/**
 * Cuántas hay en cada filtro de la lista (todas, sin leer, las de `usuarioId` y
 * las que no lleva nadie), sin mirar el buscador: son los números de los botones.
 */
async function cuentas(usuarioId) {
  const r = await db.consulta(
    `SELECT count(*)::int AS todas,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM whatsapp_mensaje m
                                            WHERE m.telefono = c.telefono AND m.sentido = 'entrante'
                                              AND m.ocurrido_at > COALESCE(c.leido_at, '-infinity'::timestamptz)))::int AS noleidas,
            count(*) FILTER (WHERE c.asignado_a = $1::bigint)::int AS mias,
            count(*) FILTER (WHERE c.asignado_a IS NULL)::int AS libres
       FROM whatsapp_chat c`, [usuarioId == null ? null : Number(usuarioId)]);
  return r.rows[0];
}

/**
 * La cabecera de una conversación (quién, ventana, pausa, quién la lleva).
 * Devuelve fila AUNQUE la conversación no exista todavía (`existe` = false): es
 * lo que se abre para escribirle a alguien por primera vez con una plantilla.
 * El teléfono va con su prefijo (34…).
 */
async function chat(telefono) {
  const r = await db.consulta(
    `SELECT c.telefono, (w.telefono IS NOT NULL) AS existe,
            w.nombre_perfil, w.ultima_entrante_at, w.bot_pausado_hasta,
            btrim(concat_ws(' ', u.nombre, u.apellidos)) AS pausado_por, q.nombre, q.que, q.conductor_id, ${FOTO},
            w.asignado_a, btrim(concat_ws(' ', ua.nombre, ua.apellidos)) AS asignado
       FROM (SELECT $1::varchar AS telefono) c
       LEFT JOIN whatsapp_chat w ON w.telefono = c.telefono
       LEFT JOIN usuario u  ON u.id  = w.pausado_por
       LEFT JOIN usuario ua ON ua.id = w.asignado_a
       ${QUIEN}`, [W.soloDigitos(telefono)]);
  return r.rows[0] || null;
}

/**
 * Los mensajes de una conversación, del más viejo al más nuevo, con el estado
 * que dio Meta de cada saliente (whatsapp_envio, db/176), quién del ERP lo
 * escribió y si su adjunto ya está guardado (db/186). `despuesDe` (un id) trae
 * solo los nuevos; `antesDe`, los anteriores.
 */
async function mensajes(telefono, { despuesDe = null, antesDe = null, limite = 80 } = {}) {
  const r = await db.consulta(
    `SELECT m.id, m.sentido, m.tipo, m.texto, m.detalle, m.origen, m.error, m.ocurrido_at,
            btrim(concat_ws(' ', u.nombre, u.apellidos)) AS usuario,
            e.estado AS estado, e.error_codigo, e.error_texto,
            a.mime AS adjunto_mime, a.tamano AS adjunto_tamano
       FROM whatsapp_mensaje m
       LEFT JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN whatsapp_envio e ON e.wamid = m.wamid
       LEFT JOIN whatsapp_adjunto a ON a.mensaje_id = m.id
      WHERE m.telefono = $1
        AND ($2::bigint IS NULL OR m.id > $2)
        AND ($3::bigint IS NULL OR m.id < $3)
      ORDER BY m.ocurrido_at DESC, m.id DESC
      LIMIT $4`, [W.soloDigitos(telefono), despuesDe, antesDe, limite]);
  return r.rows.reverse();
}

// ── Los adjuntos (db/186) ────────────────────────────────────────────────────

/** El mensaje de un adjunto y, si ya está guardado, su fichero. null si no existe. */
async function adjunto(mensajeId) {
  const r = await db.consulta(
    `SELECT m.id, m.tipo, m.detalle, a.mime, a.nombre, a.tamano, a.bytes
       FROM whatsapp_mensaje m
       LEFT JOIN whatsapp_adjunto a ON a.mensaje_id = m.id
      WHERE m.id = $1::bigint`, [Number(mensajeId)]);
  return r.rows[0] || null;
}

/** Guarda el fichero de un mensaje (si ya estaba, no hace nada). */
async function guardarAdjunto(mensajeId, { mime, nombre = null, sha256 = null, bytes }) {
  await db.consulta(
    `INSERT INTO whatsapp_adjunto (mensaje_id, mime, nombre, tamano, sha256, bytes)
     VALUES ($1::bigint, $2::varchar, $3::varchar, $4::int, $5::varchar, $6::bytea)
     ON CONFLICT (mensaje_id) DO NOTHING`,
    [Number(mensajeId), String(mime || 'application/octet-stream').slice(0, 120), nombre ? String(nombre).slice(0, 255) : null,
      bytes.length, sha256 ? String(sha256).slice(0, 100) : null, bytes]);
}

// ── Quién lleva cada conversación (db/186) ───────────────────────────────────

/** Se la da a `usuarioId` (o a nadie, con null). */
async function asignar(telefono, usuarioId, porId) {
  await db.consulta(
    `UPDATE whatsapp_chat
        SET asignado_a = $2::bigint, asignado_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END,
            asignado_por = CASE WHEN $2::bigint IS NULL THEN NULL ELSE $3::bigint END
      WHERE telefono = $1::varchar`,
    [W.soloDigitos(telefono), usuarioId == null ? null : Number(usuarioId), porId == null ? null : Number(porId)]);
}

/** Si no la lleva nadie, se la queda `usuarioId`. Devuelve si se la quedó. */
async function asignarSiLibre(telefono, usuarioId) {
  if (!usuarioId) return false;
  const r = await db.consulta(
    `UPDATE whatsapp_chat SET asignado_a = $2::bigint, asignado_at = now(), asignado_por = $2::bigint
      WHERE telefono = $1::varchar AND asignado_a IS NULL`, [W.soloDigitos(telefono), Number(usuarioId)]);
  return r.rowCount > 0;
}

/**
 * A quién se le puede dar una conversación: quien entra en /whatsapp (su llave,
 * o un rol con acceso total) y no está bloqueado.
 */
async function asignables() {
  const r = await db.consulta(
    `SELECT u.id, btrim(concat_ws(' ', u.nombre, u.apellidos)) AS nombre
       FROM usuario u JOIN rol r ON r.id = u.rol_id
      WHERE u.estado <> 'bloqueado'
        AND (r.acceso_total OR EXISTS (SELECT 1 FROM usuario_permiso p
                                        WHERE p.usuario_id = u.id AND p.clave IN ('/whatsapp', '/whatsapp/escribir')))
      ORDER BY 2`);
  return r.rows;
}

// ── Las respuestas rápidas (db/186) ──────────────────────────────────────────

async function respuestas() {
  const r = await db.consulta(`SELECT id, titulo, texto FROM whatsapp_respuesta_rapida ORDER BY lower(titulo), id`);
  return r.rows;
}

async function crearRespuesta({ titulo, texto }, usuarioId) {
  const r = await db.consulta(
    `INSERT INTO whatsapp_respuesta_rapida (titulo, texto, creado_por) VALUES ($1::varchar, $2::text, $3::bigint) RETURNING id`,
    [titulo, texto, usuarioId == null ? null : Number(usuarioId)]);
  return r.rows[0].id;
}

async function cambiarRespuesta(id, { titulo, texto }) {
  const r = await db.consulta(
    `UPDATE whatsapp_respuesta_rapida SET titulo = $2::varchar, texto = $3::text, actualizado_at = now() WHERE id = $1::bigint`,
    [Number(id), titulo, texto]);
  return r.rowCount > 0;
}

async function borrarRespuesta(id) {
  const r = await db.consulta(`DELETE FROM whatsapp_respuesta_rapida WHERE id = $1::bigint`, [Number(id)]);
  return r.rowCount > 0;
}

// ── A quién se le puede escribir por primera vez ─────────────────────────────

/**
 * Los conductores con un teléfono vigente y el contrato abierto: a quien se le
 * puede escribir aunque nunca haya escrito (con una plantilla). Con su
 * teléfono como lo quiere WhatsApp, en dígitos y con el prefijo.
 */
async function conductoresConTelefono() {
  const r = await db.consulta(
    `SELECT DISTINCT ON (co.id) co.id, btrim(concat_ws(' ', co.nombre, co.apellidos)) AS nombre,
            regexp_replace(t.e164, '[^0-9]', '', 'g') AS telefono
       FROM conductor co
       JOIN conductor_telefono t ON t.conductor_id = co.id AND t.vigente_hasta IS NULL
      WHERE NOT co.es_centinela
        AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = co.id AND p.baja IS NULL)
      ORDER BY co.id, t.principal DESC, t.vigente_desde DESC`);
  return r.rows.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/** El teléfono vigente de un conductor (dígitos, con prefijo), o null. */
async function telefonoDeConductor(conductorId) {
  const r = await db.consulta(
    `SELECT regexp_replace(e164, '[^0-9]', '', 'g') AS telefono FROM conductor_telefono
      WHERE conductor_id = $1::bigint AND vigente_hasta IS NULL
      ORDER BY principal DESC, vigente_desde DESC LIMIT 1`, [Number(conductorId)]);
  return r.rows[0] ? r.rows[0].telefono : null;
}

/** Borra lo que tenga más de `dias` (datos de personas: no se guardan para siempre). */
async function purgar(dias) {
  const r = await db.consulta(
    `DELETE FROM whatsapp_mensaje WHERE ocurrido_at < now() - make_interval(days => $1::int)`, [Number(dias)]);
  await db.consulta(`DELETE FROM whatsapp_chat WHERE ultimo_at < now() - make_interval(days => $1::int)`, [Number(dias)]);
  return r.rowCount;
}

module.exports = {
  guardar, pausaDe, pausar, reanudar, marcarLeido, conversaciones, cuentas, chat, mensajes, purgar,
  adjunto, guardarAdjunto, asignar, asignarSiLibre, asignables,
  respuestas, crearRespuesta, cambiarRespuesta, borrarRespuesta,
  conductoresConTelefono, telefonoDeConductor,
};
