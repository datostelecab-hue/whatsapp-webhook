// ============================================================
// LOS MÓDULOS CARGAN
// ============================================================
//   node scripts/comprobar-modulos.js
//
// `node --check` solo mira la sintaxis. Un `module.exports = { hacerAlgo }` con
// `hacerAlgo` ya no declarado compila perfectamente y revienta al CARGAR — o
// sea, al arrancar el servidor, o al entrar en la pantalla que lo use.
//
// Pasa al reorganizar: se sustituye un bloque, se lleva por delante una función
// de al lado, y la exportación se queda apuntando al vacío. Aquí se cargan de
// verdad, que es lo único que lo detecta.
//
// Solo `services/repo/`: son los que más se mueven y los únicos que se pueden
// cargar sin efectos. Requerir `services/` entero levantaría clientes de Google
// y crones, que es justo lo que no debe hacer una comprobación.
//
// Cargar `repo/` es seguro porque `services/db.js` crea el pool PEREZOSO: no
// conecta hasta la primera consulta.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'services', 'repo');
const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();

let fallos = 0;
const exportado = [];

for (const f of ficheros) {
  try {
    const m = require(path.join(DIR, f));
    const nombres = Object.keys(m || {});
    // Un módulo que no exporta nada casi siempre es un olvido, no una decisión.
    if (!nombres.length) {
      fallos++;
      console.log(`  x repo/${f}: no exporta nada`);
      continue;
    }
    // Y una exportación que es `undefined` es el caso que se busca: el nombre
    // está en la lista pero la función ya no existe.
    const vacias = nombres.filter(k => m[k] === undefined);
    if (vacias.length) {
      fallos++;
      console.log(`  x repo/${f}: exporta ${vacias.map(v => '"' + v + '"').join(', ')} como undefined`);
    }
    exportado.push(`  ok repo/${f}: ${nombres.length} exportación(es)`);
  } catch (e) {
    fallos++;
    console.log(`  x repo/${f}: no carga — ${String(e.message).split('\n')[0]}`);
  }
}

if (!fallos) exportado.forEach(l => console.log(l));
console.log(`\n${ficheros.length} módulo(s) de repositorio`);
console.log(fallos ? `${fallos} NO cargan bien` : 'Todos cargan y exportan lo que dicen');

// ============================================================
// LO QUE UNA RUTA LLAMA, EL SERVICIO LO EXPORTA
// ============================================================
// El otro medio fallo de lo mismo: `const exp = require('../services/explorador')`
// y luego `exp.escribir(...)` cuando el servicio nunca exportó `escribir`.
// Compila, arranca, y revienta el día que alguien pulsa ese botón.
//
// Solo se mira el patrón claro —un require con nombre y llamadas `nombre.metodo(`—
// y solo en servicios cuyo `module.exports = { … }` se puede leer entero. Lo que
// no se entiende con seguridad no se marca: un comprobador que grita en falso
// enseña a ignorarlo.

const SERV = path.join(__dirname, '..', 'services');

/** Los nombres que exporta un servicio, o null si no se puede saber. */
function exporta(rel) {
  const ruta = path.join(SERV, rel + '.js');
  if (!fs.existsSync(ruta)) return null;
  const txt = fs.readFileSync(ruta, 'utf8');
  const m = txt.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/);
  if (!m) return null;                       // exporta otra cosa (un router, una clase)
  if (/\.\.\./.test(m[1])) return null;      // hay un spread: no se ve todo
  const nombres = new Set();
  for (const trozo of m[1].split(',')) {
    const t = trozo.replace(/\/\/[^\n]*/g, '').trim();
    const n = t.match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
    if (n) nombres.add(n[1]);
  }
  return nombres.size ? nombres : null;
}

let malLlamados = 0, llamadas = 0;
for (const dir of ['routes', 'services']) {
  const carpeta = path.join(__dirname, '..', dir);
  for (const f of fs.readdirSync(carpeta).filter(x => x.endsWith('.js'))) {
    const txt = fs.readFileSync(path.join(carpeta, f), 'utf8').replace(/\/\/[^\n]*/g, '');
    // const alias = require('../services/loQueSea')
    for (const r of txt.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(['"][^'"]*services\/([\w/]+)['"]\)/g)) {
      const [, alias, rel] = r;
      const nombres = exporta(rel);
      if (!nombres) continue;
      for (const c of txt.matchAll(new RegExp('\\b' + alias + '\\.([A-Za-z_$][\\w$]*)\\s*\\(', 'g'))) {
        llamadas++;
        if (nombres.has(c[1])) continue;
        malLlamados++;
        console.log(`  x ${dir}/${f}: llama a ${alias}.${c[1]}() y services/${rel} no lo exporta`);
      }
    }
  }
}

console.log(`\n${llamadas} llamada(s) entre módulos comprobadas`);
console.log(malLlamados ? `${malLlamados} apuntan a algo que no existe` : 'Todas apuntan a algo que existe');

// ============================================================
// LAS FUNCIONES DE CASA EXISTEN
// ============================================================
// El tercer medio fallo de la misma familia, y el que más veces ha pasado: se
// sustituye un bloque, se lleva por delante una función auxiliar de al lado, y
// las llamadas se quedan apuntando al vacío.
//
// No lo ve nadie: `node --check` compila —es sintaxis válida—, el módulo carga
// —la función solo falta cuando se EJECUTA esa línea—, y las exportaciones
// siguen estando. Revienta el día que alguien pulsa el botón, y con un mensaje
// que no dice de dónde viene: "aDiaMesAnio is not defined".
//
// LA REGLA, a propósito estrecha: se marca un nombre solo si TODAS sus
// apariciones en el fichero son llamadas. Si aparece una sola vez como otra cosa
// —un parámetro, un destructurado, una declaración— se calla. Así un parámetro
// que este lector no sepa leer produce un olvido y no un grito, que es el error
// que se puede permitir: un comprobador que se equivoca enseña a ignorarlo.

const GLOBALES = new Set([
  'require', 'module', 'exports', 'process', 'console', 'Buffer', 'URL', 'URLSearchParams',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'queueMicrotask',
  'fetch', 'structuredClone', 'AbortController', 'TextEncoder', 'TextDecoder',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math', 'JSON', 'Date',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Proxy', 'Reflect', 'Function', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Palabras que van seguidas de paréntesis y no son llamadas a nada.
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'new', 'delete',
  'do', 'else', 'yield', 'void', 'in', 'of', 'case', 'function', 'class', 'super', 'this',
  'async',
]);

// Dónde puede empezar una expresión regular: justo después de algo que NO es un
// valor. Detrás de un valor, una barra es una división.
const ABRE_REGEX = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';',
  '+', '-', '*', '%', '~', '^', '<', '>']);

/**
 * El texto sin nada que PAREZCA código sin serlo.
 *
 * Hacen falta las cuatro cosas, y cada una se aprendió a base de gritos en
 * falso: un SQL entre comillas trae `count(`, un comentario trae `la vista (…)`,
 * una expresión regular trae `VIEW (`, y una plantilla trae `${n} caso(s)`.
 *
 * Y se lee CARÁCTER A CARÁCTER en vez de con expresiones regulares. Con regex
 * casi funcionaba, y ese "casi" era el problema: una plantilla con otra dentro
 * —`${x} de ${`${y}`}`— se cerraba en la comilla equivocada, y a partir de ahí
 * el fichero entero quedaba desalineado. El resultado eran nueve avisos de
 * funciones que sí existían, que es exactamente como se aprende a ignorar esto.
 */
function soloCodigo(txt) {
  const n = txt.length;
  let out = '', i = 0, anterior = '';
  // Una pila porque `${ }` vuelve a modo código dentro de una plantilla, y ahí
  // dentro puede empezar otra plantilla.
  const pila = [{ plantilla: false, llaves: 0 }];
  const cima = () => pila[pila.length - 1];

  while (i < n) {
    const c = txt[i], d = txt[i + 1];

    if (cima().plantilla) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { pila.pop(); i++; out += ' TXT '; anterior = 'x'; continue; }
      if (c === '$' && d === '{') { pila.push({ plantilla: false, llaves: 0 }); i += 2; out += ' '; continue; }
      i++;
      continue;
    }

    if (c === '/' && d === '/') { while (i < n && txt[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(txt[i] === '*' && txt[i + 1] === '/')) i++;
      i += 2; out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && txt[i] !== q) { if (txt[i] === '\\') i++; i++; }
      i++; out += ' TXT '; anterior = 'x';
      continue;
    }
    if (c === '`') { pila.push({ plantilla: true, llaves: 0 }); i++; continue; }
    if (c === '/' && ABRE_REGEX.has(anterior)) {
      i++;
      let dentroDeCorchetes = false;
      while (i < n) {
        const x = txt[i];
        if (x === '\\') { i += 2; continue; }
        if (x === '\n') break;
        if (x === '[') dentroDeCorchetes = true;
        else if (x === ']') dentroDeCorchetes = false;
        else if (x === '/' && !dentroDeCorchetes) break;
        i++;
      }
      i++;
      while (i < n && 'gimsuyd'.includes(txt[i])) i++;
      out += ' RE '; anterior = 'x';
      continue;
    }

    if (c === '{') cima().llaves++;
    if (c === '}') {
      // La llave que cierra un `${ }` devuelve a la plantilla de fuera.
      if (cima().llaves === 0 && pila.length > 1) { pila.pop(); i++; continue; }
      cima().llaves--;
    }

    out += c;
    if (!/\s/.test(c)) anterior = c;
    i++;
  }
  return out;
}

let sinDefinir = 0, nombresVistos = 0;
for (const dir of [['services'], ['services', 'repo'], ['routes'], ['scripts']]) {
  const carpeta = path.join(__dirname, '..', ...dir);
  if (!fs.existsSync(carpeta)) continue;
  const mote = dir.join('/') + '/';

  for (const f of fs.readdirSync(carpeta).filter(x => x.endsWith('.js'))) {
    const txt = soloCodigo(fs.readFileSync(path.join(carpeta, f), 'utf8'));

    // Dónde aparece cada nombre, y cuántas de esas veces es una llamada.
    const veces = new Map(), comoLlamada = new Map();
    const suma = (mapa, k) => mapa.set(k, (mapa.get(k) || 0) + 1);

    for (const m of txt.matchAll(/([.\w$]?)\s*\b([A-Za-z_$][\w$]*)\b\s*(\(?)/g)) {
      const [, antes, nombre, abre] = m;
      if (antes === '.') continue;                       // es una propiedad, no un nombre suelto
      suma(veces, nombre);
      if (!abre) continue;
      // Una DEFINICIÓN también lleva paréntesis: `function f(…) {`, `f(…) {`
      // de un método, `class X {`. Eso no cuenta como llamada.
      const resto = txt.slice(m.index + m[0].length);
      if (/^[^()]*\)\s*\{/.test(resto)) continue;
      suma(comoLlamada, nombre);
    }

    for (const [nombre, n] of comoLlamada) {
      if (GLOBALES.has(nombre)) continue;
      nombresVistos++;
      if (veces.get(nombre) > n) continue;               // aparece como otra cosa: está declarado
      sinDefinir++;
      console.log(`  x ${mote}${f}: llama a ${nombre}() y no está declarado en el fichero`);
    }
  }
}

console.log(`\n${nombresVistos} nombre(s) llamados en el propio fichero`);
console.log(sinDefinir ? `${sinDefinir} no existen` : 'Todos existen');

process.exitCode = (fallos || malLlamados || sinDefinir) ? 1 : 0;
