// ============================================================
// PROBAR: la normalizacion de jornada (logs de BOLT -> asientos)
// ============================================================
//   node scripts/probar-jornada.js
//
// Las funciones puras de services/repo/jornada.js no tocan la base, asi que se
// prueban con logs de mentira. Lo que se comprueba es EL CAMBIO del Hito 2:
//
//   · has_order cuenta como trabajo (TE_A3), siempre.
//   · waiting_orders NO cuenta solo (art. 18.7): sin confirmar el area, no hay
//     asiento. Con area confirmada, sube a TE_A1 y cuenta.
//   · descanso y desconexion no generan nada.
//   · si hubo actividad, se anaden los 20 min auxiliares (TE_C).

const path = require('path');
const j = require(path.join(__dirname, '..', 'services', 'repo', 'jornada'));

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// La tabla cat_estado_te, tal como la siembra db/35. Aqui a mano para la prueba.
const CATALOGO = new Map([
  ['has_order',      { estado_bolt: 'has_order',      supuesto_te: 'TE_A3', tipo: 'EFFECTIVE_WORK', cuenta: true,  condicionado: false, supuesto_sin: null }],
  ['waiting_orders', { estado_bolt: 'waiting_orders', supuesto_te: 'TE_A1', tipo: 'EFFECTIVE_WORK', cuenta: true,  condicionado: true,  supuesto_sin: 'TE_NO' }],
  ['busy',           { estado_bolt: 'busy',           supuesto_te: null,    tipo: null,             cuenta: false, condicionado: false, supuesto_sin: null }],
  ['inactive',       { estado_bolt: 'inactive',       supuesto_te: null,    tipo: null,             cuenta: false, condicionado: false, supuesto_sin: null }],
]);

// Un dia: epoch de una hora local (da igual la zona para la prueba).
const H = h => Math.floor(Date.UTC(2026, 7, 20, h - 2) / 1000);   // verano Madrid
const FIN = H(24);

// ── 1. Reproduccion de tramos ───────────────────────────────────────────────
console.log('\n== Los logs se parten en tramos con hora real ==');
// 08:00 en servicio, 10:00 esperando, 11:00 descanso, 13:00 desconectado.
const logs = [
  { t: H(8),  estado: 'has_order' },
  { t: H(10), estado: 'waiting_orders' },
  { t: H(11), estado: 'busy' },
  { t: H(13), estado: 'inactive' },
];
const tramos = j.tramosDeLogs(logs, FIN);
ok('4 tramos', tramos.length === 4, `(${tramos.length})`);
ok('has_order dura 2 h', tramos[0].minutos === 120, `(${tramos[0].minutos} min)`);
ok('waiting dura 1 h', tramos[1].minutos === 60);
// Logs desordenados: se ordenan solos.
const desord = j.tramosDeLogs([logs[2], logs[0], logs[3], logs[1]], FIN);
ok('logs desordenados dan lo mismo', desord[0].estado === 'has_order' && desord[0].minutos === 120);
// Un tramo larguisimo se recorta al tope.
const largo = j.tramosDeLogs([{ t: H(8), estado: 'has_order' }], H(8) + 20 * 3600);
ok('un tramo de 20 h se recorta a 12 h', largo[0].minutos === j.MAX_TRAMO_MIN, `(${largo[0].minutos} min)`);

// ── 2. Clasificacion: que cuenta y que no ───────────────────────────────────
console.log('\n== has_order cuenta, waiting NO (sin area) ==');
let as = j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20' });
const trabajo = as.filter(a => a.tipo === 'EFFECTIVE_WORK');
ok('un solo asiento de trabajo efectivo', trabajo.length === 1, `(${trabajo.length})`);
ok('es el has_order, TE_A3, 120 min', trabajo[0].supuestoTe === 'TE_A3' && trabajo[0].minutos === 120);
ok('la espera NO genera asiento', !as.some(a => a.supuestoTe === 'TE_A1'));
ok('el descanso no genera nada', !as.some(a => a.tipo && a.tipo !== 'EFFECTIVE_WORK' && a.tipo !== 'AUX_TASKS'));

console.log('\n== Con area confirmada, la espera sube a TE_A1 ==');
as = j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20',
  areaConfirmada: () => true });
ok('ahora la espera cuenta como TE_A1', as.some(a => a.supuestoTe === 'TE_A1' && a.minutos === 60));

// ── 3. Los 20 min auxiliares ────────────────────────────────────────────────
console.log('\n== Tareas auxiliares: 20 min si hubo actividad ==');
const aux = as.find(a => a.tipo === 'AUX_TASKS');
ok('hay un asiento AUX_TASKS', !!aux);
ok('son 20 min, TE_C', aux && aux.minutos === j.AUX_MIN && aux.supuestoTe === 'TE_C');
ok('uno solo por dia', as.filter(a => a.tipo === 'AUX_TASKS').length === 1);
// Un dia SIN actividad (solo desconectado): ni trabajo ni aux.
const vacio = j.asientosDeDia({
  tramos: j.tramosDeLogs([{ t: H(8), estado: 'inactive' }], FIN),
  catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20' });
ok('dia sin actividad: cero asientos', vacio.length === 0, `(${vacio.length})`);

// ── 4. Idempotencia: la referencia por tramo ────────────────────────────────
console.log('\n== La referencia externa hace la ingesta idempotente ==');
const a1 = j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20' });
const a2 = j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20' });
ok('la misma entrada da las mismas referencias',
   a1[0].refExterna === a2[0].refExterna && a1[0].refExterna.startsWith('bolt:7:'));

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa normalizacion de jornada cuadra');
process.exitCode = mal ? 1 : 0;
