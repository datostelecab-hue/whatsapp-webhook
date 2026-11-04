// ============================================================
// ESLINT DEL JAVASCRIPT DEL NAVEGADOR (FRO-4, 04/11/2026)
// ============================================================
//   npm run lint
//
// Solo public/assets/js: los componentes de la casa y, desde el FRO-4, el
// JavaScript de cada pantalla (vistas/) y del layout (layout/), que antes vivía
// dentro de los .ejs, donde ninguna herramienta podía mirarlo.
//
// Lo que importa es `no-undef`: un nombre que no existe —una errata, una
// función que se quitó de otro sitio— no avisa en ninguna parte hasta que
// alguien pulsa justo ese botón. `scripts/comprobar-vistas.js` solo mira la
// sintaxis. Lo que no se usa (`no-unused-vars`) va en aviso: limpiarlo es otra
// tanda, y no debe impedir nada.
//
// LOS GLOBALES DE LA CASA SE LEEN DEL CÓDIGO, no de una lista escrita aquí: cada
// componente se cuelga de window (`global.Listado = …`, `window.X = …`), y lo que
// se cuelga en un fichero existe para todos los demás. Un componente nuevo entra
// solo.

const fs = require('fs');
const path = require('path');
const globals = require('globals');

const JS = path.join(__dirname, 'public', 'assets', 'js');

function globalesDeLaCasa(dir = JS, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) globalesDeLaCasa(p, out);
    else if (e.name.endsWith('.js')) {
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/\b(?:global|window)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) out[m[1]] = 'readonly';
    }
  }
  return out;
}

// EL PLANIFICADOR, PARTIDO EN FICHEROS QUE COMPARTEN ÁMBITO (FRO-4, 04/11/2026):
// lo que uno declara a primer nivel (el estado T, ZONA…, los ayudantes $, esc…,
// las funciones de cada área) lo ven todos los demás. Se leen esas declaraciones
// con el mismo analizador de ESLint para que no-undef siga cazando erratas, y
// no-global-assign no deja pisar desde otro fichero lo que no es un `let`.
//
// LOS FICHEROS SON LOS QUE CARGA LA VISTA, no los que haya en la carpeta: uno
// que la vista no cargue no existe en la página, y sus nombres tampoco.
const PLAN = ['public/assets/js/vistas/Planificacion/planificadorV2.js',
  'public/assets/js/vistas/Planificacion/planificador/*.js'];
const PLAN_VISTA = path.join(__dirname, 'modules', 'Planificacion', 'vistas', 'planificadorV2.ejs');

/** Los nombres de un patrón de declaración: a, { a, b: c }, [a, ...b], a = 1. */
function nombresDe(p, out = []) {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(x => nombresDe(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(x => nombresDe(x, out));
  else if (p.type === 'AssignmentPattern') nombresDe(p.left, out);
  else if (p.type === 'RestElement') nombresDe(p.argument, out);
  return out;
}

function declaradosDelPlanificador() {
  const espree = require('espree');
  const out = {};
  const vista = fs.existsSync(PLAN_VISTA) ? fs.readFileSync(PLAN_VISTA, 'utf8') : '';
  const ficheros = [...vista.matchAll(/\/assets\/js\/(vistas\/Planificacion\/[^'"?\s)]+\.js)/g)]
    .map(m => path.join(JS, ...m[1].split('/')));
  for (const f of ficheros) {
    if (!fs.existsSync(f)) continue;
    let ast;
    // Un fichero que no compila no tumba el lint entero: se salta aquí y ESLint
    // lo señala con su línea al pasar por él.
    try { ast = espree.parse(fs.readFileSync(f, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' }); }
    catch (e) { console.warn(`eslint.config.js: no compila ${path.relative(__dirname, f)} (${e.message}); sus nombres no se comparten`); continue; }
    for (const s of ast.body) {
      if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') out[s.id.name] = 'readonly';
      if (s.type === 'VariableDeclaration') {
        for (const d of s.declarations) for (const n of nombresDe(d.id)) out[n] = s.kind === 'let' ? 'writable' : 'readonly';
      }
    }
  }
  return out;
}

// Las salidas al servidor que se saltarían el candado de solo lectura.
const POR_FETCHPLAN = 'En el planificador se escribe con fetchPlan (respeta el «solo lectura»).';

module.exports = [
  {
    files: ['public/assets/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      // Scripts clásicos, no módulos: comparten el ámbito global de la página.
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globalesDeLaCasa(),
        // Los de fuera, que llegan de cdnjs.
        Chart: 'readonly',
        ChartDataLabels: 'readonly',
        maplibregl: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // `vars: 'local'`: lo de primer nivel de un script clásico es global y lo
      // puede usar otro script de la página; eso no se cuenta como sin usar.
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    },
  },
  {
    files: PLAN,
    languageOptions: { globals: declaradosDelPlanificador() },
    rules: {
      // Lo que no es un `let` no se reasigna desde otro fichero: `pintar = …`
      // cambiaría la función para los once, y `fetchPlan = …` rompería al
      // ejecutarse.
      'no-global-assign': 'error',
      // EL CANDADO DE SOLO LECTURA ES fetchPlan. Cualquier otra salida escribiría
      // aunque quien mira no tenga '/planificador/editar' (el servidor lo para
      // igual, pero la pantalla mentiría). Api.get, para leer, sí se puede.
      'no-restricted-globals': ['error',
        { name: 'fetch', message: POR_FETCHPLAN },
        { name: 'XMLHttpRequest', message: POR_FETCHPLAN }],
      'no-restricted-properties': ['error',
        { object: 'window', property: 'fetch', message: POR_FETCHPLAN },
        { object: 'globalThis', property: 'fetch', message: POR_FETCHPLAN },
        { object: 'self', property: 'fetch', message: POR_FETCHPLAN },
        { object: 'Api', property: 'post', message: POR_FETCHPLAN },
        { object: 'Api', property: 'pedir', message: POR_FETCHPLAN },
        { object: 'navigator', property: 'sendBeacon', message: POR_FETCHPLAN }],
    },
  },
];
