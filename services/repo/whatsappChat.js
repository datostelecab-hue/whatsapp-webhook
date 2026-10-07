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
    await db.consulta(
      `INSERT INTO whatsapp_chat (telefono, nombre_perfil, ultimo_at, ultimo_texto, ultimo_sentido, ultima_entrante_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'entrante' THEN $3::timestamptz END)
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
 * Las conversaciones, la más reciente primero, con quién es cada una, lo que la
 * oficina no ha leído y la pausa del bot. `buscar` filtra por nombre o teléfono.
 */
async function conversaciones({ buscar = '', limite = 200 } = {}) {
  const q = String(buscar || '').trim();
  const r = await db.consulta(
    `SELECT c.telefono, c.nombre_perfil, c.ultimo_at, c.ultimo_texto, c.ultimo_sentido, c.ultima_entrante_at,
            c.bot_pausado_hasta, q.nombre, q.que, q.conductor_id,
            (SELECT count(*) FROM whatsapp_mensaje m
              WHERE m.telefono = c.telefono AND m.sentido = 'entrante'
                AND m.ocurrido_at > COALESCE(c.leido_at, '-infinity'::timestamptz))::int AS sin_leer
       FROM whatsapp_chat c
       ${QUIEN}
      WHERE $1 = '' OR c.telefono LIKE '%' || regexp_replace($1, '[^0-9]', '', 'g') || '%' AND regexp_replace($1, '[^0-9]', '', 'g') <> ''
         OR q.nombre ILIKE '%' || $1 || '%' OR c.nombre_perfil ILIKE '%' || $1 || '%'
      ORDER BY c.ultimo_at DESC
      LIMIT $2`, [q, limite]);
  return r.rows;
}

/** La cabecera de una conversación (quién, ventana, pausa), o null si no existe. */
async function chat(telefono) {
  const r = await db.consulta(
    `SELECT c.telefono, c.nombre_perfil, c.ultima_entrante_at, c.bot_pausado_hasta,
            btrim(concat_ws(' ', u.nombre, u.apellidos)) AS pausado_por, q.nombre, q.que, q.conductor_id
       FROM whatsapp_chat c
       LEFT JOIN usuario u ON u.id = c.pausado_por
       ${QUIEN}
      WHERE c.telefono = $1`, [W.soloDigitos(telefono)]);
  return r.rows[0] || null;
}

/**
 * Los mensajes de una conversación, del más viejo al más nuevo, con el estado
 * que dio Meta de cada saliente (whatsapp_envio, db/176) y quién del ERP lo
 * escribió. `despuesDe` (un id) trae solo los nuevos; `antesDe`, los anteriores.
 */
async function mensajes(telefono, { despuesDe = null, antesDe = null, limite = 80 } = {}) {
  const r = await db.consulta(
    `SELECT m.id, m.sentido, m.tipo, m.texto, m.detalle, m.origen, m.error, m.ocurrido_at,
            btrim(concat_ws(' ', u.nombre, u.apellidos)) AS usuario,
            e.estado AS estado, e.error_codigo, e.error_texto
       FROM whatsapp_mensaje m
       LEFT JOIN usuario u ON u.id = m.usuario_id
       LEFT JOIN whatsapp_envio e ON e.wamid = m.wamid
      WHERE m.telefono = $1
        AND ($2::bigint IS NULL OR m.id > $2)
        AND ($3::bigint IS NULL OR m.id < $3)
      ORDER BY m.ocurrido_at DESC, m.id DESC
      LIMIT $4`, [W.soloDigitos(telefono), despuesDe, antesDe, limite]);
  return r.rows.reverse();
}

/** Borra lo que tenga más de `dias` (datos de personas: no se guardan para siempre). */
async function purgar(dias) {
  const r = await db.consulta(
    `DELETE FROM whatsapp_mensaje WHERE ocurrido_at < now() - make_interval(days => $1::int)`, [Number(dias)]);
  await db.consulta(`DELETE FROM whatsapp_chat WHERE ultimo_at < now() - make_interval(days => $1::int)`, [Number(dias)]);
  return r.rowCount;
}

module.exports = { guardar, pausaDe, pausar, reanudar, marcarLeido, conversaciones, chat, mensajes, purgar };
