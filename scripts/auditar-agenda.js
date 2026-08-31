// ============================================================
// ¿PUEDE POSTGRESQL RECONSTRUIR LA AGENDA?
// ============================================================
//   node scripts/auditar-agenda.js
//
// La agenda (AGENDA_V2) es la fuente de la que beben 24 módulos. Para poder
// dejar de leerla hay que poder RECONSTRUIRLA desde PostgreSQL, columna por
// columna, sin perder ni una.
//
// Esto compara las 34 columnas de la hoja con lo que hay en el esquema y dice
// cuáles faltan. No conecta a la base: lee los .sql y el mapa de columnas del
// propio motor, así que se puede correr en cualquier sitio.

const fs = require('fs');
const path = require('path');
const { A, A_HEADERS } = require('../services/planificadorV2');

// De dónde saldría cada columna de la agenda. `null` = todavía no hay de dónde.
const ORIGEN = {
  ACTIVO:              'conductor.empleo_vigente',
  ESTADO:              'conductor_estado_hist (vigente) → cat_estado_conductor.etiqueta',
  NOMBRE_APELLIDOS:    'conductor.nombre + apellidos',
  ID_BOLT:             'conductor_externo (sistema=bolt, vigente)',
  DNI_NIE:             'conductor.dni_nie',
  NAF:                 'conductor.naf (generada)',
  FECHA_ALTA:          'conductor_periodo_empleo.alta (abierto)',
  FIN_PERIODO_PRUEBA:  'conductor_periodo_empleo.fin_periodo_prueba',
  EN_PRUEBA:           '(se deduce de fin_periodo_prueba, no se guarda)',
  RECOMENDADOR:        'conductor.recomendador',
  TURNO:               'conductor_turno_hist (vigente) → turno.etiqueta',
  CONTRATO:            'conductor_periodo_empleo.jornada_horas + tipo',
  LIB_LUN:             'patron_libranza_dia (patrón vigente)',
  LIB_MAR:             'patron_libranza_dia',
  LIB_MIE:             'patron_libranza_dia',
  LIB_JUE:             'patron_libranza_dia',
  LIB_VIE:             'patron_libranza_dia',
  LIB_SAB:             'patron_libranza_dia',
  LIB_DOM:             'patron_libranza_dia',
  MATRICULA:           'asignacion → plaza → vehiculo.matricula',
  BINOMIO:             '(lo calcula el motor: se escribe pero nunca se lee)',
  COORDENADAS:         'conductor.lat / lng',
  DIRECCION_COMPLETA:  'conductor.direccion (generada)',
  TELEFONO:            'conductor_telefono (principal, vigente)',
  TEL_EMERGENCIA:      'conductor.tel_emergencia',
  OBSERVACIONES:       'conductor.observaciones',
  ASG_LUN:             '(lo calcula el motor, no se lee)',
  ASG_MAR:             '(lo calcula el motor)',
  ASG_MIE:             '(lo calcula el motor)',
  ASG_JUE:             '(lo calcula el motor)',
  ASG_VIE:             '(lo calcula el motor)',
  ASG_SAB:             '(lo calcula el motor)',
  ASG_DOM:             '(lo calcula el motor)',
  REINCORPORACION:     'conductor_estado_hist.hasta_previsto',
};

// Columnas que existen de verdad, leídas de los .sql.
const DIR = path.join(__dirname, '..', 'db');
const sql = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
  .map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n')
  .replace(/--[^\n]*/g, '');

function columnasDe(tabla) {
  const m = sql.match(new RegExp('CREATE TABLE ' + tabla + '\\s*\\(', 'i'));
  if (!m) return null;
  let nivel = 0, cuerpo = '', i = sql.indexOf('(', m.index);
  for (; i < sql.length; i++) {
    if (sql[i] === '(') nivel++;
    else if (sql[i] === ')') { nivel--; if (!nivel) break; }
    if (nivel) cuerpo += sql[i];
  }
  const cols = new Set();
  for (const linea of cuerpo.split('\n')) {
    const c = linea.trim().match(/^([a-z_][a-z0-9_]*)\s+[A-Za-z]/);
    if (c && !/^(constraint|primary|unique|foreign|check|exclude)$/i.test(c[1])) cols.add(c[1]);
  }
  // Y lo que añadan los ALTER.
  for (const s of sql.split(';')) {
    if (!new RegExp('ALTER TABLE\\s+' + tabla + '\\b', 'i').test(s)) continue;
    for (const a of s.matchAll(/ADD COLUMN (?:IF NOT EXISTS )?([a-z_]+)/gi)) cols.add(a[1]);
  }
  return cols;
}

console.log(`La agenda tiene ${A_HEADERS.length} columnas.\n`);

const faltan = [], calculadas = [], listas = [];
A_HEADERS.forEach((cab, i) => {
  const origen = ORIGEN[cab];
  if (origen === undefined) { faltan.push({ cab, col: i + 1, motivo: 'sin mapear' }); return; }
  if (origen === null) { faltan.push({ cab, col: i + 1, motivo: 'no existe en PostgreSQL' }); return; }
  if (origen.startsWith('(')) { calculadas.push(cab); return; }
  // Se comprueba que la tabla y la columna citadas existan.
  const ref = origen.match(/^([a-z_]+)\.([a-z_]+)/);
  if (ref) {
    const cols = columnasDe(ref[1]);
    if (!cols) { faltan.push({ cab, col: i + 1, motivo: `no existe la tabla ${ref[1]}` }); return; }
    if (!cols.has(ref[2])) { faltan.push({ cab, col: i + 1, motivo: `${ref[1]} no tiene ${ref[2]}` }); return; }
  }
  listas.push({ cab, origen });
});

console.log(`LISTAS (${listas.length}):`);
listas.forEach(l => console.log(`  ok  ${l.cab.padEnd(20)} ← ${l.origen}`));

console.log(`\nLAS CALCULA EL MOTOR (${calculadas.length}): ${calculadas.join(', ')}`);

console.log(`\nFALTAN (${faltan.length}):`);
faltan.forEach(f => console.log(`  x   ${f.cab.padEnd(20)} col ${f.col} — ${f.motivo}`));

console.log(`\n${listas.length} listas · ${calculadas.length} calculadas · ${faltan.length} por resolver`);
process.exitCode = faltan.length ? 1 : 0;
