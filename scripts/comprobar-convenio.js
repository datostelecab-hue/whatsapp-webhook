// ============================================================
// COMPROBAR: el esquema del convenio aguanta el seed
// ============================================================
//   node scripts/comprobar-convenio.js [ruta-al-seed.sql]
//
// El seed llega de fuera (asesoria) y el esquema lo escribimos nosotros. Si una
// columna del INSERT no existe en el CREATE TABLE, el seed se estrella a mitad
// y deja la carga a medias. Aqui se cruzan los dos ANTES de tocar la base:
//
//   1. Cada tabla que el seed rellena, existe en el esquema.
//   2. Cada columna que el seed nombra, existe en su tabla.
//   3. El numero de parametros coincide con lo que el propio seed dice esperar.
//
// No ejecuta SQL: lee los dos ficheros y compara. Es la red que sustituye a "lo
// aplico y a ver que pasa" cuando no hay una base a mano.

const fs = require('fs');
const path = require('path');
const RAIZ = path.join(__dirname, '..');

const DDL = path.join(RAIZ, 'db', '30-convenio-esquema.sql');
// El seed puede pasarse como argumento; por defecto se busca en Downloads y en
// la raiz del proyecto.
const SEED = process.argv[2]
  || [path.join(RAIZ, 'seed_convenio_vtc_madrid.sql'),
      path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'seed_convenio_vtc_madrid.sql')]
       .find(p => fs.existsSync(p));

let mal = 0;
const ok = (t, cond, extra) => {
  if (!cond) mal++;
  console.log((cond ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : ''));
};

if (!SEED || !fs.existsSync(SEED)) {
  console.log('\nNo encuentro el seed. Pasa su ruta:  node scripts/comprobar-convenio.js C:\\ruta\\seed.sql');
  process.exit(2);
}

const ddl = fs.readFileSync(DDL, 'utf8');
const seed = fs.readFileSync(SEED, 'utf8');

// ── Las columnas de cada CREATE TABLE del esquema ───────────────────────────
// Se lee el bloque entre parentesis y se toma la primera palabra de cada linea
// que empiece por un identificador (las que definen columna). Se ignoran las
// lineas de CONSTRAINT.
function columnasDelDDL(sql) {
  const tablas = {};
  const re = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(sql))) {
    const nombre = m[1];
    // Recorrer desde el "(" contando parentesis hasta cerrar la tabla.
    let i = m.index + m[0].length - 1, prof = 0, fin = i;
    for (; i < sql.length; i++) {
      if (sql[i] === '(') prof++;
      else if (sql[i] === ')') { prof--; if (prof === 0) { fin = i; break; } }
    }
    const cuerpo = sql.slice(m.index + m[0].length, fin);
    const cols = new Set();
    for (const linea of cuerpo.split('\n')) {
      const t = linea.trim();
      if (!t || t.startsWith('--')) continue;
      const palabra = t.match(/^([a-z_][a-z0-9_]*)/i);
      if (!palabra) continue;
      const p = palabra[1].toUpperCase();
      if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'FOREIGN', 'CHECK', 'EXCLUDE'].includes(p)) continue;
      cols.add(palabra[1].toLowerCase());
    }
    tablas[nombre] = cols;
  }
  return tablas;
}

// ── Los INSERT del seed: a que tabla y con que columnas ─────────────────────
function insertsDelSeed(sql) {
  const out = [];
  const re = /INSERT\s+INTO\s+(\w+)\s*\(([^;]*?)\)\s*VALUES/gis;
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[2].split(',').map(c => c.trim().toLowerCase()).filter(Boolean);
    out.push({ tabla: m[1], cols });
  }
  return out;
}

const tablas = columnasDelDDL(ddl);
const inserts = insertsDelSeed(seed);

console.log('\n== Las tablas que el seed rellena existen en el esquema ==');
const tablasSeed = [...new Set(inserts.map(i => i.tabla))];
for (const t of tablasSeed) {
  ok(t.padEnd(26), !!tablas[t], tablas[t] ? '' : '<- NO EXISTE en el DDL');
}

console.log('\n== Cada columna del seed tiene su hueco en la tabla ==');
for (const { tabla, cols } of inserts) {
  const definidas = tablas[tabla];
  if (!definidas) continue;   // ya se marco arriba
  const huerfanas = cols.filter(c => !definidas.has(c));
  ok(`${tabla} (${cols.length} col)`.padEnd(30),
    huerfanas.length === 0,
    huerfanas.length ? 'sin sitio: ' + huerfanas.join(', ') : '');
}

console.log('\n== El recuento que el propio seed manda comprobar ==');
// El seed dice: "SELECT count(*) FROM agreement_parameter --> esperado 57".
const declarado = (seed.match(/esperado\s+(\d+)/) || [])[1];
const filasParam = insertsDelSeed(seed)
  .filter(i => i.tabla === 'agreement_parameter')
  .length;
// Contar las tuplas reales del bloque de agreement_parameter.
const bloque = seed.slice(seed.indexOf('INSERT INTO agreement_parameter'));
const finBloque = bloque.indexOf(';');
const tuplas = (bloque.slice(0, finBloque).match(/\n\s*\('a1000000/g) || []).length;
ok(`agreement_parameter: ${tuplas} tuplas reales`,
   tuplas > 0,
   declarado ? `(el seed dice esperar ${declarado})` : '');
if (declarado && Number(declarado) !== tuplas) {
  console.log(`  !!  El comentario del seed dice ${declarado} y hay ${tuplas}. ` +
              'No rompe la carga, pero la comprobacion de count(*) del seed fallara.');
}

console.log(mal ? `\n${mal} PROBLEMA(S): el seed NO cargaria limpio` : '\nEl seed encaja con el esquema');
process.exitCode = mal ? 1 : 0;
