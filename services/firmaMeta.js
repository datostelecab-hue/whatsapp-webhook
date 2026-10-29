// ============================================================
// FIRMA DEL WEBHOOK DE META (X-Hub-Signature-256)
// ============================================================
// Meta firma CADA POST del webhook con HMAC-SHA256 del CUERPO CRUDO, con el App
// Secret de la app de Meta como clave, y lo manda en la cabecera
// `X-Hub-Signature-256: sha256=<hex>`.
//
// POR QUÉ IMPORTA AQUÍ: el webhook (`routes/botPuertas.js`, POST `/`) está
// expuesto a internet (la URL de Render) y el bot hace acciones FÍSICAS según el
// teléfono del remitente —desbloquear el motor, abrir puertas, cerrar turnos,
// dar códigos de lavado—. Sin comprobar la firma, cualquiera que alcance la URL
// puede inyectar mensajes falsos y mover el bot. El único filtro anterior
// (`deOtroNumero`) mira un dato del propio payload, que el atacante controla: no
// es autenticación.
//
// EL SECRETO va en `META_APP_SECRET` (entorno de Render). En developers.facebook.com
// → tu app → Configuración → Básica → «Clave secreta de la aplicación». NUNCA en
// el código.
//
// EL CUERPO CRUDO lo guarda el parser JSON en `req.rawBody` (app.js:
// `express.json({ verify })`). Hace falta el crudo: si se recalcula desde
// `JSON.stringify(req.body)` la firma no casa (espacios, orden de claves, UTF-8).

const crypto = require('crypto');

const secreto = () => process.env.META_APP_SECRET || '';

/** ¿Hay App Secret configurado? Si no, el que llama decide (procesar en local, rechazar en producción). */
const configurada = () => !!secreto();

/** Compara dos hex del MISMO largo en tiempo constante. Distinto largo = no casa, sin filtrar por qué. */
function igualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * ¿La firma del POST casa con el cuerpo crudo y el App Secret?
 * Devuelve { ok, motivo }. `motivo` solo para el log, nunca se filtra al cliente.
 */
function comprobar(req) {
  const sec = secreto();
  if (!sec) return { ok: false, motivo: 'sin-secreto' };

  const cabecera = String(req.get('x-hub-signature-256') || '').trim();
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(cabecera);
  if (!m) return { ok: false, motivo: 'sin-firma-o-mal-formada' };

  const cuerpo = req.rawBody;
  if (!cuerpo || !cuerpo.length) return { ok: false, motivo: 'sin-cuerpo-crudo' };

  const esperado = crypto.createHmac('sha256', sec).update(cuerpo).digest('hex');
  return igualHex(m[1].toLowerCase(), esperado)
    ? { ok: true }
    : { ok: false, motivo: 'firma-no-casa' };
}

module.exports = { configurada, comprobar };
