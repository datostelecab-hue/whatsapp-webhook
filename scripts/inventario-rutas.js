// ============================================================
// INVENTARIO DE RUTAS — la red de seguridad de la reorganización
// ============================================================
//   node scripts/inventario-rutas.js              compara con la foto guardada
//   node scripts/inventario-rutas.js --guardar    hace la foto
//   node scripts/inventario-rutas.js --lista      solo imprime lo que hay
//
// Mover un fichero de sitio NO puede cambiar ni una URL. El problema es que eso
// no se ve: una ruta que deja de montarse no rompe el arranque ni da error en
// ningún sitio, simplemente devuelve 404 el día que alguien pulsa ese botón.
//
// Aquí se levanta la aplicación DE VERDAD —con app.listen anulado y sin base de
// datos— y se recorre el árbol de routers de Express para sacar la lista exacta
// de método + URL. Se guarda una foto antes de tocar nada y se compara después:
// si la lista es idéntica, el traslado fue limpio.
//
// El prefijo de montaje NO se adivina de la expresión regular de Express: se
// apunta en el momento en que app.use() lo declara, envolviendo `use` antes de
// cargar app.js. Adivinarlo falla justo en los casos raros, que son los que
// importan.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
// En scripts/ y NO en scripts/datos/: esa carpeta esta ignorada por git porque
// guarda PII de la migracion, y esta foto tiene que viajar en el repositorio —
// si no, no sirve para comparar entre commits, que es justo para lo que es.
const FOTO = path.join(__dirname, 'rutas-base.json');

// ── Anular lo que arranca cosas ────────────────────────────────────────────
// MODO_PRUEBAS deja los crons sin programar (lo hace el propio app.js) y corta
// las escrituras a Sheets/WhatsApp/Mapon. Sin DATABASE_URL el pool ni se crea.
process.env.MODO_PRUEBAS = '1';
delete process.env.DATABASE_URL;

const express = require('express');
const app_ = express.application;

// Dónde se monta cada router. Se apunta según se declara: `use` recibe el
// prefijo y el router, y esa pareja es la única fuente fiable del prefijo.
const montado = new Map();   // handle del router -> prefijo
const useOriginal = app_.use;
app_.use = function (...args) {
  if (typeof args[0] === 'string') {
    for (const h of args.slice(1)) if (typeof h === 'function' && h.stack) montado.set(h, args[0]);
  }
  return useOriginal.apply(this, args);
};

// El servidor no se levanta: solo queremos el árbol de rutas. Y de paso `listen`
// es quien nos da la aplicación: app.js no la exporta, pero sí la escucha, así
// que `this` en esta llamada ES la aplicación montada y entera.
let app = null;
app_.listen = function () { app = this; return { close() {}, on() {} }; };

// Silencio: app.js escribe mucho al arrancar y aquí estorba.
const logOriginal = console.log;
console.log = () => {};
try {
  require(path.join(RAIZ, 'app.js'));
} finally {
  console.log = logOriginal;
}
if (!app) {
  console.error('app.js no llamó a listen(): no hay de dónde sacar la aplicación');
  process.exit(1);
}

// ── Recorrer el árbol ──────────────────────────────────────────────────────
const rutas = [];

function pila(capa) {
  return (capa && capa.handle && capa.handle.stack) || (capa && capa.stack) || null;
}

function recorrer(capas, prefijo) {
  for (const capa of capas || []) {
    if (capa.route) {
      const metodos = Object.keys(capa.route.methods || {}).filter(m => m !== '_all');
      for (const m of metodos) rutas.push(`${m.toUpperCase()} ${limpiar(prefijo + capa.route.path)}`);
      continue;
    }
    const dentro = pila(capa);
    if (!dentro) continue;                       // middleware suelto: no es una ruta
    const sub = montado.has(capa.handle) ? montado.get(capa.handle) : '';
    recorrer(dentro, prefijo + sub);
  }
}

// `/control` + `/` -> `/control`, no `/control/`. Y la raíz se queda en `/`.
const limpiar = u => (u.length > 1 ? u.replace(/\/+$/, '') : u) || '/';

const raiz = app._router || (app.router && app.router.stack ? app.router : null);
if (!raiz || !raiz.stack) {
  console.error('No se pudo leer el árbol de rutas de Express (¿cambió de versión?)');
  process.exit(1);
}
recorrer(raiz.stack, '');

const lista = [...new Set(rutas)].sort();

// ── Qué hacer con ella ─────────────────────────────────────────────────────
const arg = process.argv[2] || '';

if (arg === '--lista') {
  lista.forEach(r => console.log('  ' + r));
  console.log(`\n${lista.length} ruta(s)`);
  process.exit(0);
}

if (arg === '--guardar') {
  fs.mkdirSync(path.dirname(FOTO), { recursive: true });
  fs.writeFileSync(FOTO, JSON.stringify({ rutas: lista }, null, 2) + '\n');
  console.log(`Foto guardada: ${lista.length} ruta(s) en scripts/rutas-base.json`);
  process.exit(0);
}

if (!fs.existsSync(FOTO)) {
  console.error('No hay foto que comparar. Hazla primero:\n  node scripts/inventario-rutas.js --guardar');
  process.exit(1);
}

const antes = JSON.parse(fs.readFileSync(FOTO, 'utf8')).rutas;
const faltan = antes.filter(r => !lista.includes(r));
const sobran = lista.filter(r => !antes.includes(r));

faltan.forEach(r => console.log(`  - ${r}   (ESTABA Y YA NO)`));
sobran.forEach(r => console.log(`  + ${r}   (nueva)`));

if (!faltan.length && !sobran.length) {
  console.log(`\n${lista.length} ruta(s): exactamente las mismas que antes`);
  process.exit(0);
}
console.log(`\n${antes.length} antes -> ${lista.length} ahora · ${faltan.length} perdida(s), ${sobran.length} nueva(s)`);
// Perder una ruta es un fallo; añadir una es normal al desarrollar.
process.exit(faltan.length ? 1 : 0);
