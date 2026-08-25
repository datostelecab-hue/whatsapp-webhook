// ============================================================
// FLOTA VIVA — lo que se puede comprobar sin base ni APIs
// ============================================================
//   node scripts/probar-flota-viva.js
//
// Dos cosas, y las dos ya han fallado de verdad:
//
//   1. LAS FRANJAS. La de noche cruza medianoche, y el dia al que pertenece no
//      es el del reloj: la del 25 sigue siendo la del 25 a las tres de la
//      maniana del 26. Si eso se tuerce, las incidencias de madrugada acaban en
//      el parte del dia siguiente.
//
//   2. EL PUENTE CON EL CALL CENTER. Su catalogo casa por TEXTO EXACTO, con
//      tildes. Un 'Conexion' sin acento no encuentra 'Conexión' y la llamada
//      simplemente no se crea, sin ruido. Aqui se contrasta el mapeo del
//      esquema contra el catalogo de verdad.

const path = require('path');
const fs = require('fs');
const RAIZ = path.join(__dirname, '..');

let mal = 0;
const comprobar = (t, ok, extra) => {
  if (!ok) mal++;
  console.log((ok ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : ''));
};

// ── 1. Las franjas ──────────────────────────────────────────────────────────
const franjas = require(path.join(RAIZ, 'services/flotaViva/franjas'));

const FRANJAS = [
  { codigo: 'dia',   etiqueta: 'Día',   inicio_min: 390,  fin_min: 930, activa: true, orden: 1 },
  { codigo: 'noche', etiqueta: 'Noche', inicio_min: 1110, fin_min: 210, activa: true, orden: 2 },
];

// Verano en Madrid = UTC+2. Se construye el instante para una hora LOCAL dada.
const enMadrid = (dia, h, m) => new Date(Date.UTC(2026, 7, dia, h - 2, m));

console.log('\n== Las franjas, con su cruce de medianoche ==');
[
  ['25/8 07:00', enMadrid(25, 7, 0),  'dia',   '2026-08-25'],
  ['25/8 15:29', enMadrid(25, 15, 29), 'dia',   '2026-08-25'],
  ['25/8 15:31', enMadrid(25, 15, 31), null,    null],
  ['25/8 18:00', enMadrid(25, 18, 0),  null,    null],
  ['25/8 18:31', enMadrid(25, 18, 31), 'noche', '2026-08-25'],
  ['26/8 01:00', enMadrid(26, 1, 0),   'noche', '2026-08-25'],
  ['26/8 03:29', enMadrid(26, 3, 29),  'noche', '2026-08-25'],
  ['26/8 03:31', enMadrid(26, 3, 31),  null,    null],
  ['26/8 06:31', enMadrid(26, 6, 31),  'dia',   '2026-08-26'],
].forEach(([que, cuando, esperada, dia]) => {
  const r = franjas.franjaDe(FRANJAS, cuando);
  const cod = r ? r.franja.codigo : null;
  comprobar(que.padEnd(12) + '→ ' + (cod || 'relevo'),
    cod === esperada && (r ? r.diaOperativo : null) === dia,
    dia ? '(día ' + dia + ')' : '');
});

// ── 2. El puente con el Call Center ─────────────────────────────────────────
console.log('\n== El mapeo a clasificaciones del Call Center ==');
const cc = require(path.join(RAIZ, 'services/callCenter'));
const sql = fs.readFileSync(path.join(RAIZ, 'services/flotaViva/esquema.sql'), 'utf8');

// Se leen del propio esquema las cuatro filas del UPDATE, para contrastar lo que
// se va a guardar de verdad y no una copia que se quede atrás.
const bloque = sql.slice(sql.indexOf('UPDATE fv_cat_incidencia SET cc_cluster'));
const filas = [...bloque.slice(0, bloque.indexOf(') AS v(')).matchAll(
  /\('([a-z_]+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)];

comprobar('se leen las cuatro del esquema', filas.length === 4, '(' + filas.length + ')');

filas.forEach(([, codigo, cluster, subcluster, motivo]) => {
  const m = cc.CATALOGO
    .filter(c => c.cluster === cluster)
    .flatMap(c => c.subclusters.filter(s => s.nombre === subcluster))
    .flatMap(s => s.motivos.filter(x => x.motivo === motivo))[0];
  comprobar(codigo.padEnd(14) + '→ ' + cluster + ' › ' + subcluster,
    !!m, m ? '(' + m.resultados.length + ' resultado(s))' : '← NO EXISTE en el catálogo');
});

console.log(mal ? `\n${mal} COMPROBACIÓN(ES) MAL` : '\nTodo cuadra');
process.exitCode = mal ? 1 : 0;
