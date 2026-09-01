// ============================================================
// COMPROBAR MIGRACIONES — cazar los errores que Postgres daria
// ============================================================
//   node scripts/comprobar-migraciones.js
//
// No hay una base a mano para aplicar, asi que este analisis estatico caza las
// CLASES de error que YA han reventado, CRUZANDO todos los ficheros en orden
// (el agujero estaba ahi: un valor en la 48 contra una columna de la 45).
//
// Es PRECISO a proposito: un comprobador que grita en falso no lo mira nadie.
// Solo tres cosas, y las tres cualificadas por tabla, no por nombre suelto:
//   1. Un valor de un CHECK ... IN mas largo que el ancho de SU columna.
//   2. Una funcion set-returning (RETURNS TABLE/SETOF) extraida como escalar
//      con (fn(...)).columna -- el patron exacto que rompio la 46.
//   3. ALTER COLUMN TYPE de una columna de una tabla de la que depende una
//      vista viva, sin soltar la vista antes.
//
// NO sustituye a aplicar contra Postgres. Coge lo que se repite, no todo.

const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'db');

const ficheros = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
let problemas = 0;
const fallo = (f, msg) => { problemas++; console.log(`  MAL  ${f}: ${msg}`); };

// Quita comentarios y cadenas para no contar parentesis dentro de ellos.
const limpiar = sql => sql
  .replace(/--[^\n]*/g, '')
  .replace(/\$func\$[\s\S]*?\$func\$/g, '$B$')   // cuerpos de funcion: fuera del conteo de ()
  .replace(/\$\$[\s\S]*?\$\$/g, '$B$')
  .replace(/'(?:[^']|'')*'/g, "''");

// Estado acumulado CRUZANDO ficheros.
const colWidth = {};       // 'tabla.col' -> ancho VARCHAR
const srf = new Set();     // funciones set-returning
const vistaTablas = {};    // vista viva -> Set de tablas que menciona en FROM/JOIN

// La tabla a la que pertenece un CHECK: la del CREATE/ALTER que lo envuelve.
function tablaDelCheck(sql, posCheck) {
  const antes = sql.slice(0, posCheck);
  const mT = [...antes.matchAll(/(?:CREATE TABLE(?:\s+IF NOT EXISTS)?|ALTER TABLE)\s+(\w+)/gi)];
  return mT.length ? mT[mT.length - 1][1] : null;
}

// Acumuladores del ESTADO FINAL (tras aplicar todo en orden).
const checks = [];        // { f, tabla, col, valores }
const funcs = {};         // nombre -> { f, cuerpo }  (ultima definicion viva)
const dropped = new Set();
const alters = [];        // { f, tabla, col }  ALTER COLUMN TYPE, para el chequeo de vistas

for (const f of ficheros) {
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
  const limpio = limpiar(sql);

  // Estructura, por fichero (esto si es local).
  if ((sql.match(/\bBEGIN;/g) || []).length !== (sql.match(/\bCOMMIT;/g) || []).length) {
    fallo(f, 'BEGIN/COMMIT descuadrados');
  }
  const ab = (limpio.match(/\(/g) || []).length, ce = (limpio.match(/\)/g) || []).length;
  if (ab !== ce) fallo(f, `parentesis descuadrados (${ab} vs ${ce})`);
  if ((sql.split('$func$').length - 1) % 2 !== 0) fallo(f, 'dollar-quote $func$ sin cerrar');

  // Anchos, en orden: el ultimo ALTER manda.
  for (const m of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
    for (const c of m[2].matchAll(/^\s*([a-z_]+)\s+VARCHAR\((\d+)\)/gim)) colWidth[`${m[1]}.${c[1]}`] = +c[2];
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)[\s\S]*?ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)\s+VARCHAR\((\d+)\)/gi)) {
    colWidth[`${m[1]}.${m[2]}`] = +m[3];
  }
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)[\s\S]*?ALTER COLUMN\s+(\w+)\s+TYPE\s+VARCHAR\((\d+)\)/gi)) {
    colWidth[`${m[1]}.${m[2]}`] = +m[3];
  }

  // CHECK ... IN: acumular con su tabla (se evalua al final contra el ancho final).
  for (const m of sql.matchAll(/CHECK\s*\(\s*([a-z_]+)\s+IN\s*\(([^)]*)\)/gi)) {
    const tabla = tablaDelCheck(sql, m.index);
    if (tabla) checks.push({ f, tabla, col: m[1], valores: [...m[2].matchAll(/'([^']*)'/g)].map(x => x[1]) });
  }

  // Funciones: la ultima definicion viva de cada nombre.
  for (const m of sql.matchAll(/CREATE(?:\s+OR REPLACE)?\s+FUNCTION\s+(\w+)\s*\([^)]*\)\s*RETURNS\s+(TABLE|SETOF|\w+)([\s\S]*?)\$func\$([\s\S]*?)\$func\$/gi)) {
    funcs[m[1]] = { f, cuerpo: m[4], srf: /^(TABLE|SETOF)$/i.test(m[2]) };
    dropped.delete(m[1]);
  }
  for (const m of sql.matchAll(/DROP FUNCTION(?:\s+IF EXISTS)?\s+(\w+)/gi)) { dropped.add(m[1]); delete funcs[m[1]]; }

  // Vistas vivas (para el chequeo de ALTER).
  for (const m of sql.matchAll(/CREATE(?:\s+OR REPLACE)?\s+VIEW\s+(\w+)\s+AS([\s\S]*?);\s*(?:COMMENT|CREATE|DROP|BEGIN|$)/gi)) {
    vistaTablas[m[1]] = new Set([...m[2].matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map(x => x[1].toLowerCase()));
  }
  for (const m of sql.matchAll(/DROP VIEW(?:\s+IF EXISTS)?\s+(\w+)/gi)) delete vistaTablas[m[1]];

  // ALTER COLUMN TYPE con vista viva sin soltar antes (esto SI es por fichero).
  for (const m of sql.matchAll(/ALTER TABLE\s+(\w+)[\s\S]*?ALTER COLUMN\s+(\w+)\s+TYPE/gi)) {
    const tabla = m[1].toLowerCase();
    for (const [vista, tablas] of Object.entries(vistaTablas)) {
      if (tablas.has(tabla)) {
        const iDrop = sql.search(new RegExp(`DROP VIEW(?:\s+IF EXISTS)?\s+${vista}\b`, 'i'));
        const iAlter = sql.search(new RegExp(`ALTER COLUMN\s+${m[2]}\s+TYPE`, 'i'));
        if (iDrop === -1 || iDrop > iAlter) {
          fallo(f, `ALTER COLUMN ${m[2]} TYPE en ${tabla}, pero la vista ${vista} la usa y no se suelta antes`);
        }
      }
    }
  }
}

// ── Evaluacion del ESTADO FINAL ──
// Los CHECK, contra el ancho FINAL de su columna (un ALTER posterior lo arregla).
for (const c of checks) {
  const ancho = colWidth[`${c.tabla}.${c.col}`];
  if (ancho == null) continue;
  for (const v of c.valores) if (v.length > ancho) {
    fallo(c.f, `'${v}' (${v.length}) no cabe en ${c.tabla}.${c.col} VARCHAR(${ancho}) [ancho final]`);
  }
}
// Las funciones set-returning VIVAS, extraidas como escalar en algun cuerpo vivo.
const srfVivas = Object.keys(funcs).filter(n => funcs[n].srf);
for (const [nombre, def] of Object.entries(funcs)) {
  for (const srfn of srfVivas) {
    if (new RegExp(`\(\s*${srfn}\s*\([^)]*\)\s*\)\s*\.`, 'i').test(def.cuerpo)) {
      fallo(def.f, `${nombre}() extrae como escalar la set-returning ${srfn}(...).col -- ilegal`);
    }
  }
}

console.log('');
if (problemas) {
  console.log(`${problemas} PROBLEMA(S) que Postgres rechazaria. Corrige antes de desplegar.`);
  process.exitCode = 1;
} else {
  console.log(`${ficheros.length} migraciones revisadas. Ninguno de los errores conocidos.`);
  console.log('(No sustituye a aplicar contra Postgres: coge lo que se repite, no todo.)');
}
