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
// que estar en el bloque de datos de su vista; y dos scripts de una misma
// página no pueden declarar el mismo nombre global.

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

for (const { nombre: f, ruta } of ficheros) {
  const html = fs.readFileSync(ruta, 'utf8');

  // Los datos del servidor: lo que lee su JavaScript —el de dentro y el de sus
  // ficheros de public/assets/js/vistas— contra lo que trae su bloque. Los
  // partials no: su bloque, si lo usan, está en la vista que los incluye.
  if (!/(^|\/)partials\//.test(f)) {
    let codigo = scriptsDe(html).map(s => s.codigo).join('\n');
    // Los trozos de la PÁGINA: los scripts de la vista, los de sus ficheros y
    // los de los partials que incluye. Para la regla de abajo.
    const trozos = scriptsDe(html).map(s => sinEjs(s.codigo));
    const deFicheros = texto => {
      for (const m of texto.matchAll(/\/assets\/js\/((?:vistas|layout)\/[^'"?)\s]+\.js)/g)) {
        const js = path.join(PUBLICO, 'assets', 'js', m[1]);
        if (fs.existsSync(js)) { const c = fs.readFileSync(js, 'utf8'); codigo += '\n' + c; trozos.push(c); }
        else { fallos++; console.log(`  x ${f}: carga /assets/js/${m[1]} y ese fichero no existe`); }
      }
    };
    deFicheros(html);
    for (const m of html.matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
      const p = path.join(path.dirname(ruta), m[1].endsWith('.ejs') ? m[1] : m[1] + '.ejs');
      if (!fs.existsSync(p)) continue;
      const parcial = fs.readFileSync(p, 'utf8');
      trozos.push(...scriptsDe(parcial).map(s => sinEjs(s.codigo)));
      deFicheros(parcial);
    }

    // DOS SCRIPTS DE LA MISMA PÁGINA NO PUEDEN DECLARAR LO MISMO (FRO-4). Los
    // <script> clásicos de una página comparten el ámbito global: si dos
    // declaran `const X` (o `let`, `class`) a primer nivel, el segundo no llega
    // a ejecutarse («Identifier 'X' has already been declared»). Con el código
    // repartido entre la vista, sus partials y sus ficheros, esto ya no se ve
    // leyendo un solo sitio. Se compilan juntos, como hace el navegador; el
    // `void 0;` de delante evita que un 'use strict' del primero valga para todos.
    if (trozos.length > 1) {
      try { new vm.Script('void 0;\n' + trozos.join('\n;\n'), { filename: f }); } catch (e) {
        if (/already been declared/.test(e.message)) {
          fallos++;
          console.log(`  x ${f}: dos scripts de la misma página declaran lo mismo (${e.message}) — mételo en una IIFE o cambia el nombre`);
        }
      }
    }
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

console.log(`\n${revisados} bloque(s) de JavaScript en ${ficheros.length} vistas`);
console.log(fallos ? `${fallos} NO COMPILAN` : 'Todos compilan');
process.exitCode = fallos ? 1 : 0;
