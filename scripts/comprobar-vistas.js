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

for (const { nombre: f, ruta } of ficheros) {
  const html = fs.readFileSync(ruta, 'utf8');

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
// de los manejadores en un atributo vale igual para ellos.
const COMPONENTES = path.join(__dirname, '..', 'public', 'assets', 'js');
for (const f of fs.readdirSync(COMPONENTES).filter(x => x.endsWith('.js')).sort()) {
  const js = fs.readFileSync(path.join(COMPONENTES, f), 'utf8');
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
