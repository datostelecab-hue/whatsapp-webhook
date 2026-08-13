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

// Meta responde #132001 "Template name does not exist in the translation" cuando la
// plantilla SÍ existe y está aprobada, pero NO en el idioma que se le pide: al crearla
// se elige "Español" (es) o "Español (España)" (es_ES) y no son intercambiables. En vez
// de tener que acertar a mano, se prueban los códigos habituales y se recuerda el que
// funcionó para cada plantilla (así solo se tantea en el primer envío).
const IDIOMAS = ['es', 'es_ES', 'es_MX', 'es_AR'];
const idiomaOk = new Map();   // plantilla → código de idioma que aceptó Meta
const esErrorDeIdioma = e => /132001|does not exist in the translation|translation|language/i.test(e || '');

/** Envío de plantilla con reintento por idioma. `components` ya montado. */
async function enviarTemplate(telefono, plantilla, components) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };
  const memo = idiomaOk.get(plantilla);
  const codigos = memo ? [memo, ...IDIOMAS.filter(c => c !== memo)] : IDIOMAS;

  let ultimo = { ok: false, error: 'sin intentos' };
  for (const code of codigos) {
    const payload = {
      messaging_product: 'whatsapp', to, type: 'template',
      template: { name: plantilla, language: { code }, components }
    };
    try {
      const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await r.json();
      if (d.messages && d.messages[0] && d.messages[0].id) {
        if (memo !== code) { idiomaOk.set(plantilla, code); console.log(`📩 [WA] Plantilla "${plantilla}" enviada en idioma ${code}`); }
        return { ok: true, id: d.messages[0].id, idioma: code };
      }
      ultimo = { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
      // Solo reintentar si el fallo es DE IDIOMA: cualquier otro error (parámetros,
      // número, límite de conversaciones) daría igual con otro código y gastaría envíos.
      if (!esErrorDeIdioma(ultimo.error)) return ultimo;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  return ultimo;
}

/**
 * Envía una plantilla con UN parámetro de cuerpo llamado "nombre" (el saludo).
 * Nota: el parámetro va como NOMBRADO ('nombre'), igual que "atencion_hora". Si al
 * crear la plantilla en Meta la variable quedó como {{1}} (posicional), habría que
 * quitar `parameter_name`. Devuelve { ok, id } o { ok:false, error }.
 */
function enviarPlantillaNombre(telefono, plantilla, nombre) {
  return enviarTemplate(telefono, plantilla, [{
    type: 'body',
    parameters: [{ type: 'text', parameter_name: 'nombre', text: nombre || '' }]
  }]);
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
function enviarPlantillaPosicional(telefono, plantilla, valores) {
  // Una plantilla SIN variables no lleva componente de cuerpo: mandarlo vacío da error.
  const params = (valores || []).map(t => ({ type: 'text', text: (t == null ? '' : String(t)) }));
  return enviarTemplate(telefono, plantilla, params.length ? [{ type: 'body', parameters: params }] : []);
}

// Aviso de turnos: plantilla con BOTÓN de respuesta rápida. El mensaje solo avisa de que
// los turnos ya están; el detalle ordenado se manda en TEXTO LIBRE cuando el conductor
// pulsa el botón (lo maneja el webhook de botPuertas). Sustituye a la antigua
// "turnosdeconductores", que metía todo el plan en una variable y se veía fatal.
//
// El nombre debe coincidir EXACTAMENTE con el de Meta o responde #132001. Se puede
// cambiar sin tocar código con la variable PLANTILLA_TURNOS.
const PLANTILLA_TURNOS = (process.env.PLANTILLA_TURNOS || 'detalle_turnos').trim();

// Si la plantilla NO tiene variables, mandarle un parámetro da error de nº de
// parámetros; en ese caso se reintenta SIN cuerpo y se recuerda. Un fallo de
// parámetros no llega a enviar mensaje, así que reintentar no duplica.
let _turnosSinVars = false;
async function enviarAvisoTurnos(telefono, nombre) {
  if (_turnosSinVars) return enviarPlantillaPosicional(telefono, PLANTILLA_TURNOS, []);
  const r = await enviarPlantillaPosicional(telefono, PLANTILLA_TURNOS, [nombre || '']);
  if (r.ok || !/132000|number of parameters|param/i.test(r.error || '')) return r;
  const r2 = await enviarPlantillaPosicional(telefono, PLANTILLA_TURNOS, []);
  if (r2.ok) { _turnosSinVars = true; console.log(`📩 [WA] "${PLANTILLA_TURNOS}" no lleva variables: se envía sin parámetros`); }
  return r2.ok ? r2 : r;
}

/**
 * Lista las plantillas de la cuenta con su NOMBRE, IDIOMA y ESTADO exactos. Es lo que
 * responde de verdad a "¿por qué no sale mi plantilla?": casi siempre el nombre o el
 * idioma no son los que creemos. Descubre la cuenta (WABA) a partir del propio token;
 * se puede fijar con WHATSAPP_WABA_ID para ahorrarse el descubrimiento.
 */
// WABA "Telecab" (portfolio "Datos telecab"), la que contiene nuestras plantillas y los
// dos números. Se deja fijo como el PHONE_NUMBER_ID; WHATSAPP_WABA_ID lo puede cambiar.
const WABA_TELECAB = '1352445060168316';
let _waba = (process.env.WHATSAPP_WABA_ID || '').trim() || WABA_TELECAB;
async function descubrirWaba() {
  if (_waba) return _waba;
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`);
    const d = await r.json();
    for (const s of (d.data && d.data.granular_scopes) || []) {
      for (const t of (s.target_ids || [])) {
        // Nos quedamos con el primero que sepa listar plantillas.
        const rr = await fetch(`https://graph.facebook.com/${VERSION}/${t}/message_templates?limit=1&access_token=${encodeURIComponent(TOKEN)}`);
        const dd = await rr.json();
        if (dd && dd.data) { _waba = t; return _waba; }
      }
    }
  } catch (e) { /* sin WABA: se informa arriba */ }
  return _waba;
}

async function listarPlantillas(nombre) {
  const waba = await descubrirWaba();
  if (!waba) return { ok: false, error: 'No se pudo determinar la cuenta de WhatsApp (WABA) desde el token. Puedes fijarla en la variable WHATSAPP_WABA_ID.' };
  const url = `https://graph.facebook.com/${VERSION}/${waba}/message_templates?limit=200` +
    (nombre ? `&name=${encodeURIComponent(nombre)}` : '') + `&access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.error) return { ok: false, waba, error: d.error.message };
  const plantillas = (d.data || []).map(t => ({
    nombre: t.name, idioma: t.language, estado: t.status,
    categoria: t.category, formato: t.parameter_format || null,
    variables: ((t.components || []).find(c => (c.type || '').toUpperCase() === 'BODY')?.text || '')
      .match(/\{\{\s*[^}]+?\s*\}\}/g) || [],
    botones: ((t.components || []).find(c => (c.type || '').toUpperCase() === 'BUTTONS')?.buttons || []).map(b => b.text)
  })).sort((a, b) => a.nombre.localeCompare(b.nombre));
  return { ok: true, waba, total: plantillas.length, idiomaUsado: Object.fromEntries(idiomaOk), plantillas };
}

/**
 * Estado de la cuenta: qué WABA usamos, QUÉ EMPRESA la posee y si esa empresa está
 * verificada, más la calidad y el escalón de mensajes del número. Sirve para el caso
 * típico de "mi empresa está verificada pero WhatsApp me sigue limitando": suele ser
 * que el WABA cuelga de OTRO portfolio distinto del verificado.
 */
async function estadoCuenta() {
  const out = { phone_number_id: PHONE_NUMBER_ID };
  const g = async (ruta, campos) => {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${ruta}?fields=${encodeURIComponent(campos)}&access_token=${encodeURIComponent(TOKEN)}`);
    return r.json();
  };
  try {
    // Calidad y escalón actual del número que envía.
    const n = await g(PHONE_NUMBER_ID, 'display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,status');
    out.numero = n.error ? { error: n.error.message } : n;
  } catch (e) { out.numero = { error: e.message }; }

  try {
    const waba = await descubrirWaba();
    out.waba = waba || null;
    if (waba) {
      const w = await g(waba, 'id,name,account_review_status,owner_business_info,on_behalf_of_business_info');
      out.cuenta = w.error ? { error: w.error.message } : w;
      const negocio = (w.owner_business_info && w.owner_business_info.id) || (w.on_behalf_of_business_info && w.on_behalf_of_business_info.id);
      if (negocio) {
        const b = await g(negocio, 'id,name,verification_status');
        out.empresaPropietaria = b.error ? { error: b.error.message } : b;
      }
    }
  } catch (e) { out.errorWaba = e.message; }

  // Traducción de lo importante a lenguaje llano.
  const v = out.empresaPropietaria && out.empresaPropietaria.verification_status;
  out.resumen = {
    escalon: (out.numero && out.numero.messaging_limit_tier) || '(desconocido)',
    calidad: (out.numero && out.numero.quality_rating) || '(desconocida)',
    empresaQuePoseeElWhatsApp: (out.empresaPropietaria && out.empresaPropietaria.name) || '(desconocida)',
    empresaVerificada: v === 'verified' ? 'sí' : (v || '(desconocido)')
  };
  return out;
}

/** Mensaje de texto suelto (dentro de la ventana de 24 h). */
async function enviarTexto(telefono, texto) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto } })
    });
    const d = await r.json();
    if (d.messages && d.messages[0]) return { ok: true, id: d.messages[0].id };
    return { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
  } catch (e) { return { ok: false, error: e.message }; }
}

/**
 * Mensaje con botones de respuesta rápida. `botones` = [{ id, titulo }] (máx. 3, y
 * WhatsApp corta los títulos a 20 caracteres).
 */
async function enviarBotones(telefono, texto, botones) {
  const to = limpiarTelefono(telefono);
  if (!to) return { ok: false, error: 'sin teléfono' };
  const payload = {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: texto },
      action: { buttons: (botones || []).slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: String(b.titulo).slice(0, 20) } })) }
    }
  };
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json();
    if (d.messages && d.messages[0]) return { ok: true, id: d.messages[0].id };
    return { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { enviarAtencionHora, enviarBallenoil, enviarPlantillaNombre, enviarPlantillaPosicional, enviarAvisoTurnos, enviarTexto, enviarBotones, listarPlantillas, estadoCuenta, limpiarTelefono, PLANTILLA_TURNOS };
