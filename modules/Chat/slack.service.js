// ============================================================
// LA MIGRACIÓN DE SLACK — trae Slack al chat (ítem 2, entrega 2d, db/259)
// ============================================================
// Camilo, 17/11/2026: «Ya no queremos usarlo y la idea es migrar toda la info
// allá. Que no avise menciones ni nada hasta después de la migración». Decidió:
//   · con un TOKEN de Slack de solo lectura (de Ignacio: SLACK_MIGRACION_TOKEN
//     en Render) y este proceso, que copia el texto exacto, los hilos, las
//     reacciones y los ficheros (a R2);
//   · LOS 19 CANALES del chat y el privado #efectivo, que se crea;
//   · LOS MENSAJES DIRECTOS DE IGNACIO, como directos entre él y cada persona.
//
// CÓMO:
//   · Primero se SIMULA: lee Slack entero y dice qué traería (canales, mensajes,
//     respuestas, ficheros) y QUIÉN ES QUIÉN: cada persona de Slack con su
//     usuario del ERP (por email; si no, por nombre). Se corrige en la pantalla.
//   · Luego se MIGRA. Cada mensaje, con su fecha y su autor de Slack (si no es
//     usuario del ERP, con su nombre); los hilos, como hilos; las reacciones que
//     son de las seis del chat; las menciones, a <@id> si es usuario y si no a
//     @Nombre; @here, @channel y @everyone, a @canal; los ficheros, a R2.
//   · SE PUEDE REPETIR: lo ya traído (mismo canal y marca de Slack) no se trae
//     dos veces. Sirve para traer lo que se siga escribiendo hasta el cambio.
//   · NO AVISA DE NADA: ni notificaciones, ni no leídos, ni menciones pendientes
//     (lo traído no cuenta: chat.repo excluye slack_ts). Al acabar, solo se avisa
//     a las pantallas abiertas para que se recarguen.
//   · Fuera: lo que no es un mensaje (entró, salió, cambió el tema…).
//
// Lo lanza el desarrollador desde /chat/slack. Va en segundo plano: tarda lo
// que tarde Slack (respeta sus límites; los hilos se piden uno a uno).
'use strict';

const { Readable } = require('stream');
const libro = require('../../services/libro');
const adjuntos = require('../../services/adjuntos');
const tiempoReal = require('../../services/tiempoReal');
const contadores = require('../../services/contadores');
const repo = require('./slack.repo');
// El chat registra el dueño de sus ficheros (chat_mensaje) y su canal de tiempo real.
require('./chat.service');

function conEstado(e, status) { e.status = status; return e; }
const error = (msg, status = 400) => conEstado(new Error(msg), status);

const ORIGEN = 'migración de Slack';
// Los canales que se traen (Camilo, 17/11/2026): los 19 del chat y #efectivo.
const CANALES = new Set(['1-general-telecab', '2-altas-de-empresas', '3-bajas-de-empresa', '4-bajas-medicas',
  '5-cambios-turnos-contratos', '6-nominas', '7-vacaciones', '8-seleccion-vacantes', '9-rrhh',
  '10-planificacion-de-trafico', '11-control-de-trafico', '12-gestion-de-flota', '13-insidencias-coches-conductores',
  '14-taller-soporte', '15-administracion', '16-efectivo', 'datos', 'martes-10am', 'escalaciones-lorenzo', 'efectivo']);
const CREAR = new Set(['efectivo']);          // los que no existen en el chat: se crean, privados
// Lo que no es un mensaje.
const NO_SON_MENSAJES = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name',
  'channel_archive', 'channel_unarchive', 'channel_posting_permissions', 'channel_convert_to_private', 'channel_convert_to_public',
  'group_join', 'group_leave', 'group_topic', 'group_purpose', 'group_name', 'group_archive', 'group_unarchive',
  'pinned_item', 'unpinned_item', 'bot_add', 'bot_remove', 'reminder_add', 'joiner_notification', 'ekm_access_denied']);
// Las reacciones de Slack que son de las seis del chat (decisión de la 2b); las demás no se traen.
const REACCION = {
  '+1': 'ok', thumbsup: 'ok', ok_hand: 'ok',
  white_check_mark: 'hecho', heavy_check_mark: 'hecho', ballot_box_with_check: 'hecho',
  eyes: 'visto',
  pray: 'gracias', raised_hands: 'gracias',
  joy: 'risa', rolling_on_the_floor_laughing: 'risa', laughing: 'risa', sweat_smile: 'risa',
  heart: 'corazon', red_heart: 'corazon', heart_eyes: 'corazon', hearts: 'corazon',
};
// Los :emojis: de Slack que salen en el texto, a su carácter (el resto se queda como :nombre:).
const EMOJI = {
  '+1': '👍', thumbsup: '👍', '-1': '👎', ok_hand: '👌', muscle: '💪', wave: '👋', eyes: '👀', white_check_mark: '✅',
  heavy_check_mark: '✔️', x: '❌', warning: '⚠️', pray: '🙏', raised_hands: '🙌', clap: '👏', joy: '😂', smile: '😄',
  slightly_smiling_face: '🙂', blush: '😊', sweat_smile: '😅', thinking_face: '🤔', heart: '❤️', tada: '🎉', fire: '🔥',
  rocket: '🚀', point_right: '👉', point_down: '👇', clipboard: '📋', memo: '📝', pushpin: '📌', round_pushpin: '📍',
  loudspeaker: '📢', mega: '📣', bell: '🔔', rotating_light: '🚨', euro: '💶', moneybag: '💰', money_with_wings: '💸',
  car: '🚗', red_car: '🚗', taxi: '🚕', wrench: '🔧', hammer_and_wrench: '🛠️', star: '⭐', arrow_forward: '▶️',
  arrow_right: '➡️', page_facing_up: '📄', world_map: '🗺️', shower: '🚿', telephone_receiver: '📞', phone: '📞',
  iphone: '📱', busts_in_silhouette: '👥', bust_in_silhouette: '👤', calendar: '📅', date: '📅', stopwatch: '⏱️',
  hourglass: '⌛', 'spock-hand': '🖖', grinning: '😀', sob: '😭', cry: '😢', ok: '🆗', sos: '🆘', no_entry: '⛔',
  question: '❓', exclamation: '❗', bangbang: '‼️', fuelpump: '⛽', key: '🔑', lock: '🔒', mag: '🔍', email: '📧',
};

// ── Slack ──────────────────────────────────────────────────────────────────
const token = () => String(process.env.SLACK_MIGRACION_TOKEN || '').trim();
const dormir = ms => new Promise(r => setTimeout(r, ms));

/** Una llamada a la API de Slack, con sus límites (si dice «espera», se espera). */
async function pedirDeVerdad(metodo, params = {}) {
  if (!token()) throw error('Falta SLACK_MIGRACION_TOKEN en el servidor', 503);
  const u = new URL(`https://slack.com/api/${metodo}`);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') u.searchParams.set(k, String(v)); });
  for (let intento = 0; intento < 6; intento++) {
    const r = await fetch(u, { headers: { Authorization: `Bearer ${token()}` } });
    if (r.status === 429) { await dormir((Number(r.headers.get('retry-after')) || 5) * 1000 + 250); continue; }
    const j = await r.json();
    if (!j.ok) throw error(`Slack dice «${j.error}» en ${metodo}${j.needed ? ` (le falta el permiso ${j.needed})` : ''}`, 502);
    return j;
  }
  throw error(`Slack no deja seguir (${metodo}): demasiadas esperas`, 502);
}

/**
 * Un fichero de Slack, como stream. Solo de files.slack.com: la clave no se
 * manda a ningún otro sitio.
 */
async function descargarDeVerdad(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'files.slack.com') throw error(`Un fichero fuera de files.slack.com (${u.hostname}): no se pide`);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token()}` } });
  if (!r.ok || !r.body) throw error(`Slack no da el fichero (${r.status})`, 502);
  const tipo = String(r.headers.get('content-type') || '');
  // Sin permiso (files:read), Slack devuelve su página de entrar en vez del fichero.
  if (tipo.startsWith('text/html')) throw error('Slack devuelve una página en vez del fichero: falta el permiso files:read', 502);
  return Readable.fromWeb(r.body);
}

// Para las pruebas: otra «Slack».
let pedir = pedirDeVerdad;
let descargar = descargarDeVerdad;
let pausa = 300;        // entre hilo e hilo, para no tocar el límite de Slack
function usarSlack({ pedir: p, descargar: d, pausa: z } = {}) {
  pedir = p || pedirDeVerdad;
  descargar = d || descargarDeVerdad;
  pausa = z == null ? 300 : z;
}

/** Todas las páginas de una llamada (con su cursor). */
async function todo(metodo, params, clave) {
  const out = [];
  let cursor = null;
  do {
    const j = await pedir(metodo, { ...params, cursor, limit: params.limit || 200 });
    out.push(...(j[clave] || []));
    cursor = j.response_metadata && j.response_metadata.next_cursor;
  } while (cursor);
  return out;
}

// ── El texto: de Slack al chat ─────────────────────────────────────────────
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * El texto de Slack (mrkdwn) al del chat: las menciones a <@id> (o @Nombre si
 * no es usuario del ERP), @here/@channel/@everyone a <!canal>, los canales a
 * #nombre, los enlaces a su dirección, las entidades y los :emojis:. El formato
 * (*negrita*, _cursiva_, ~tachado~, `código`, > cita) es el mismo. Pura.
 */
function textoDeSlack(texto, { personas = new Map(), canales = new Map() } = {}) {
  let s = String(texto || '');
  s = s.replace(/<@([UW][A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, n) => {
    const p = personas.get(id);
    return p && p.usuarioId ? `<@${p.usuarioId}>` : `@${(p && p.nombre) || n || 'alguien'}`;
  });
  s = s.replace(/<!(?:channel|here|everyone)(?:\|[^>]*)?>/g, '<!canal>');
  s = s.replace(/<!subteam\^[A-Z0-9]+(?:\|([^>]*))?>/g, (m, n) => n || '@grupo');
  s = s.replace(/<!date\^\d+\^[^|>]*\|([^>]*)>/g, '$1');
  s = s.replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, n) => `#${n || canales.get(id) || 'canal'}`);
  s = s.replace(/<(?:mailto|tel):([^|>]+)\|([^>]+)>/g, '$2');
  s = s.replace(/<(?:mailto|tel):([^>]+)>/g, '$1');
  s = s.replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, (m, url, txt) => {
    const visto = txt.replace(/…$/, '').replace(/^https?:\/\//, '');
    return url.includes(visto) ? url : `${txt} (${url})`;
  });
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, '$1');
  s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  s = s.replace(/:([a-z0-9_+'-]+):(?::skin-tone-\d:)?/gi, (m, n) => EMOJI[n.toLowerCase()] || m);
  return s.replace(/\r\n/g, '\n').trim();
}

/** El código de la reacción del chat que corresponde a una de Slack, o null. */
const reaccionDeSlack = nombre => REACCION[String(nombre || '').replace(/::skin-tone-\d$/, '')] || null;

// ── Quién es quién ─────────────────────────────────────────────────────────
/**
 * Propone el usuario del ERP de cada persona de Slack: por email; si no, por
 * nombre (nombre y primer apellido, o el nombre solo si en la oficina no hay
 * otro igual). Lo apunta en chat_slack_usuario sin pisar lo puesto a mano.
 */
async function proponerPersonas(slackUsuarios, firmante) {
  const erp = await repo.usuariosErp();
  const porEmail = new Map(erp.filter(u => u.email).map(u => [u.email, u]));
  const oficina = erp.filter(u => u.oficina);
  const buscarPorNombre = nombre => {
    const n = sinTildes(nombre);
    if (!n) return null;
    const exacto = erp.filter(u => sinTildes(u.completo) === n);
    if (exacto.length === 1) return exacto[0];
    const t = n.split(' ');
    if (t.length >= 2) {
      const dos = oficina.filter(u => { const c = sinTildes(u.completo).split(' '); return c[0] === t[0] && c.slice(1).includes(t[1]); });
      if (dos.length === 1) return dos[0];
    }
    const solo = oficina.filter(u => sinTildes(u.nombre) === t[0]);
    return t.length === 1 && solo.length === 1 ? solo[0] : null;
  };
  await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, async cli => {
    for (const s of slackUsuarios) {
      if (s.id === 'USLACKBOT') continue;
      const p = s.profile || {};
      const nombre = String(p.real_name || s.real_name || p.display_name || s.name || s.id).slice(0, 160);
      const email = String(p.email || '').toLowerCase() || null;
      let u = email ? porEmail.get(email) : null, como = u ? 'email' : null;
      if (!u && !s.is_bot) { u = buscarPorNombre(nombre) || buscarPorNombre(p.display_name); if (u) como = 'nombre'; }
      await repo.apuntarPersona(cli, { slackId: s.id, nombre, email, usuarioId: u ? u.id : null, como, esBot: !!s.is_bot });
    }
  });
  return repo.personasSlack();
}

// ── Leer Slack ─────────────────────────────────────────────────────────────
/**
 * Lo que hay que traer: cada conversación con sus mensajes de arriba y las
 * respuestas de sus hilos, y con quién es. `alAvanzar(texto)` para el progreso.
 */
async function leerSlack(alAvanzar = () => {}) {
  const yo = await pedir('auth.test');
  alAvanzar('Leyendo quién hay en Slack…');
  const usuarios = await todo('users.list', {}, 'members');
  alAvanzar('Leyendo los canales…');
  // Todos los públicos, los privados en los que está y sus directos.
  const convs = await todo('conversations.list', { types: 'public_channel,private_channel,im,mpim', exclude_archived: false }, 'channels');
  const nombresCanal = new Map(convs.filter(c => c.name).map(c => [c.id, c.name]));
  const leidas = [];
  for (const c of convs) {
    const tipo = c.is_im ? 'directo' : c.is_mpim ? 'grupo' : c.is_private ? 'privado' : 'publico';
    const nombre = c.is_im || c.is_mpim ? null : c.name;
    if ((tipo === 'publico' || tipo === 'privado') && !CANALES.has(nombre)) {
      leidas.push({ c, tipo, nombre, saltar: 'no es de los canales que se traen' });
      continue;
    }
    if (c.is_im && (c.is_user_deleted || c.user === 'USLACKBOT')) {
      leidas.push({ c, tipo, nombre, saltar: c.user === 'USLACKBOT' ? 'es Slackbot' : 'esa cuenta ya no existe en Slack' });
      continue;
    }
    alAvanzar(`Leyendo ${nombre ? `#${nombre}` : 'un mensaje directo'}…`);
    try {
      const historia = await todo('conversations.history', { channel: c.id }, 'messages');
      const arriba = historia.filter(m => !m.thread_ts || m.thread_ts === m.ts);
      const respuestas = [];
      for (const m of arriba.filter(x => (x.reply_count || 0) > 0)) {
        if (pausa) await dormir(pausa);
        const hilo = await todo('conversations.replies', { channel: c.id, ts: m.ts }, 'messages');
        respuestas.push(...hilo.filter(r => r.ts !== m.ts));
      }
      const miembros = tipo === 'publico' ? [] : await todo('conversations.members', { channel: c.id }, 'members');
      leidas.push({ c, tipo, nombre, arriba, respuestas, miembros });
    } catch (e) {
      if (e.status === 503) throw e;
      leidas.push({ c, tipo, nombre, saltar: e.message });
    }
  }
  return { yo, usuarios, convs, nombresCanal, leidas };
}

/** ¿Es un mensaje (y no «se ha unido», «ha cambiado el tema»…)? */
const esMensaje = m => m.type === 'message' && !NO_SON_MENSAJES.has(m.subtype || '');
const ficherosDe = m => (m.files || []).filter(f => f && f.url_private_download && f.mode !== 'tombstone' && f.mode !== 'hidden_by_limit');
/** Lo que dice un mensaje sin texto (los de una integración lo llevan en sus «attachments»). */
const textoDeAdjuntosSlack = m => (m.attachments || [])
  .map(a => [a.pretext, a.title, a.text || a.fallback].filter(Boolean).join('\n'))
  .filter(Boolean).join('\n\n');

// ── El estado del proceso (en memoria: lo mira la pantalla) ─────────────────
let proceso = null;     // { modo, empezado, en, avance, informe, error, acabado }
const estadoProceso = () => (proceso ? { ...proceso } : null);

/**
 * Lo que la pantalla enseña: si hay token, con qué cuenta de Slack y lo que
 * esté en marcha. `ligero`: sin preguntar a Slack (lo que se mira cada poco).
 */
async function estado({ ligero = false } = {}) {
  const r = { token: !!token(), proceso: estadoProceso() };
  if (!r.token || ligero) return r;
  try { const a = await pedir('auth.test'); r.slack = { equipo: a.team, usuario: a.user }; } catch (e) { r.problema = e.message; }
  return r;
}

/** Quién es quién, como lo apunta la tabla, con su nombre en el ERP. */
async function personas() {
  const p = await repo.personasSlack();
  const erp = (await repo.usuariosErp()).filter(u => u.estado !== 'bloqueado').map(u => ({ id: u.id, nombre: u.completo, oficina: u.oficina }));
  return {
    personas: [...p.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(x => ({
      slackId: x.slack_id, nombre: x.nombre, email: x.email, usuarioId: x.usuario_id, usuario: x.usuario_nombre || null, como: x.como, bot: x.es_bot,
    })),
    usuarios: erp,
  };
}
async function ponerPersona(firmante, { slackId, usuarioId } = {}) {
  const id = usuarioId == null || usuarioId === '' ? null : Number(usuarioId);
  const hecho = await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, cli => repo.ponerUsuario(cli, String(slackId || ''), id));
  if (!hecho) throw error('Esa persona de Slack no está apuntada: simula primero', 404);
  return personas();
}

/** Lanza la simulación o la migración en segundo plano. Una a la vez. */
function lanzar(modo, firmante) {
  if (!['simular', 'migrar'].includes(modo)) throw error('O simular o migrar');
  if (!token()) throw error('Falta SLACK_MIGRACION_TOKEN en el servidor', 503);
  if (proceso && !proceso.acabado) throw error('Ya hay uno en marcha: espera a que acabe', 409);
  proceso = { modo, empezado: new Date().toISOString(), avance: 'Empezando…', acabado: false };
  ejecutar(modo, firmante, t => { proceso.avance = t; })
    .then(informe => { proceso.informe = informe; proceso.avance = modo === 'simular' ? 'Simulación hecha' : 'Migración hecha'; })
    .catch(e => { proceso.error = e.message; console.error(`❌ [Slack] ${modo}:`, e.stack || e.message); })
    .finally(() => { proceso.acabado = true; proceso.acabadoAt = new Date().toISOString(); });
  return estadoProceso();
}

const sumar = (t, f) => ['mensajes', 'respuestas', 'ficheros', 'nuevos', 'reaccionesFuera'].forEach(k => { t[k] += f[k] || 0; });

/**
 * Simula o migra. → el informe: por canal (qué es, adónde va, cuántos
 * mensajes, respuestas y ficheros, cuántos nuevos) y los totales.
 */
async function ejecutar(modo, firmante, alAvanzar = () => {}) {
  const migrar = modo === 'migrar';
  const s = await leerSlack(alAvanzar);
  alAvanzar('Viendo quién es quién…');
  const tabla = await proponerPersonas(s.usuarios, firmante);
  const personasMap = new Map([...tabla.values()].map(p => [p.slack_id, { usuarioId: p.usuario_id, nombre: p.nombre }]));
  const ctxTexto = { personas: personasMap, canales: s.nombresCanal };
  const yoErp = (personasMap.get(s.yo.user_id) || {}).usuarioId || null;
  const nombreDe = id => (personasMap.get(id) || {}).nombre || id;
  const informe = {
    modo, slack: { equipo: s.yo.team, usuario: s.yo.user }, canales: [], avisos: [],
    totales: { mensajes: 0, respuestas: 0, ficheros: 0, nuevos: 0, ficherosSubidos: 0, reaccionesFuera: 0 },
  };
  if (!yoErp) informe.avisos.push(`La cuenta del token (${s.yo.user}) no tiene usuario del ERP: sus directos no se pueden traer`);
  const tocados = [];

  for (const l of s.leidas) {
    const fila = {
      id: l.c.id, tipo: l.tipo, mensajes: 0, respuestas: 0, ficheros: 0, nuevos: 0, reaccionesFuera: 0,
      slack: l.nombre ? `#${l.nombre}` : l.tipo === 'directo' ? `Directo con ${nombreDe(l.c.user)}` : 'Un grupo de directos',
    };
    informe.canales.push(fila);
    if (l.saltar) { fila.destino = 'no se trae'; fila.motivo = l.saltar; continue; }
    const arriba = l.arriba.filter(esMensaje);
    const respuestas = l.respuestas.filter(esMensaje);
    fila.mensajes = arriba.length;
    fila.respuestas = respuestas.length;
    fila.ficheros = [...arriba, ...respuestas].reduce((n, m) => n + ficherosDe(m).length, 0);
    fila.reaccionesFuera = [...arriba, ...respuestas].reduce((n, m) =>
      n + (m.reactions || []).filter(r => !reaccionDeSlack(r.name)).reduce((k, r) => k + (r.count || 1), 0), 0);

    // ¿Adónde va?
    const miembrosErp = [...new Set(l.miembros.map(id => (personasMap.get(id) || {}).usuarioId).filter(Boolean))];
    let canal = await repo.canalPorSlack(null, l.c.id);
    if (l.tipo === 'directo' || l.tipo === 'grupo') {
      const otros = l.tipo === 'directo' ? [l.c.user] : l.miembros.filter(id => id !== s.yo.user_id);
      const otrosErp = otros.map(id => (personasMap.get(id) || {}).usuarioId);
      const nombres = otros.map(nombreDe);
      fila.slack = `${l.tipo === 'directo' ? 'Directo' : 'Grupo'} con ${nombres.join(', ')}`;
      if (!yoErp || otrosErp.some(x => !x)) {
        fila.destino = 'no se trae';
        fila.motivo = `${nombres.filter((n, i) => !otrosErp[i]).join(', ') || 'quien tiene el token'} no tiene usuario del ERP`;
        continue;
      }
      const ids = [...new Set([yoErp, ...otrosErp])].sort((a, b) => a - b);
      if (ids.length < 2) { fila.destino = 'no se trae'; fila.motivo = 'es un directo con uno mismo'; continue; }
      const clave = ids.join(',');
      canal = canal || await repo.directoPorClave(null, clave);
      fila.destino = canal ? 'directo que ya existe' : 'directo nuevo';
      fila.gente = ids;
      if (migrar && !canal) {
        canal = await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, async cli => {
          const nuevo = await repo.crearCanal(cli, { tipo: 'directo', claveDirecto: clave, creadoPor: yoErp, creadoAt: new Date(Number(l.c.created || 0) * 1000 || Date.now()) });
          for (const u of ids) await repo.meter(cli, nuevo.id, u);
          return nuevo;
        });
      }
    } else {
      canal = canal || await repo.canalPorNombre(null, l.nombre);
      if (!canal && !CREAR.has(l.nombre)) { fila.destino = 'no se trae'; fila.motivo = 'no existe en el chat'; continue; }
      fila.destino = canal ? `#${canal.nombre}` : `#${l.nombre} (nuevo, privado)`;
      if (l.tipo === 'privado') fila.gente = miembrosErp;
      if (migrar && !canal) {
        const creador = (personasMap.get(l.c.creator) || {}).usuarioId || yoErp;
        canal = await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, cli =>
          repo.crearCanal(cli, { tipo: 'privado', nombre: l.nombre, creadoPor: creador, creadoAt: new Date(Number(l.c.created || 0) * 1000 || Date.now()) }));
      }
    }
    if (!migrar) {
      const ya = canal ? await repo.traidos(null, l.c.id) : new Map();
      fila.nuevos = [...arriba, ...respuestas].filter(m => !ya.has(m.ts)).length;
      sumar(informe.totales, fila);
      continue;
    }

    // ── Migrar este canal ──
    alAvanzar(`Trayendo ${fila.destino}…`);
    const conFicheros = [];
    await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, async cli => {
      await repo.enlazarCanal(cli, canal.id, {
        slackId: l.c.id,
        tema: l.c.topic && l.c.topic.value ? textoDeSlack(l.c.topic.value, ctxTexto).slice(0, 250) : null,
        descripcion: l.c.purpose && l.c.purpose.value ? textoDeSlack(l.c.purpose.value, ctxTexto).slice(0, 2000) : null,
      });
      // En un privado, su gente de Slack; en un directo, los dos (o los del
      // grupo). La de los públicos ya es toda la oficina.
      if (l.tipo === 'privado') for (const u of miembrosErp) await repo.meter(cli, canal.id, u);
      if (fila.gente && l.tipo !== 'privado') for (const u of fila.gente) await repo.meter(cli, canal.id, u);
      const ya = await repo.traidos(cli, l.c.id);
      const idDe = ts => (ya.get(ts) || {}).id || null;
      const traer = async (m, padreId) => {
        const fs = ficherosDe(m);
        const previo = ya.get(m.ts);
        if (previo) {
          // Ya traído: solo los ficheros que no llegaron la otra vez.
          const faltan = fs.filter(f => !previo.nombres.includes(String(f.name || f.title || 'fichero').slice(0, 255)));
          if (faltan.length) conFicheros.push({ id: previo.id, ficheros: faltan, autorId: (personasMap.get(m.user) || {}).usuarioId || null });
          return previo.id;
        }
        const autor = personasMap.get(m.user) || {};
        const autorId = autor.usuarioId || null;
        const externo = autorId ? null : String(autor.nombre || m.username || (m.bot_profile && m.bot_profile.name) || 'Slack').slice(0, 120);
        let texto = m.subtype === 'tombstone' ? '(Mensaje borrado en Slack)'
          : textoDeSlack(m.text || textoDeAdjuntosSlack(m), ctxTexto);
        if (!texto && !fs.length) texto = '(Mensaje sin texto en Slack)';
        if (texto.length > 8000) texto = texto.slice(0, 7990) + '…';
        const id = await repo.importarMensaje(cli, {
          canalId: canal.id, autorId, autorExterno: externo, padreId, texto,
          creadoAt: new Date(Number(m.ts) * 1000),
          editadoAt: m.edited && m.edited.ts ? new Date(Number(m.edited.ts) * 1000) : null,
          conAdjuntos: fs.length > 0, slackCanal: l.c.id, slackTs: m.ts,
        });
        if (!id) return idDe(m.ts);
        fila.nuevos++;
        ya.set(m.ts, { id, ficheros: 0, nombres: [] });
        // Las menciones (para resaltarlas; no cuentan como pendientes: es de Slack).
        const usuarios = [...new Set([...texto.matchAll(/<@(\d{1,9})>/g)].map(x => Number(x[1])))];
        if (usuarios.length || /<!canal>/.test(texto)) await repo.mencionar(cli, id, { usuarios, todos: /<!canal>/.test(texto) });
        for (const r of m.reactions || []) {
          const emoji = reaccionDeSlack(r.name);
          if (!emoji) continue;
          for (const u of r.users || []) {
            const uid = (personasMap.get(u) || {}).usuarioId;
            if (uid) await repo.reaccionar(cli, id, uid, emoji, new Date(Number(m.ts) * 1000));
          }
        }
        if (fs.length) conFicheros.push({ id, ficheros: fs, autorId });
        return id;
      };
      // Primero los de arriba (en orden), luego las respuestas (a su hilo).
      for (const m of [...arriba].sort((a, b) => Number(a.ts) - Number(b.ts))) await traer(m, null);
      for (const m of [...respuestas].sort((a, b) => Number(a.ts) - Number(b.ts))) {
        const padre = idDe(m.thread_ts);
        if (!padre) { informe.avisos.push(`Una respuesta de ${fila.destino} sin su mensaje de arriba (${m.ts}): no se trae`); continue; }
        await traer(m, padre);
      }
      await repo.recontar(cli, canal.id);
    });

    // Los ficheros, fuera de la transacción: van por trozos a R2.
    for (const x of conFicheros) {
      for (const f of x.ficheros) {
        alAvanzar(`Subiendo «${f.name || 'fichero'}» de ${fila.destino}…`);
        try {
          await adjuntos.subirDelSistema({
            tipo: 'chat_mensaje', duenoId: String(x.id), nombre: String(f.name || f.title || 'fichero').slice(0, 255),
            mime: f.mimetype || 'application/octet-stream', cuerpo: await descargar(f.url_private_download),
            firmante, creadoPor: x.autorId, origen: ORIGEN, tope: 300 * 1024 * 1024,
          });
          informe.totales.ficherosSubidos++;
        } catch (e) {
          informe.avisos.push(`«${f.name || 'fichero'}» de ${fila.destino}: ${e.message}`);
        }
      }
    }
    tocados.push(canal.id);
    sumar(informe.totales, fila);
  }

  // Sin notificaciones ni no leídos: solo que las pantallas abiertas se recarguen.
  if (migrar) {
    for (const id of tocados) {
      try { tiempoReal.publicar('chat', { canal: id, tipo: 'canal' }, { para: await repo.idsMiembros(null, id) }); } catch (_) { /* nada */ }
    }
    contadores.cambio('chat');
    await libro.apuntar({ tabla: 'chat_canal', registro: 'slack', accion: 'alta', usuarioId: firmante, origen: ORIGEN,
      detalle: { totales: informe.totales, canales: informe.canales.length } }).catch(() => {});
  }
  return informe;
}

module.exports = {
  estado, personas, ponerPersona, lanzar, ejecutar, estadoProceso,
  textoDeSlack, reaccionDeSlack, usarSlack, CANALES,
};
