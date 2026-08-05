// ============================================================
// CORREO — envío de avisos y correos de proceso (nodemailer)
// ============================================================
// Las credenciales de envío salen, por orden:
//   1) De la app: Configuración → "Correo para procesos" (hoja CONFIG; la
//      contraseña va CIFRADA con CRED_KEY).
//   2) De variables de entorno (SMTP_HOST / SMTP_USER / SMTP_PASS …).
// Si no hay ninguna, no envía: solo registra en el log (útil en el arranque, para
// no perder la contraseña provisional del primer superadmin).
//
// Para telecab.es (DonDominio): host smtp.dondominio.com, puerto 587 (STARTTLS).

const configApp = require('./configApp');
const { descifrar } = require('./cripto');

const CORREO_TRAFICO = process.env.CORREO_TRAFICO || 'traficotelecab@gmail.com';

/** Resuelve los ajustes SMTP (app primero, luego entorno) o null si no hay. */
async function ajustesEnvio() {
  try {
    const c = await configApp.leerConfig();
    if (c.correo_activo === 'si' && c.correo_host && c.correo_user && c.correo_pass_cifrada) {
      const pass = descifrar(c.correo_pass_cifrada);
      if (pass) {
        const port = Number(c.correo_port) || 587;
        return { host: c.correo_host, port, secure: port === 465, user: c.correo_user, pass,
          from: c.correo_from || c.correo_user, origen: 'app' };
      }
    }
  } catch (_) { /* la hoja CONFIG puede no existir aún */ }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 587;
    return { host: process.env.SMTP_HOST, port, secure: port === 465, user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, from: process.env.SMTP_FROM || process.env.SMTP_USER, origen: 'env' };
  }
  return null;
}

/** Estado para la pantalla de Configuración (nunca expone la contraseña). */
async function estadoCorreo() {
  const c = await configApp.leerConfig().catch(() => ({}));
  return {
    activo: c.correo_activo === 'si',
    host: c.correo_host || '',
    port: c.correo_port || '587',
    user: c.correo_user || '',
    from: c.correo_from || '',
    tienePass: !!c.correo_pass_cifrada,
    envCredenciales: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  };
}

/** Envía (o registra) un correo. Nunca lanza: un fallo de correo no rompe el flujo. */
async function enviarCorreo({ to, subject, text, html } = {}) {
  try {
    const a = await ajustesEnvio();
    if (!a) {
      console.log(`✉️  [CORREO] Sin configurar → no se envía a ${to} · «${subject}» (revisa "Correo para procesos" y la variable CRED_KEY)`);
      return { enviado: false, motivo: 'sin credenciales (revisa Correo para procesos / CRED_KEY)' };
    }
    // Log de diagnóstico (sin la contraseña): de dónde salen los ajustes y a dónde va.
    console.log(`✉️  [CORREO] Enviando (origen ${a.origen}) por ${a.host}:${a.port} secure=${a.secure} user=${a.user} from=${a.from} → ${to}`);
    const nodemailer = require('nodemailer');   // lazy: la app arranca aunque no esté instalado
    const transport = nodemailer.createTransport({
      host: a.host, port: a.port, secure: a.secure,
      requireTLS: !a.secure,                     // en 587 fuerza STARTTLS (nunca manda en claro)
      auth: { user: a.user, pass: a.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    const info = await transport.sendMail({ from: a.from, to, subject, text, html });
    console.log(`✅ [CORREO] Enviado a ${to} · id=${info.messageId || '?'} · ${info.response || ''}`);
    return { enviado: true, id: info.messageId };
  } catch (e) {
    // Detalle SMTP completo para diagnosticar (código, respuesta del servidor…).
    const detalle = [e.message, e.code && `code=${e.code}`, e.responseCode && `smtp=${e.responseCode}`, e.response && `«${e.response}»`].filter(Boolean).join(' · ');
    console.error(`❌ [CORREO] Fallo enviando a ${to}: ${detalle}`);
    return { enviado: false, motivo: detalle || 'error desconocido' };
  }
}

/**
 * Envía un correo COMO un usuario concreto (desde su propio buzón @telecab.es), para
 * la trazabilidad: se sabe quién hizo cada proceso. Autentica con la contraseña de
 * correo CIFRADA guardada en su ficha. El SMTP es el mismo para todos (@telecab.es):
 * host/puerto salen de "correo para procesos" o, por defecto, de DonDominio.
 */
// Guarda una copia del mensaje (RFC822 crudo) en la carpeta "Enviados" por IMAP,
// porque enviar por SMTP NO la deja ahí (eso lo hace el cliente aparte). Busca la
// carpeta por su marca especial \Sent y, si no, por nombre (Sent/Enviados).
async function guardarEnEnviados({ user, pass, host, port = 993 }, raw) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false, emitLogs: false });
  await client.connect();
  try {
    let carpeta = 'Sent';
    try {
      const list = await client.list();
      const bySpecial = list.find(m => m.specialUse === '\\Sent');
      const byName = list.find(m => /(^|[./])(sent|enviados)$/i.test(m.path || '') || /^(sent|enviados)$/i.test(m.name || ''));
      carpeta = (bySpecial && bySpecial.path) || (byName && byName.path) || 'Sent';
    } catch (_) { /* sin LIST: probamos con "Sent" */ }
    await client.append(carpeta, raw, ['\\Seen']);
    return carpeta;
  } finally {
    await client.logout().catch(() => {});
  }
}

// Construye el mensaje crudo (RFC822) que se guardará en Enviados.
function componerRaw(mail) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return new Promise((resolve, reject) => {
    new MailComposer(mail).compile().build((err, message) => err ? reject(err) : resolve(message));
  });
}

async function enviarComoUsuario(emailRemitente, { to, subject, text, html, attachments } = {}) {
  try {
    const usuarios = require('./usuarios');
    const u = await usuarios.buscarUsuario(emailRemitente);
    if (!u) return { enviado: false, motivo: `El remitente ${emailRemitente} no existe` };
    const pass = usuarios.descifrarPassCorreo(u);
    if (!pass) return { enviado: false, motivo: `${emailRemitente} no tiene contraseña de correo configurada (Configuración → Mi perfil)` };

    const c = await configApp.leerConfig().catch(() => ({}));
    const host = c.correo_host || 'smtp.dondominio.com';
    const port = Number(c.correo_port) || 587;
    const from = u.email;   // se envía SIEMPRE como el propio usuario

    console.log(`✉️  [CORREO] Como ${from} por ${host}:${port} → ${to}`);
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: from, pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000
    });
    const info = await transport.sendMail({ from, to, subject, text, html, attachments });
    console.log(`✅ [CORREO] Enviado como ${from} → ${to} · id=${info.messageId || '?'}${attachments && attachments.length ? ` · ${attachments.length} adj.` : ''}`);

    // Deja copia en "Enviados" por IMAP. Si falla, el correo YA salió: solo se avisa.
    try {
      const raw = await componerRaw({ from, to, subject, text, html, attachments, messageId: info.messageId });
      const imapHost = (c.correo_imap_host || '').trim() || host.replace(/^smtp\./i, 'imap.');
      const carpeta = await guardarEnEnviados({ user: from, pass, host: imapHost }, raw);
      console.log(`📥 [CORREO] Copia guardada en "${carpeta}" de ${from}`);
    } catch (e) {
      console.error(`⚠️ [CORREO] No se pudo guardar copia en Enviados: ${e.message}`);
    }
    return { enviado: true, id: info.messageId, from };
  } catch (e) {
    const detalle = [e.message, e.code && `code=${e.code}`, e.responseCode && `smtp=${e.responseCode}`, e.response && `«${e.response}»`].filter(Boolean).join(' · ');
    console.error(`❌ [CORREO] Fallo enviando como ${emailRemitente}: ${detalle}`);
    return { enviado: false, motivo: detalle || 'error desconocido' };
  }
}

// Compatibilidad: indica si hay credenciales por entorno (uso heredado).
function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

module.exports = { enviarCorreo, enviarComoUsuario, estadoCorreo, ajustesEnvio, configurado, CORREO_TRAFICO };
