// ============================================================
// COMPROBADOR DE ESQUEMA (sin base de datos)
// ============================================================
// Lee todos los db/*.sql, saca qué tablas y columnas existen, y avisa de las
// referencias `alias.columna` que no cuadran.
//
//   node scripts/comprobar-sql.js
//
// No sustituye a ejecutar la migración, pero pilla el error que de verdad se
// comete: escribir `a.hasta` cuando esa tabla usa `baja`. Ese fallo no se ve
// leyendo, no lo detecta ningún editor, y en PostgreSQL no aparece hasta que
// alguien ejecuta esa consulta concreta — que puede ser semanas despues.

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'db');
const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
const texto = ficheros.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');

// Fuera comentarios: dentro hay ejemplos y prosa que no son SQL.
const limpio = texto.replace(/--[^\n]*/g, '');

// ---------- qué existe ----------

const tablas = new Map();   // tabla → Set(columnas)

/** Corta el bloque de parentesis que abre en `desde`, respetando anidamientos. */
function bloque(s, desde) {
  let nivel = 0;
  for (let i = desde; i < s.length; i++) {
    if (s[i] === '(') nivel++;
    else if (s[i] === ')') { nivel--; if (!nivel) return s.slice(desde + 1, i); }
  }
  return '';
}

for (const m of limpio.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)\s*\(/gi)) {
  const cuerpo = bloque(limpio, m.index + m[0].length - 1);
  const cols = new Set();
  // Se parte por comas de primer nivel: dentro de CHECK(...) hay comas propias.
  let nivel = 0, actual = '';
  for (const ch of cuerpo) {
    if (ch === '(') nivel++;
    if (ch === ')') nivel--;
    if (ch === ',' && !nivel) { cols.add(actual); actual = ''; continue; }
    actual += ch;
  }
  cols.add(actual);

  const nombres = new Set();
  for (const def of cols) {
    const d = def.trim();
    if (!d) continue;
    // Las restricciones y claves no son columnas.
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)\b/i.test(d)) continue;
    const nom = d.match(/^"?([a-z_][a-z0-9_]*)"?\s/i);
    if (nom) nombres.add(nom[1].toLowerCase());
  }
  const t = m[1].toLowerCase();
  tablas.set(t, new Set([...(tablas.get(t) || []), ...nombres]));
}

// ALTER TABLE ... ADD COLUMN. Un mismo ALTER puede anadir VARIAS columnas de
// una vez, asi que primero se aisla la sentencia y luego se sacan todas: con un
// solo patron sobre el fichero entero se cogia unicamente la primera de cada
// bloque y las demas parecian no existir.
for (const sent of limpio.split(';')) {
  const cab = sent.match(/ALTER TABLE\s+(?:ONLY\s+)?([a-z_]+)/i);
  if (!cab) continue;
  const t = cab[1].toLowerCase();
  for (const c of sent.matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/gi)) {
    if (!tablas.has(t)) tablas.set(t, new Set());
    tablas.get(t).add(c[1].toLowerCase());
  }
}

// Las vistas exponen columnas nuevas; se registran por su lista de alias AS.
const vistas = new Map();
for (const m of limpio.matchAll(/CREATE (?:OR REPLACE )?VIEW ([a-z_]+) AS([\s\S]*?);/gi)) {
  const cols = new Set();
  for (const a of m[2].matchAll(/\bAS\s+([a-z_][a-z0-9_]*)/gi)) cols.add(a[1].toLowerCase());
  // Y las columnas seleccionadas sin AS (`a.conductor_id,`).
  for (const a of m[2].matchAll(/([a-z_]+)\.([a-z_][a-z0-9_]*)\s*[,\n]/gi)) cols.add(a[2].toLowerCase());
  // `SELECT v.*` o `SELECT *`: la vista hereda columnas que no se pueden saber
  // desde aqui. Se marca con un comodin para no dar falsos avisos al usarla.
  if (/SELECT\s+(?:[a-z_]+\.)?\*/i.test(m[2])) cols.add('*');
  vistas.set(m[1].toLowerCase(), cols);
}

// ---------- qué se referencia ----------

let fallos = 0, revisadas = 0;

/**
 * El SQL que hay dentro de un fichero JavaScript.
 *
 * Las consultas viven en plantillas de texto con trozos interpolados
 * (`${cols.join(',')}`). Se sustituyen por un hueco neutro: lo que se comprueba
 * son los nombres escritos a mano, que es donde está el error humano.
 */
function sqlDeJs(txt) {
  const trozos = [];
  for (const m of txt.matchAll(/`([^`]*)`/g)) {
    const t = m[1];
    if (!/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM)\b/i.test(t)) continue;
    trozos.push(t.replace(/\$\{[^}]*\}/g, ' _ '));
  }
  return trozos;
}

// Todos los sitios donde se escribe SQL: los .sql, los repositorios y los
// cargadores.
//
// Durante un tiempo esto solo miraba `services/repo/`, y por ahí se coló SQL sin
// revisar en dos sitios: los cargadores de `scripts/`, que son los que más
// nombres de columna escriben de una sentada, y los servicios sueltos de
// `services/`, donde vive todo lo que habla con BOLT y con Mapon.
//
// Una columna mal tecleada ahí no revienta al arrancar: revienta a mitad de una
// carga o dentro de un cron, que es cuando peor viene y donde menos se mira.
//
// Solo se ve el SQL escrito entre comillas invertidas, así que ahí se escribe.
const fuentes = ficheros.map(f => ({ nombre: f, sql: [fs.readFileSync(path.join(DIR, f), 'utf8')] }));
for (const [dir, mote] of [[['services', 'repo'], 'repo/'],
                           [['services'], 'services/'],
                           [['scripts'], 'scripts/']]) {
  const ruta = path.join(__dirname, '..', ...dir);
  if (!fs.existsSync(ruta)) continue;
  for (const f of fs.readdirSync(ruta).filter(x => x.endsWith('.js'))) {
    const sql = sqlDeJs(fs.readFileSync(path.join(ruta, f), 'utf8'));
    if (sql.length) fuentes.push({ nombre: mote + f, sql });
  }
}

for (const fuente of fuentes) {
  const bruto = fuente.sql.join('\n;\n').replace(/--[^\n]*/g, '');
  const f = fuente.nombre;
  // Cada sentencia por separado: los alias no cruzan de una a otra.
  for (const sent of bruto.split(';')) {
    // ── Las listas de columnas de un INSERT ──
    //
    // Esto no se miraba, y era el hueco grande: un INSERT escribe veinte o
    // treinta nombres de columna de una sentada, sin alias delante, así que la
    // comprobación de abajo (que busca `alias.columna`) no veía ni uno. Y un
    // INSERT ... VALUES ni siquiera llegaba aquí, porque el filtro de la línea
    // siguiente solo dejaba pasar SELECT, UPDATE y DELETE.
    //
    // Es justo donde peor duele equivocarse: no falla al arrancar, falla a
    // mitad de una carga.
    for (const m of sent.matchAll(/\bINSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/gi)) {
      const tabla = m[1].toLowerCase();
      const cols = tablas.get(tabla);
      if (!cols || !cols.size || cols.has('*')) continue;   // CTE, o tabla que no conocemos
      for (const trozo of m[2].split(',')) {
        const col = trozo.trim().toLowerCase();
        if (!/^[a-z_][a-z0-9_]*$/.test(col)) continue;      // expresiones, no columnas
        // `_` es la marca que deja sqlDeJs donde había una interpolación: la
        // lista de columnas se arma en JavaScript y desde aquí no se puede
        // saber cuál es. No es un error, es que no se ve.
        if (col === '_') continue;
        revisadas++;
        if (!cols.has(col)) {
          fallos++;
          console.log(`  x ${f}: INSERT INTO ${tabla} — no existe la columna "${col}"`);
          const parecidas = [...cols].filter(c => c.startsWith(col.slice(0, 3)) || col.startsWith(c.slice(0, 3)));
          if (parecidas.length) console.log(`      ¿querías decir ${parecidas.slice(0, 4).join(', ')}?`);
        }
      }
    }

    if (!/\b(SELECT|UPDATE|DELETE)\b/i.test(sent)) continue;

    // alias → tabla(s), sacado de FROM/JOIN/UPDATE.
    //
    // Se guarda un CONJUNTO por alias, no una tabla suelta: una misma sentencia
    // puede usar el mismo alias en dos subconsultas distintas. SQL lo resuelve
    // por ámbito, pero aquí no hay ámbitos, así que un alias ambiguo se deja
    // pasar en vez de inventarse un error.
    const alias = new Map();
    const anota = (ali, tabla) => {
      if (!alias.has(ali)) alias.set(ali, new Set());
      alias.get(ali).add(tabla);
    };
    for (const m of sent.matchAll(/\b(?:FROM|JOIN|UPDATE)\s+([a-z_]+)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi)) {
      const tabla = m[1].toLowerCase();
      const ali = (m[2] || '').toLowerCase();
      const palabras = ['on', 'where', 'set', 'using', 'select', 'group', 'order', 'lateral', 'cross', 'left', 'join', 'and', 'or', 'as'];
      if (!tablas.has(tabla) && !vistas.has(tabla)) continue;
      anota(tabla, tabla);
      if (ali && !palabras.includes(ali)) anota(ali, tabla);
    }
    if (!alias.size) continue;

    for (const m of sent.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const ali = m[1].toLowerCase(), col = m[2].toLowerCase();
      const posibles = alias.get(ali);
      if (!posibles || posibles.size !== 1) continue;   // sin alias, o ambiguo
      const tabla = [...posibles][0];
      const cols = tablas.get(tabla) || vistas.get(tabla);
      if (!cols || !cols.size || cols.has('*')) continue;
      revisadas++;
      if (!cols.has(col)) {
        fallos++;
        console.log(`  x ${f}: ${ali}.${col} — "${tabla}" no tiene esa columna`);
        const parecidas = [...cols].filter(c => c.startsWith(col.slice(0, 3)) || col.startsWith(c.slice(0, 3)));
        if (parecidas.length) console.log(`      ¿querías decir ${parecidas.slice(0, 4).join(', ')}?`);
      }
    }
  }
}

console.log(`\n${tablas.size} tablas y ${vistas.size} vistas leídas de ${ficheros.length} ficheros`);
console.log(`${revisadas} referencias comprobadas en ${fuentes.length} fuentes · ${fallos} sin cuadrar`);

// Y que el mapa de vigencias siga cuadrando con las tablas de verdad, sin
// necesidad de conectarse: es el fallo que ya nos costó una pantalla vacía.
const vig = fs.readFileSync(path.join(__dirname, '..', 'services', 'repo', 'vigencia.js'), 'utf8');
const bloqueTipos = vig.slice(vig.indexOf('const TIPOS = {'), vig.indexOf('\n};', vig.indexOf('const TIPOS = {')));
let malVig = 0;
for (const m of bloqueTipos.matchAll(/(\w+):\s*\{\s*tabla:\s*'([a-z_]+)',\s*entidad:\s*'([a-z_]+)'([^}]*)\}/g)) {
  const [, tipo, tabla, entidad, resto] = m;
  const cols = tablas.get(tabla);
  if (!cols) { console.log(`  x vigencia "${tipo}": no existe la tabla ${tabla}`); malVig++; continue; }
  const desde = (resto.match(/desde:\s*'([a-z_]+)'/) || [, 'desde'])[1];
  const hasta = (resto.match(/hasta:\s*'([a-z_]+)'/) || [, 'hasta'])[1];
  for (const [que, c] of [['entidad', entidad], ['desde', desde], ['hasta', hasta]]) {
    if (!cols.has(c)) { console.log(`  x vigencia "${tipo}": ${tabla} no tiene ${que} "${c}"`); malVig++; }
  }
  const mira = resto.match(/mira:\s*\{\s*col:\s*'([a-z_]+)',\s*tabla:\s*'([a-z_]+)',\s*\n?\s*clave:\s*'([a-z_]+)',\s*campo:\s*'([a-z_]+)'/);
  if (mira) {
    const [, col, cat, clave, campo] = mira;
    if (!cols.has(col)) { console.log(`  x vigencia "${tipo}": ${tabla} no tiene "${col}"`); malVig++; }
    const cc = tablas.get(cat);
    if (!cc) { console.log(`  x vigencia "${tipo}": no existe el catálogo ${cat}`); malVig++; }
    else [clave, campo].forEach(c => {
      if (!cc.has(c)) { console.log(`  x vigencia "${tipo}": ${cat} no tiene "${c}"`); malVig++; }
    });
  }
}
console.log(malVig ? `${malVig} problema(s) en el mapa de vigencias` : 'El mapa de vigencias cuadra con el esquema');

// Y que los campos que la ficha declara editables sean COLUMNAS DE VERDAD y no
// generadas. Escribir en una columna generada es un error de PostgreSQL, y un
// campo mal escrito se descubre cuando alguien intenta guardar.
const cond = require(path.join(__dirname, '..', 'services', 'repo', 'conductores.js'));
const colsConductor = tablas.get('conductor') || new Set();
// Las generadas se sacan del propio .sql: llevan GENERATED ALWAYS AS.
const sqlNucleo = fs.readFileSync(path.join(DIR, '01-nucleo.sql'), 'utf8');
const generadas = new Set([...sqlNucleo.matchAll(/^\s+([a-z_]+)\s+[A-Z][^\n]*GENERATED ALWAYS AS/gm)].map(m => m[1]));

let malCampos = 0;
for (const [campo, def] of Object.entries(cond.CAMPOS || {})) {
  if (!colsConductor.has(campo)) {
    console.log(`  x campo editable "${campo}": no existe en la tabla conductor`);
    malCampos++;
  } else if (generadas.has(campo)) {
    console.log(`  x campo editable "${campo}": es una columna GENERADA, no se puede escribir`);
    malCampos++;
  }
  if (!def.etiqueta) { console.log(`  x campo "${campo}": sin etiqueta, saldría sin nombre en pantalla`); malCampos++; }
  if (!def.grupo) { console.log(`  x campo "${campo}": sin grupo`); malCampos++; }
}
// Y al revés: columnas que se pueden escribir y nadie declara editables. No es
// un error —el teléfono, por ejemplo, tiene su propio historial— pero conviene
// verlas para decidir a conciencia.
const NO_EDITABLES = new Set([
  'id', 'es_centinela', 'empleo_vigente', 'creado_at', 'actualizado_at',
  'iban_cifrado',            // va cifrado, no se toca desde un formulario
  'pais_codigo', 'pais_nacimiento_codigo',   // los pone el propio país
]);
const huerfanas = [...colsConductor].filter(c =>
  !generadas.has(c) && !NO_EDITABLES.has(c) && !(cond.CAMPOS || {})[c]);
if (huerfanas.length) console.log(`  · columnas sin declarar editables (a propósito o no): ${huerfanas.join(', ')}`);

console.log(malCampos
  ? `${malCampos} problema(s) en el mapa de campos editables`
  : `Los ${Object.keys(cond.CAMPOS || {}).length} campos editables cuadran con la tabla`);

process.exitCode = (fallos || malVig || malCampos) ? 1 : 0;
