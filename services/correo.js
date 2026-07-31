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
      console.log(`✉️  [CORREO pendiente de configurar] → ${to} · ${subject}\n${text || ''}`);
      return { enviado: false, motivo: 'sin credenciales' };
    }
    // Lazy require: la app arranca aunque nodemailer no esté instalado todavía.
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport({
      host: a.host, port: a.port, secure: a.secure, auth: { user: a.user, pass: a.pass }
    });
    await transport.sendMail({ from: a.from, to, subject, text, html });
    return { enviado: true };
  } catch (e) {
    console.error('❌ [CORREO]:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

// Compatibilidad: indica si hay credenciales por entorno (uso heredado).
function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

module.exports = { enviarCorreo, estadoCorreo, ajustesEnvio, configurado, CORREO_TRAFICO };
