// ============================================================
// BODA — RSVP por WhatsApp (Igna y Cruz · 19/12/2026)
// ============================================================
// Favor aparte, DENTRO del mismo app de WhatsApp de Telecab (mismo token) pero con
// OTRO número. El webhook es el mismo para todos los números del app, así que en
// routes/botPuertas.js se enruta por phone_number_id: lo que llega al número de la
// boda entra aquí y el bot de Telecab queda intacto.
//
// Plantillas aprobadas (botones Quick reply A/B/C):
//   · plantilla_1     → invitado individual. Saluda {{1}} = apodo.
//   · plantilla_1_1_2 → pareja a UN solo número. Saluda {{1}} y {{2}} (los dos apodos).
//
// Lista en Google Sheets (la cuenta de servicio es editora). Pestañas:
//   · "1 (Si o Si)"  : Nombre Titular | Telefono Titular | Apodo | Rta Titular  [+ E: Enviado]
//   · "1+1 (Si o SI)": Nombre Titular | Nombre &+1 | Telefono Titular | Apodo Titular |
//                      Apodo &+1 | Rta Titular | Rta &+1  [+ H: Enviado]
//   · "TEST 1" / "TEST 1+1": mismas columnas, para ensayar sin tocar la lista real.
//
// Los textos de respuesta están aquí (fáciles de editar).

const { readSheet, writeSheet, writeSheetRaw, appendRows, ensureSheet, clearSheet } = require('./sheets');

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const VERSION = 'v25.0';
const PHONE_NUMBER_ID = '1146890328517605';                       // número de la BODA
const SHEET_ID = '1fS7AoZRl08hxAzlwVqbLOj2jT7znAJuJMyy93zXqPA8';  // lista de invitados
const HOJA = { ind: '1 (Si o Si)', par: '1+1 (Si o SI)', indTest: 'TEST 1', parTest: 'TEST 1+1', ofi: 'Lista Oficial' };
const HOJA_MENSAJES = 'MENSAJES';   // texto libre que escribe la gente (lo que NO es un botón)
// Plantillas aprobadas en Meta.
const PLANTILLA = { ind: 'plantilla_1_corr', par: 'plantilla_1_1_2' };

// Columnas (letra) para escribir respuestas / marca de envío.
const COL = { IND_RTA: 'D', IND_ENVIADO: 'E', PAR_RTA_T: 'F', PAR_RTA_MAS: 'G', PAR_ENVIADO: 'H' };

// Idioma de las plantillas. Se auto-corrige en el primer envío (es / es_AR / es_ES…).
let IDIOMA_OK = (process.env.BODA_IDIOMA || 'es').trim();

// Las plantillas llevan ENCABEZADO DE IMAGEN (la foto del portón). Meta obliga a mandar
// esa imagen en CADA envío. Se resuelve por orden:
//   1) BODA_IMAGEN_ID   → media id ya subido a WhatsApp.
//   2) BODA_IMAGEN_URL  → URL pública directa.
//   3) La propia app en Render: RENDER_EXTERNAL_URL/assets/<BODA_IMAGEN_FILE> (por defecto
//      boda.jpg; /assets se sirve en abierto, así que WhatsApp puede descargarla).
const IMG_ID = (process.env.BODA_IMAGEN_ID || '').trim();
const IMG_FILE = (process.env.BODA_IMAGEN_FILE || 'boda.jpeg').trim();
let IMG_URL = (process.env.BODA_IMAGEN_URL || '').trim();
if (!IMG_URL && !IMG_ID && process.env.RENDER_EXTERNAL_URL) {
  IMG_URL = process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '') + '/assets/' + IMG_FILE;
}
const tieneImagen = () => !!(IMG_URL || IMG_ID);
const imgParam = () => ({ type: 'image', image: IMG_ID ? { id: IMG_ID } : { link: IMG_URL } });
const imagenActual = () => IMG_ID ? ('id:' + IMG_ID) : (IMG_URL || '(sin imagen configurada)');

// ── Textos de las respuestas ────────────────────────────────────────────────
const IND = {
  A: '¡Genial! Qué bueno que nos vas a poder acompañar en este día tan especial 🥳\n¡Te esperamos!\n\nIgna y Cruz',
  B: 'No te preocupes, más adelante nos podés confirmar.\n¡Ojalá puedas acompañarnos! 🙏\n\nIgna y Cruz',
  C: 'Lamentamos que no puedas ser parte, te agradecemos igualmente 💛\n¡Saludos!\n\nIgna y Cruz'
};
const firma = '\n\nIgna y Cruz';
const PAR = {
  A: '¡Genial! Qué bueno que nos puedan acompañar en este día tan especial 🥳\n¡Los esperamos!' + firma,
  C: 'Qué pena que no nos puedan acompañar. ¡Muchas gracias por su respuesta! 💛' + firma
};
const FALLBACK = n => `Hola${n ? ' ' + n : ''} 👋 Soy solo un asistente virtual y no puedo leerte. ` +
  `Para confirmar tu asistencia usá por favor los botones del mensaje de la invitación ` +
  `(Sí / Tal vez / No). ¡Muchas gracias!` + firma;

// ── Sub-flujo de pareja (botón "No podemos confirmar"): se pregunta UNO POR UNO y el
//    cierre REFLEJA lo que contestaron (para que no salgan respuestas genéricas raras). ──
const preguntaAsiste = quien => `¿${quien || 'esa persona'} podrá asistir? 🙂`;
const bridgePareja = quienSigue => `¡Gracias! ¿Y ${quienSigue || 'su acompañante'}? 🙂`;
const unir = arr => (arr.length === 2 ? `${arr[0]} y ${arr[1]}` : arr[0]);
function cierrePareja(apT, rT, apP, rP) {
  const si = [], tv = [], no = [];
  [[apT || 'el/la titular', rT], [apP || 'su acompañante', rP]].forEach(([ap, r]) => {
    if (r === 'Sí') si.push(ap); else if (r === 'Tal vez') tv.push(ap); else no.push(ap);
  });
  const p = [];
  if (si.length === 2) p.push(`¡Genial, los esperamos a ${unir(si)}! 🥳`);
  else if (si.length === 1) p.push(`¡Genial, contamos con ${si[0]}! 🥳`);
  if (tv.length) p.push(`${unir(tv)} nos lo confirma${tv.length === 2 ? 'n' : ''} más adelante 🙏`);
  if (no.length === 2 && !si.length && !tv.length) p.push('Qué pena que no puedan acompañarnos 💛');
  else if (no.length) p.push(`Una pena que ${unir(no)} no pueda${no.length === 2 ? 'n' : ''} 💛`);
  return p.join('\n') + '\n\n¡Muchas gracias por avisar!' + firma;
}

// ── Respuestas al TEXTO LIBRE según la etapa (además, el mensaje se guarda aparte). ──
const MSG = {
  fin: ap => `¡Hola${ap ? ' ' + ap : ''}! 🤖 Soy un asistente automático y no leo los mensajes. Ya tenemos tu respuesta anotada, ¡gracias! Cualquier duda, escribile directamente a Igna y Cruz 💛`,
  pendiente: ap => `¡Hola${ap ? ' ' + ap : ''}! 🤖 Soy un asistente automático. Para confirmar tu asistencia tocá por favor uno de los botones del mensaje de la invitación (Sí / Tal vez / No). ¡Gracias! 🙏`,
  desconocido: () => `¡Hola! 🤖 Soy el asistente automático de la boda de Igna y Cruz. No puedo leer los mensajes; para cualquier cosa, escribiles directamente a ellos. ¡Gracias! 💛`
};

// Cuando alguien CAMBIA una respuesta que ya había dado (ej. tocó "Sí" y luego "No").
const actualizada = (ap, valor) => `¡Listo${ap ? ' ' + ap : ''}! Cambiamos tu respuesta a *${valor}* ✅\nQueda registrada la nueva. ¡Gracias! 🙏${firma}`;
const NOTA_ACT = '✅ Cambiamos tu respuesta anterior por esta nueva.\n\n';

// Botones interactivos del sub-flujo de parejas.
const BOTONES_SN = [
  { id: 'boda_si', title: 'Sí' },
  { id: 'boda_talvez', title: 'Tal vez' },
  { id: 'boda_no', title: 'No' }
];
const VALOR_BOTON = { boda_si: 'Sí', boda_talvez: 'Tal vez', boda_no: 'No' };

// Estado en memoria del sub-flujo de parejas (botón B). Efímero: una charla dura
// segundos; si el server reinicia a mitad, el invitado solo vuelve a tocar el botón.
const estados = new Map();   // telClave → { step:'titular'|'mas', inv }

// Progreso del envío masivo (para la barra del panel). Vive en memoria.
let progreso = { activo: false, tipo: null, test: false, total: 0, enviados: 0, saltados: 0, errores: 0, iniciado: null, fin: null, detalle: [] };
const progresoActual = () => ({ ...progreso, detalle: progreso.detalle.slice(-12) });
const enviando = () => progreso.activo;

// ── Utilidades de teléfono ──────────────────────────────────────────────────
const soloDigitos = t => (t || '').toString().replace(/\D/g, '');
// Clave de cruce entre el teléfono del sheet y el `from` de WhatsApp. Quita el
// prefijo de país (34 ES / 54 AR) y el "9" de móvil argentino (que WhatsApp a veces
// entrega y a veces no), con guardas de longitud para no romper números nacionales
// (p.ej. el área argentina 342, que empieza por "34" pero NO es España).
function clave(t) {
  let d = soloDigitos(t);
  if (d.startsWith('00')) d = d.slice(2);                         // 00 + país
  if (d.startsWith('34') && d.length === 11) return d.slice(2);   // España: 34 + 9
  if (d.startsWith('549') && d.length === 13) return d.slice(3);  // Argentina móvil: 549 + 10
  if (d.startsWith('54') && d.length === 12) return d.slice(2);   // Argentina sin 9: 54 + 10
  return d.length > 10 ? d.slice(-10) : d;                        // ya nacional u otro
}

// Normaliza un teléfono para ENVIAR (WhatsApp exige el prefijo de país, sin signos).
// Repara el caso típico del listado: móvil argentino sin el "54" (queda "9"+10 dígitos).
function normalizarEnvio(t) {
  let d = soloDigitos(t);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('9')) d = '54' + d;        // 9 + 10 nacional AR → +54
  return d;
}

// ── Envío por la Cloud API (SIEMPRE desde el número de la boda) ──────────────
async function enviarWA(payload) {
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...payload })
    });
    const d = await r.json();
    if (d.messages && d.messages[0] && d.messages[0].id) return { ok: true, id: d.messages[0].id };
    return { ok: false, error: (d.error && d.error.message) || JSON.stringify(d) };
  } catch (e) { return { ok: false, error: e.message }; }
}
const enviarTexto = (to, texto) => enviarWA({ to: normalizarEnvio(to), type: 'text', text: { body: texto } });
const enviarInteractivo = (to, texto, botones) => enviarWA({
  to: normalizarEnvio(to), type: 'interactive',
  interactive: { type: 'button', body: { text: texto }, action: { buttons: botones.map(b => ({ type: 'reply', reply: b })) } }
});

// ── Definición real de la plantilla (para armar los parámetros como toca) ────
// Meta acepta parámetros POSICIONALES ({{1}}) o CON NOMBRE ({{nombre}}); mandar el
// formato equivocado da el error #132012. En vez de adivinar, leemos la plantilla
// desde la Graph API y construimos los parámetros según su formato real e idioma.
let WABA_ID = (process.env.BODA_WABA_ID || '').trim() || null;
let debugWaba = null;              // rastro del descubrimiento (para el diagnóstico)
const defsPlantilla = new Map();   // nombre → { formato, nombres, idioma }

let wabaBuscado = false;   // ya se intentó descubrir (no re-tantear en cada envío)

// Reúne WABAs candidatos del token: por granular_scopes y, si no, por los negocios del usuario.
async function candidatosWaba() {
  const ids = new Set();
  if (WABA_ID) ids.add(WABA_ID);
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/debug_token?input_token=${encodeURIComponent(TOKEN)}&access_token=${encodeURIComponent(TOKEN)}`);
    const d = await r.json();
    debugWaba = { app_id: d.data && d.data.app_id, scopes: (d.data && d.data.granular_scopes) || null, error: d.error ? d.error.message : null };
    for (const s of (d.data && d.data.granular_scopes) || []) for (const t of (s.target_ids || [])) ids.add(t);
  } catch (e) { debugWaba = { error: e.message }; }
  try {
    const rb = await fetch(`https://graph.facebook.com/${VERSION}/me/businesses?access_token=${encodeURIComponent(TOKEN)}`);
    const db = await rb.json();
    if (db.error && debugWaba) debugWaba.errorNegocios = db.error.message;
    for (const b of (db.data || [])) {
      for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
        try {
          const rw = await fetch(`https://graph.facebook.com/${VERSION}/${b.id}/${edge}?access_token=${encodeURIComponent(TOKEN)}`);
          const dw = await rw.json();
          for (const w of (dw.data || [])) if (w.id) ids.add(w.id);
        } catch (_) { }
      }
    }
  } catch (_) { }
  return [...ids];
}

// Descubre el WABA que contiene nuestras plantillas (probando cada candidato).
async function descubrirWaba() {
  if (WABA_ID) return WABA_ID;
  if (wabaBuscado) return null;
  wabaBuscado = true;
  const cands = await candidatosWaba();
  if (debugWaba) debugWaba.candidatos = cands;
  for (const w of cands) {
    try {
      const r = await fetch(`https://graph.facebook.com/${VERSION}/${w}/message_templates?name=plantilla_1&access_token=${encodeURIComponent(TOKEN)}`);
      const d = await r.json();
      if ((d.data || []).length) { WABA_ID = w; break; }
    } catch (_) { }
  }
  if (!WABA_ID && cands.length === 1) WABA_ID = cands[0];
  return WABA_ID;
}

// Lee (y cachea) el formato de parámetros y el idioma de una plantilla aprobada.
async function definicionPlantilla(nombre) {
  if (defsPlantilla.has(nombre)) return defsPlantilla.get(nombre);
  const waba = await descubrirWaba();
  if (!waba) return null;
  try {
    const r = await fetch(`https://graph.facebook.com/${VERSION}/${waba}/message_templates?name=${encodeURIComponent(nombre)}&access_token=${encodeURIComponent(TOKEN)}`);
    const d = await r.json();
    const t = (d.data || []).find(x => x.name === nombre) || (d.data || [])[0];
    if (!t) return null;
    const body = (t.components || []).find(c => (c.type || '').toUpperCase() === 'BODY');
    let nombres = [];
    if (body && body.example && body.example.body_text_named_params) nombres = body.example.body_text_named_params.map(p => p.param_name);
    if (!nombres.length && body && body.text) {
      const toks = (body.text.match(/\{\{\s*([^}]+?)\s*\}\}/g) || []).map(x => x.replace(/[{}]/g, '').trim());
      nombres = toks.filter(x => !/^\d+$/.test(x));   // solo los que NO son números
    }
    const formato = (t.parameter_format || (nombres.length ? 'NAMED' : 'POSITIONAL')).toUpperCase();
    const def = {
      formato, nombres, idioma: t.language || IDIOMA_OK,
      // Estructura cruda (para el diagnóstico): tipo de cada componente, texto y ejemplo.
      componentes: (t.components || []).map(c => ({ type: c.type, format: c.format, text: c.text, example: c.example }))
    };
    defsPlantilla.set(nombre, def);
    console.log(`💍 [BODA] Plantilla ${nombre}: formato ${def.formato}, idioma ${def.idioma}${def.nombres.length ? ', vars ' + def.nombres.join('/') : ''}`);
    return def;
  } catch (e) { console.error(`⚠️ [BODA] No pude leer la plantilla ${nombre}:`, e.message); return null; }
}

// Construcción de los parámetros (valores en orden {{1}}, {{2}}…).
const paramsPosicional = valores => valores.map(t => ({ type: 'text', text: (t || '').toString() }));
const paramsConNombre = (valores, nombres) => valores.map((t, i) => ({ type: 'text', parameter_name: nombres[i] || String(i + 1), text: (t || '').toString() }));

// Componentes EXACTOS según la definición real de la plantilla: coloca las variables
// donde de verdad están (HEADER o BODY) y en el formato correcto (con nombre o posicional).
// Devuelve null si no se pudo leer la definición.
function componentesDesdeDef(def, valores) {
  if (!def || !Array.isArray(def.componentes)) return null;
  const out = []; let idx = 0;
  for (const c of def.componentes) {
    const tipo = (c.type || '').toUpperCase();
    if (tipo !== 'BODY' && tipo !== 'HEADER') continue;
    // Encabezado de imagen (media): se manda la imagen, no texto.
    if (tipo === 'HEADER' && (c.format || '').toUpperCase() === 'IMAGE') {
      if (tieneImagen()) out.push({ type: 'header', parameters: [imgParam()] });
      continue;
    }
    const toks = (c.text || '').match(/\{\{\s*[^}]+?\s*\}\}/g) || [];
    if (!toks.length) continue;
    const nombres = toks.map(x => x.replace(/[{}]/g, '').trim());
    const named = def.formato === 'NAMED' || nombres.some(n => !/^\d+$/.test(n));
    out.push({
      type: tipo.toLowerCase(),
      parameters: nombres.map(n => {
        const val = (valores[idx++] || '').toString();
        return named ? { type: 'text', parameter_name: n, text: val } : { type: 'text', text: val };
      })
    });
  }
  return out.length ? out : null;
}

// Estrategias de envío (constructores de componentes), de más a menos probable. La 1ª es
// la EXACTA (según Meta); el resto cubre por fuerza bruta que no se pudiera leer la
// definición: cuerpo/encabezado × posicional/con-nombre "1","2".
function estrategiasEnvio(def) {
  const num = v => v.map((_, i) => String(i + 1));
  const bodyPos = v => ({ type: 'body', parameters: paramsPosicional(v) });
  const bodyNum = v => ({ type: 'body', parameters: paramsConNombre(v, num(v)) });
  const estr = [{ label: 'def', fn: v => componentesDesdeDef(def, v) }];
  // Estas plantillas llevan ENCABEZADO DE IMAGEN + cuerpo posicional {{1}}[,{{2}}]. Hay que
  // mandar la imagen (imgParam) en cada envío; sin ella Meta rechaza con #132012.
  if (tieneImagen()) {
    estr.push(
      { label: 'img+body-pos', fn: v => [{ type: 'header', parameters: [imgParam()] }, bodyPos(v)] },
      { label: 'img+body-num', fn: v => [{ type: 'header', parameters: [imgParam()] }, bodyNum(v)] }
    );
  }
  // Respaldos (por si alguna plantilla no llevara imagen).
  estr.push(
    { label: 'body-pos', fn: v => [bodyPos(v)] },
    { label: 'body-num', fn: v => [bodyNum(v)] }
  );
  return estr;
}

// Recuerda la estrategia que funcionó (para no re-tantear en los 249 envíos).
const estrategiaMemo = new Map();   // plantilla → label

// Envía la plantilla acertando la estructura SÍ o SÍ. Prueba la estructura EXACTA de Meta
// y, si no, cuerpo/encabezado en ambos formatos. Un fallo de estructura (#132012) NO manda
// mensaje, así que probar otra estrategia nunca duplica. valores = APODOS en orden.
async function enviarPlantilla(to, plantilla, valores) {
  const def = await definicionPlantilla(plantilla).catch(() => null);
  let estr = estrategiasEnvio(def);
  const memo = estrategiaMemo.get(plantilla);
  if (memo) estr = [...estr.filter(e => e.label === memo), ...estr.filter(e => e.label !== memo)];

  const idiomas = [(def && def.idioma) || IDIOMA_OK, 'es', 'es_AR', 'es_ES', 'es_LA'].filter((v, i, a) => v && a.indexOf(v) === i);
  let ultimo;
  for (const e of estr) {
    const comps = e.fn(valores);
    if (!comps || !comps.length) continue;
    for (const code of idiomas) {
      const r = await enviarWA({ to: normalizarEnvio(to), type: 'template', template: { name: plantilla, language: { code }, components: comps } });
      if (r.ok) { IDIOMA_OK = code; estrategiaMemo.set(plantilla, e.label); return r; }
      ultimo = r;
      const err = r.error || '';
      if (/132012|parameter format|number of param|expected|component/i.test(err)) break;   // estructura mala → siguiente
      if (!/language|translat|does not exist|template name/i.test(err)) return r;            // error no recuperable
      // fallo de idioma → siguiente idioma, misma estrategia
    }
  }
  return ultimo;
}

// Diagnóstico para el panel: qué WABA y qué formato/idioma ve de cada plantilla.
async function diagnostico() {
  const waba = await descubrirWaba();
  const [p1, p112] = await Promise.all([definicionPlantilla(PLANTILLA.ind), definicionPlantilla(PLANTILLA.par)]);
  return { waba: waba || null, imagen: imagenActual(), debug: debugWaba, individual: p1, pareja: p112 };
}

// Prueba de envío con TRAZA completa: intenta cada estrategia (cuerpo/encabezado,
// posicional/con-nombre, cada idioma) y registra qué respondió Meta en cada una. Para
// en el primer ÉXITO (para no mandar duplicados: las que fallan no llegan a enviar).
async function probarEnvio(telefono, plantilla, valores) {
  const def = await definicionPlantilla(plantilla).catch(() => null);
  const estr = estrategiasEnvio(def);
  const idiomas = [(def && def.idioma) || IDIOMA_OK, 'es', 'es_AR', 'es_ES', 'es_LA'].filter((v, i, a) => v && a.indexOf(v) === i);
  const to = normalizarEnvio(telefono);
  const traza = [];
  let exito = null;
  for (const e of estr) {
    const comps = e.fn(valores);
    if (!comps || !comps.length) { traza.push({ estrategia: e.label, saltada: 'sin componentes (falta definición/WABA)' }); continue; }
    const intentos = [];
    let ok = false;
    for (const code of idiomas) {
      const r = await enviarWA({ to, type: 'template', template: { name: plantilla, language: { code }, components: comps } });
      intentos.push({ idioma: code, ok: r.ok, id: r.id || null, error: r.error || null });
      if (r.ok) { ok = true; exito = { estrategia: e.label, idioma: code, id: r.id }; estrategiaMemo.set(plantilla, e.label); IDIOMA_OK = code; break; }
      if (!/language|translat|does not exist|template name/i.test(r.error || '')) break;   // no es de idioma → no probar más idiomas
    }
    traza.push({ estrategia: e.label, componentes: comps, intentos });
    if (ok) break;
  }
  return { plantilla, to, def, exito, traza };
}

// Ejecuta la prueba completa contra los números de las hojas TEST (un individual y una
// pareja) y devuelve toda la traza. Solo manda mensaje real en la estrategia que acierta.
async function probarCompleto() {
  const [t1, t11] = await Promise.all([
    readSheet(SHEET_ID, `'${HOJA.indTest}'!A:E`).catch(() => []),
    readSheet(SHEET_ID, `'${HOJA.parTest}'!A:H`).catch(() => [])
  ]);
  const fi = t1[1] || [], fp = t11[1] || [];
  const out = { waba: await descubrirWaba(), imagen: imagenActual(), debug: debugWaba };
  out.individual = fi[1]
    ? await probarEnvio(fi[1], PLANTILLA.ind, [(fi[2] || fi[0] || 'Prueba').toString()])
    : { error: 'Sin número en TEST 1 (fila 2, col B)' };
  out.pareja = fp[2]
    ? await probarEnvio(fp[2], PLANTILLA.par, [(fp[3] || fp[0] || 'Prueba').toString(), (fp[4] || fp[1] || 'Prueba').toString()])
    : { error: 'Sin número en TEST 1+1 (fila 2, col C)' };
  return out;
}

// ── Lectura de la lista y localización del invitado por teléfono ─────────────
// Busca en las hojas reales Y en las de prueba; recuerda en qué hoja está para
// escribir la respuesta en el sitio correcto.
let _simTipo = null;   // en simulación fuerza qué lista buscar primero (las hojas TEST comparten números)

async function buscarInvitado(telefono) {
  const k = clave(telefono);
  if (!k) return null;

  const buscarInd = async () => {
    for (const hoja of [HOJA.ind, HOJA.indTest]) {
      const rows = await readSheet(SHEET_ID, `'${hoja}'!A:E`).catch(() => []);
      for (let i = 1; i < rows.length; i++) {
        const f = rows[i] || [];
        if (clave(f[1]) === k) return { tipo: 'individual', hoja, fila: i + 1, apodo: (f[2] || f[0] || '').toString().trim(), nombre: f[0], rta: (f[3] || '').toString().trim() };
      }
    }
    return null;
  };
  const buscarPar = async () => {
    for (const hoja of [HOJA.par, HOJA.parTest]) {
      const rows = await readSheet(SHEET_ID, `'${hoja}'!A:H`).catch(() => []);
      for (let i = 1; i < rows.length; i++) {
        const f = rows[i] || [];
        if (clave(f[2]) === k) return {
          tipo: 'pareja', hoja, fila: i + 1,
          apodoT: (f[3] || f[0] || '').toString().trim(), apodoP: (f[4] || f[1] || '').toString().trim(),
          nombreT: f[0], nombreP: f[1],
          rtaT: (f[5] || '').toString().trim(), rtaP: (f[6] || '').toString().trim()
        };
      }
    }
    return null;
  };
  // Normalmente individual primero; en simulación de pareja se invierte.
  const [a, b] = _simTipo === 'pareja' ? [buscarPar, buscarInd] : [buscarInd, buscarPar];
  return (await a()) || (await b());
}

async function guardarRta(inv, quien, valor) {
  if (inv.tipo === 'individual') return writeSheet(SHEET_ID, `'${inv.hoja}'!${COL.IND_RTA}${inv.fila}`, [[valor]]);
  const col = quien === 'titular' ? COL.PAR_RTA_T : COL.PAR_RTA_MAS;
  return writeSheet(SHEET_ID, `'${inv.hoja}'!${col}${inv.fila}`, [[valor]]);
}

// Guarda el TEXTO LIBRE (lo que NO es un botón) en la hoja MENSAJES, para revisarlo aparte.
let _mensajesListo = false;
async function ensureMensajes() {
  if (_mensajesListo) return;
  await ensureSheet(SHEET_ID, HOJA_MENSAJES);
  const filas = await readSheet(SHEET_ID, `'${HOJA_MENSAJES}'!A1:F1`).catch(() => []);
  if (!filas.length || !(filas[0] || []).length) {
    await writeSheetRaw(SHEET_ID, `'${HOJA_MENSAJES}'!A1`, [['FECHA', 'TELEFONO', 'NOMBRE', 'TIPO', 'ETAPA', 'MENSAJE']]);
  }
  _mensajesListo = true;
}
async function guardarMensajeLibre(from, inv, texto, etapa) {
  try {
    await ensureMensajes();
    const nombre = inv ? (inv.nombre || inv.nombreT || inv.apodo || inv.apodoT || '') : '';
    await appendRows(SHEET_ID, `'${HOJA_MENSAJES}'!A:F`, [[selloAhora(), soloDigitos(from), nombre, inv ? inv.tipo : '', etapa, (texto || '').slice(0, 500)]]);
  } catch (e) { console.warn('⚠️ [BODA] no pude guardar el mensaje libre:', e.message); }
}

// ── Clasificación del botón de la plantilla (por su texto), según el TIPO ─────
// A/B/C significan cosas distintas en individual (Sí / Tal vez / No) y en pareja (ambos
// sí / confirmar uno por uno / ambos no). Los textos pueden variar entre versiones de la
// plantilla, así que es tolerante (sin acentos, por palabras clave y con orden cuidado).
function clasificar(caption, tipo) {
  const n = (caption || '').toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (tipo === 'pareja') {
    if (/conta con nosotros|cuenten con nosotros|vamos los dos|asistimos|si,? vamos/.test(n)) return 'A';
    // OJO: B ("No podemos/podremos CONFIRMAR" → preguntar uno por uno) va ANTES que C, porque
    // ambos botones empiezan casi igual ("no pod…"); lo que los distingue es "confirmar" (B)
    // frente a "acompañar" (C). Si se comprueba C primero, "no podremos confirmar" cae mal en C.
    if (/confi|uno por uno|no estamos segur|tal vez|quiza/.test(n)) return 'B';
    if (/acompan|no podremos|no podemos|no vamos a poder|no asistir|no iremos/.test(n)) return 'C';
    if (/\bno\b/.test(n)) return 'B';   // último recurso → sub-flujo (nunca respuesta inmediata rara)
    return 'A';
  }
  // individual (Sí / Tal vez / No). Ojo al orden: "tal vez" puede contener "no lo sé".
  if (/tal vez|talvez|todav|quiza|mas adelante|aun no|no lo se|no se|no estoy segur|pendiente/.test(n)) return 'B';
  if (/\bno\b/.test(n)) return 'C';     // "no voy a poder", "no podre", "no puedo"…
  return 'A';                            // por defecto: confirmación (Sí)
}

// ============================================================
// WEBHOOK — mensaje entrante al número de la boda
// ============================================================
async function manejarMensaje(message /*, value */) {
  const from = message.from;
  try {
    if (message.type === 'button') {                        // botón de PLANTILLA (A/B/C)
      const cap = (message.button && (message.button.text || message.button.payload) || '').trim();
      console.log(`💍 [BODA] Botón plantilla "${cap}" de ${from}`);
      await onBotonPlantilla(from, cap);
    } else if (message.type === 'interactive' && message.interactive && message.interactive.type === 'button_reply') {
      const id = message.interactive.button_reply.id;        // sub-flujo (Sí/Tal vez/No)
      console.log(`💍 [BODA] Botón interactivo "${id}" de ${from}`);
      await onBotonInteractivo(from, id);
    } else {                                                 // texto libre
      console.log(`💍 [BODA] Texto de ${from}`);
      await onTexto(from, (message.text && message.text.body || '').trim());
    }
  } catch (e) {
    console.error('❌ [BODA] Error manejando mensaje:', e.message);
  }
}

async function onBotonPlantilla(from, cap) {
  const inv = await buscarInvitado(from);
  if (!inv) { await enviarTexto(from, FALLBACK('')); return; }
  const op = clasificar(cap, inv.tipo);

  if (inv.tipo === 'individual') {
    const valor = op === 'A' ? 'Sí' : op === 'B' ? 'Tal vez' : op === 'C' ? 'No' : null;
    if (!valor) { await enviarTexto(from, FALLBACK(inv.apodo)); return; }
    const cambio = inv.rta && inv.rta !== valor;            // ya había respondido algo distinto
    await guardarRta(inv, 'titular', valor);
    await enviarTexto(from, cambio ? actualizada(inv.apodo, valor)
      : (valor === 'Sí' ? IND.A : valor === 'Tal vez' ? IND.B : IND.C));
    return;
  }
  // pareja
  const pre = yaRespondio(inv) ? NOTA_ACT : '';   // ¿ya habían respondido? → avisar que se cambia
  if (op === 'A') { await guardarRta(inv, 'titular', 'Sí'); await guardarRta(inv, 'mas', 'Sí'); await enviarTexto(from, pre + PAR.A); }
  else if (op === 'C') { await guardarRta(inv, 'titular', 'No'); await guardarRta(inv, 'mas', 'No'); await enviarTexto(from, pre + PAR.C); }
  else if (op === 'B') {   // confirmamos uno por uno (un solo mensaje por vez)
    estados.set(clave(from), { step: 'titular', inv, previo: yaRespondio(inv) });
    await enviarInteractivo(from, `Sin problema, confirmemos uno por uno 🙂\n${preguntaAsiste(inv.apodoT)}`, BOTONES_SN);
  } else await enviarTexto(from, FALLBACK(inv.apodoT));
}

async function onBotonInteractivo(from, id) {
  const st = estados.get(clave(from));
  if (!st) { await enviarTexto(from, FALLBACK('')); return; }   // sin contexto: fallback
  const valor = VALOR_BOTON[id] || 'Tal vez';
  if (st.step === 'titular') {
    await guardarRta(st.inv, 'titular', valor);
    st.rtaT = valor; st.step = 'mas'; estados.set(clave(from), st);   // guardamos la 1ª rta para el cierre
    await enviarInteractivo(from, bridgePareja(st.inv.apodoP), BOTONES_SN);
  } else {
    await guardarRta(st.inv, 'mas', valor);
    estados.delete(clave(from));
    const pre = st.previo ? NOTA_ACT : '';
    // Cierre NATURAL que refleja lo que contestaron (no un genérico).
    await enviarTexto(from, pre + cierrePareja(st.inv.apodoT, st.rtaT, st.inv.apodoP, valor));
  }
}

const yaRespondio = inv => inv && (inv.tipo === 'individual' ? !!inv.rta : !!(inv.rtaT || inv.rtaP));

async function onTexto(from, texto) {
  const st = estados.get(clave(from));
  if (st) {   // en mitad del sub-flujo: reencaminar a los botones (no cuenta como mensaje suelto)
    const quien = st.step === 'titular' ? st.inv.apodoT : st.inv.apodoP;
    await enviarInteractivo(from, `Por favor, respondé con los botones 🙏\n${preguntaAsiste(quien)}`, BOTONES_SN);
    return;
  }
  const inv = await buscarInvitado(from);
  const etapa = inv ? (yaRespondio(inv) ? 'fin' : 'pendiente') : 'desconocido';
  await guardarMensajeLibre(from, inv, texto, etapa);   // se guarda SIEMPRE en la hoja MENSAJES
  const ap = inv ? (inv.apodo || inv.apodoT || '') : '';
  if (etapa === 'fin') await enviarTexto(from, MSG.fin(ap));
  else if (etapa === 'pendiente') await enviarTexto(from, MSG.pendiente(ap));
  else await enviarTexto(from, MSG.desconocido());
}

// ============================================================
// ENVÍO MASIVO DE INVITACIONES
// ============================================================
const sleep = ms => new Promise(r => setTimeout(r, ms));
const selloAhora = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
}).format(new Date());

// opciones: { tipo:'individual'|'pareja'|'todos', test, pausaMs, limite, reenviar }
async function enviarInvitaciones(opciones = {}) {
  if (progreso.activo) throw new Error('Ya hay un envío en marcha');
  const tipo = opciones.tipo || 'todos';
  const test = opciones.test === true;
  const pausaMs = Math.max(300, Number(opciones.pausaMs) || 1200);   // ~50/min
  const limite = Number(opciones.limite) || 0;                        // 0 = sin límite
  const reenviar = opciones.reenviar === true;
  const hInd = test ? HOJA.indTest : HOJA.ind;
  const hPar = test ? HOJA.parTest : HOJA.par;

  progreso = { activo: true, tipo, test, total: 0, enviados: 0, saltados: 0, errores: 0, iniciado: selloAhora(), fin: null, detalle: [] };

  try {
    // 1) Recolectar destinatarios (respetando "ya enviado" salvo reenviar).
    const cola = [];
    if (tipo === 'individual' || tipo === 'todos') {
      const rows = await readSheet(SHEET_ID, `'${hInd}'!A:E`);
      for (let i = 1; i < rows.length; i++) {
        const f = rows[i] || [];
        const tel = soloDigitos(f[1]);
        if (!tel) continue;
        if (!reenviar && (f[4] || '').toString().trim()) { progreso.saltados++; continue; }
        cola.push({ hoja: hInd, fila: i + 1, tel, plantilla: PLANTILLA.ind, params: [(f[2] || f[0] || '').toString().trim()], envCol: COL.IND_ENVIADO });
      }
    }
    if (tipo === 'pareja' || tipo === 'todos') {
      const rows = await readSheet(SHEET_ID, `'${hPar}'!A:H`);
      for (let i = 1; i < rows.length; i++) {
        const f = rows[i] || [];
        const tel = soloDigitos(f[2]);
        if (!tel) continue;
        if (!reenviar && (f[7] || '').toString().trim()) { progreso.saltados++; continue; }
        cola.push({ hoja: hPar, fila: i + 1, tel, plantilla: PLANTILLA.par, params: [(f[3] || f[0] || '').toString().trim(), (f[4] || f[1] || '').toString().trim()], envCol: COL.PAR_ENVIADO });
      }
    }
    // Quita duplicados por teléfono (el mismo número en varias filas → un solo mensaje).
    const vistas = new Set(), dedup = [];
    for (const d of cola) { const k = clave(d.tel); if (vistas.has(k)) { progreso.saltados++; continue; } vistas.add(k); dedup.push(d); }
    const lote = limite ? dedup.slice(0, limite) : dedup;
    progreso.total = lote.length;

    // 2) Enviar en serie, marcando "Enviado" y actualizando el progreso.
    for (const d of lote) {
      const r = await enviarPlantilla(d.tel, d.plantilla, d.params);
      if (r.ok) {
        progreso.enviados++;
        await writeSheet(SHEET_ID, `'${d.hoja}'!${d.envCol}${d.fila}`, [[selloAhora()]]).catch(() => {});
      } else {
        progreso.errores++;
        progreso.detalle.push(`${d.tel}: ${r.error}`);
      }
      await sleep(pausaMs);
    }
  } finally {
    progreso.activo = false;
    progreso.fin = selloAhora();
  }
  console.log(`💍 [BODA] Envío ${tipo}${test ? ' (PRUEBA)' : ''}: ${progreso.enviados} enviados, ${progreso.errores} errores, ${progreso.saltados} saltados`);
  return progresoActual();
}

// Resumen de estado (enviados / respondidos) para el panel.
async function estadoResumen() {
  const [ind, par] = await Promise.all([
    readSheet(SHEET_ID, `'${HOJA.ind}'!A:E`).catch(() => []),
    readSheet(SHEET_ID, `'${HOJA.par}'!A:H`).catch(() => [])
  ]);
  const contar = (rows, telIdx, rtaIdxs, envIdx) => {
    let con = 0, enviados = 0, respondidos = 0;
    for (let i = 1; i < rows.length; i++) {
      const f = rows[i] || [];
      if (!soloDigitos(f[telIdx])) continue;
      con++;
      if ((f[envIdx] || '').toString().trim()) enviados++;
      if (rtaIdxs.some(x => (f[x] || '').toString().trim())) respondidos++;
    }
    return { total: con, enviados, respondidos };
  };
  return {
    individual: contar(ind, 1, [3], 4),
    pareja: contar(par, 2, [5, 6], 7),
    idioma: IDIOMA_OK
  };
}

// ============================================================
// ALTA DE INVITADOS (desde el panel)
// ============================================================
// Escribe en DOS sitios:
//   1) la lista de ENVÍO ("1 (Si o Si)" o "1+1 (Si o SI)") → así recibe la
//      invitación en el próximo envío y su respuesta se guarda sola.
//   2) "Lista Oficial" (maestra) → con prioridad, grupo, edad, quién invita…
// Lista Oficial: A=C/I | B=Nombre | C=Apellido | D=IG | E=Telefono | F=Save the date |
//                G=Edad | H=Prioridad | I=Lista | J=() | K=Grupo | L=Adjunto | M=Tel | N=Asistira

const txt = v => (v == null ? '' : v).toString().trim();

// ¿Ese teléfono ya está en alguna lista de envío? (evita invitar dos veces)
async function telefonoYaEnLista(tel) {
  const k = clave(tel);
  if (!k) return null;
  const ind = await readSheet(SHEET_ID, `'${HOJA.ind}'!A:B`).catch(() => []);
  for (let i = 1; i < ind.length; i++) if (clave((ind[i] || [])[1]) === k) return { hoja: HOJA.ind, fila: i + 1 };
  const par = await readSheet(SHEET_ID, `'${HOJA.par}'!A:C`).catch(() => []);
  for (let i = 1; i < par.length; i++) if (clave((par[i] || [])[2]) === k) return { hoja: HOJA.par, fila: i + 1 };
  return null;
}

// Fila para "Lista Oficial" (14 columnas A:N).
function filaOficial(d, nombre, tel, ig) {
  return [
    txt(d.quienInvita), nombre, txt(d.apellido), txt(ig !== undefined ? ig : d.ig),
    txt(tel), '', txt(d.edad), txt(d.prioridad), txt(d.lista), '', txt(d.grupo), '', '', ''
  ];
}

// d: { tipo, quienInvita, nombre, apellido, apodo, ig, telefono, edad, prioridad,
//      lista, grupo, nombre2, apodo2, ig2 }
async function agregarInvitado(d = {}) {
  const tipo = d.tipo === 'pareja' ? 'pareja' : 'individual';
  const tel = txt(d.telefono);
  if (soloDigitos(tel).length < 8) throw new Error('Teléfono no válido (incluye el prefijo de país, ej. 54 9 351…)');
  const nombre = txt(d.nombre);
  if (!nombre) throw new Error('Falta el nombre del titular');
  const apodo = txt(d.apodo) || nombre.split(/\s+/)[0];

  const dup = await telefonoYaEnLista(tel);
  if (dup) throw new Error(`Ese teléfono ya está en "${dup.hoja}" (fila ${dup.fila})`);

  let aviso = null;
  if (tipo === 'individual') {
    // 1) Lista de envío (A=Nombre, B=Telefono, C=Apodo; D/E quedan vacías).
    await appendRows(SHEET_ID, `'${HOJA.ind}'!A:E`, [[nombre, tel, apodo]]);
    // 2) Lista Oficial (mejor esfuerzo: si falla, la invitación ya está asegurada).
    try { await appendRows(SHEET_ID, `'${HOJA.ofi}'!A:N`, [filaOficial(d, nombre, tel)]); }
    catch (e) { aviso = 'Añadido a la lista de envío, pero no pude escribir en Lista Oficial: ' + e.message; }
    console.log(`💍 [BODA] Alta individual: ${nombre} (${tel})`);
    return { tipo, nombre, apodo, tel, aviso };
  }
  // pareja
  const nombre2 = txt(d.nombre2);
  if (!nombre2) throw new Error('Falta el nombre del acompañante (+1)');
  const apodo2 = txt(d.apodo2) || nombre2.split(/\s+/)[0];
  await appendRows(SHEET_ID, `'${HOJA.par}'!A:H`, [[nombre, nombre2, tel, apodo, apodo2]]);
  try {
    await appendRows(SHEET_ID, `'${HOJA.ofi}'!A:N`, [
      filaOficial(d, nombre, tel),
      filaOficial(d, nombre2, '', d.ig2)   // el +1 comparte teléfono con el titular
    ]);
  } catch (e) { aviso = 'Añadida la pareja a la lista de envío, pero no pude escribir en Lista Oficial: ' + e.message; }
  console.log(`💍 [BODA] Alta pareja: ${nombre} & ${nombre2} (${tel})`);
  return { tipo, nombre, apodo, nombre2, apodo2, tel, aviso };
}

// Valores existentes para los desplegables del formulario (de Lista Oficial).
async function opcionesLista() {
  const rows = await readSheet(SHEET_ID, `'${HOJA.ofi}'!A:K`).catch(() => []);
  const set = idx => {
    const s = new Set();
    for (let i = 1; i < rows.length; i++) { const v = txt((rows[i] || [])[idx]); if (v) s.add(v); }
    return [...s].sort((a, b) => a.localeCompare(b));
  };
  return { invita: set(0), edad: set(6), prioridad: set(7), lista: set(8), grupo: set(10) };
}

// ============================================================
// SIMULACIÓN DEL FLUJO DE RESPUESTA (para probar sin teléfono)
// ============================================================
// Inyecta toques de botón / texto por el MISMO código que una persona real
// (manejarMensaje), usando el primer número de las hojas TEST, y devuelve cómo
// quedó guardada la respuesta en la hoja. También manda los WhatsApp de respuesta
// al número de prueba (para ver la experiencia completa).
async function simular(escenario) {
  const esPareja = escenario.startsWith('pareja');
  const hoja = esPareja ? HOJA.parTest : HOJA.indTest;
  const telIdx = esPareja ? 2 : 1;
  const rows = await readSheet(SHEET_ID, `'${hoja}'!A:H`).catch(() => []);
  const fila = rows[1] || [];                       // primera fila de datos de la hoja TEST
  const from = soloDigitos(fila[telIdx]);
  if (!from) throw new Error(`No hay número de prueba en "${hoja}" (fila 2)`);

  const boton = texto => ({ from, type: 'button', button: { text: texto, payload: texto } });
  const inter = id => ({ from, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id } } });
  const texto = body => ({ from, type: 'text', text: { body } });

  const GUION = {
    'individual-si': [boton('¡Cuenten con migo!')],
    'individual-talvez': [boton('Todavia no puedo confirmar')],
    'individual-no': [boton('No voy a poder acompañarlos')],
    'individual-texto': [texto('Hola, ¿puedo llevar acompañante?')],
    'pareja-si': [boton('¡Conta con nosotros!')],
    'pareja-no': [boton('No podremos acompañarlos')],
    'pareja-parcial': [boton('No podemos confimar...'), inter('boda_si'), inter('boda_no')],
    'pareja-texto': [texto('Hola, una consulta')]
  };
  const guion = GUION[escenario];
  if (!guion) throw new Error('Escenario desconocido: ' + escenario);

  _simTipo = esPareja ? 'pareja' : 'individual';
  try {
    for (const msg of guion) await manejarMensaje(msg);
  } finally { _simTipo = null; }

  // Releer la fila para mostrar cómo quedó guardada la respuesta.
  const rows2 = await readSheet(SHEET_ID, `'${hoja}'!A:H`).catch(() => []);
  const f2 = rows2[1] || [];
  const guardado = esPareja
    ? { titular: (f2[3] || f2[0] || '').toString().trim(), rtaTitular: (f2[5] || '').toString().trim(), acompanante: (f2[4] || f2[1] || '').toString().trim(), rtaAcompanante: (f2[6] || '').toString().trim() }
    : { invitado: (f2[2] || f2[0] || '').toString().trim(), rta: (f2[3] || '').toString().trim() };
  return { escenario, hoja, from, pasos: guion.length, guardado };
}

// Borra las respuestas Y las marcas de envío de las hojas TEST, para empezar una prueba
// desde cero (así el bot no cree que "ya respondió" por pruebas anteriores).
async function reiniciarPruebas() {
  await clearSheet(SHEET_ID, `'${HOJA.indTest}'!D2:E`).catch(() => { });   // TEST 1: Rta + Enviado
  await clearSheet(SHEET_ID, `'${HOJA.parTest}'!F2:H`).catch(() => { });   // TEST 1+1: Rta T + Rta +1 + Enviado
  console.log('💍 [BODA] Respuestas de prueba reiniciadas (TEST 1 y TEST 1+1)');
  return { ok: true };
}

module.exports = { PHONE_NUMBER_ID, manejarMensaje, enviarInvitaciones, estadoResumen, progresoActual, enviando, agregarInvitado, opcionesLista, diagnostico, probarCompleto, simular, reiniciarPruebas };
