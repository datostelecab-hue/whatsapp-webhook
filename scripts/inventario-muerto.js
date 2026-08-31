// ============================================================
// INVENTARIO: qué se usa de verdad y qué no
// ============================================================
//   node scripts/inventario-muerto.js            resumen
//   node scripts/inventario-muerto.js --detalle  con quién referencia a quién
//
// ESTO NO BORRA NADA. Hace una lista para que la mire una persona.
//
// "Nadie lo importa" NO significa muerto, y en este código menos que en otros:
//
//   · las vistas se alcanzan por `res.render('nombre')` — una cadena
//   · los layouts, por `layout: 'nombre'` — otra cadena
//   · las rutas se montan por cadena en app.js
//   · los crons hacen `require()` dentro de la función, no arriba
//   · los assets se citan por URL desde el HTML
//   · y una ruta puede llamarla algo que NO ESTÁ EN ESTE REPOSITORIO:
//     una fórmula de Sheets, un Apps Script, un webhook de Meta, un marcador
//     del navegador de alguien.
//
// Por eso no basta con "¿alguien lo importa?". Se recorre el grafo desde los
// puntos de entrada reales y se clasifica según CÓMO se llega, no según si
// aparece mencionado en algún sitio.
//
//   VIVO       se llega desde app.js
//   HERRAMIENTA se llega solo desde scripts/ (son CLI, no sobran)
//   DUDOSO     no se llega, pero su nombre aparece en algún sitio
//   HUÉRFANO   no se llega y su nombre no aparece en ninguna parte
//
// Solo los HUÉRFANOS son candidatos claros. Los DUDOSOS los mira una persona.
// Las RUTAS nunca se dan por muertas solas: ver el aviso del final.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

const DETALLE = process.argv.includes('--detalle');

// ── Qué ficheros entran en el inventario ────────────────────────────────────
// `db/` queda fuera a propósito: son migraciones ya aplicadas contra una base
// real. Borrar una no libera nada y rompe la historia de cómo llegó el esquema
// a donde está. Eso se archiva, no se barre.
const CARPETAS = ['services', 'routes', 'views', 'scripts', 'public/assets'];

function ficherosDe(dir) {
  const salida = [];
  const abs = path.join(RAIZ, dir);
  if (!fs.existsSync(abs)) return salida;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { salida.push(...ficherosDe(rel)); continue; }
    salida.push(rel);
  }
  return salida;
}

const TODOS = CARPETAS.flatMap(ficherosDe).concat(['app.js']);
const ES_JS = f => f.endsWith('.js');
const ES_VISTA = f => f.endsWith('.ejs');

const texto = new Map();
for (const f of TODOS) {
  try { texto.set(f, fs.readFileSync(path.join(RAIZ, f), 'utf8')); }
  catch (e) { texto.set(f, ''); }
}

// ── Resolver un `require` a un fichero del repositorio ──────────────────────
function resolver(desde, spec) {
  if (!spec.startsWith('.')) return null;           // paquete de node_modules
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(desde.replace(/\\/g, '/')), spec));
  for (const cand of [base, base + '.js', base + '/index.js']) {
    if (texto.has(cand)) return cand;
  }
  return null;
}

// ── Las aristas ─────────────────────────────────────────────────────────────
// De cada fichero salen tres tipos de referencia y hay que buscar las tres.
const aristas = new Map();   // fichero -> Set de ficheros a los que llama
const quien = new Map();     // fichero -> Set de ficheros que lo llaman

const enlazar = (de, a) => {
  if (!a || a === de) return;
  if (!aristas.has(de)) aristas.set(de, new Set());
  if (!quien.has(a)) quien.set(a, new Set());
  aristas.get(de).add(a);
  quien.get(a).add(de);
};

for (const f of TODOS) {
  const src = texto.get(f);

  // 1. require('...') — estático, y también el que va dentro de una función,
  //    que aquí es lo normal en los crons.
  for (const m of src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    enlazar(f, resolver(f, m[1]));
  }
  // 2. require(path.join(__dirname, '..', 'services/x')) — así llaman los
  //    scripts de prueba. Se resuelve desde la raíz.
  for (const m of src.matchAll(/path\.join\(\s*(?:__dirname|RAIZ)\s*,\s*['"]([^'"]+)['"]\s*\)/g)) {
    const p = m[1].replace(/^\.\.\//, '');
    for (const cand of [p, p + '.js']) if (texto.has(cand)) enlazar(f, cand);
  }
  // 3. Vistas: render('x') y layout: 'x'.
  for (const m of src.matchAll(/(?:render|layout)\s*[(:]\s*['"]([\w\-\/]+)['"]/g)) {
    const v = 'views/' + m[1] + '.ejs';
    if (texto.has(v)) enlazar(f, v);
  }
  // 4. include('partials/x') dentro de una vista.
  for (const m of src.matchAll(/include\(\s*['"]([\w\-\/]+)['"]/g)) {
    const v = 'views/' + m[1] + '.ejs';
    if (texto.has(v)) enlazar(f, v);
  }
  // 5. Assets citados por URL.
  for (const m of src.matchAll(/\/assets\/([\w\-\/\.]+)/g)) {
    const a = 'public/assets/' + m[1];
    if (texto.has(a)) enlazar(f, a);
  }
}

// ── Recorrido desde los puntos de entrada ───────────────────────────────────
function alcanzables(raices) {
  const vistos = new Set(raices.filter(r => texto.has(r)));
  const cola = [...vistos];
  while (cola.length) {
    for (const sig of aristas.get(cola.pop()) || []) {
      if (!vistos.has(sig)) { vistos.add(sig); cola.push(sig); }
    }
  }
  return vistos;
}

const DESDE_APP = alcanzables(['app.js']);
const SCRIPTS = TODOS.filter(f => f.startsWith('scripts/') && ES_JS(f));
const DESDE_SCRIPTS = alcanzables(SCRIPTS);

// ── Clasificación ───────────────────────────────────────────────────────────
// NO BASTA CON EL GRAFO, y esto se aprendió rompiéndolo: la primera versión daba
// por muerto `views/layout.ejs`, que es el layout por defecto de TODAS las
// pantallas. Se cita en `app.set('layout', 'layout')`, que no es un `render()`
// ni un `include()`. Y `layout-auth.ejs` se cita a través de una variable.
//
// Así que hay una segunda señal, más floja pero real: que un fichero VIVO
// mencione su nombre. Esos no se dan por muertos, pero tampoco se dan por vivos
// sin mirar — porque el detector no distingue código de comentario, y ya ha
// pasado: `logo-256.png` solo aparece en un comentario que dice que NO se usa.
// La mención tiene que ser una CADENA EXACTA, no la palabra suelta. Buscando la
// palabra, `views/error.ejs` salia "citado" por medio codigo — porque `error`
// aparece en cada `console.error` y en cada `status: 'error'`. Eso no es una
// referencia: es la palabra mas comun del repositorio.
const quienMenciona = f => {
  const nombre = path.basename(f).replace(/\.(js|ejs)$/, '');
  const formas = [`'${nombre}'`, `"${nombre}"`, '`' + nombre + '`', f];
  return TODOS.filter(o => o !== f && formas.some(x => texto.get(o).includes(x)));
};

const clase = f => {
  if (DESDE_APP.has(f)) return 'VIVO';
  if (DESDE_SCRIPTS.has(f)) return 'HERRAMIENTA';
  const menciones = quienMenciona(f);
  if (menciones.some(o => DESDE_APP.has(o))) return 'CITADO';
  return menciones.length ? 'DUDOSO' : 'HUÉRFANO';
};

const grupos = { VIVO: [], HERRAMIENTA: [], CITADO: [], DUDOSO: [], 'HUÉRFANO': [] };
for (const f of TODOS) grupos[clase(f)].push(f);

// ── Salida ──────────────────────────────────────────────────────────────────
const bytes = f => { try { return fs.statSync(path.join(RAIZ, f)).size; } catch (e) { return 0; } };
const kb = n => (n / 1024).toFixed(1) + ' KB';

console.log('\n═══ INVENTARIO ═══');
console.log(`${TODOS.length} ficheros · ${DESDE_APP.size} se alcanzan desde app.js\n`);

for (const g of ['HUÉRFANO', 'DUDOSO', 'CITADO', 'HERRAMIENTA']) {
  const lista = grupos[g].sort();
  const peso = lista.reduce((s, f) => s + bytes(f), 0);
  console.log(`── ${g} (${lista.length}${lista.length ? ' · ' + kb(peso) : ''}) ` + '─'.repeat(Math.max(0, 46 - g.length)));
  if (!lista.length) { console.log('   ninguno\n'); continue; }
  for (const f of lista) {
    console.log(`   ${f.padEnd(46)} ${kb(bytes(f)).padStart(9)}`);
    if (DETALLE || g === 'CITADO') {
      const llaman = g === 'CITADO'
        ? quienMenciona(f).filter(o => DESDE_APP.has(o))
        : [...(quien.get(f) || [])];
      if (llaman.length) console.log(`      ← ${llaman.slice(0, 4).join(', ')}`);
    }
  }
  console.log();
}

console.log(`── VIVO (${grupos.VIVO.length}) ` + '─'.repeat(44));
console.log('   (no se listan: son los que se usan)\n');

// ── El aviso que hay que leer antes de borrar nada ──────────────────────────
const rutasSospechosas = [...grupos['HUÉRFANO'], ...grupos.DUDOSO, ...grupos.CITADO].filter(f => f.startsWith('routes/'));
if (rutasSospechosas.length) {
  console.log('⚠️  HAY RUTAS EN LA LISTA. Una ruta puede llamarla algo que no está en');
  console.log('   este repositorio: una fórmula de Sheets, un Apps Script, un webhook,');
  console.log('   un marcador de alguien. NO se borran por esta lista; se comprueba');
  console.log('   antes en los accesos del servidor.\n');
}
console.log('Esto NO ha borrado nada. Es una lista para mirar.');
