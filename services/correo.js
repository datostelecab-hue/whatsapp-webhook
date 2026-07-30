// ============================================================
// CORREO — envío de avisos (STUB, listo para enchufar)
// ============================================================
// De momento NO envía: solo registra en el log. Cuando haya credenciales
// (variables SMTP_HOST / SMTP_USER / SMTP_PASS, o un app-password de Gmail) se
// implementa el transporte real con nodemailer sin tocar quien lo llama.

const CORREO_TRAFICO = process.env.CORREO_TRAFICO || 'traficotelecab@gmail.com';

function configurado() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/** Envía (o registra) un correo. Nunca lanza: un fallo de correo no debe romper el flujo. */
async function enviarCorreo({ to, subject, text } = {}) {
  try {
    if (!configurado()) {
      console.log(`✉️  [CORREO pendiente de configurar] → ${to} · ${subject}\n${text || ''}`);
      return { enviado: false, motivo: 'sin credenciales' };
    }
    // TODO: const nodemailer = require('nodemailer'); crear transport con las
    // variables de entorno y sendMail({ from, to, subject, text }).
    console.log(`✉️  [CORREO] → ${to} · ${subject}`);
    return { enviado: true };
  } catch (e) {
    console.error('❌ [CORREO]:', e.message);
    return { enviado: false, motivo: e.message };
  }
}

module.exports = { enviarCorreo, configurado, CORREO_TRAFICO };
