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

// TODO TIPO DE INCIDENCIA TIENE QUE ESTAR MAPEADO.
//
// Si se aniade uno y se olvida el mapeo, la incidencia se justifica pero no
// llega ninguna llamada al Call Center, y no se entera nadie: no hay error, solo
// una llamada que no existe. Por eso no se comprueba un numero fijo, sino que la
// lista de tipos del catalogo y la del mapeo son la misma.
const seedTipos = sql.slice(sql.indexOf('INSERT INTO fv_cat_incidencia'));
const tipos = [...seedTipos.slice(0, seedTipos.indexOf('ON CONFLICT')).matchAll(
  /^\s+\('([a-z_]+)',/gm)].map(m => m[1]);
const mapeados = filas.map(f => f[1]);
const sinMapear = tipos.filter(t => !mapeados.includes(t));

comprobar('todos los tipos tienen mapeo', tipos.length > 0 && !sinMapear.length,
  sinMapear.length ? 'sin mapear: ' + sinMapear.join(', ')
                   : '(' + tipos.length + ' tipo(s))');

filas.forEach(([, codigo, cluster, subcluster, motivo]) => {
  const m = cc.CATALOGO
    .filter(c => c.cluster === cluster)
    .flatMap(c => c.subclusters.filter(s => s.nombre === subcluster))
    .flatMap(s => s.motivos.filter(x => x.motivo === motivo))[0];
  comprobar(codigo.padEnd(14) + '→ ' + cluster + ' › ' + subcluster,
    !!m, m ? '(' + m.resultados.length + ' resultado(s))' : '← NO EXISTE en el catálogo');
});

// -- 3. La ventana horaria de cada franja ------------------------------------
// La de noche va de 18:30 a 03:30, asi que "dentro" no es un intervalo: es lo de
// despues del inicio O lo de antes del fin. Cuando esto se aplano a un BETWEEN
// que acababa a las 23:59, la madrugada entera dejo de contar y la ausencia de
// quien solo trabaja de madrugada no se reclamaba nunca.
console.log('\n== La ventana horaria de cada franja ==');
const [DIA, NOCHE] = FRANJAS;
const hm = (h, m) => h * 60 + (m || 0);
[
  ['dia   07:00', DIA,   hm(7),      true],
  ['dia   15:29', DIA,   hm(15, 29), true],
  ['dia   16:30', DIA,   hm(16, 30), false],
  ['noche 19:00', NOCHE, hm(19),     true],
  ['noche 23:59', NOCHE, hm(23, 59), true],
  ['noche 01:00', NOCHE, hm(1),      true],
  ['noche 03:29', NOCHE, hm(3, 29),  true],
  ['noche 05:00', NOCHE, hm(5),      false],
  ['noche 12:00', NOCHE, hm(12),     false],
].forEach(([que, f, minutos, esperado]) => {
  const r = franjas.dentroDeFranja(f, minutos);
  comprobar(que.padEnd(12) + '-> ' + (r ? 'dentro' : 'fuera'), r === esperado);
});

// -- 4. El esquema, en las dos cosas que ya se han roto -----------------------
console.log('\n== El esquema ==');

// El corte es lo que hace que la auditoria empiece a contar a las 06:30 en vez
// de heredar los kilometros de la madrugada.
comprobar('existe fv_corte', /CREATE TABLE IF NOT EXISTS fv_corte\b/.test(sql));
comprobar('fv_ahora publica km_m en crudo', /\n\s+t\.km_m,/.test(sql));

// LAS HORAS LAS PONE QUIEN OPERA, con un UPDATE. Si la semilla las pisara al
// arrancar, cada despliegue devolveria los turnos a lo que diga este fichero.
const semilla = sql.slice(sql.indexOf('INSERT INTO fv_franja'));
const conflicto = semilla.slice(semilla.indexOf('ON CONFLICT'), semilla.indexOf(';'));
comprobar('el despliegue no pisa las horas de fv_franja',
  !/inicio_min\s*=|fin_min\s*=/.test(conflicto));

// Cerrar una incidencia: llamar o ignorar. Las dos dejan rastro; solo una crea
// llamada en el Call Center.
comprobar('existe fv_cat_gestion', /CREATE TABLE IF NOT EXISTS fv_cat_gestion/.test(sql));
comprobar('fv_incidencia guarda la gestion',
  /ALTER TABLE fv_incidencia ADD COLUMN IF NOT EXISTS gestion/.test(sql));

const semGestion = sql.slice(sql.indexOf('INSERT INTO fv_cat_gestion'));
const gest = [...semGestion.slice(0, semGestion.indexOf('ON CONFLICT')).matchAll(
  /\('([a-z_]+)',/g)].map(m => m[1]);
comprobar('estan llamada e ignorada',
  gest.includes('llamada') && gest.includes('ignorada'), '(' + gest.join(', ') + ')');

// Si NINGUNA gestion creara llamada, el puente con el Call Center existiria
// pero no lo cruzaria nadie, y nadie se enteraria.
comprobar('alguna gestion crea llamada',
  /'llamada',[^)]*TRUE,\s*TRUE/.test(semGestion));

console.log(mal ? `\n${mal} COMPROBACIÓN(ES) MAL` : '\nTodo cuadra');
process.exitCode = mal ? 1 : 0;
