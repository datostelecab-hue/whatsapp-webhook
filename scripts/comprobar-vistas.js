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
// antes que su principal. Lo fino lo hace con el analizador de ESLint
// (devDependencies); sin él, solo los const/let repetidos.

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
const sinEjs = s => s
  .replace(/<%[-=]([\s\S]*?)%>/g, '(0)')
  .replace(/<%([\s\S]*?)%>/g, '');

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

if (fs.existsSync(MODULOS)) {
  for (const m of fs.readdirSync(MODULOS, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const dv = path.join(MODULOS, m.name, 'vistas');
    if (!fs.existsSync(dv)) continue;
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

// El analizador de ESLint, si está (devDependencies). Sin él, la regla se queda
// en lo que ve el compilador de Node: los const/let/class repetidos.
let espree = null, NAVEGADOR = new Set();
try { espree = require('espree'); } catch (_) { /* sin devDependencies */ }
try { NAVEGADOR = new Set(Object.keys(require('globals').browser)); } catch (_) { /* ídem */ }
const arbolCache = new Map();
function arbolDe(codigo) {
  if (!arbolCache.has(codigo)) {
    let a = null;
    try { a = espree.parse(codigo, { ecmaVersion: 'latest', sourceType: 'script' }); } catch (_) { /* la sintaxis ya se avisa aparte */ }
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

// Los ficheros de public/assets/js que alguna vista carga (para los huérfanos).
const cargados = new Set();

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
    const vistos = new Set();
    const deFicheros = (texto, deLaVista) => {
      for (const m of texto.matchAll(/\/assets\/js\/([^'"?)\s]+\.js)/g)) {
        if (vistos.has(m[1])) continue;            // el layout escribe cada ruta dos veces (est o no)
        vistos.add(m[1]);
        cargados.add(m[1]);
        const js = path.join(PUBLICO, 'assets', 'js', ...m[1].split('/'));
        if (!fs.existsSync(js)) { fallos++; console.log(`  x ${f}: carga /assets/js/${m[1]} y ese fichero no existe`); continue; }
        const c = fs.readFileSync(js, 'utf8');
        if (deLaVista && /^(vistas|layout)\//.test(m[1])) codigo += '\n' + c;
        trozos.push({ origen: 'public/assets/js/' + m[1], codigo: c, propio: /^(vistas|layout)\//.test(m[1]) });
      }
    };
    const layout = layoutDe(f);
    if (layout && fs.existsSync(layout)) {
      const lh = fs.readFileSync(layout, 'utf8');
      scriptsDe(lh).forEach((s, i) => trozos.push({ origen: path.basename(layout) + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true }));
      deFicheros(lh, false);
    }
    scriptsDe(html).forEach((s, i) => trozos.push({ origen: f + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true }));
    deFicheros(html, true);
    for (const m of html.matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
      const p = path.join(path.dirname(ruta), m[1].endsWith('.ejs') ? m[1] : m[1] + '.ejs');
      if (!fs.existsSync(p)) continue;
      const parcial = fs.readFileSync(p, 'utf8');
      scriptsDe(parcial).forEach((s, i) => trozos.push({ origen: m[1] + ' #' + (i + 1), codigo: sinEjs(s.codigo), propio: true }));
      deFicheros(parcial, true);
    }

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

  // Las tres reglas de la CSP (ver arriba).
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

console.log(`\n${revisados} bloque(s) de JavaScript en ${ficheros.length} vistas`);
console.log(fallos ? `${fallos} NO COMPILAN` : 'Todos compilan');
process.exitCode = fallos ? 1 : 0;
