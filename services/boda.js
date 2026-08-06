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

const { readSheet, writeSheet, appendRows } = require('./sheets');

const TOKEN = process.env.WHATSAPP_TOKEN || '';
const VERSION = 'v25.0';
const PHONE_NUMBER_ID = '1146890328517605';                       // número de la BODA
const SHEET_ID = '1fS7AoZRl08hxAzlwVqbLOj2jT7znAJuJMyy93zXqPA8';  // lista de invitados
const HOJA = { ind: '1 (Si o Si)', par: '1+1 (Si o SI)', indTest: 'TEST 1', parTest: 'TEST 1+1', ofi: 'Lista Oficial' };

// Columnas (letra) para escribir respuestas / marca de envío.
const COL = { IND_RTA: 'D', IND_ENVIADO: 'E', PAR_RTA_T: 'F', PAR_RTA_MAS: 'G', PAR_ENVIADO: 'H' };

// Idioma de las plantillas. Se auto-corrige en el primer envío (es / es_AR / es_ES…).
let IDIOMA_OK = (process.env.BODA_IDIOMA || 'es').trim();

// ── Textos de las respuestas ────────────────────────────────────────────────
const IND = {
  A: '¡Genial! Qué bueno que nos vas a poder acompañar en este día tan especial 🥳\n¡Te esperamos!\n\nIgna y Cruz',
  B: 'No te preocupes, más adelante nos podés confirmar.\n¡Ojalá puedas acompañarnos! 🙏\n\nIgna y Cruz',
  C: 'Lamentamos que no puedas ser parte, te agradecemos igualmente 💛\n¡Saludos!\n\nIgna y Cruz'
};
const PAR = {
  A: '¡Genial! Qué bueno que nos puedan acompañar en este día tan especial 🥳\n¡Los esperamos!\n\nIgna y Cruz',
  C: 'Qué pena que no nos puedan acompañar. ¡Muchas gracias por su respuesta! 💛\n\nIgna y Cruz',
  FIN: '¡Muchas gracias por tu respuesta! 🙏\n\nIgna y Cruz'
};
const FALLBACK = n => `Hola${n ? ' ' + n : ''} 👋 Soy solo un asistente virtual y no puedo leerte. ` +
  `Para confirmar tu asistencia usá por favor los botones del mensaje de la invitación ` +
  `(Sí / Tal vez / No). ¡Muchas gracias!\n\nIgna y Cruz`;

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
const enviarTexto = (to, texto) => enviarWA({ to: soloDigitos(to), type: 'text', text: { body: texto } });
const enviarInteractivo = (to, texto, botones) => enviarWA({
  to: soloDigitos(to), type: 'interactive',
  interactive: { type: 'button', body: { text: texto }, action: { buttons: botones.map(b => ({ type: 'reply', reply: b })) } }
});

// Envía la plantilla probando variantes de idioma hasta acertar, y recuerda la buena.
// params: array posicional para {{1}}, {{2}}…
async function enviarPlantilla(to, plantilla, params) {
  const cuerpo = code => ({
    to: soloDigitos(to), type: 'template',
    template: { name: plantilla, language: { code }, components: [{ type: 'body', parameters: params.map(t => ({ type: 'text', text: (t || '').toString() })) }] }
  });
  const orden = [IDIOMA_OK, 'es', 'es_AR', 'es_ES', 'es_LA'].filter((v, i, a) => v && a.indexOf(v) === i);
  let ultimo;
  for (const code of orden) {
    const r = await enviarWA(cuerpo(code));
    if (r.ok) { IDIOMA_OK = code; return r; }
    ultimo = r;
    // Si el fallo NO es de idioma/plantilla, no tiene sentido seguir probando.
    if (!/language|translat|does not exist|template name|plantilla/i.test(r.error || '')) break;
  }
  return ultimo;
}

// ── Lectura de la lista y localización del invitado por teléfono ─────────────
// Busca en las hojas reales Y en las de prueba; recuerda en qué hoja está para
// escribir la respuesta en el sitio correcto.
async function buscarInvitado(telefono) {
  const k = clave(telefono);
  if (!k) return null;

  for (const hoja of [HOJA.ind, HOJA.indTest]) {
    const rows = await readSheet(SHEET_ID, `'${hoja}'!A:E`).catch(() => []);
    for (let i = 1; i < rows.length; i++) {
      const f = rows[i] || [];
      if (clave(f[1]) === k) return { tipo: 'individual', hoja, fila: i + 1, apodo: (f[2] || f[0] || '').toString().trim(), nombre: f[0] };
    }
  }
  for (const hoja of [HOJA.par, HOJA.parTest]) {
    const rows = await readSheet(SHEET_ID, `'${hoja}'!A:H`).catch(() => []);
    for (let i = 1; i < rows.length; i++) {
      const f = rows[i] || [];
      if (clave(f[2]) === k) return {
        tipo: 'pareja', hoja, fila: i + 1,
        apodoT: (f[3] || f[0] || '').toString().trim(), apodoP: (f[4] || f[1] || '').toString().trim(),
        nombreT: f[0], nombreP: f[1]
      };
    }
  }
  return null;
}

async function guardarRta(inv, quien, valor) {
  if (inv.tipo === 'individual') return writeSheet(SHEET_ID, `'${inv.hoja}'!${COL.IND_RTA}${inv.fila}`, [[valor]]);
  const col = quien === 'titular' ? COL.PAR_RTA_T : COL.PAR_RTA_MAS;
  return writeSheet(SHEET_ID, `'${inv.hoja}'!${col}${inv.fila}`, [[valor]]);
}

// ── Clasificación del botón de la plantilla (por su texto) ───────────────────
// Los A/B/C llegan como type:'button' con button.text = el texto del botón.
function clasificar(caption) {
  const s = (caption || '').toString().toLowerCase();
  if (/cuenten con ?migo|cont[aá] con nosotros|cuenten conmigo/.test(s)) return 'A';
  if (/todav[ií]a no puedo|no podemos confi/.test(s)) return 'B';
  if (/no voy a poder|no podremos acompa/.test(s)) return 'C';
  return null;
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
  const op = clasificar(cap);

  if (inv.tipo === 'individual') {
    if (op === 'A') { await guardarRta(inv, 'titular', 'Sí'); await enviarTexto(from, IND.A); }
    else if (op === 'B') { await guardarRta(inv, 'titular', 'Tal vez'); await enviarTexto(from, IND.B); }
    else if (op === 'C') { await guardarRta(inv, 'titular', 'No'); await enviarTexto(from, IND.C); }
    else await enviarTexto(from, FALLBACK(inv.apodo));
    return;
  }
  // pareja
  if (op === 'A') { await guardarRta(inv, 'titular', 'Sí'); await guardarRta(inv, 'mas', 'Sí'); await enviarTexto(from, PAR.A); }
  else if (op === 'C') { await guardarRta(inv, 'titular', 'No'); await guardarRta(inv, 'mas', 'No'); await enviarTexto(from, PAR.C); }
  else if (op === 'B') {   // confirmar uno a uno
    estados.set(clave(from), { step: 'titular', inv });
    await enviarInteractivo(from, `¿${inv.apodoT || 'el/la titular'} podrá asistir?`, BOTONES_SN);
  } else await enviarTexto(from, FALLBACK(inv.apodoT));
}

async function onBotonInteractivo(from, id) {
  const st = estados.get(clave(from));
  if (!st) { await enviarTexto(from, FALLBACK('')); return; }   // sin contexto: fallback
  const valor = VALOR_BOTON[id] || 'Tal vez';
  if (st.step === 'titular') {
    await guardarRta(st.inv, 'titular', valor);
    st.step = 'mas'; estados.set(clave(from), st);
    await enviarInteractivo(from, `¿Y ${st.inv.apodoP || 'su acompañante'}?`, BOTONES_SN);
  } else {
    await guardarRta(st.inv, 'mas', valor);
    estados.delete(clave(from));
    await enviarTexto(from, PAR.FIN);
  }
}

async function onTexto(from, _text) {
  const st = estados.get(clave(from));
  if (st) {   // está a mitad del sub-flujo: reencaminar a los botones
    const quien = st.step === 'titular' ? st.inv.apodoT : st.inv.apodoP;
    await enviarInteractivo(from, `Por favor, usá los botones 🙏\n¿${quien || 'esa persona'} podrá asistir?`, BOTONES_SN);
    return;
  }
  const inv = await buscarInvitado(from);
  await enviarTexto(from, FALLBACK(inv ? (inv.apodo || inv.apodoT) : ''));
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
        cola.push({ hoja: hInd, fila: i + 1, tel, plantilla: 'plantilla_1', params: [(f[2] || f[0] || '').toString().trim()], envCol: COL.IND_ENVIADO });
      }
    }
    if (tipo === 'pareja' || tipo === 'todos') {
      const rows = await readSheet(SHEET_ID, `'${hPar}'!A:H`);
      for (let i = 1; i < rows.length; i++) {
        const f = rows[i] || [];
        const tel = soloDigitos(f[2]);
        if (!tel) continue;
        if (!reenviar && (f[7] || '').toString().trim()) { progreso.saltados++; continue; }
        cola.push({ hoja: hPar, fila: i + 1, tel, plantilla: 'plantilla_1_1_2', params: [(f[3] || f[0] || '').toString().trim(), (f[4] || f[1] || '').toString().trim()], envCol: COL.PAR_ENVIADO });
      }
    }
    const lote = limite ? cola.slice(0, limite) : cola;
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

module.exports = { PHONE_NUMBER_ID, manejarMensaje, enviarInvitaciones, estadoResumen, progresoActual, enviando, agregarInvitado, opcionesLista };
