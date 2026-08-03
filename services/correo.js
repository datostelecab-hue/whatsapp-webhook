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

// Compatibilidad: indica si hay credenciales por entorno (uso heredado).
function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

module.exports = { enviarCorreo, estadoCorreo, ajustesEnvio, configurado, CORREO_TRAFICO };
