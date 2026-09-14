// ============================================================
// COMPROBADOR DE CAPAS — que el dibujo de la arquitectura sea verdad
// ============================================================
//   node scripts/comprobar-capas.js            los incumplimientos
//   node scripts/comprobar-capas.js --todo     además, la foto completa
//   node scripts/comprobar-capas.js --medir    solo los números, sin juzgar
//
// El orden es:
//
//   Petición HTTP → Controlador → Servicio → Repositorio → Base de datos
//
// Y la regla que de verdad importa: EL CONTROLADOR NO DECIDE NADA. Traduce
// HTTP a una llamada y la respuesta a HTTP. Si un controlador sabe que una
// baja cierra la asignación y además avisa por WhatsApp, esa regla vive en el
// sitio donde nadie la va a encontrar: en una ruta.
//
// Un dibujo en un documento no lo cumple nadie a los tres meses. Esto lo
// comprueba, y por eso están aquí las reglas y no en un PDF.
//
// LO QUE SE MIRA, Y POR QUÉ ESTAS COSAS Y NO OTRAS:
//
//   · SQL en el controlador          saltarse dos capas de golpe
//   · el pool de la base importado   lo mismo, por la puerta de atrás
//   · manejadores largos             donde se esconde la lógica de negocio
//   · un repositorio llamando a un servicio   la flecha al revés
//
// No pretende ser un analizador de verdad: no hay árbol sintáctico, se leen
// los ficheros con expresiones regulares después de quitar comentarios y
// cadenas. Se equivoca por defecto hacia NO acusar.

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const args = process.argv.slice(2);
const TODO = args.includes('--todo');
const SOLO_MEDIR = args.includes('--medir');

// Un manejador más largo que esto casi siempre lleva dentro una decisión. No es
// una ley: es el punto a partir del cual merece la pena mirarlo.
const LINEAS_MANEJADOR = 25;
// Llamar a dos módulos de dominio en una ruta es normal (leer dos cosas para
// pintar una pantalla). A partir de tres, eso es orquestar, y orquestar es
// lógica de negocio.
const MODULOS_POR_MANEJADOR = 3;

// ── Leer el código sin comentarios ni cadenas ──────────────────────────────
// Sin esto, cualquier SELECT dentro de un comentario explicativo —y aquí hay
// muchos— saldría como una infracción. Se sustituyen por espacios en vez de
// borrarlos para que los números de línea no se muevan.
function desnudar(src) {
  let fuera = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { fuera += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      fuera += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { fuera += src[i] === '\n' ? '\n' : ' '; i++; }
      fuera += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      fuera += c; i++;
      while (i < n) {
        if (src[i] === '\\') { fuera += '  '; i += 2; continue; }
        if (src[i] === cierre) break;
        fuera += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      fuera += cierre; i++; continue;
    }
    fuera += c; i++;
  }
  return fuera;
}

/**
 * Solo sin comentarios: las cadenas se quedan enteras.
 *
 * Hace falta porque `desnudar` vacía también el contenido de las cadenas, y la
 * ruta de un `require` ES una cadena. Sustituye carácter a carácter, así que
 * las posiciones siguen valiendo para el fichero original.
 */
function sinComentarios(src) {
  let fuera = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { fuera += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      fuera += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { fuera += src[i] === '\n' ? '\n' : ' '; i++; }
      fuera += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c;
      fuera += c; i++;
      while (i < n) {
        if (src[i] === '\\') { fuera += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === cierre) break;
        fuera += src[i]; i++;
      }
      fuera += cierre; i++; continue;
    }
    fuera += c; i++;
  }
  return fuera;
}

/** El texto de las cadenas, aparte: ahí es donde vive el SQL de verdad. */
function cadenasDe(src) {
  const trozos = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const cierre = c; i++;
      let t = '';
      while (i < n) {
        if (src[i] === '\\') { t += src[i + 1] || ''; i += 2; continue; }
        if (src[i] === cierre) break;
        t += src[i]; i++;
      }
      trozos.push(t); i++; continue;
    }
    i++;
  }
  return trozos;
}

const ES_SQL = /\b(SELECT\s+[\s\S]*\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)/i;

// ── LA LISTA QUE HAY QUE DISCUTIR ──────────────────────────────────────────
// `services/` guarda hoy dos cosas que no se parecen en nada:
//
//   · ADAPTADORES: hablan con el mundo de fuera (WhatsApp, Drive, Sheets,
//     Mapon, BOLT, el correo) o son herramienta pura (cifrar, dar formato a un
//     Excel). NO saben nada del negocio. Cualquier capa puede usarlos, igual
//     que cualquiera puede usar `path` o `fs`: son el suelo, no una capa.
//
//   · SERVICIOS DE DOMINIO: saben qué es un turno, una libranza o una jornada.
//     Esos SÍ son una capa, y un repositorio no puede llamarlos: sería la capa
//     de datos dependiendo de las reglas, y entonces no se puede probar ni leer
//     una sin arrastrar la otra.
//
// La lista va escrita a mano y no adivinada: adivinar por el nombre acabaría
// tarde o temprano colando un servicio de dominio como adaptador, que es justo
// el error que esto tiene que cazar. Añadir uno aquí es una decisión, y como
// tal se ve en el commit.
const ADAPTADORES = new Set([
  'services/whatsapp',      // Cloud API de Meta
  'services/drive',         // Google Drive
  'services/sheets',        // Google Sheets
  'services/correo',        // IMAP/SMTP
  'services/mapon',         // telemetría
  'services/bolt',          // API de BOLT
  'services/cripto',        // cifrar/descifrar
  'services/geocoding',     // direcciones → coordenadas
  'services/excelEstilo',   // estilo común de los .xlsx
  'services/limiteIntentos',
  'services/configApp',
  'services/modoPruebas',
]);

// Los pools de conexión: services/db y el propio de flota viva.
const esBase = rel => rel === 'services/db' || /\/db$/.test(rel);

// TRANSVERSALES: quién eres y qué puedes. Los usa todo el mundo y no son
// dominio, así que no cuentan al medir si un manejador está orquestando. Sin
// esto, `actor.idDe(req)` —que aparece en casi toda escritura— haría que
// cualquier ruta de dos pasos pareciera que orquesta tres módulos.
const TRANSVERSALES = new Set(['services/repo/actor', 'services/sesion', 'services/permisos']);

/** Los require() de un fichero, ya clasificados por capa. */
function importes(desnudo, desde) {
  const out = [];
  for (const m of desnudo.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) { out.push({ spec, capa: 'externo' }); continue; }
    const abs = path.resolve(path.dirname(desde), spec);
    const rel = path.relative(RAIZ, abs).replace(/\\/g, '/').replace(/\.js$/, '');
    let capa = 'otro';
    if (esBase(rel)) capa = 'base';
    else if (ADAPTADORES.has(rel)) capa = 'adaptador';
    else if (rel.startsWith('services/repo/')) capa = 'repositorio';
    else if (rel.startsWith('services/')) capa = 'servicio';
    else if (rel.startsWith('routes/')) capa = 'controlador';
    out.push({ spec, rel, capa });
  }
  return out;
}

/**
 * Los manejadores de un router, con su tamaño.
 *
 * Se localiza `router.verbo(` y se avanza contando paréntesis y llaves hasta
 * cerrar. No es un analizador sintáctico, pero sobre código que ya compila
 * (comprobar-modulos.js lo garantiza) cuenta bien.
 */
function manejadores(desnudo, conCadenas) {
  const out = [];
  const re = /\brouter\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(/g;
  let m;
  while ((m = re.exec(desnudo))) {
    let i = m.index + m[0].length;
    let prof = 1;
    while (i < desnudo.length && prof > 0) {
      const c = desnudo[i];
      if (c === '(' || c === '{' || c === '[') prof++;
      else if (c === ')' || c === '}' || c === ']') prof--;
      i++;
    }
    const cuerpo = desnudo.slice(m.index, i);
    const linea = desnudo.slice(0, m.index).split('\n').length;
    // Las líneas que cuentan son las que hacen algo: ni vacías ni cerrar llaves.
    const utiles = cuerpo.split('\n').filter(l => l.trim() && !/^[\s})\];,]*$/.test(l.trim())).length;
    // La ruta se saca del texto CON cadenas: en `desnudo` está vaciada. Las
    // posiciones coinciden porque desnudar() sustituye carácter a carácter.
    const ruta = (conCadenas.slice(m.index, i).match(/^[^,]*?['"]([^'"]*)['"]/) || [])[1] || '?';
    out.push({ verbo: m[1], ruta, linea, lineas: utiles, cuerpo, cuerpoCadenas: conCadenas.slice(m.index, i) });
    re.lastIndex = i;
  }
  return out;
}

// ── Revisar un controlador ─────────────────────────────────────────────────
function revisarControlador(fichero) {
  const abs = path.join(RAIZ, fichero);
  const src = fs.readFileSync(abs, 'utf8');
  const desnudo = desnudar(src);
  const conCadenas = sinComentarios(src);
  const imps = importes(conCadenas, abs);
  const faltas = [], avisos = [];

  for (const rel of new Set(imps.filter(i => i.capa === 'base').map(i => i.rel))) {
    faltas.push({ que: 'importa el pool de la base', detalle: rel });
  }
  for (const s of cadenasDe(src)) {
    if (ES_SQL.test(s)) { faltas.push({ que: 'lleva SQL dentro', detalle: s.replace(/\s+/g, ' ').trim().slice(0, 70) + '…' }); break; }
  }

  // Nombres de los módulos de dominio que importa, para contarlos por manejador.
  const dominio = imps.filter(i => i.capa === 'repositorio' || i.capa === 'servicio').map(i => i.rel);
  const alias = new Map();
  for (const m of conCadenas.matchAll(/(?:const|let|var)\s+(?:\{([^}]*)\}|(\w+))\s*=\s*require\(\s*['"]([^'"]+)['"]/g)) {
    const spec = m[3];
    if (!spec.startsWith('.')) continue;
    const rel = path.relative(RAIZ, path.resolve(path.dirname(abs), spec)).replace(/\\/g, '/').replace(/\.js$/, '');
    if (!rel.startsWith('services/')) continue;
    if (m[2]) alias.set(m[2], rel);
    else for (const n of (m[1] || '').split(',')) { const k = n.split(':').pop().trim(); if (k) alias.set(k, rel); }
  }

  const manes = manejadores(desnudo, conCadenas);
  for (const h of manes) {
    if (h.lineas > LINEAS_MANEJADOR) {
      avisos.push({ que: `manejador de ${h.lineas} líneas`, detalle: `${h.verbo.toUpperCase()} ${h.ruta} (línea ${h.linea})` });
    }
    const usados = new Set();
    for (const [nombre, rel] of alias) {
      if (new RegExp(`\\b${nombre}\\s*\\.`).test(h.cuerpo)) usados.add(rel);
    }
    const cuerpoCadenas = conCadenas.slice(desnudo.indexOf(h.cuerpo) >= 0 ? desnudo.indexOf(h.cuerpo) : 0, 0) || h.cuerpoCadenas || '';
    for (const mm of (h.cuerpoCadenas || '').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (mm[1].startsWith('.')) usados.add(path.relative(RAIZ, path.resolve(path.dirname(abs), mm[1])).replace(/\\/g, '/').replace(/\.js$/, ''));
    }
    for (const t of TRANSVERSALES) usados.delete(t);
    if (usados.size >= MODULOS_POR_MANEJADOR) {
      avisos.push({ que: `orquesta ${usados.size} módulos`, detalle: `${h.verbo.toUpperCase()} ${h.ruta} → ${[...usados].map(x => x.split('/').pop()).join(', ')}` });
    }
  }

  return { fichero, capa: 'controlador', faltas, avisos, manejadores: manes.length,
    lineas: src.split('\n').length, dominio: [...new Set(dominio)] };
}

// ── Revisar un repositorio ─────────────────────────────────────────────────
function revisarRepositorio(fichero) {
  const abs = path.join(RAIZ, fichero);
  const src = fs.readFileSync(abs, 'utf8');
  const imps = importes(sinComentarios(src), abs);
  const faltas = [];
  // La flecha va hacia abajo. Un repositorio que llama a un servicio de dominio
  // deja de ser la capa de datos: ya no se puede leer ni probar una sin la otra.
  // Los adaptadores no cuentan: son el suelo, no una capa de encima.
  for (const rel of new Set(imps.filter(i => i.capa === 'servicio').map(i => i.rel))) {
    faltas.push({ que: 'llama hacia ARRIBA, a un servicio de dominio', detalle: rel });
  }
  for (const rel of new Set(imps.filter(i => i.capa === 'controlador').map(i => i.rel))) {
    faltas.push({ que: 'llama a un controlador', detalle: rel });
  }
  return { fichero, capa: 'repositorio', faltas, avisos: [], lineas: src.split('\n').length };
}

// ── Arranque ───────────────────────────────────────────────────────────────
const rutas = fs.readdirSync(path.join(RAIZ, 'routes')).filter(f => f.endsWith('.js')).sort();
const repos = fs.readdirSync(path.join(RAIZ, 'services', 'repo')).filter(f => f.endsWith('.js')).sort();

const infC = rutas.map(f => revisarControlador('routes/' + f));
const infR = repos.map(f => revisarRepositorio('services/repo/' + f));
const todos = [...infC, ...infR];

const nFaltas = todos.reduce((a, x) => a + x.faltas.length, 0);
const nAvisos = todos.reduce((a, x) => a + x.avisos.length, 0);

if (!SOLO_MEDIR) {
  console.log('\n═══ INCUMPLIMIENTOS (hay que arreglarlos) ═══');
  let hubo = false;
  for (const x of todos) {
    if (!x.faltas.length) continue;
    hubo = true;
    console.log(`\n  ${x.fichero}`);
    x.faltas.forEach(f => console.log(`      x ${f.que}: ${f.detalle}`));
  }
  if (!hubo) console.log('  ninguno');

  console.log('\n═══ PARA MIRAR (probable lógica de negocio en el controlador) ═══');
  const conAvisos = infC.filter(x => x.avisos.length);
  if (!conAvisos.length) console.log('  ninguno');
  for (const x of conAvisos) {
    console.log(`\n  ${x.fichero}  (${x.lineas} líneas, ${x.manejadores} rutas)`);
    x.avisos.forEach(a => console.log(`      · ${a.que}: ${a.detalle}`));
  }
}

console.log('\n═══ LA FOTO ═══');
const conServicio = infC.filter(x => x.dominio.some(d => !d.startsWith('services/repo/'))).length;
const soloRepo = infC.filter(x => x.dominio.length && x.dominio.every(d => d.startsWith('services/repo/'))).length;
const sinNada = infC.filter(x => !x.dominio.length).length;
console.log(`  ${infC.length} controladores · ${infC.reduce((a, x) => a + x.manejadores, 0)} rutas · ${infC.reduce((a, x) => a + x.lineas, 0)} líneas`);
console.log(`     ${soloRepo} van directos al repositorio (sin capa de servicio)`);
console.log(`     ${conServicio} pasan por algún servicio`);
console.log(`     ${sinNada} no tocan dominio (pantallas sueltas, redirecciones)`);
console.log(`  ${infR.length} repositorios · ${infR.reduce((a, x) => a + x.lineas, 0)} líneas`);
console.log(`\n  ${nFaltas} incumplimiento(s) · ${nAvisos} aviso(s)`);

if (TODO) {
  console.log('\n═══ DE QUÉ COME CADA CONTROLADOR ═══');
  for (const x of infC) {
    console.log(`  ${x.fichero.replace('routes/', '').padEnd(24)} ${String(x.manejadores).padStart(3)} rutas  ${x.dominio.map(d => d.replace('services/', '')).join(', ') || '—'}`);
  }
}

// Los avisos NO tumban la comprobación: son deuda conocida, no un error nuevo.
process.exit(nFaltas ? 1 : 0);
