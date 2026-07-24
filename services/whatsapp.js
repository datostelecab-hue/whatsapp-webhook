// ============================================================
// WHATSAPP: envío de plantillas (Cloud API de Meta)
// ============================================================
// Mismo número/token que usa botPuertas. El token es permanente (System User).

const TOKEN = 'EAAZBBQk7ZCDvkBR0jkEmoVjGn07x2OdgQzjtIWAZAlSJrFnsexsfZC7NqaKcKN1F3HBGxGw4eLOUQd0kqZCbRW3hMr3ZCYZBFJy94oxL0Pn9DBV092umEPhdgJ9HW4eV2Vh7CxhJJGHZCrBNbpRWSQ9whmqLKtVpAZBnx3Hdv8h3wuICs86P11R8w5ZA7Y2CgaITa0XgZDZD';
const PHONE_NUMBER_ID = '1256923474160518';
const VERSION = 'v25.0';

/** Deja el teléfono en solo dígitos (34XXXXXXXXX). */
function limpiarTelefono(t) {
  return (t || '').toString().replace(/[\s+\-()]/g, '');
}

/**
 * Envía la plantilla "atencion_hora" (un parámetro de cuerpo: el nombre).
 * Devuelve { ok, id } o { ok:false, error }.
 */
async function enviarAtencionHora(telefono, nombre) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: 'atencion_hora',
      language: { code: 'es' },
      components: [{
        type: 'body',
        parameters: [{ type: 'text', parameter_name: 'nombre', text: nombre || '' }]
      }]
    }
  };

  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.messages && d.messages[0] && d.messages[0].id) return { ok: true, id: d.messages[0].id };
    return { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { enviarAtencionHora, limpiarTelefono };
