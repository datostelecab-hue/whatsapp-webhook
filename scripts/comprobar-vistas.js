// ============================================================
// EL JAVASCRIPT DE LAS VISTAS COMPILA
// ============================================================
//   node scripts/comprobar-vistas.js
//
// Un `node --check` no sabe leer un .ejs: se atraganta con las etiquetas <% %>.
// Asi que el JavaScript de las pantallas era lo unico del proyecto que nadie
// comprobaba, y un error de sintaxis ahi no avisa en ningun sitio: el navegador
// deja de ejecutar el script ENTERO y la pantalla se queda a medias, cargando
// para siempre, sin un solo mensaje en el servidor.
//
// Aqui se saca el JavaScript de cada vista, se sustituyen las interpolaciones de
// EJS por un valor neutro y se comprueba la sintaxis.
//
// Y DESDE EL 03/11/2026, TRES REGLAS QUE SI SE ROMPEN DEJAN LA PANTALLA MUERTA:
//   · todo <script> en línea lleva el nonce (`<script nonce="<%= nonce %>">`):
//     con la CSP obligatoria, el navegador no ejecuta uno sin él;
//   · ningún manejador escrito en un atributo (onclick="…", onerror="…"),
//     ni en el HTML ni en el que se monta con cadenas: tampoco se ejecuta;
//   · los datos del servidor en un <script> van con `<%- json(x) %>`, no con
//     JSON.stringify (ver app.js).
// Y desde el 04/11/2026, una cuarta: el `esc` de una vista es `Casa.esc`; y una
// quinta: ni botones de solo icono sin nombre ni <label> sueltas (FRO-9).
// También mira las subcarpetas (partials/), que antes se le escapaban.
// Y desde el FRO-4 (04/11/2026): el JavaScript de las pantallas vive en
// public/assets/js/vistas y layout (un <script> en línea de más de
// MAX_EN_LINEA líneas es un fallo); lo que el script lee de Casa.datos() tiene
// que estar en el bloque de datos de su vista; en una PÁGINA (su layout, la
// vista, sus partials y sus ficheros) ningún nombre global se declara dos veces
// ni es uno del navegador (`function open` sustituiría a window.open); ningún
// fichero de vistas/ o layout/ se queda sin vista que lo cargue; y las áreas de
// una pantalla partida (el planificador) solo traen declaraciones y se cargan
// antes que su principal. Lo fino lo hace con el analizador de ESLint (espree,
// en dependencies); si falta, es un fallo.
//
// Y desde el 05/11/2026, que cada nombre que usa el JavaScript de una página
// exista EN ESA PÁGINA (revisarNombres): lo declara uno de sus scripts, lo
// cuelga de window uno de sus ficheros o llega de una CDN que la página carga.
//
// Corre solo en cada `npm install` sin argumentos —también el build de Render,
// que no despliega si falla— junto con ESLint: scripts/comprobar-al-instalar.js.

const MAX_EN_LINEA = 30;

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'views');

/** El contenido de cada <script> que no sea de un fichero externo. */
function scriptsDe(html) {
  const trozos = [];
  // Los atributos pueden llevar EJS (nonce="<%= nonce %>"): el «>» de un «%>» no
  // cierra la etiqueta.
  const re = /<script\b((?:<%[\s\S]*?%>|[^>])*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;          // externo: ya se comprueba solo
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(m[1])) continue;  // plantillas, JSON…
    trozos.push({ codigo: m[2], desde: html.slice(0, m.index).split('\n').length });
  }
  return trozos;
}

// `<%- x %>` y `<%= x %>` se van a convertir en un valor cualquiera. Lo que se
// comprueba es el codigo escrito a mano, que es donde esta el error humano.
// Los saltos de línea de la etiqueta se conservan, para que la línea de un aviso
// siga siendo la del fichero, pero se dejan para el siguiente salto de línea del
// código: puestos en el sitio de la etiqueta romperían una cadena
// ('<%= a ? b\n : c %>' daría un falso error de sintaxis).
const susLineas = s => s.replace(/[^\n]/g, '');
const sinEjs = s => {
  let debe = '';
  return s.replace(/<%([-=]?)[\s\S]*?%>|\n/g, (m, imprime) => {
    if (m === '\n') { const r = '\n' + debe; debe = ''; return r; }
    debe += susLineas(m);
    return imprime ? '(0)' : '';
  }) + debe;
};
// Lo comentado no se carga en el navegador: ni un <!-- <script src> --> ni un
// <%# include() %>. Ojo: un include() dentro de <!-- --> EJS SÍ lo ejecuta (el
// comentario solo esconde su salida): se comprueba que exista, pero sus
// scripts no cuentan. Por eso aquí solo se quitan los <!-- --> cuando se pide.
const sinComentariosEjs = t => t.replace(/<%#[\s\S]*?%>/g, susLineas);
const sinComentarios = t => sinComentariosEjs(t).replace(/<!--[\s\S]*?-->/g, susLineas);

// Las vistas viven en DOS sitios mientras dura la Fase 2: views/ y la carpeta
// `vistas/` de cada modulo ya mudado. Una vista que se escape de aqui es una
// pantalla que se queda cargando para siempre sin un solo mensaje en el
// servidor, que es justo lo que este comprobador existe para evitar.
const MODULOS = path.join(__dirname, '..', 'modules');
// Los .ejs de una carpeta y de sus subcarpetas (partials/), con el nombre relativo.
function ejsDe(dir, prefijo) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...ejsDe(ruta, prefijo + e.name + '/'));
    else if (e.name.endsWith('.ejs')) out.push({ nombre: prefijo + e.name, ruta });
  }
  return out;
}
const ficheros = ejsDe(DIR, '');
// Las raíces de las vistas, las mismas que app.js da a Express (RAICES_VISTAS):
// EJS busca un include primero junto al que incluye y luego en ellas.
const RAICES = [DIR];

if (fs.existsSync(MODULOS)) {
  for (const m of fs.readdirSync(MODULOS, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const dv = path.join(MODULOS, m.name, 'vistas');
    if (!fs.existsSync(dv)) continue;
    RAICES.push(dv);
    ficheros.push(...ejsDe(dv, m.name + '/'));
  }
}

let fallos = 0, revisados = 0;
const lineaDe = (html, i) => html.slice(0, i).split('\n').length;

// LO QUE UN LECTOR DE PANTALLA NO PUEDE NOMBRAR (FRO-9, 04/11/2026): un botón
// con solo un icono y sin aria-label, aria-labelledby ni title, y una <label>
// que no está unida a nada (ni for, ni un control dentro, ni la usa un
// aria-labelledby). Lo que pinta EJS (<%= %>) o JS (${…}) cuenta como texto.
const ATRIBUTOS = '((?:<%[\\s\\S]*?%>|\\$\\{[^}]*\\}|[^>])*)';
function sinNombre(texto) {
  const malos = [];
  for (const m of texto.matchAll(new RegExp('<button\\b' + ATRIBUTOS + '>([\\s\\S]*?)<\\/button>', 'gi'))) {
    const dentro = m[2].replace(/<i\b[^>]*>\s*<\/i>/gi, '').replace(/<%[=-][\s\S]*?%>/g, 'X')
      .replace(/<%[\s\S]*?%>/g, '').trim();
    if (dentro || /\baria-label(ledby)?\s*=|\btitle\s*=/.test(m[1])) continue;
    malos.push({ i: m.index, que: 'un botón con solo un icono y sin nombre — ponle aria-label con lo que hace' });
  }
  for (const m of texto.matchAll(new RegExp('<label\\b' + ATRIBUTOS + '>([\\s\\S]*?)<\\/label>', 'gi'))) {
    if (/\bfor\s*=/.test(m[1]) || /<(input|select|textarea)\b/i.test(m[2])) continue;
    const id = (m[1].match(/\bid\s*=\s*"([^"]+)"/) || [])[1];
    if (id && texto.includes('aria-labelledby="' + id + '"')) continue;
    malos.push({ i: m.index, que: 'una <label> suelta — for="<id del campo>", o id y aria-labelledby si titula un grupo' });
  }
  return malos;
}

// ── LOS DATOS DEL SERVIDOR (FRO-4, 04/11/2026) ──────────────────────────────
// El JavaScript de una pantalla lee lo que le deja el servidor con
// `const DEL_SERVIDOR = Casa.datos();` (public/assets/js/nucleo.js), de un bloque
// <script type="application/json" id="datos-servidor"><%- json({ … }) %></script>
// de la vista. Si el script lee DEL_SERVIDOR.x y el bloque no trae `x`, llega
// undefined sin ningún error: en un permiso, un «no puede» callado. Aquí se
// comparan las dos listas.
const PUBLICO = path.join(__dirname, '..', 'public');

// ¿EXISTE CON ESTAS MAYÚSCULAS? En Windows (NTFS) fs.existsSync no las distingue
// y en Render (Linux) sí: un `/assets/js/Listado.js` que en disco es listado.js
// pasaría aquí y allí daría 404 (o tumbaría el build sin que en local se viera).
// Se recorre la ruta tramo a tramo contra los nombres reales del directorio.
// Lo que no cubre: un renombrado que solo cambia mayúsculas sin `git mv -f`,
// porque git (core.ignorecase) se queda con el nombre viejo y el disco no.
const nombresCache = new Map();
function existeTal(base, rel) {
  let d = base;
  for (const s of rel.split(/[\\/]/)) {
    if (!s || s === '.') continue;
    if (s === '..') { d = path.dirname(d); continue; }
    if (!nombresCache.has(d)) {
      let n = [];
      try { n = fs.readdirSync(d); } catch (_) { /* no es un directorio */ }
      nombresCache.set(d, new Set(n));
    }
    if (!nombresCache.get(d).has(s)) return false;
    d = path.join(d, s);
  }
  return true;
}

/** Las claves de primer nivel del json({ … }) del bloque de datos. null = no hay bloque. */
function clavesDelBloque(html) {
  const b = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find(m => /type\s*=\s*["']application\/json["']/i.test(m[1]) && /\bid\s*=\s*["']datos-servidor["']/i.test(m[1]));
  if (!b) return null;
  const j = b[2].match(/<%-\s*json\(\s*\{([\s\S]*)\}\s*\)\s*%>/);
  if (!j) return { abierto: true, claves: new Set() };   // no es un objeto escrito: no se puede mirar
  // Se parte por las comas de primer nivel, saltando cadenas y paréntesis.
  const trozos = [];
  let prof = 0, desde = 0;
  const s = j[1];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < s.length && s[i] !== c; i++) if (s[i] === '\\') i++;
    } else if ('([{'.includes(c)) prof++;
    else if (')]}'.includes(c)) prof--;
    else if (c === ',' && prof === 0) { trozos.push(s.slice(desde, i)); desde = i + 1; }
  }
  trozos.push(s.slice(desde));
  const claves = new Set();
  let abierto = false;
  for (const t of trozos.map(x => x.trim()).filter(Boolean)) {
    const m = t.match(/^(["']?)([A-Za-z_$][\w$]*)\1\s*:/) || t.match(/^([A-Za-z_$][\w$]*)$/);
    if (m) claves.add(m[2] || m[1]);
    else abierto = true;                                   // ...spread, [calculada]
  }
  return { abierto, claves };
}

/** Las claves que lee un trozo de JavaScript de Casa.datos(). */
function clavesLeidas(codigo) {
  const leidas = new Set();
  for (const m of codigo.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*Casa\.datos\(\s*\)/g)) {
    const n = m[1].replace(/\$/g, '\\$');
    for (const u of codigo.matchAll(new RegExp('\\b' + n + '\\.([A-Za-z_$][\\w$]*)', 'g'))) leidas.add(u[1]);
    for (const u of codigo.matchAll(new RegExp('\\b' + n + '\\[\\s*["\']([^"\']+)["\']\\s*\\]', 'g'))) leidas.add(u[1]);
  }
  for (const m of codigo.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*Casa\.datos\(\s*\)/g)) {
    m[1].split(',').map(x => x.split(':')[0].replace(/=.*$/, '').trim()).filter(Boolean).forEach(k => leidas.add(k));
  }
  return { usa: /Casa\.datos\(/.test(codigo), leidas };
}

// ── LA PÁGINA ENTERA (FRO-4, 04/11/2026) ─────────────────────────────────────
// Con qué layout se pinta cada vista: el portal con el suyo, el acceso con
// layout-auth (auth.controller) y lo demás con layout-gestion (app.js).
const VIEWS = path.join(__dirname, '..', 'views');
const DEL_ACCESO = new Set(['Usuarios/login.ejs', 'Usuarios/cambiar-password.ejs', 'Usuarios/olvide-password.ejs']);
function layoutDe(nombre) {
  if (/(^|\/)(layout-[^/]*|portalLayout)\.ejs$/.test(nombre)) return null;
  if (nombre.startsWith('Portal/')) return path.join(MODULOS, 'Portal', 'vistas', 'portalLayout.ejs');
  if (DEL_ACCESO.has(nombre)) return path.join(VIEWS, 'layout-auth.ejs');
  return path.join(VIEWS, 'layout-gestion.ejs');
}

// El analizador de ESLint (espree) y los nombres del navegador (globals). Desde
// el 04/11/2026 son `dependencies` y esto corre en el build de Render
// (scripts/comprobar-al-instalar.js): si faltan, es un FALLO, no un aviso, porque
// lo fino (nombres repetidos entre ficheros, nombres del navegador, áreas del
// planificador) se quedaría sin mirar y el build daría por buena una página que
// no ha revisado. Lo que se ve sin ellos —los const/let/class repetidos que
// encuentra el compilador de Node— se sigue comprobando, para avisar de todo.
let espree = null, NAVEGADOR = new Set();
try { espree = require('espree'); } catch (_) { /* se cuenta justo abajo */ }
try { NAVEGADOR = new Set(Object.keys(require('globals').browser)); } catch (_) { /* ídem */ }
if (!espree || !NAVEGADOR.size) {
  fallos++;
  console.log('  x falta espree o globals (npm install): sin ellos no se miran los nombres globales de cada página');
}
const arbolCache = new Map();
function arbolDe(codigo) {
  if (!arbolCache.has(codigo)) {
    let a = null;
    try { a = espree.parse(codigo, { ecmaVersion: 'latest', sourceType: 'script', loc: true }); } catch (_) { /* la sintaxis ya se avisa aparte */ }
    arbolCache.set(codigo, a);
  }
  return arbolCache.get(codigo);
}
const nombresDe = (p, out = []) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(x => nombresDe(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(x => nombresDe(x, out));
  else if (p.type === 'AssignmentPattern') nombresDe(p.left, out);
  else if (p.type === 'RestElement') nombresDe(p.argument, out);
  return out;
};
/** Lo que un script declara a primer nivel: [{ nombre, tipo }]. */
function declarados(arbol) {
  const out = [];
  for (const s of (arbol ? arbol.body : [])) {
    if (s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') out.push({ nombre: s.id.name, tipo: s.type === 'ClassDeclaration' ? 'class' : 'function' });
    else if (s.type === 'VariableDeclaration') s.declarations.forEach(d => nombresDe(d.id).forEach(n => out.push({ nombre: n, tipo: s.kind })));
  }
  return out;
}

function revisarPagina(f, trozos) {
  if (trozos.length < 2) return;
  if (!espree) {
    // Sin analizador: lo que el compilador de Node ve al juntarlos (el `void 0;`
    // de delante evita que un 'use strict' del primero valga para todos).
    try { new vm.Script('void 0;\n' + trozos.map(t => t.codigo).join('\n;\n'), { filename: f }); } catch (e) {
      if (/already been declared/.test(e.message)) { fallos++; console.log(`  x ${f}: dos scripts de la misma página declaran lo mismo (${e.message})`); }
    }
    return;
  }
  const donde = new Map();
  for (const t of trozos) {
    for (const d of declarados(arbolDe(t.codigo))) {
      if (!donde.has(d.nombre)) donde.set(d.nombre, []);
      donde.get(d.nombre).push({ ...d, origen: t.origen });
      if (NAVEGADOR.has(d.nombre)) {
        fallos++;
        console.log(`  x ${f}: ${t.origen} declara «${d.nombre}» (${d.tipo}) a primer nivel, y es un nombre del navegador (window.${d.nombre}) — en toda la página lo sustituye o lo tapa; cámbialo o mételo en una IIFE`);
      }
    }
  }
  for (const [n, sitios] of donde) {
    const origenes = [...new Set(sitios.map(s => s.origen))];
    if (origenes.length < 2) continue;
    fallos++;
    console.log(`  x ${f}: «${n}» se declara a primer nivel en ${origenes.join(' y en ')} — el segundo ${sitios.some(s => ['const', 'let', 'class'].includes(s.tipo)) ? 'no llega a ejecutarse (already been declared)' : 'sustituye al primero en silencio'}`);
  }
}

// UN NOMBRE QUE NO EXISTE EN SU PÁGINA (no-undef por página, 05/11/2026).
// `npm run lint` mira cada fichero suelto y da por definido en todos lo que
// cualquier componente cuelga de window: un `Graficos.pintar()` en una pantalla
// que no carga graficos.js pasaba, y al llegar ahí daba un ReferenceError. Aquí
// se mira cada PÁGINA con lo que esa página trae de verdad:
//   · lo del navegador y lo del propio lenguaje;
//   · lo que declaran a primer nivel sus scripts (comparten el ámbito global:
//     así se ven entre sí las áreas del planificador) y lo que cuelgan de
//     window (`global.X =`, `window.X =`);
//   · lo de fuera, solo si la página carga su <script> de cdnjs (EXTERNOS).
// Cuenta como USO el nombre suelto (`CitasTaller.esc`) y también leer por window
// algo que cuelga la casa (`const C = window.CitasTaller`, `global.Api.post()`):
// los dos revientan si la página no lo carga. Lo que PREGUNTA no cuenta
// (`typeof X`, `if (!window.X)`, `window.X && …`, `window.X?.…`,
// `'X' in window`), y protege ese nombre DENTRO DE SU GUARDA (ver siVerdad más
// abajo), no en todo el fichero. Mira todos los trozos, también los componentes
// y los arranques en línea de los layouts, que ESLint no ve.
//
// LO QUE NO MIRA: el ORDEN de carga (usar al cargar algo que define un script
// posterior); hoy no pasa en ninguna página.
const CDN = 'https://cdnjs.cloudflare.com/';   // el único host de scripts que deja la CSP (app.js, script-src)
const EXTERNOS = [
  // De Chart.js, solo el UMD: el chart.js de la v4 es ESM y como script clásico no compila.
  { re: /\/chart\.umd(?:\.min)?\.js(?:[?#]|$)/i, nombres: ['Chart'] },
  { re: /\/chartjs-plugin-datalabels(?:\.min)?\.js(?:[?#]|$)/i, nombres: ['ChartDataLabels'] },
  { re: /\/maplibre-gl(?:-csp|-dev)?(?:\.min)?\.js(?:[?#]|$)/i, nombres: ['maplibregl'] },
];
const NOMBRES_EXTERNOS = new Set(EXTERNOS.flatMap(e => e.nombres));
/** Cada <script src> de un texto: su URL, dónde está y si lleva nonce (los atributos pueden llevar EJS). */
function srcsDe(texto) {
  const out = [];
  for (const m of texto.matchAll(/<script\b((?:<%[\s\S]*?%>|[^>])*)>/gi)) {
    const s = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(m[1]);
    // `//cdnjs…` en una página https es https://cdnjs…
    if (s) out.push({ src: s[1].startsWith('//') ? 'https:' + s[1] : s[1], i: m.index, nonce: /\bnonce\s*=/i.test(m[1]) });
  }
  return out;
}
/** ¿Lo ejecuta el navegador? Con la CSP, de cdnjs o con el nonce de la página. */
const seEjecuta = s => s.src.startsWith(CDN) || s.nonce;

// Lo que un trozo cuelga de window, lo que pregunta y lo que lee por window,
// sacado de su árbol (no del texto: un `window.X =` en un comentario o en una
// cadena no carga nada). `global` es el nombre de la casa para window
// (`(function (global) { … })(window)`); `self` solo cuenta si el trozo no
// tiene un `self` propio (`const self = this`).
const OBJ_GLOBAL = new Set(['window', 'global', 'globalThis', 'self']);
let objetosGlobales = OBJ_GLOBAL;                  // los de este trozo (analizar)
/** `window.N`, `global.N`, `window['N']`… → N; si no, null. */
function deVentana(n) {
  if (!n || n.type !== 'MemberExpression' || n.object.type !== 'Identifier' || !objetosGlobales.has(n.object.name)) return null;
  if (!n.computed && n.property.type === 'Identifier') return n.property.name;
  if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') return n.property.value;
  return null;
}
/** Lo de window que nombra `n`: `window.X`, o un alias suyo (`const G = window.X` → G). */
const deVentanaO = (n, al) => deVentana(n) || (n && n.type === 'Identifier' && al.get(n.name)) || null;
/** La raíz por window de una cadena: `window.X.y`, `window.X?.y?.()`, `G.y` → X; si no, null. */
function raizVentana(n, al) {
  if (n && n.type === 'ChainExpression') n = n.expression;
  while (n) {
    const N = deVentanaO(n, al);
    if (N) return N;
    if (n.type === 'MemberExpression') n = n.object;
    else if (n.type === 'CallExpression') n = n.callee;
    else return null;
  }
  return null;
}
const esBoolean = (p, n) => p.type === 'CallExpression' && p.callee.type === 'Identifier' && p.callee.name === 'Boolean' && p.arguments[0] === n;
/** ¿`n` (un window.N o un alias) está preguntando si existe? */
function pregunta(n, p) {
  switch (p && p.type) {
    case 'IfStatement': case 'ConditionalExpression': case 'WhileStatement': case 'DoWhileStatement': case 'ForStatement': return p.test === n;
    case 'LogicalExpression': return true;                                   // window.X && …, window.X || {}
    case 'UnaryExpression': return p.operator === '!' || p.operator === 'typeof';
    case 'BinaryExpression': return ['==', '!=', '===', '!=='].includes(p.operator);
    case 'MemberExpression': return p.optional && p.object === n;            // window.X?.y
    case 'CallExpression': return (p.optional && p.callee === n) || esBoolean(p, n);   // window.X?.(), Boolean(window.X)
    default: return false;
  }
}
/** ¿`n` (un window.N o un alias) se usa dando por hecho que existe? */
function seUsa(n, p) {
  switch (p && p.type) {
    // `const G = window.X` es un alias: lo que cuenta son los usos de G. Una
    // desestructuración (`const { a } = window.X`) sí revienta ahí mismo.
    case 'VariableDeclarator': return p.init === n && p.id.type !== 'Identifier';
    case 'MemberExpression': return !p.optional && p.object === n;           // window.X.y
    case 'CallExpression': return !p.optional && p.callee === n;             // window.X()
    case 'NewExpression': return p.callee === n;                             // new window.X()
    case 'ForOfStatement': return p.right === n;                             // for (… of window.X)
    case 'TaggedTemplateExpression': return p.tag === n;
    default: return false;
  }
}

// UNA PREGUNTA PROTEGE SOLO LO QUE QUEDA DENTRO DE SU GUARDA. En
// `if (window.Chart) { Chart.x }` el Chart de dentro está a salvo; un
// `new Chart()` en otra función del mismo fichero, no: si la página no carga
// Chart, revienta al llegar ahí. Lo que sabe que existe cada sitio:
//   · `if (P) A else B`: en A, lo que P asegura si es verdad; en B, si es falso;
//     y si una rama sale (return, throw…), lo que sigue en el bloque sabe lo de
//     la otra (`if (!window.X) return;` protege el resto de la función; también
//     con `else` y con cadenas de `else if` que salen);
//   · `P ? A : B` igual; `P && A`, lo de verdad; `P || A`, lo de falso;
//   · `while (P) A` y `for (…; P; …) A`: en A, lo de verdad.
// Las funciones declaradas en un bloque existen desde el principio del bloque
// (se elevan): no heredan lo que asegura una guarda anterior a ellas.
// Un try/catch NO es una guarda: se tragaría el ReferenceError de una carga que
// falta.
const NOMBRE_SUELTO = n => n && n.type === 'Identifier' ? n.name : null;
const esIndefinido = b => (b.type === 'Identifier' && b.name === 'undefined') || (b.type === 'UnaryExpression' && b.operator === 'void');
/** `typeof X === 'v'` (o con window.X, un alias o al revés): { nombre, valor, igual } o null. */
function typeofDe(t, al) {
  if (!t || t.type !== 'BinaryExpression' || !['==', '!=', '===', '!=='].includes(t.operator)) return null;
  const [a, b] = t.left.type === 'UnaryExpression' && t.left.operator === 'typeof' ? [t.left, t.right] : [t.right, t.left];
  if (a.type !== 'UnaryExpression' || a.operator !== 'typeof' || b.type !== 'Literal' || typeof b.value !== 'string') return null;
  const arg = a.argument;
  const nombre = (arg.type === 'Identifier' && al.get(arg.name)) || NOMBRE_SUELTO(arg) || raizVentana(arg, al);
  return nombre ? { nombre, valor: b.value, igual: t.operator.startsWith('=') } : null;
}
/** `window.X == null`, `G === undefined`, `window.X?.y !== void 0`…: { nombre, igual } o null. */
function nuloDe(t, al) {
  if (!t || t.type !== 'BinaryExpression' || !['==', '!=', '===', '!=='].includes(t.operator)) return null;
  const [a, b] = raizVentana(t.left, al) ? [t.left, t.right] : [t.right, t.left];
  const nombre = raizVentana(a, al);
  const esNull = b.type === 'Literal' && b.value === null;
  if (!nombre || !(esIndefinido(b) || (esNull && t.operator.length === 2))) return null;   // `!== null` no descarta undefined
  return { nombre, igual: t.operator.startsWith('=') };
}
/** Lo que existe seguro si `t` es verdad. */
function siVerdad(t, al, s = new Set()) {
  if (!t) return s;
  const N = raizVentana(t, al); if (N) s.add(N);   // si `window.X.y` (o `?.y`) es verdad, X existe
  if (t.type === 'LogicalExpression' && t.operator === '&&') { siVerdad(t.left, al, s); siVerdad(t.right, al, s); }
  if (t.type === 'UnaryExpression' && t.operator === '!') siFalso(t.argument, al, s);
  if (t.type === 'CallExpression' && esBoolean(t, t.arguments[0])) siVerdad(t.arguments[0], al, s);
  if (t.type === 'BinaryExpression' && t.operator === 'in' && t.left.type === 'Literal' && typeof t.left.value === 'string'
    && t.right.type === 'Identifier' && objetosGlobales.has(t.right.name)) s.add(t.left.value);
  const tp = typeofDe(t, al); if (tp && tp.igual !== (tp.valor === 'undefined')) s.add(tp.nombre);
  const nu = nuloDe(t, al); if (nu && !nu.igual) s.add(nu.nombre);
  return s;
}
/** Lo que existe seguro si `t` es falso. */
function siFalso(t, al, s = new Set()) {
  if (!t) return s;
  if (t.type === 'UnaryExpression' && t.operator === '!') siVerdad(t.argument, al, s);
  if (t.type === 'LogicalExpression' && t.operator === '||') { siFalso(t.left, al, s); siFalso(t.right, al, s); }
  if (t.type === 'CallExpression' && esBoolean(t, t.arguments[0])) siFalso(t.arguments[0], al, s);
  const tp = typeofDe(t, al); if (tp && tp.igual === (tp.valor === 'undefined')) s.add(tp.nombre);
  const nu = nuloDe(t, al); if (nu && nu.igual) s.add(nu.nombre);
  return s;
}
/** ¿Esta sentencia sale siempre (return, throw, break, continue)? */
function sale(st) {
  if (!st) return false;
  if (['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement'].includes(st.type)) return true;
  if (st.type === 'BlockStatement') return st.body.length > 0 && sale(st.body[st.body.length - 1]);
  if (st.type === 'IfStatement') return sale(st.consequent) && sale(st.alternate);
  return false;
}
const mas = (a, b) => (b.size ? new Set([...a, ...b]) : a);
/** Lo que se sabe después de un `if` (o de una cadena de else if) con una rama que sale. */
function despues(st, al) {
  if (!st || st.type !== 'IfStatement') return new Set();
  if (sale(st.consequent)) return mas(siFalso(st.test, al), despues(st.alternate, al));
  if (st.alternate && sale(st.alternate)) return siVerdad(st.test, al);
  return new Set();
}
const ES_FUNCION = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
/** Recorre los hijos de un nodo (sin loc ni range). */
function hijos(n, fn) {
  for (const k of Object.keys(n)) {
    if (k === 'loc' || k === 'range') continue;
    const v = n[k];
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') fn(x); }
    else if (v && typeof v.type === 'string') fn(v);
  }
}

const analisisCache = new Map();
/**
 * Lo que un trozo cuelga de window (`cuelga`), lo que lee por window (o por un
 * alias) dando por hecho que existe (`usos`) y dónde un nombre suelto está
 * protegido por su guarda (`protegidos`, «línea:columna» de espree).
 */
function analizar(codigo) {
  if (analisisCache.has(codigo)) return analisisCache.get(codigo);
  const r = { cuelga: new Set(), usos: [], protegidos: new Set() };
  const arbol = arbolDe(codigo);
  if (!arbol) {
    // No compila (ya se avisa aparte): lo que cuelga, por el texto, para no
    // sembrar avisos falsos en las páginas que lo cargan.
    for (const m of codigo.matchAll(/\b(?:global|window|globalThis|self)\.([A-Za-z_$][\w$]*)\s*(?:\|\||\?\?|&&)?=(?!=)/g)) r.cuelga.add(m[1]);
    analisisCache.set(codigo, r);
    return r;
  }
  // Primera pasada: ¿tiene un `self` propio?, y los alias de cada función
  // (`const G = window.X`, `G = window.X`).
  let selfPropio = false;
  const aliasDe = new Map();                       // función o Program → [[nombre, X]]
  objetosGlobales = OBJ_GLOBAL;
  const buscar = (n, ambito) => {
    if (ES_FUNCION.has(n.type) || n.type === 'Program') ambito = n;
    if ((n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === 'self')
      || (ES_FUNCION.has(n.type) && n.params.some(x => x.type === 'Identifier' && x.name === 'self'))) selfPropio = true;
    hijos(n, x => buscar(x, ambito));
  };
  buscar(arbol, arbol);
  if (selfPropio) objetosGlobales = new Set([...OBJ_GLOBAL].filter(x => x !== 'self'));
  const apuntarAlias = (n, ambito) => {
    if (ES_FUNCION.has(n.type) || n.type === 'Program') ambito = n;
    const par = n.type === 'VariableDeclarator' && n.id.type === 'Identifier' ? [n.id.name, deVentana(n.init)]
      : n.type === 'AssignmentExpression' && n.operator === '=' && n.left.type === 'Identifier' ? [n.left.name, deVentana(n.right)] : null;
    if (par && par[1]) { if (!aliasDe.has(ambito)) aliasDe.set(ambito, []); aliasDe.get(ambito).push(par); }
    hijos(n, x => apuntarAlias(x, ambito));
  };
  apuntarAlias(arbol, arbol);

  const secuencia = (lista, padre, seguros, al) => {
    let s = seguros;
    for (const st of lista) {
      visitar(st, padre, st.type === 'FunctionDeclaration' ? seguros : s, al);
      s = mas(s, despues(st, al));
    }
  };
  const visitar = (n, p, seguros, al) => {
    if (ES_FUNCION.has(n.type) || n.type === 'Program') {
      // Los alias de esta función, y fuera los que tapa un parámetro suyo.
      const propios = aliasDe.get(n) || [];
      const tapa = ES_FUNCION.has(n.type) ? n.params.filter(x => x.type === 'Identifier').map(x => x.name) : [];
      if (propios.length || tapa.some(x => al.has(x))) { al = new Map(al); tapa.forEach(x => al.delete(x)); propios.forEach(([a, x]) => al.set(a, x)); }
    }
    if (n.type === 'Identifier' && seguros.has(n.name)) r.protegidos.add(`${n.loc.start.line}:${n.loc.start.column}`);
    if (n.type === 'AssignmentExpression') { const N = deVentana(n.left); if (N) r.cuelga.add(N); }
    const N = deVentanaO(n, al);
    if (N && !(p && p.type === 'AssignmentExpression' && p.left === n)
      && !pregunta(n, p) && seUsa(n, p) && !seguros.has(N)) r.usos.push({ nombre: N, linea: n.loc.start.line });
    switch (n.type) {
      case 'IfStatement': case 'ConditionalExpression':
        visitar(n.test, n, seguros, al);
        visitar(n.consequent, n, mas(seguros, siVerdad(n.test, al)), al);
        if (n.alternate) visitar(n.alternate, n, mas(seguros, siFalso(n.test, al)), al);
        return;
      case 'LogicalExpression':
        visitar(n.left, n, seguros, al);
        visitar(n.right, n, n.operator === '&&' ? mas(seguros, siVerdad(n.left, al)) : n.operator === '||' ? mas(seguros, siFalso(n.left, al)) : seguros, al);
        return;
      case 'WhileStatement': case 'ForStatement':
        for (const k of ['init', 'test', 'update']) if (n[k]) visitar(n[k], n, seguros, al);
        visitar(n.body, n, mas(seguros, siVerdad(n.test, al)), al);
        return;
      case 'Program': case 'BlockStatement': case 'StaticBlock':
        secuencia(n.body, n, seguros, al);
        return;
      case 'SwitchCase':
        if (n.test) visitar(n.test, n, seguros, al);
        secuencia(n.consequent, n, seguros, al);
        return;
    }
    hijos(n, x => visitar(x, n, seguros, al));
  };
  visitar(arbol, null, new Set(), new Map());
  objetosGlobales = OBJ_GLOBAL;
  analisisCache.set(codigo, r);
  return r;
}

let linter = null;
try { const { Linter } = require('eslint'); linter = new Linter({ configType: 'flat' }); } catch (_) { /* se cuenta justo abajo */ }
if (!linter || !NAVEGADOR.size) {
  fallos++;
  console.log('  x falta eslint o globals (npm install): sin ellos no se mira qué nombres no existen en cada página');
}
// Sin configuración en comentarios: un `/* global X */` o un `eslint-disable`
// de un fichero no pueden decidir qué existe en la página.
const CONFIG_LIBRES = [{
  languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: NAVEGADOR.size ? require('globals').browser : {} },
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
  rules: { 'no-undef': 'error' },
}];
const libresCache = new Map();
/** Lo que un trozo usa sin declararlo él (ni ser del navegador): [{ nombre, linea, columna }]. */
function libresDe(codigo) {
  if (!libresCache.has(codigo)) {
    const out = [];
    for (const m of linter.verify(codigo, CONFIG_LIBRES)) {
      if (m.fatal || m.ruleId !== 'no-undef') continue;   // la sintaxis ya se avisa aparte
      const n = /^'(.+)' is not defined\.$/.exec(m.message);
      // Un mensaje con otra forma (otra versión de ESLint) es un fallo, no un
      // silencio: sin el nombre, la regla no sabría qué buscar.
      out.push(n ? { nombre: n[1], linea: m.line, columna: m.column } : { nombre: null, linea: m.line, raro: m.message });
    }
    libresCache.set(codigo, out);
  }
  return libresCache.get(codigo);
}
// Cada página guarda lo que trae (`hay`); se comprueba al final, cuando ya se
// sabe todo lo que cuelga la casa (para las lecturas por window).
const paginasNombres = [];
function revisarNombres(f, trozos, textos) {
  if (!linter || !NAVEGADOR.size) return;            // ya contado como fallo arriba
  const hay = new Set();
  for (const t of textos) {
    for (const s of srcsDe(t)) {
      if (!seEjecuta(s)) continue;                   // de otro host y sin nonce, la CSP no lo ejecuta
      for (const e of EXTERNOS) if (e.re.test(s.src)) e.nombres.forEach(n => hay.add(n));
    }
  }
  for (const t of trozos) {
    for (const d of declarados(arbolDe(t.codigo))) hay.add(d.nombre);
    for (const n of analizar(t.codigo).cuelga) hay.add(n);
  }
  paginasNombres.push({ f, trozos, hay });
}
// Un nombre que falta sale una vez por fichero, con sus líneas y sus páginas
// (en un componente, pueden ser muchas).
const sinDefinir = new Map();
function cerrarNombres() {
  // Lo que cuelga la casa: TODOS sus ficheros (también uno nuevo que aún no
  // carga ninguna página) y los scripts en línea de las vistas.
  const CASA = new Set();
  for (const js of jsDe(COMPONENTES, '')) for (const n of analizar(fs.readFileSync(path.join(COMPONENTES, ...js.split('/')), 'utf8')).cuelga) CASA.add(n);
  for (const { trozos } of paginasNombres) for (const t of trozos) for (const n of analizar(t.codigo).cuelga) CASA.add(n);
  const apuntar = (t, f, nombre, lineaTrozo, comoVentana, raro) => {
    const linea = (t.desde || 1) + lineaTrozo - 1;
    const clave = `${t.origen}\u0000${comoVentana ? 'window.' : ''}${nombre || raro}`;
    if (!sinDefinir.has(clave)) sinDefinir.set(clave, { origen: t.origen, nombre, comoVentana, raro, lineas: new Set(), paginas: new Set() });
    sinDefinir.get(clave).lineas.add(linea);
    sinDefinir.get(clave).paginas.add(f);
  };
  for (const { f, trozos, hay } of paginasNombres) {
    for (const t of trozos) {
      const a = analizar(t.codigo);
      for (const l of libresDe(t.codigo)) {
        // ESLint cuenta la columna desde 1; espree, desde 0.
        if (l.nombre && (hay.has(l.nombre) || a.protegidos.has(`${l.linea}:${l.columna - 1}`))) continue;
        apuntar(t, f, l.nombre, l.linea, false, l.raro);
      }
      for (const u of a.usos) {
        if (NAVEGADOR.has(u.nombre) || !(CASA.has(u.nombre) || NOMBRES_EXTERNOS.has(u.nombre))) continue;
        if (!hay.has(u.nombre)) apuntar(t, f, u.nombre, u.linea, true);
      }
    }
  }
}

// Los ficheros de public/assets/js que alguna vista carga (para los huérfanos).
const cargados = new Set();
// Un include roto del layout saldría en cada página: se avisa una vez.
const includesRotos = new Set();

for (const { nombre: f, ruta } of ficheros) {
  const html = fs.readFileSync(ruta, 'utf8');

  // Los datos del servidor: lo que lee su JavaScript —el de dentro y el de sus
  // ficheros de public/assets/js/vistas— contra lo que trae su bloque. Los
  // partials no: su bloque, si lo usan, está en la vista que los incluye.
  if (!/(^|\/)partials\//.test(f)) {
    let codigo = scriptsDe(html).map(s => s.codigo).join('\n');
    // Los trozos de la PÁGINA, cada uno con su origen: los scripts de su LAYOUT
    // (los componentes de la casa y layout/*.js incluidos), los de la vista, los
    // de sus ficheros y los de los partials que incluye. Para las reglas de abajo.
    const trozos = [];
    const textos = [];                             // para los <script> de la CDN
    const vistos = new Set();
    const deFicheros = (texto, deLaVista) => {
      for (const m of texto.matchAll(/\/assets\/js\/([^'"?)\s]+\.js)/g)) {
        if (vistos.has(m[1])) continue;            // el layout escribe cada ruta dos veces (est o no)
        vistos.add(m[1]);
        cargados.add(m[1]);
        const js = path.join(PUBLICO, 'assets', 'js', ...m[1].split('/'));
        if (!existeTal(path.join(PUBLICO, 'assets', 'js'), m[1])) { fallos++; console.log(`  x ${f}: carga /assets/js/${m[1]} y ese fichero no existe (con esas mayúsculas)`); continue; }
        const c = fs.readFileSync(js, 'utf8');
        if (deLaVista && /^(vistas|layout)\//.test(m[1])) codigo += '\n' + c;
        trozos.push({ origen: 'public/assets/js/' + m[1], codigo: c, propio: /^(vistas|layout)\//.test(m[1]) });
      }
    };
    // Los include se siguen desde la vista, desde el layout y desde los propios
    // partials, resueltos como EJS: junto al que incluye y, si no, en las
    // raíces de las vistas (RAICES); cada parcial, una vez. Antes, uno que no se
    // encontraba se saltaba en silencio: en Linux, con otras mayúsculas, el
    // build pasaba y la página daba error. Uno dentro de <!-- --> EJS lo
    // ejecuta igual: se exige que exista, pero lo suyo no carga en la página.
    const parciales = new Set();
    const deIncludes = (crudo, dir, deLaVista, quien, comentado = false) => {
      const t = sinComentariosEjs(crudo);
      const enHtml = [...t.matchAll(/<!--[\s\S]*?-->/g)].map(c => [c.index, c.index + c[0].length]);
      for (const m of t.matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
        const rel = m[1].endsWith('.ejs') ? m[1] : m[1] + '.ejs';
        const base = existeTal(dir, rel) ? dir : RAICES.find(r => existeTal(r, rel));
        if (!base) {
          const clave = `${quien}\u0000${m[1]}`;
          if (!includesRotos.has(clave)) {
            includesRotos.add(clave);
            fallos++;
            console.log(`  x ${path.relative(path.join(__dirname, '..'), quien).split(path.sep).join('/')} (linea ${lineaDe(t, m.index)}): include('${m[1]}') y ese fichero no existe (con esas mayúsculas)`);
          }
          continue;
        }
        const p = path.join(base, rel);
        const oculto = comentado || enHtml.some(([a, b]) => m.index > a && m.index < b);
        if (parciales.has(p + (oculto ? '#oculto' : ''))) continue;
        parciales.add(p + (oculto ? '#oculto' : ''));
        const crudoP = fs.readFileSync(p, 'utf8');
        if (!oculto) {
          const parcial = sinComentarios(crudoP);
          textos.push(parcial);
          scriptsDe(parcial).forEach((s, i) => trozos.push({ origen: m[1] + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true, desde: s.desde }));
          deFicheros(parcial, deLaVista);
        }
        deIncludes(crudoP, path.dirname(p), deLaVista, p, oculto);
      }
    };
    const layout = layoutDe(f);
    if (layout && fs.existsSync(layout)) {
      const crudoL = fs.readFileSync(layout, 'utf8');
      const lh = sinComentarios(crudoL);
      textos.push(lh);
      scriptsDe(lh).forEach((s, i) => trozos.push({ origen: path.basename(layout) + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true, desde: s.desde }));
      deFicheros(lh, false);
      deIncludes(crudoL, path.dirname(layout), false, layout);
    }
    const vista = sinComentarios(html);
    textos.push(vista);
    scriptsDe(vista).forEach((s, i) => trozos.push({ origen: f + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true, desde: s.desde }));
    deFicheros(vista, true);
    deIncludes(html, path.dirname(ruta), true, ruta);

    // DOS SCRIPTS DE LA MISMA PÁGINA NO PUEDEN DECLARAR LO MISMO (FRO-4). Los
    // <script> clásicos de una página comparten el ámbito global: si dos
    // declaran `const X` (o `let`, `class`) a primer nivel, el segundo no llega
    // a ejecutarse («Identifier 'X' has already been declared»); si son `function`
    // o `var`, el segundo sustituye al primero EN SILENCIO para todos. Con el
    // código repartido entre el layout, la vista, sus partials y sus ficheros
    // —el planificador son once—, esto ya no se ve leyendo un solo sitio.
    //
    // Y UN NOMBRE DEL NAVEGADOR TAMPOCO: una `function open()` o `close()` a
    // primer nivel sustituye a window.open para toda la página.
    revisarPagina(f, trozos);
    revisarNombres(f, trozos, textos);
    const { usa, leidas } = clavesLeidas(codigo);
    if (usa) {
      const bloque = clavesDelBloque(html);
      if (!bloque) {
        fallos++;
        console.log(`  x ${f}: su JavaScript usa Casa.datos() y la vista no trae <script type="application/json" id="datos-servidor">`);
      } else if (!bloque.abierto) {
        for (const k of leidas) {
          if (bloque.claves.has(k)) continue;
          fallos++;
          console.log(`  x ${f}: su JavaScript lee .${k} de Casa.datos() y el bloque de datos no lo trae — añádelo a <%- json({ … }) %>`);
        }
      }
    }
  }

  // Las tres reglas de la CSP (ver arriba). Y una cuarta (05/11/2026): un
  // <script src> de otro host que no sea cdnjs, y sin el nonce, no se ejecuta.
  const sinComentar = sinComentarios(html);
  for (const s of srcsDe(sinComentar)) {
    if (!/^https?:\/\//i.test(s.src) || seEjecuta(s)) continue;
    fallos++;
    console.log(`  x ${f} (linea ${lineaDe(sinComentar, s.i)}): <script src="${s.src}"> — con la CSP (app.js, script-src) solo se ejecutan los de ${CDN} (o los que llevan el nonce); cárgalo de ahí o súbelo a /assets`);
  }
  for (const m of html.matchAll(/<script\b((?:<%[\s\S]*?%>|[^>])*)>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["'](?!text\/javascript|module)/i.test(attrs)) continue;   // JSON: no se ejecuta
    if (!/\bnonce\s*=/i.test(attrs)) {
      fallos++;
      console.log(`  x ${f} (linea ${lineaDe(html, m.index)}): <script> sin nonce — con la CSP no se ejecuta. Escribe <script nonce="<%= nonce %>">`);
    }
  }
  for (const m of html.matchAll(/\son[a-z]+\s*=\s*["'\\]/gi)) {
    fallos++;
    console.log(`  x ${f} (linea ${lineaDe(html, m.index)}): manejador en un atributo (${m[0].trim()}…) — con la CSP no se ejecuta. Usa addEventListener`);
  }
  for (const m of html.matchAll(/<%-\s*JSON\.stringify\(/g)) {
    fallos++;
    console.log(`  x ${f} (linea ${lineaDe(html, m.index)}): <%- JSON.stringify(…) %> — usa <%- json(…) %>, que escapa «<»`);
  }
  // Desde el 04/11/2026 el `esc` de las vistas es uno (nucleo.js). Había 35
  // copias, no todas iguales; una nueva volvería a separarlas.
  for (const m of html.matchAll(/\b(?:(?:const|let|var)\s+esc\s*=(?!\s*(?:Casa|C)\.esc\b)|function\s+esc\s*\()/g)) {
    fallos++;
    console.log(`  x ${f} (linea ${lineaDe(html, m.index)}): un esc propio — usa const esc = Casa.esc; (nucleo.js), que escapa los cinco`);
  }
  for (const m of sinNombre(html)) {
    fallos++;
    console.log(`  x ${f} (linea ${lineaDe(html, m.i)}): ${m.que}`);
  }

  for (const s of scriptsDe(html)) {
    const codigo = sinEjs(s.codigo);
    if (!codigo.trim()) continue;
    revisados++;
    // EL JAVASCRIPT DE UNA PANTALLA VIVE EN SU FICHERO (FRO-4, 04/11/2026). En
    // una vista solo caben los arranques cortos que tienen que correr antes de
    // pintar (el tema, en la cabecera de los layouts: 20 y 15 líneas). Lo demás,
    // en public/assets/js/vistas/<Módulo>/<vista>.js, que se cachea y pasa
    // `npm run lint`; los datos, por el bloque y Casa.datos().
    const lineas = s.codigo.replace(/^\r?\n/, '').replace(/\s+$/, '').split('\n').length;
    if (lineas > MAX_EN_LINEA) {
      fallos++;
      console.log(`  x ${f} (linea ${s.desde}): un <script> de ${lineas} líneas dentro de la vista — va en public/assets/js/vistas (como mucho ${MAX_EN_LINEA} en línea)`);
    }
    try {
      new vm.Script(codigo, { filename: f });
    } catch (e) {
      fallos++;
      // La linea que da el error es relativa al <script>; se suma donde empieza.
      const linea = (String(e.stack).match(/:(\d+)\n/) || [])[1];
      console.log(`  x ${f}${linea ? ' (hacia la linea ' + (Number(linea) + s.desde - 1) + ')' : ''}: ${e.message}`);
    }
  }
}

// Los componentes de public/assets/js también montan HTML con cadenas: la regla
// de los manejadores en un atributo vale igual para ellos. Y desde el FRO-4
// (04/11/2026) también las subcarpetas —vistas/ y layout/, el JavaScript que
// salió de las vistas—, con las reglas que tenía dentro: compila, no trae EJS
// (ahí no se interpreta: saldría tal cual) y su `esc` es el de la casa.
// `vendor/` es de fuera y no se toca.
const COMPONENTES = path.join(__dirname, '..', 'public', 'assets', 'js');
function jsDe(dir, prefijo) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) { if (e.name !== 'vendor') out.push(...jsDe(path.join(dir, e.name), prefijo + e.name + '/')); }
    else if (e.name.endsWith('.js')) out.push(prefijo + e.name);
  }
  return out;
}
for (const f of jsDe(COMPONENTES, '')) {
  const js = fs.readFileSync(path.join(COMPONENTES, f), 'utf8');
  if (f.includes('/')) {
    revisados++;
    try { new vm.Script(js, { filename: f }); } catch (e) {
      fallos++;
      const linea = (String(e.stack).match(/:(\d+)\n/) || [])[1];
      console.log(`  x public/assets/js/${f}${linea ? ' (linea ' + linea + ')' : ''}: ${e.message}`);
    }
    for (const m of js.matchAll(/<%/g)) {
      fallos++;
      console.log(`  x public/assets/js/${f} (linea ${lineaDe(js, m.index)}): una etiqueta EJS en un .js — no se interpreta; el dato va en el bloque de la vista y se lee con Casa.datos()`);
    }
    for (const m of js.matchAll(/\b(?:(?:const|let|var)\s+esc\s*=(?!\s*(?:Casa|C)\.esc\b)|function\s+esc\s*\()/g)) {
      fallos++;
      console.log(`  x public/assets/js/${f} (linea ${lineaDe(js, m.index)}): un esc propio — usa const esc = Casa.esc;`);
    }
  }
  for (const m of js.matchAll(/\son[a-z]+\s*=\s*["'\\]/gi)) {
    fallos++;
    console.log(`  x public/assets/js/${f} (linea ${lineaDe(js, m.index)}): manejador en un atributo (${m[0].trim()}…) — con la CSP no se ejecuta. Usa addEventListener`);
  }
  for (const m of sinNombre(js)) {
    fallos++;
    console.log(`  x public/assets/js/${f} (linea ${lineaDe(js, m.i)}): ${m.que}`);
  }
}

// ── HUÉRFANOS (FRO-4) ────────────────────────────────────────────────────────
// Un fichero de vistas/ o layout/ que ninguna vista carga no existe en ninguna
// página: o falta su <script src> o sobra.
for (const js of jsDe(COMPONENTES, '').filter(x => /^(vistas|layout)\//.test(x))) {
  if (cargados.has(js)) continue;
  fallos++;
  console.log(`  x public/assets/js/${js}: ninguna vista lo carga — o falta su <script src> o sobra`);
}

// ── PANTALLAS PARTIDAS EN ÁREAS (FRO-4) ──────────────────────────────────────
// El planificador son once ficheros que comparten ámbito: las áreas solo traen
// funciones y constantes que NO ejecutan nada al cargar, y se cargan ANTES que el
// principal (estado y arranque). Una sentencia que se ejecute en un área podría
// usar algo del principal que aún no existe; un área que se cargue después, dejar
// al arranque sin una función.
const PARTIDAS = [{ carpeta: 'vistas/Planificacion/planificador/', principal: 'vistas/Planificacion/planificadorV2.js' }];
function puro(n) {
  if (!n) return true;
  switch (n.type) {
    case 'ArrowFunctionExpression': case 'FunctionExpression': case 'Literal': return true;
    case 'TemplateLiteral': return n.expressions.length === 0;
    case 'ArrayExpression': return n.elements.every(e => e && e.type !== 'SpreadElement' && puro(e));
    case 'ObjectExpression': return n.properties.every(p => p.type === 'Property' && !p.computed && puro(p.value));
    case 'UnaryExpression': return ['-', '+', '!'].includes(n.operator) && puro(n.argument);
    default: return false;
  }
}
for (const { carpeta, principal } of PARTIDAS) {
  const areas = jsDe(COMPONENTES, '').filter(x => x.startsWith(carpeta));
  for (const { nombre: f, ruta } of ficheros) {
    const orden = [...new Set([...fs.readFileSync(ruta, 'utf8').matchAll(/\/assets\/js\/([^'"?)\s]+\.js)/g)].map(m => m[1]))];
    const iP = orden.indexOf(principal);
    if (iP < 0) continue;
    for (const a of areas) {
      const iA = orden.indexOf(a);
      if (iA >= 0 && iA < iP) continue;
      fallos++;
      console.log(`  x ${f}: ${iA < 0 ? 'no carga' : 'carga después de ' + principal.split('/').pop()} public/assets/js/${a} — las áreas van antes del principal`);
    }
  }
  if (!espree) continue;
  for (const a of areas) {
    const arbol = arbolDe(fs.readFileSync(path.join(COMPONENTES, ...a.split('/')), 'utf8'));
    for (const s of (arbol ? arbol.body : [])) {
      const ok = s.type === 'FunctionDeclaration'
        || (s.type === 'VariableDeclaration' && s.kind === 'const' && s.declarations.every(d => d.id.type === 'Identifier' && puro(d.init)));
      if (ok) continue;
      fallos++;
      console.log(`  x public/assets/js/${a}: una sentencia que se ejecuta al cargar (${s.type}${s.kind ? ' ' + s.kind : ''}) — en un área solo van funciones y constantes que no ejecutan nada; lo demás, en ${principal.split('/').pop()}`);
    }
  }
}

// Los nombres que no existen en su página (revisarNombres): uno por fichero y nombre.
cerrarNombres();
for (const s of sinDefinir.values()) {
  fallos++;
  const paginas = [...s.paginas], lineas = [...s.lineas];
  const en = paginas.length > 3 ? `${paginas.slice(0, 3).join(', ')} y ${paginas.length - 3} más` : paginas.join(', ');
  const donde = `${lineas.length > 1 ? 'líneas' : 'línea'} ${lineas.slice(0, 6).join(', ')}${lineas.length > 6 ? '…' : ''}`;
  const que = s.comoVentana ? `lee window.${s.nombre} sin preguntar si está` : `usa «${s.nombre}»`;
  console.log(s.nombre
    ? `  x ${s.origen} (${donde}): ${que}, y en ${en} no existe — o la página no carga lo que lo define, o es una errata. Si viene de cdnjs, añádelo a EXTERNOS; si puede faltar, pregunta antes: if (!window.${s.nombre}) return; (o typeof ${s.nombre}, o window.${s.nombre}?.…)`
    : `  x ${s.origen} (${donde}): ESLint avisa con una forma que no se entiende («${s.raro}»): revisa libresDe`);
}

console.log(`\n${revisados} bloque(s) de JavaScript en ${ficheros.length} vistas`);
console.log(fallos ? `${fallos} NO COMPILAN` : 'Todos compilan');
process.exitCode = fallos ? 1 : 0;
