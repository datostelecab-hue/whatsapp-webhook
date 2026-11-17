// ============================================================
// LAS NOTIFICACIONES AL DISPOSITIVO (Web Push, db/250, pieza A8)
// ============================================================
// Pieza A8 de docs/Hoja de ruta.md (16/11/2026). Avisar a alguien en su móvil
// o su ordenador aunque no tenga el ERP abierto:
//
//   const push = require('../../services/notificacionesPush');
//   await push.enviar([usuarioId], {
//     titulo: 'Nueva tarea',                 // hasta 80 letras
//     cuerpo: 'Revisar la J de Luis (ficha 12)', // hasta 200; SIN DNI ni datos sensibles: sale en la pantalla bloqueada
//     url: '/tareas/42',                     // dónde lleva al pulsarla (del ERP, nunca de fuera)
//     etiqueta: 'tarea-42',                  // opcional: una nueva con la misma sustituye a la anterior
//     urgente: false,                        // opcional: true = el móvil la entrega aunque ahorre batería
//   });
//
// CÓMO FUNCIONA: al pulsar «Activar» (Configuración), el navegador pide permiso
// y da una dirección de SU servicio de avisos (Google, Mozilla, Apple o
// Microsoft) con dos claves. Se guarda (`push_suscripcion`). Para avisar se
// manda por esa dirección, cifrado con esas claves y firmado con las claves
// VAPID del servidor (VAPID_PUBLICA, VAPID_PRIVADA y VAPID_CONTACTO en Render;
// se generan con scripts/generar-claves-push.js).
//
// SOLO MIENTRAS SU SESIÓN SIGA ABIERTA: cada dirección lleva la sesión (sid)
// de la última vez que la pantalla la confirmó, y solo se avisa si esa sesión
// sigue abierta. Al salir, al cerrarla desde otro dispositivo o al caducar, ese
// navegador deja de recibirlas hasta que se vuelve a entrar.
//
// SOLO A LOS SERVICIOS DE LOS NAVEGADORES: la dirección la manda el navegador, y
// el servidor va a llamarla. Si se aceptara cualquiera, el ERP llamaría a donde
// se le dijera (a su propia red, por ejemplo). Se comprueba el servidor de la
// dirección contra la lista de SERVICIOS.
'use strict';

const db = require('./db');

let _webpush = null;
const webpush = () => (_webpush || (_webpush = require('web-push')));

const env = n => String(process.env[n] || '').trim();

/** ¿Están las claves VAPID en el entorno? Sin ellas no se puede avisar. */
const configurado = () => !!(env('VAPID_PUBLICA') && env('VAPID_PRIVADA'));
const clavePublica = () => env('VAPID_PUBLICA') || null;
// A quién escribe el servicio de avisos si algo va mal (lo pide la norma).
const contacto = () => env('VAPID_CONTACTO') || 'https://erptelecab.es';

// ── Los servicios de avisos de los navegadores ─────────────────────────────
const SERVICIOS = [
  /^fcm\.googleapis\.com$/,                       // Chrome, Edge en Android, Brave, Opera, Samsung
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,       // Firefox
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,                       // Safari, y el iPhone con la web instalada
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,            // Edge en Windows
];
const extra = new Set();
/** Para las pruebas: un servicio de mentira (host:puerto). */
const permitirServicio = host => extra.add(String(host));

function servicioValido(endpoint) {
  let u;
  try { u = new URL(String(endpoint || '')); } catch (_) { return false; }
  if (u.protocol !== 'https:' || u.username || u.password) return false;
  if (extra.has(u.host)) return true;
  return (u.port === '' || u.port === '443') && SERVICIOS.some(r => r.test(u.hostname));
}

// ── Lo que manda el navegador ──────────────────────────────────────────────
const B64URL = /^[A-Za-z0-9_-]+=*$/;
const bytesDe = s => Buffer.from(String(s).replace(/=+$/, ''), 'base64url').length;

function conEstado(e, status) { e.status = status; return e; }

/** La suscripción del navegador (PushSubscription.toJSON()), comprobada. */
function suscripcionDe(s) {
  const endpoint = s && s.endpoint;
  const keys = (s && s.keys) || {};
  if (!endpoint || String(endpoint).length > 1000 || !servicioValido(endpoint)) {
    throw conEstado(new Error('Esa dirección de avisos no es de ningún navegador conocido'), 400);
  }
  if (!B64URL.test(keys.p256dh || '') || bytesDe(keys.p256dh) !== 65 || !B64URL.test(keys.auth || '') || bytesDe(keys.auth) !== 16) {
    throw conEstado(new Error('Las claves de la suscripción no son válidas'), 400);
  }
  return { endpoint: String(endpoint), p256dh: keys.p256dh, auth: keys.auth };
}

/** «Chrome en Windows»: lo que manda la pantalla, sin caracteres raros. */
const nombreDispositivo = d => {
  const t = String(d || '').replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  return t || null;
};

function exigirSesion(quien) {
  if (!quien || !quien.id) throw conEstado(new Error('Sesión requerida'), 401);
  if (!quien.sid) throw conEstado(new Error('Vuelve a entrar en el ERP para activar las notificaciones en este dispositivo'), 409);
}

// ── Activar, confirmar y quitar ────────────────────────────────────────────
/**
 * La persona pulsó «Activar» en este navegador. Si la dirección ya estaba (de
 * ella o de otra persona que usó este navegador antes), pasa a ella y vuelve a
 * estar de alta. → { id }
 */
async function activar(quien, suscripcion, dispositivo) {
  exigirSesion(quien);
  const s = suscripcionDe(suscripcion);
  const r = await db.consulta(
    `INSERT INTO push_suscripcion (usuario_id, endpoint, p256dh, auth, sid, dispositivo)
          VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
          SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
              sid = EXCLUDED.sid, dispositivo = COALESCE(EXCLUDED.dispositivo, push_suscripcion.dispositivo),
              visto_at = now(), fallos = 0, baja_at = NULL, baja_motivo = NULL
       RETURNING id`,
    [quien.id, s.endpoint, s.p256dh, s.auth, quien.sid, nombreDispositivo(dispositivo)]);
  console.log(`🔔 [Push] usuario ${quien.id} activa las notificaciones en «${nombreDispositivo(dispositivo) || 'un dispositivo'}»`);
  return { id: Number(r.rows[0].id) };
}

/**
 * La pantalla, al cargar, confirma que este navegador sigue activado, con la
 * sesión de ahora: así los avisos vuelven a llegar tras entrar otra vez. No da
 * de alta lo que la persona quitó, ni lo que activó otra persona en este
 * navegador (eso se activa a mano). → { estado: 'ok' | 'no-esta', id }
 */
async function confirmar(quien, suscripcion) {
  exigirSesion(quien);
  const s = suscripcionDe(suscripcion);
  const r = await db.consulta(
    `UPDATE push_suscripcion
        SET sid = $3, p256dh = $4, auth = $5, visto_at = now()
      WHERE endpoint = $1 AND usuario_id = $2 AND baja_at IS NULL
      RETURNING id`,
    [s.endpoint, quien.id, quien.sid, s.p256dh, s.auth]);
  return r.rows[0] ? { estado: 'ok', id: Number(r.rows[0].id) } : { estado: 'no-esta' };
}

/** Quita uno de sus dispositivos (por id, desde la lista; o este, por su dirección). */
async function quitar(quien, { id, endpoint } = {}) {
  if (!quien || !quien.id) throw conEstado(new Error('Sesión requerida'), 401);
  const n = Number(id);
  if (!(Number.isSafeInteger(n) && n > 0) && !endpoint) throw conEstado(new Error('Di qué dispositivo quitar'), 400);
  const r = await db.consulta(
    `UPDATE push_suscripcion SET baja_at = now(), baja_motivo = 'quitada'
      WHERE usuario_id = $1 AND baja_at IS NULL
        AND ${Number.isSafeInteger(n) && n > 0 ? 'id = $2' : 'endpoint = $2'}
      RETURNING id`,
    [quien.id, Number.isSafeInteger(n) && n > 0 ? n : String(endpoint)]);
  return { quitadas: r.rowCount };
}

/** Sus dispositivos de alta, con si ahora mismo le llegarían (sesión abierta). */
async function mias(quien) {
  if (!quien || !quien.id) throw conEstado(new Error('Sesión requerida'), 401);
  const r = await db.consulta(
    `SELECT p.id, p.dispositivo, p.creado_at, p.visto_at, p.enviado_at, p.fallos,
            (s.sid IS NOT NULL) AS abierta
       FROM push_suscripcion p
       LEFT JOIN usuario_sesion s ON s.sid = p.sid AND s.cerrada_at IS NULL AND s.expira_at > now()
      WHERE p.usuario_id = $1 AND p.baja_at IS NULL
      ORDER BY p.visto_at DESC`, [quien.id]);
  return r.rows.map(x => ({
    id: Number(x.id), dispositivo: x.dispositivo, creado: x.creado_at, visto: x.visto_at,
    ultimoAviso: x.enviado_at, fallos: x.fallos, sesionAbierta: x.abierta,
  }));
}

// ── Avisar ─────────────────────────────────────────────────────────────────
const RUTA_VALIDA = /^\/(?!\/)[^\s\\]{0,299}$/;
const ETIQUETA_VALIDA = /^[A-Za-z0-9_-]{1,32}$/;
const corta = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);

/** Lo que va dentro del aviso, comprobado. Lanza si algo no vale. */
function avisoDe({ titulo, cuerpo, url, etiqueta, urgente } = {}) {
  const t = corta(titulo, 80);
  if (!t) throw new Error('Una notificación necesita título');
  const destino = url == null || url === '' ? '/inicio' : String(url);
  if (!RUTA_VALIDA.test(destino)) throw new Error(`La notificación tiene que llevar a una página del ERP («/…»), no a «${destino}»`);
  if (etiqueta != null && !ETIQUETA_VALIDA.test(String(etiqueta))) throw new Error('La etiqueta de una notificación son hasta 32 letras, números, «-» o «_»');
  return { titulo: t, cuerpo: corta(cuerpo, 200), url: destino, etiqueta: etiqueta == null ? null : String(etiqueta), urgente: !!urgente };
}

// Para las pruebas: opciones que se pasan a web-push (un agente que acepta el
// certificado de un servicio de mentira).
let opcionesExtra = {};
const opcionesDePrueba = o => { opcionesExtra = o || {}; };

const MAX_FALLOS = 5;
let avisadoSinClaves = false;

/**
 * Manda la notificación a todos los dispositivos de esas personas cuya sesión
 * siga abierta. No lanza por un dispositivo que falle: lo apunta, y si el
 * servicio dice que ya no existe, lo da de baja.
 *   → { dispositivos, enviados, fallidos, bajas, sinConfigurar? }
 */
async function enviar(usuarioIds, datos) {
  const aviso = avisoDe(datos);
  const ids = [...new Set([].concat(usuarioIds || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
  const resultado = { dispositivos: 0, enviados: 0, fallidos: 0, bajas: 0 };
  if (!ids.length) return resultado;
  if (!configurado()) {
    if (!avisadoSinClaves) { console.warn('⚠️ [Push] Sin VAPID_PUBLICA / VAPID_PRIVADA: no se manda ninguna notificación'); avisadoSinClaves = true; }
    return { ...resultado, sinConfigurar: true };
  }
  const r = await db.consulta(
    `SELECT p.id, p.endpoint, p.p256dh, p.auth
       FROM push_suscripcion p
       JOIN usuario_sesion s ON s.sid = p.sid AND s.cerrada_at IS NULL AND s.expira_at > now()
      WHERE p.usuario_id = ANY($1::int[]) AND p.baja_at IS NULL`, [ids]);
  resultado.dispositivos = r.rows.length;
  const cuerpo = JSON.stringify({ ...aviso, en: Date.now() });
  const opciones = {
    vapidDetails: { subject: contacto(), publicKey: clavePublica(), privateKey: env('VAPID_PRIVADA') },
    TTL: aviso.urgente ? 60 * 60 : 24 * 60 * 60,      // si el dispositivo está apagado, cuánto se guarda
    urgency: aviso.urgente ? 'high' : 'normal',
    timeout: 10000,
    ...(aviso.etiqueta ? { topic: aviso.etiqueta } : {}),
    ...opcionesExtra,
  };

  // De diez en diez: una lista larga no abre cien conexiones a la vez.
  for (let i = 0; i < r.rows.length; i += 10) {
    await Promise.all(r.rows.slice(i, i + 10).map(async fila => {
      try {
        await webpush().sendNotification({ endpoint: fila.endpoint, keys: { p256dh: fila.p256dh, auth: fila.auth } }, cuerpo, opciones);
        resultado.enviados++;
        await db.consulta('UPDATE push_suscripcion SET enviado_at = now(), fallos = 0 WHERE id = $1', [fila.id]);
      } catch (e) {
        resultado.fallidos++;
        const codigo = e.statusCode;
        // 404/410: el navegador tiró la suscripción. 403: se firmó con otras
        // claves VAPID (se cambiaron): esa suscripción ya no vale.
        const motivo = codigo === 404 || codigo === 410 ? 'caducada'
          : codigo === 403 ? 'rechazada (otras claves VAPID)' : null;
        if (motivo) {
          resultado.bajas++;
          await db.consulta(`UPDATE push_suscripcion SET baja_at = now(), baja_motivo = $2 WHERE id = $1 AND baja_at IS NULL`, [fila.id, motivo]);
          return;
        }
        console.error(`❌ [Push] aviso a la suscripción ${fila.id}: ${codigo || ''} ${e.message}`);
        const f = await db.consulta(
          `UPDATE push_suscripcion SET fallos = fallos + 1,
                  baja_at = CASE WHEN fallos + 1 >= $2 THEN now() END,
                  baja_motivo = CASE WHEN fallos + 1 >= $2 THEN 'falla siempre' END
            WHERE id = $1 AND baja_at IS NULL RETURNING baja_at`, [fila.id, MAX_FALLOS]);
        if (f.rows[0] && f.rows[0].baja_at) resultado.bajas++;
      }
    }));
  }
  return resultado;
}

module.exports = {
  configurado, clavePublica, activar, confirmar, quitar, mias, enviar,
  // Para las pruebas:
  servicioValido, suscripcionDe, avisoDe, permitirServicio, opcionesDePrueba,
};
