// ============================================================
// CREAR LAS PLANTILLAS DE WHATSAPP Y MANDARLAS A REVISIÓN
// ============================================================
//   node scripts/crear-plantillas-whatsapp.js --ver     qué hay y qué se mandaría
//   node scripts/crear-plantillas-whatsapp.js --go      las manda a revisión
//   node scripts/crear-plantillas-whatsapp.js --go alerta_control    solo una
//
// Teclear una plantilla en el formulario de Meta es donde se cometen los errores
// que luego cuestan un rechazo y otra espera: una variable pegada a otra, un
// ejemplo que falta, el cuerpo empezando por {{1}}. Aquí el texto es el mismo
// que está escrito en docs/PLANTILLAS-WHATSAPP.md y se manda tal cual por la API.
//
// NO BORRA NI MODIFICA NADA. Si una plantilla ya existe con ese nombre, se salta
// y lo dice: cambiar una aprobada es otra operación y se hace a conciencia.
//
// Necesita WHATSAPP_TOKEN. La cuenta (WABA) se toma de WHATSAPP_WABA_ID o del
// valor fijo que ya usa services/whatsapp.js.

const TOKEN = (process.env.WHATSAPP_TOKEN || '').trim();
const WABA = (process.env.WHATSAPP_WABA_ID || '1352445060168316').trim();
const VERSION = 'v25.0';
const IDIOMA = 'es';

// ── LAS PLANTILLAS ──────────────────────────────────────────────────────────
// Las cuatro comparten las MISMAS cuatro variables y en el mismo orden, que es
// el que arma `mandar()` en services/repo/alertasControl.js:
//   {{1}} conductor · {{2}} teléfono · {{3}} horas de jornada · {{4}} el hecho
// Así se puede cambiar de la genérica a la de cada tipo sin tocar los parámetros.
const PIE = 'Telecab · Alertas de control';

const PLANTILLAS = [
  {
    name: 'alerta_control',
    para: 'La genérica: vale para los tres tipos. Es la que el código usa hoy.',
    header: 'Aviso de control',
    body:
      'Hay que llamar a un conductor.\n\n' +
      'Conductor: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Jornada acumulada: {{3}}\n\n' +
      'Motivo: {{4}}\n\n' +
      'Llámale y deja anotado en el panel qué te ha dicho.',
    ejemplos: ['Juan Antonio Vázquez Uscanga', '+34 600 11 22 33', '7 h 42 min',
      '3 viajes RECHAZADOS por él hoy (no se puede rechazar ningún viaje)'],
  },
  {
    name: 'alerta_rechazo_directo',
    para: 'Rechaza viajes con el dedo. Umbral 1: al primero se llama.',
    header: 'Viajes rechazados',
    body:
      'Un conductor está rechazando viajes. No se puede rechazar ninguno, así que toca llamarle.\n\n' +
      'Conductor: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Jornada acumulada: {{3}}\n' +
      'Rechazados hoy: {{4}}\n\n' +
      'Si tenía un motivo, déjalo anotado en el panel de alertas.',
    ejemplos: ['Juan Antonio Vázquez Uscanga', '+34 600 11 22 33', '7 h 42 min', '3 viajes'],
  },
  {
    name: 'alerta_sin_respuesta',
    para: 'Deja pasar ofertas sin contestar. Umbral 5. Se pregunta, no se acusa.',
    header: 'Viajes sin responder',
    body:
      'Un conductor está dejando pasar ofertas sin contestar. Puede ser cobertura o el móvil, ' +
      'así que pregúntale primero si necesita algo.\n\n' +
      'Conductor: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Jornada acumulada: {{3}}\n' +
      'Perdidos sin responder: {{4}}\n\n' +
      'Deja anotado en el panel qué te ha dicho.',
    ejemplos: ['Marian Nicolae Dan Voivozeanu', '+34 600 11 22 33', '5 h 10 min', '7 viajes'],
  },
  {
    name: 'alerta_km_parado',
    para: 'El coche rueda en descanso o desconectado. Umbral 20 km.',
    header: 'Coche rodando en descanso',
    body:
      'Un coche está haciendo kilómetros estando en descanso o con la aplicación desconectada.\n\n' +
      'Conductor: {{1}}\n' +
      'Teléfono: {{2}}\n' +
      'Jornada acumulada: {{3}}\n' +
      'Kilómetros: {{4}}\n\n' +
      'Llámale para saber quién lo lleva y anótalo en el panel.',
    ejemplos: ['Dylan Hernández García', '+34 600 11 22 33', '9 h 05 min', '24,6 km (franja 20:00-01:00)'],
  },
];

// ── LAS REGLAS DE META, COMPROBADAS AQUÍ ────────────────────────────────────
// Vale más fallar en este script que esperar un día a que Meta conteste que no.
function revisar(p) {
  const fallos = [];
  const cuerpo = p.body;
  const vars = [...cuerpo.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));

  if (!/^[a-z0-9_]+$/.test(p.name)) fallos.push('el nombre solo admite minúsculas, números y guion bajo');
  if (cuerpo.length > 1024) fallos.push(`el cuerpo pasa de 1024 caracteres (${cuerpo.length})`);
  if (/^\s*\{\{/.test(cuerpo)) fallos.push('el cuerpo EMPIEZA con una variable');
  if (/\}\}\s*$/.test(cuerpo)) fallos.push('el cuerpo TERMINA con una variable');
  if (/\}\}\s*\{\{/.test(cuerpo)) fallos.push('hay dos variables pegadas, sin texto entre medias');
  vars.forEach((n, i) => { if (n !== i + 1) fallos.push(`las variables no van seguidas desde 1 (aparece {{${n}}} en la posición ${i + 1})`); });
  if (vars.length !== p.ejemplos.length) fallos.push(`hay ${vars.length} variable(s) y ${p.ejemplos.length} ejemplo(s)`);
  if (p.ejemplos.some(e => !String(e).trim())) fallos.push('algún ejemplo está vacío');
  if (PIE.length > 60) fallos.push(`el pie pasa de 60 caracteres (${PIE.length})`);
  if (p.header && p.header.length > 60) fallos.push(`el encabezado pasa de 60 caracteres (${p.header.length})`);
  if (/\{\{/.test(p.header || '')) fallos.push('el encabezado lleva variables (aquí no las queremos)');
  return fallos;
}

/** El cuerpo JSON que espera la API de Meta. */
function componentes(p) {
  return [
    { type: 'HEADER', format: 'TEXT', text: p.header },
    { type: 'BODY', text: p.body, example: { body_text: [p.ejemplos] } },
    { type: 'FOOTER', text: PIE },
  ];
}

// ── LO QUE YA HAY EN LA CUENTA ──────────────────────────────────────────────
async function existentes() {
  const url = `https://graph.facebook.com/${VERSION}/${WABA}/message_templates` +
    `?limit=200&access_token=${encodeURIComponent(TOKEN)}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!d || !d.data) throw new Error((d && d.error && d.error.message) || 'no se pudo listar las plantillas');
  const m = new Map();
  for (const t of d.data) m.set(t.name, { idioma: t.language, estado: t.status, categoria: t.category });
  return m;
}

async function crear(p) {
  const r = await fetch(`https://graph.facebook.com/${VERSION}/${WABA}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: p.name,
      language: IDIOMA,
      category: 'UTILITY',
      components: componentes(p),
    }),
  });
  const d = await r.json();
  if (d && d.id) return { ok: true, id: d.id, estado: d.status || 'PENDING' };
  return { ok: false, error: (d && d.error && d.error.message) || JSON.stringify(d) };
}

// Requerir este fichero da las definiciones sin ejecutar nada: así las pruebas
// leen el texto de LA MISMA fuente que se manda a Meta, y no de una copia que se
// queda vieja el primer día que se corrija una coma.
module.exports = { PLANTILLAS, PIE, IDIOMA, revisar, componentes };

// ── ARRANQUE ────────────────────────────────────────────────────────────────
if (require.main !== module) return;

(async () => {
  const args = process.argv.slice(2);
  const go = args.includes('--go');
  const soloUna = args.find(a => !a.startsWith('--'));
  const lista = soloUna ? PLANTILLAS.filter(p => p.name === soloUna) : PLANTILLAS;

  if (soloUna && !lista.length) {
    console.error(`No conozco ninguna plantilla llamada "${soloUna}".`);
    console.error('Las que hay: ' + PLANTILLAS.map(p => p.name).join(', '));
    process.exit(1);
  }

  // Las reglas se comprueban SIEMPRE, se vaya a enviar o no.
  let malas = 0;
  for (const p of lista) {
    const fallos = revisar(p);
    if (fallos.length) { malas++; console.log(`\n  x ${p.name}`); fallos.forEach(f => console.log(`      · ${f}`)); }
  }
  if (malas) { console.log(`\n${malas} plantilla(s) incumplen las reglas de Meta. No se manda nada.`); process.exit(1); }
  console.log(`${lista.length} plantilla(s) cumplen las reglas de Meta (variables, ejemplos, pie, bordes del cuerpo)`);

  if (!TOKEN) {
    console.log('\nSin WHATSAPP_TOKEN no se puede hablar con Meta: esto es solo la comprobación.');
    console.log('El texto exacto para copiar a mano está en docs/PLANTILLAS-WHATSAPP.md');
    if (go) process.exit(1);
    process.exit(0);
  }

  let ya;
  try { ya = await existentes(); } catch (e) { console.error('\nNo se pudo leer la cuenta: ' + e.message); process.exit(1); }

  console.log(`\nCuenta ${WABA} · ${ya.size} plantilla(s) ya creadas\n`);
  for (const p of lista) {
    const hay = ya.get(p.name);
    if (hay) { console.log(`  = ${p.name} — YA EXISTE (${hay.estado}, ${hay.idioma}, ${hay.categoria}). No se toca.`); continue; }
    if (!go) { console.log(`  + ${p.name} — se mandaría a revisión · ${p.para}`); continue; }
    const r = await crear(p);
    if (r.ok) console.log(`  + ${p.name} — ENVIADA a revisión (id ${r.id}, estado ${r.estado})`);
    else console.log(`  x ${p.name} — Meta la rechazó al crearla: ${r.error}`);
  }

  if (!go) console.log('\nEsto ha sido un ensayo. Para mandarlas de verdad: --go');
  else console.log('\nMeta suele contestar en minutos. El estado se ve en WhatsApp Manager o con /alertas.');
  process.exit(0);
})().catch(e => { console.error('ERROR: ' + (e.stack || e.message)); process.exit(1); });
