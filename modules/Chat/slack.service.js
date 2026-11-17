// ============================================================
// LA MIGRACIÓN DE SLACK — trae Slack al chat (ítem 2, entrega 2d, db/259-260)
// ============================================================
// Camilo, 17/11/2026: «Ya no queremos usarlo y la idea es migrar toda la info
// allá. Que no avise menciones ni nada hasta después de la migración». Y luego:
// «no necesito integrar slack sino migrarlo y dejar de usarlo, que lo haga
// mensaje a mensaje». Así que el ERP NO habla con Slack (ni token ni app):
//   · Slack se lee FUERA, mensaje a mensaje, con el conector de Slack de Claude
//     (la cuenta de Ignacio), y se monta una EXPORTACIÓN: un JSON con cada
//     conversación, sus mensajes, hilos, reacciones (con su gente) y ficheros,
//     y una carpeta con los ficheros (<id de Slack>__<nombre>). Fuera del repo:
//     tiene datos de personas.
//   · Aquí se SUBE esa exportación (/chat/slack, solo el desarrollador) y se
//     SIMULA: qué traería por conversación y QUIÉN ES QUIÉN (cada persona de
//     Slack con su usuario del ERP, por su correo y si no por su nombre). Se
//     corrige en la pantalla.
//   · Luego se MIGRA: cada mensaje con su fecha y su autor (si no es usuario del
//     ERP, con su nombre de Slack); los hilos, como hilos; las reacciones de las
//     seis del chat; las menciones, a <@id> o a @Nombre; @here, @channel y
//     @everyone, a @canal. Se trae lo de los 19 canales, el privado #efectivo
//     (que se crea) y los directos de Ignacio.
//   · Y se SUBEN LOS FICHEROS: cada uno va a su mensaje (chat_slack_fichero).
//   · SE PUEDE REPETIR con una exportación más nueva: lo ya traído (mismo canal
//     y marca de Slack) no se trae dos veces, ni sus ficheros.
//   · NO AVISA DE NADA: ni notificaciones, ni no leídos, ni menciones pendientes
//     (chat.repo excluye slack_ts). Al acabar, solo se avisa a las pantallas
//     abiertas para que se recarguen.
'use strict';

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
const CREAR = new Set(['efectivo']);          // los que no existen en el chat: se crean, privados
const TOPE_FICHERO = 300 * 1024 * 1024;
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
  s = s.replace(/<@([UWB][A-Z0-9]+)(?:\|([^>]*))?>/g, (m, id, n) => {
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
  // Lo reenviado: el conector lo pone como «Forwarded message from X: …».
  s = s.replace(/^Forwarded message from ([^:\n]+): /gm, 'Reenviado de $1: ');
  return s.replace(/\r\n/g, '\n').trim();
}

/** El código de la reacción del chat que corresponde a una de Slack, o null. */
const reaccionDeSlack = nombre => REACCION[String(nombre || '').replace(/::skin-tone-\d$/, '')] || null;

// ── La exportación (en memoria: se sube, se simula y se migra) ──────────────
let exportacion = null;   // { generado, fuente, yo, personas, conversaciones, subida, resumen }

const TIPOS = new Set(['publico', 'privado', 'directo', 'grupo']);
/** Comprueba la forma de lo subido y lo guarda. → su resumen. */
function cargar(datos) {
  if (proceso && !proceso.acabado) throw error('Hay una simulación o una migración en marcha: espera a que acabe', 409);
  const d = datos || {};
  if (!Array.isArray(d.conversaciones) || !Array.isArray(d.personas) || !/^U\w+$/.test(String(d.yo || ''))) {
    throw error('No es una exportación de Slack: le faltan «conversaciones», «personas» o «yo»');
  }
  for (const c of d.conversaciones) {
    if (!/^[CDG]\w+$/.test(String(c.id || '')) || !TIPOS.has(c.tipo) || !Array.isArray(c.mensajes)) {
      throw error(`Una conversación de la exportación no se entiende (${String(c.id || '?').slice(0, 20)})`);
    }
    for (const m of c.mensajes) {
      if (!/^\d+\.\d+$/.test(String(m.ts || '')) || typeof m.texto !== 'string') throw error(`Un mensaje de ${c.id} no se entiende`);
    }
  }
  const mensajes = d.conversaciones.reduce((n, c) => n + c.mensajes.filter(m => !m.sistema).length, 0);
  const ficheros = d.conversaciones.reduce((n, c) => n + c.mensajes.reduce((k, m) => k + (m.ficheros || []).length, 0), 0);
  exportacion = {
    generado: d.generado || null, fuente: d.fuente || null, yo: d.yo,
    personas: d.personas, conversaciones: d.conversaciones,
    resumen: { generado: d.generado || null, conversaciones: d.conversaciones.length, mensajes, ficheros, personas: d.personas.length, subida: new Date().toISOString() },
  };
  return exportacion.resumen;
}

// ── Quién es quién ─────────────────────────────────────────────────────────
/**
 * Propone el usuario del ERP de cada persona de Slack: por email; si no, por
 * nombre (nombre y primer apellido, o el nombre solo si en la oficina no hay
 * otro igual). Lo apunta en chat_slack_usuario sin pisar lo puesto a mano.
 */
async function proponerPersonas(personasSlack, firmante) {
  const erp = await repo.usuariosErp();
  const porEmail = new Map(erp.filter(u => u.email).map(u => [u.email, u]));
  const oficina = erp.filter(u => u.oficina);
  const buscarPorNombre = nombre => {
    const n = sinTildes(nombre);
    if (!n) return null;
    const exacto = erp.filter(u => sinTildes(u.completo) === n);
    if (exacto.length === 1) return exacto[0];
    // En Slack cada uno puso su nombre a su manera («Lorenzo Pérez Director
    // Trafico», «Karen Melissa Gallego») y en el ERP está con otro apellido o
    // con la inicial («Diana C»). Si en la oficina solo hay uno con ese nombre
    // de pila, es él; si hay varios, el que comparta un apellido. Sale «por el
    // nombre»: se comprueba en la pantalla.
    const [pila, ...resto] = n.split(' ');
    const mismos = oficina.filter(u => sinTildes(u.nombre).split(' ')[0] === pila);
    if (mismos.length === 1) return mismos[0];
    const conApellido = mismos.filter(u => sinTildes(u.apellidos).split(' ').some(a => a.length > 1 && resto.includes(a)));
    return conApellido.length === 1 ? conApellido[0] : null;
  };
  await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, async cli => {
    for (const s of personasSlack) {
      if (!s || !/^[UBW]\w+$/.test(String(s.id || '')) || s.id === 'USLACKBOT') continue;
      const nombre = String(s.nombre || s.id).slice(0, 160);
      const email = String(s.email || '').toLowerCase() || null;
      const esBot = String(s.id).startsWith('B') || !!s.bot;
      let u = email ? porEmail.get(email) : null, como = u ? 'email' : null;
      if (!u && !esBot) { u = buscarPorNombre(nombre); if (u) como = 'nombre'; }
      await repo.apuntarPersona(cli, { slackId: s.id, nombre, email, usuarioId: u ? u.id : null, como, esBot });
    }
  });
  return repo.personasSlack();
}

// ── El estado del proceso (en memoria: lo mira la pantalla) ─────────────────
let proceso = null;     // { modo, empezado, avance, informe, error, acabado }
const estadoProceso = () => (proceso ? { ...proceso } : null);

/** Lo que la pantalla enseña: la exportación subida, lo que esté en marcha y los ficheros por subir. */
async function estado() {
  return {
    exportacion: exportacion ? exportacion.resumen : null,
    proceso: estadoProceso(),
    ficheros: await repo.cuentaFicheros(),
  };
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
  if (!exportacion) throw error('Primero, sube la exportación de Slack', 409);
  if (proceso && !proceso.acabado) throw error('Ya hay uno en marcha: espera a que acabe', 409);
  proceso = { modo, empezado: new Date().toISOString(), avance: 'Empezando…', acabado: false };
  ejecutar(modo, firmante, t => { proceso.avance = t; })
    .then(informe => { proceso.informe = informe; proceso.avance = modo === 'simular' ? 'Simulación hecha' : 'Migración hecha'; })
    .catch(e => { proceso.error = e.message; console.error(`❌ [Slack] ${modo}:`, e.stack || e.message); })
    .finally(() => { proceso.acabado = true; proceso.acabadoAt = new Date().toISOString(); });
  return estadoProceso();
}

const sumar = (t, f) => ['mensajes', 'respuestas', 'ficheros', 'nuevos', 'reaccionesFuera'].forEach(k => { t[k] += f[k] || 0; });
const nombreFichero = f => String(f.nombre || f.id || 'fichero').slice(0, 255);

/**
 * Simula o migra la exportación subida (o la que se le dé: las pruebas). →
 * el informe: por conversación (qué es, adónde va, cuántos mensajes,
 * respuestas y ficheros, cuántos nuevos) y los totales.
 */
async function ejecutar(modo, firmante, alAvanzar = () => {}, datos = exportacion) {
  if (!datos) throw error('Primero, sube la exportación de Slack', 409);
  const migrar = modo === 'migrar';
  alAvanzar('Viendo quién es quién…');
  const tabla = await proponerPersonas(datos.personas, firmante);
  const personasMap = new Map([...tabla.values()].map(p => [p.slack_id, { usuarioId: p.usuario_id, nombre: p.nombre }]));
  const nombresCanal = new Map(datos.conversaciones.filter(c => c.nombre).map(c => [c.id, c.nombre]));
  const ctxTexto = { personas: personasMap, canales: nombresCanal };
  const yoErp = (personasMap.get(datos.yo) || {}).usuarioId || null;
  const nombreDe = id => (personasMap.get(id) || {}).nombre || id;
  const informe = {
    modo, canales: [], avisos: [],
    totales: { mensajes: 0, respuestas: 0, ficheros: 0, nuevos: 0, reaccionesFuera: 0 },
  };
  if (!yoErp) informe.avisos.push(`Quien hizo la exportación (${nombreDe(datos.yo)}) no tiene usuario del ERP: sus directos no se pueden traer`);
  const tocados = [];

  for (const conv of datos.conversaciones) {
    const fila = {
      id: conv.id, tipo: conv.tipo, mensajes: 0, respuestas: 0, ficheros: 0, nuevos: 0, reaccionesFuera: 0,
      slack: conv.nombre ? `#${conv.nombre}` : conv.tipo === 'directo' ? `Directo con ${nombreDe(conv.con)}` : 'Un grupo de directos',
    };
    informe.canales.push(fila);
    const validos = conv.mensajes.filter(m => !m.sistema);
    const arriba = validos.filter(m => !m.hilo);
    const respuestas = validos.filter(m => m.hilo);
    fila.mensajes = arriba.length;
    fila.respuestas = respuestas.length;
    fila.ficheros = validos.reduce((n, m) => n + (m.ficheros || []).length, 0);
    fila.reaccionesFuera = validos.reduce((n, m) => n + (m.reacciones || []).filter(r => !reaccionDeSlack(r.nombre))
      .reduce((k, r) => k + Math.max(1, (r.usuarios || []).length), 0), 0);
    const miembrosErp = [...new Set((conv.miembros || []).map(id => (personasMap.get(id) || {}).usuarioId).filter(Boolean))];

    // ¿Adónde va?
    let canal = await repo.canalPorSlack(null, conv.id);
    if (conv.tipo === 'directo' || conv.tipo === 'grupo') {
      const otros = conv.tipo === 'directo' ? [conv.con] : (conv.miembros || []).filter(id => id !== datos.yo);
      const otrosErp = otros.map(id => (personasMap.get(id) || {}).usuarioId);
      const nombres = otros.map(nombreDe);
      if (conv.tipo === 'grupo') fila.slack = `Grupo con ${nombres.join(', ')}`;
      if (!yoErp || !otros.length || otrosErp.some(x => !x)) {
        fila.destino = 'no se trae';
        fila.motivo = `${nombres.filter((n, i) => !otrosErp[i]).join(', ') || 'quien hizo la exportación'} no tiene usuario del ERP`;
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
          const primero = conv.mensajes[0];
          const nuevo = await repo.crearCanal(cli, { tipo: 'directo', claveDirecto: clave, creadoPor: yoErp, creadoAt: primero ? new Date(Number(primero.ts) * 1000) : null });
          for (const u of ids) await repo.meter(cli, nuevo.id, u);
          return nuevo;
        });
      }
    } else {
      canal = canal || await repo.canalPorNombre(null, conv.nombre);
      if (!canal && !CREAR.has(conv.nombre)) { fila.destino = 'no se trae'; fila.motivo = 'no existe en el chat'; continue; }
      fila.destino = canal ? `#${canal.nombre}` : `#${conv.nombre} (nuevo, privado)`;
      if (conv.tipo === 'privado') {
        // Su gente de Slack (Camilo: «que en escalaciones-lorenzo estén los que
        // faltan en el ERP»): entra quien tiene usuario; el resto se dice.
        fila.gente = miembrosErp;
        const dentro = new Set(canal ? await repo.idsMiembros(null, canal.id) : []);
        const nombreErp = new Map([...tabla.values()].filter(p => p.usuario_id).map(p => [p.usuario_id, p.usuario_nombre || p.nombre]));
        fila.entran = miembrosErp.filter(u => !dentro.has(u)).map(u => nombreErp.get(u) || `usuario ${u}`);
        fila.yaDentro = miembrosErp.filter(u => dentro.has(u)).length;
        fila.sinUsuario = (conv.miembros || []).filter(id => !(personasMap.get(id) || {}).usuarioId).map(nombreDe);
      }
      if (migrar && !canal) {
        const primero = conv.mensajes[0];
        canal = await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, cli =>
          repo.crearCanal(cli, { tipo: 'privado', nombre: conv.nombre, creadoPor: yoErp, creadoAt: primero ? new Date(Number(primero.ts) * 1000) : null }));
      }
    }
    if (!migrar) {
      const ya = await repo.traidos(null, conv.id);
      fila.nuevos = validos.filter(m => !ya.has(m.ts)).length;
      sumar(informe.totales, fila);
      continue;
    }

    // ── Migrar esta conversación ──
    alAvanzar(`Trayendo ${fila.destino === 'directo nuevo' || fila.destino === 'directo que ya existe' ? fila.slack : fila.destino}…`);
    await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, async cli => {
      await repo.enlazarCanal(cli, canal.id, { slackId: conv.id });
      // En un privado, su gente de Slack; en un directo, los dos. La de los
      // públicos ya es toda la oficina.
      for (const u of fila.gente || []) await repo.meter(cli, canal.id, u);
      const ya = await repo.traidos(cli, conv.id);
      const traer = async (m, padreId) => {
        const fs = m.ficheros || [];
        const autorId = (personasMap.get(m.user) || {}).usuarioId || null;
        let id = (ya.get(m.ts) || {}).id || null;
        if (!id) {
          const externo = autorId ? null : String(m.borrado ? 'Slack' : ((personasMap.get(m.user) || {}).nombre || m.nombre || 'Slack')).slice(0, 120);
          let texto = m.borrado ? '(Mensaje borrado en Slack)' : textoDeSlack(m.texto, ctxTexto);
          if (!texto && !fs.length) texto = '(Mensaje sin texto en Slack)';
          if (texto.length > 8000) texto = texto.slice(0, 7990) + '…';
          id = await repo.importarMensaje(cli, {
            canalId: canal.id, autorId, autorExterno: externo, padreId, texto,
            creadoAt: new Date(Number(m.ts) * 1000), editadoAt: null,
            conAdjuntos: fs.length > 0, slackCanal: conv.id, slackTs: m.ts,
          });
          if (!id) return null;
          fila.nuevos++;
          ya.set(m.ts, { id });
          // Las menciones (para resaltarlas; no cuentan como pendientes: es de Slack).
          const usuarios = [...new Set([...texto.matchAll(/<@(\d{1,9})>/g)].map(x => Number(x[1])))];
          if (usuarios.length || /<!canal>/.test(texto)) await repo.mencionar(cli, id, { usuarios, todos: /<!canal>/.test(texto) });
          for (const r of m.reacciones || []) {
            const emoji = reaccionDeSlack(r.nombre);
            if (!emoji) continue;
            for (const u of r.usuarios || []) {
              const uid = (personasMap.get(u) || {}).usuarioId;
              if (uid) await repo.reaccionar(cli, id, uid, emoji, new Date(Number(m.ts) * 1000));
            }
          }
        }
        // Sus ficheros, por subir (también los de un mensaje ya traído).
        for (const f of fs) await repo.apuntarFichero(cli, { slackId: f.id, mensajeId: id, nombre: nombreFichero(f), mime: f.mime || 'application/octet-stream' });
        return id;
      };
      // Primero los de arriba (en orden), luego las respuestas (a su hilo).
      for (const m of [...arriba].sort((a, b) => Number(a.ts) - Number(b.ts))) await traer(m, null);
      for (const m of [...respuestas].sort((a, b) => Number(a.ts) - Number(b.ts))) {
        const padre = (ya.get(m.hilo) || {}).id;
        if (!padre) { informe.avisos.push(`Una respuesta de ${fila.slack} sin su mensaje de arriba (${m.ts}): no se trae`); continue; }
        await traer(m, padre);
      }
      await repo.recontar(cli, canal.id);
    });
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
      detalle: { totales: informe.totales, conversaciones: informe.canales.length } }).catch(() => {});
  }
  return informe;
}

// ── Los ficheros ───────────────────────────────────────────────────────────
/** Los que faltan por subir: [{ id, nombre }] (el id es el de Slack: así se llaman en la carpeta). */
const ficherosPendientes = () => repo.ficherosPendientes();

/**
 * Sube UN fichero de Slack a su mensaje. `cuerpo` es el stream de lo que llega.
 * Si ya estaba subido, no hace nada (se puede repetir). → { subido, ya }.
 */
async function subirFichero(firmante, slackId, cuerpo) {
  const f = await repo.fichero(String(slackId || ''));
  if (!f) { cuerpo.resume(); throw error('Ese fichero no es de ningún mensaje traído de Slack', 404); }
  if (f.adjunto_id) { cuerpo.resume(); return { ya: true }; }
  const a = await adjuntos.subirDelSistema({
    tipo: 'chat_mensaje', duenoId: String(f.mensaje_id), nombre: f.nombre, mime: f.mime, cuerpo,
    firmante, creadoPor: f.autor_id, origen: ORIGEN, tope: TOPE_FICHERO,
  });
  await libro.conFirma({ usuarioId: firmante, origen: ORIGEN }, cli => repo.ficheroSubido(cli, f.slack_id, a.id));
  return { subido: true };
}

module.exports = {
  cargar, estado, personas, ponerPersona, lanzar, ejecutar, estadoProceso,
  ficherosPendientes, subirFichero,
  textoDeSlack, reaccionDeSlack,
  // Para las pruebas:
  olvidar: () => { exportacion = null; proceso = null; },
};
