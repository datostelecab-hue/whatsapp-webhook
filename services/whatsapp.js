// ============================================================
// WHATSAPP: envío de plantillas (Cloud API de Meta)
// ============================================================
// Mismo número/token que usa botPuertas. El token es permanente (System User).

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const PHONE_NUMBER_ID = '1256923474160518';
const VERSION = 'v25.0';

/** Deja el teléfono en solo dígitos (34XXXXXXXXX). Si viene con 9 dígitos (sin
 *  prefijo, como en la agenda), le añade el 34 de España: WhatsApp lo exige. */
function limpiarTelefono(t) {
  let n = (t || '').toString().replace(/[\s+\-()]/g, '');
  if (n.length === 9) n = '34' + n;
  return n;
}

/**
 * Envía una plantilla con UN parámetro de cuerpo llamado "nombre" (el saludo).
 * Nota: el parámetro va como NOMBRADO ('nombre'), igual que "atencion_hora". Si al
 * crear la plantilla en Meta la variable quedó como {{1}} (posicional), habría que
 * quitar `parameter_name`. Devuelve { ok, id } o { ok:false, error }.
 */
async function enviarPlantillaNombre(telefono, plantilla, nombre) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: plantilla,
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

// Plantilla de aviso de horas (ya existente).
const enviarAtencionHora = (telefono, nombre) => enviarPlantillaNombre(telefono, 'atencion_hora', nombre);

// Bienvenida de Ballenoil: saluda por su nombre y trae el botón "VER PIN BALLENOIL"
// (el bot entrega el PIN de su ficha al pulsarlo).
const enviarBallenoil = (telefono, nombre) => enviarPlantillaNombre(telefono, 'ballenoil', nombre);

/**
 * Envía una plantilla con parámetros de cuerpo POSICIONALES ({{1}}, {{2}}…), es decir
 * SIN parameter_name (a diferencia de enviarPlantillaNombre). Devuelve { ok, id } o
 * { ok:false, error }.
 */
async function enviarPlantillaPosicional(telefono, plantilla, valores) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };
  const payload = {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {
      name: plantilla, language: { code: 'es' },
      components: [{ type: 'body', parameters: (valores || []).map(t => ({ type: 'text', text: (t == null ? '' : String(t)) })) }]
    }
  };
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.messages && d.messages[0] && d.messages[0].id) return { ok: true, id: d.messages[0].id };
    return { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Plantilla de turnos de la semana: {{1}} = nombre, {{2}} = plan del conductor. Meta a
// veces rechaza los saltos de línea en los parámetros; si pasa, se reintenta APLANADO y,
// una vez detectado, se aplana ya siempre (para no gastar dos envíos por conductor).
let _turnosPlano = false;
const aplanarPlan = p => (p || '').replace(/\n+/g, '  ·  ').replace(/[\t ]{4,}/g, '   ');
async function enviarTurnosSemana(telefono, nombre, plan) {
  const mandar = txt => enviarPlantillaPosicional(telefono, 'turnosdeconductores', [nombre || '', txt]);
  const r = await mandar(_turnosPlano ? aplanarPlan(plan) : plan);
  if (r.ok || _turnosPlano || !/\n/.test(plan || '')) return r;
  // Falló y el plan tenía saltos de línea: reintenta APLANADO. Solo si el aplanado funciona
  // se asume que era por los saltos y se aplana ya siempre (si no, se devuelve el error real).
  const r2 = await mandar(aplanarPlan(plan));
  if (r2.ok) { _turnosPlano = true; return r2; }
  return r;
}

module.exports = { enviarAtencionHora, enviarBallenoil, enviarPlantillaNombre, enviarPlantillaPosicional, enviarTurnosSemana, limpiarTelefono };
