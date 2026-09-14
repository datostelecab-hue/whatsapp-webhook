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

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'views');

/** El contenido de cada <script> que no sea de un fichero externo. */
function scriptsDe(html) {
  const trozos = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
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
const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.ejs')).sort()
  .map(f => ({ nombre: f, ruta: path.join(DIR, f) }));

if (fs.existsSync(MODULOS)) {
  for (const m of fs.readdirSync(MODULOS, { withFileTypes: true })) {
    if (!m.isDirectory()) continue;
    const dv = path.join(MODULOS, m.name, 'vistas');
    if (!fs.existsSync(dv)) continue;
    for (const f of fs.readdirSync(dv).filter(x => x.endsWith('.ejs')).sort()) {
      ficheros.push({ nombre: `${m.name}/${f}`, ruta: path.join(dv, f) });
    }
  }
}

let fallos = 0, revisados = 0;

for (const { nombre: f, ruta } of ficheros) {
  const html = fs.readFileSync(ruta, 'utf8');
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

console.log(`\n${revisados} bloque(s) de JavaScript en ${ficheros.length} vistas`);
console.log(fallos ? `${fallos} NO COMPILAN` : 'Todos compilan');
process.exitCode = fallos ? 1 : 0;
