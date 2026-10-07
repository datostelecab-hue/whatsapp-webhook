// ============================================================
// BARCELONA — el planificador y sus horas
// ============================================================
// Las reglas de modules/Barcelona (07/10/2026): el tablero de un día (cada
// matrícula con su conductor de día y de noche, quién queda sin plaza), lo que se
// comprueba al asignar, y las horas: la misma regla que Madrid (día 00→24, noche
// 12→12 según la plaza; sin plaza, por su hora de inicio) y «No salió» si no hizo
// horas.
//
//   node scripts/comprobar-barcelona.js
//
// No toca la base: el repositorio se sustituye por datos de mentira.
const repo = require('../modules/Barcelona/barcelona.repo');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
async function lanza(nombre, fn, trozo) {
  try { await fn(); igual(nombre, 'no lanzó', `lanza «${trozo}»`); } catch (e) { igual(nombre, e.message.includes(trozo), true); }
}

// ── Los datos de mentira ─────────────────────────────────────────────────────
const CONDUCTORES = [
  { uuid: 'u-ana', nombre: 'Ana', telefono: '600000001', estado: 'active' },
  { uuid: 'u-beto', nombre: 'Beto', telefono: '600000002', estado: 'active' },
  { uuid: 'u-caro', nombre: 'Caro', telefono: '600000003', estado: 'active' },
  { uuid: 'u-dani', nombre: 'Dani', telefono: '600000004', estado: 'deactivated' },
];
const COCHES = [
  { uuid: 'v1', matricula: '1111AAA', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
  { uuid: 'v2', matricula: '2222BBB', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
  { uuid: 'v3', matricula: '3333CCC', modelo: 'Prius', estado: 'deactivated', enBolt: true, enErp: false },
  // En Vehículos con sede Barcelona, pero aún no dado de alta en BOLT (como la 3035LTX).
  { uuid: null, matricula: '4444DDD', modelo: 'Corolla', estado: '', enBolt: false, enErp: true },
];
let ASIG = [];
let ultimaAsignacion = null;
repo.conductores = async () => CONDUCTORES;
repo.coches = async () => COCHES;
repo.asignacionesEn = async (sede, fecha) => ASIG.filter(a => a.desde <= fecha && (!a.hasta || a.hasta >= fecha));
repo.asignar = async x => { ultimaAsignacion = x; return { cambio: true, movidaDe: null }; };

const S = require('../modules/Barcelona/barcelona.service');

(async () => {
  // El tablero.
  ASIG = [
    { matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', desde: '2026-10-01', hasta: null },
    { matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', desde: '2026-10-01', hasta: '2026-10-05' },
    { matricula: '3333CCC', turno: 'noche', uuid: 'u-dani', desde: '2026-09-01', hasta: null },
  ];
  const t = await S.tablero({ fecha: '2026-10-07' });
  igual('Filas: los activos (también el que no está en BOLT) y el desactivado que alguien lleva', t.filas.map(f => f.matricula), ['1111AAA', '2222BBB', '4444DDD', '3333CCC']);
  const sinBolt = t.filas.find(f => f.matricula === '4444DDD');
  igual('El de Vehículos que no está en BOLT se puede planificar, y se avisa', [sinBolt.activo, sinBolt.enBolt], [true, false]);
  igual('La plaza de día de 1111AAA es de Ana', t.filas[0].dia && t.filas[0].dia.nombre, 'Ana');
  igual('La noche de 1111AAA terminó el 05/10: libre el 07', t.filas[0].noche, null);
  const f3 = t.filas.find(f => f.matricula === '3333CCC');
  igual('Dani ya no está activo en BOLT y se marca', f3.noche && f3.noche.activa, false);
  igual('Sin plaza: Beto y Caro (Dani no cuenta: no está activo)', t.sinPlaza.map(c => c.nombre), ['Beto', 'Caro']);
  igual('Resumen', t.resumen, { coches: 3, plazas: 6, cubiertas: 2, conductores: 3, sinPlaza: 2 });
  const t5 = await S.tablero({ fecha: '2026-10-05' });
  igual('El 05/10 la noche de 1111AAA aún era de Beto', t5.filas[0].noche && t5.filas[0].noche.nombre, 'Beto');

  // Asignar: lo que se comprueba.
  const hoy = S.hoyMadrid();
  await lanza('Un turno que no es día ni noche', () => S.asignar({ matricula: '1111AAA', turno: 'tarde', conductor: 'u-caro' }), 'día o de noche');
  await lanza('Una matrícula que no es de Barcelona', () => S.asignar({ matricula: '9999ZZZ', turno: 'dia', conductor: 'u-caro' }), 'no es de un coche de Barcelona');
  await S.asignar({ matricula: '4444DDD', turno: 'dia', conductor: 'u-caro', desde: hoy }, 7);
  igual('Se puede asignar un coche que aún no está en BOLT', ultimaAsignacion && ultimaAsignacion.matricula, '4444DDD');
  await lanza('Una cuenta que no es de Barcelona', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-otro' }), 'no es una cuenta de BOLT de Barcelona');
  await lanza('Una cuenta desactivada', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-dani' }), 'no está activa');
  await lanza('Una fecha de hace dos meses', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-caro', desde: '2020-01-01' }), 'un mes atrás');
  await S.asignar({ matricula: '2222-bbb', turno: 'noche', conductor: { valor: 'u-caro' }, desde: hoy }, 7);
  igual('La matrícula se normaliza y el selector puede mandar { valor }', ultimaAsignacion,
    { sede: 'barcelona', matricula: '2222BBB', turno: 'noche', driverUuid: 'u-caro', desde: hoy, usuarioId: 7 });
  await S.asignar({ matricula: '2222BBB', turno: 'noche', conductor: '' }, 7);
  igual('Sin conductor deja la plaza libre (desde hoy)', [ultimaAsignacion.driverUuid, ultimaAsignacion.desde], [null, hoy]);

  // ── Las horas ──────────────────────────────────────────────────────────────
  const H = require('../modules/Barcelona/barcelona.horas');
  const R = require('../services/flotaViva/repartoTurnos');
  const SIT = { has_order: 'viaje', waiting_orders: 'espera', busy: 'descanso', inactive: 'desconectado' };
  const sit = e => SIT[e] || 'otro';
  const en = (fecha, hora) => R.instante(fecha, hora);
  const ap = (uuid, fecha, hora, estado, veh = '1111AAA') => ({ uuid, veh, estado, t: en(fecha, hora) });
  const horasDe = l => Math.round(l.reduce((s, x) => s + (x.fin - x.ini), 0) / 360000) / 10;

  // De los apuntes a los ratos: cada apunte dura hasta el siguiente; el descanso no cuenta.
  const dia6 = [
    ap('u-ana', '2026-10-06', 8, 'waiting_orders'), ap('u-ana', '2026-10-06', 8.5, 'has_order'),
    ap('u-ana', '2026-10-06', 10, 'busy'), ap('u-ana', '2026-10-06', 10.5, 'waiting_orders'),
    ap('u-ana', '2026-10-06', 16, 'inactive'),
  ];
  const ivA = H.intervalos(dia6, sit, en('2026-10-06', 0), en('2026-10-07', 0));
  igual('Ana: 2 h hasta el descanso y 5,5 h después', horasDe(ivA), 7.5);
  igual('El viaje y la espera se distinguen', ivA.map(x => x.situacion), ['espera', 'viaje', 'espera']);
  // Dos apuntes en el mismo segundo: gana el de más rango (desempate.js), y la espera se queda en nada.
  const emp = H.intervalos([ap('u-beto', '2026-10-06', 9, 'busy'), ap('u-beto', '2026-10-06', 9, 'waiting_orders'),
    ap('u-beto', '2026-10-06', 11, 'waiting_orders'), ap('u-beto', '2026-10-06', 12, 'inactive')], sit, en('2026-10-06', 0), en('2026-10-07', 0));
  igual('Empate «waiting_orders + busy»: es descanso (como en Madrid)', horasDe(emp), 1);
  // Un estado de trabajo sin apunte detrás no dura para siempre.
  igual('Una espera sin más apuntes se corta en el tope', horasDe(H.intervalos([ap('u-caro', '2026-10-06', 1, 'waiting_orders')],
    sit, en('2026-10-06', 0), en('2026-10-07', 0))), H.TOPE_H);
  // El último apunte de antes de la ventana dice cómo empezó.
  igual('Un apunte de antes de la ventana cuenta desde el borde', horasDe(H.intervalos([ap('u-caro', '2026-10-05', 23, 'has_order'),
    ap('u-caro', '2026-10-06', 1, 'inactive')], sit, en('2026-10-06', 0), en('2026-10-07', 0))), 1);

  // El reporte.
  const ASIGS = [
    { matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', desde: '2026-10-01', hasta: null },
    { matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', desde: '2026-10-06', hasta: null },
    { matricula: '2222BBB', turno: 'dia', uuid: 'u-dani', desde: '2026-10-01', hasta: null },
  ];
  const apuntes = [
    ...dia6,
    // Beto, de noche: de 18:00 a 03:00 (9 h) en otro coche, y por la mañana 2 h fuera de su turno.
    ap('u-beto', '2026-10-06', 8, 'waiting_orders', '2222BBB'), ap('u-beto', '2026-10-06', 10, 'inactive', '2222BBB'),
    ap('u-beto', '2026-10-06', 18, 'waiting_orders', '3333CCC'), ap('u-beto', '2026-10-06', 22, 'has_order', '3333CCC'),
    ap('u-beto', '2026-10-06', 23, 'waiting_orders', '3333CCC'), ap('u-beto', '2026-10-07', 3, 'inactive', '3333CCC'),
    // Caro no tiene plaza: de 09:00 a 12:00.
    ap('u-caro', '2026-10-06', 9, 'has_order', '2222BBB'), ap('u-caro', '2026-10-06', 12, 'inactive', '2222BBB'),
  ];
  const iniR = en('2026-10-05', 12), finR = en('2026-10-07', 12);
  const inf = H.informe({ desde: '2026-10-06', hasta: '2026-10-06', ivs: H.intervalos(apuntes, sit, iniR, finR),
    asignaciones: ASIGS, conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-08', 9) });
  const fila = (uuid, turno) => inf.filas.find(f => f.uuid === uuid && f.turno === turno) || {};
  igual('Filas: el día antes que la noche, y por matrícula', inf.filas.map(f => `${f.turno} ${f.matricula} ${f.nombre}`),
    ['dia 1111AAA Ana', 'dia 2222BBB Dani', 'noche 1111AAA Beto']);
  igual('Ana salió: 7,5 h (2 de viaje)', [fila('u-ana', 'dia').horas, fila('u-ana', 'dia').viaje, fila('u-ana', 'dia').estado], [7.5, 1.5, 'salio']);
  igual('Dani tenía plaza y no hizo nada: No salió', fila('u-dani', 'dia').estado, 'no_salio');
  igual('Beto, de noche: su noche va de 12:00 a 12:00 (9 h)', fila('u-beto', 'noche').horas, 9);
  igual('Lo de Beto por la mañana no suma a su noche, pero se dice', [fila('u-beto', 'noche').fuera, /2 h fuera de su turno/.test(fila('u-beto', 'noche').obs)], [2, true]);
  igual('Beto trabajó en otro coche y se avisa', /Trabajó en 3333CCC, no en su matrícula/.test(fila('u-beto', 'noche').obs), true);
  igual('Caro sin plaza: 3 h de día (empezó antes de las 12:00)', inf.sinPlan.map(f => `${f.nombre} ${f.turno} ${f.horas}`), ['Caro dia 3']);
  igual('Por conductor: primero quien no salió', inf.porConductor.map(c => `${c.nombre} ${c.salio}/${c.noSalio}`), ['Dani 0/1', 'Ana 1/0', 'Beto 1/0']);
  igual('Resumen', [inf.resumen.plazas, inf.resumen.salieron, inf.resumen.noSalieron, inf.resumen.horas, inf.resumen.abierto],
    [3, 2, 1, 16.5, false]);

  // A media tarde del mismo día: nada está cerrado aún.
  const vivo = H.informe({ desde: '2026-10-06', hasta: '2026-10-06', ivs: H.intervalos(apuntes, sit, iniR, en('2026-10-06', 11)),
    asignaciones: ASIGS, conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-06', 11) });
  const fv = (uuid, turno) => (vivo.filas.find(f => f.uuid === uuid && f.turno === turno) || {}).estado;
  igual('A las 11:00: Ana en curso, Dani aún no ha salido, la noche de Beto por empezar',
    [fv('u-ana', 'dia'), fv('u-dani', 'dia'), fv('u-beto', 'noche')], ['en_curso', 'todavia', 'pendiente']);

  // El Excel se genera sin errores.
  const xls = await require('../modules/Barcelona/barcelona.excel').generar(inf);
  igual('El Excel sale (un .xlsx: empieza por PK)', xls.slice(0, 2).toString(), 'PK');

  // ── La semana ─────────────────────────────────────────────────────────────
  const ivsSemana = H.intervalos(apuntes, sit, en('2026-10-04', 12), en('2026-10-12', 12));
  const sem = H.semana({ lunes: '2026-10-07', ivs: ivsSemana, asignaciones: ASIGS, conductores: CONDUCTORES, ahoraMs: en('2026-10-13', 13) });
  igual('Cualquier día vale: la semana empieza el lunes', [sem.lunes, sem.domingo, sem.fechas.length], ['2026-10-05', '2026-10-11', 7]);
  igual('De menor a mayor; Dani (desactivada y sin horas) no sale', sem.filas.map(f => `${f.nombre} ${f.total}`), ['Caro 3', 'Ana 7.5', 'Beto 11']);
  const beto = sem.filas.find(f => f.nombre === 'Beto');
  const martes = beto.celdas[1];
  igual('Beto el martes: su noche (9 h) más lo de la mañana (2 h)', [martes.horas, martes.dia, martes.noche], [11, 2, 9]);
  igual('Beto: tenía plaza de noche del miércoles al domingo y no salió', [beto.noSalio, beto.celdas[0].noSalio, beto.celdas[2].noSalio], [5, false, true]);
  const ana = sem.filas.find(f => f.nombre === 'Ana');
  igual('Ana: un día trabajado, media de ese día', [ana.dias, ana.media], [1, 7.5]);
  igual('Caro trabajó sin plaza: sus horas cuentan, sin «no salió»', [sem.filas[0].celdas[1].horas, sem.filas[0].noSalio, sem.filas[0].celdas[1].plazas.length], [3, 0, 0]);
  igual('Semana cerrada', [sem.resumen.cerrada, sem.resumen.enCurso, sem.resumen.horas], [true, false, 21.5]);
  const curso = H.semana({ lunes: '2026-10-05', ivs: H.intervalos(apuntes, sit, en('2026-10-04', 12), en('2026-10-07', 10)), asignaciones: ASIGS, conductores: CONDUCTORES, ahoraMs: en('2026-10-07', 10) });
  const anaCurso = curso.filas.find(f => f.nombre === 'Ana');
  igual('La semana en curso: el martes aún abierto (su noche acaba el miércoles a las 12), el jueves por venir',
    [anaCurso.celdas[1].estado, anaCurso.celdas[3].estado, curso.resumen.enCurso, curso.resumen.cerrada], ['abierto', 'futuro', true, false]);
  igual('En curso, un día abierto sin horas no es «no salió»', anaCurso.celdas[2].noSalio, false);
  const xlsSem = await require('../modules/Barcelona/barcelona.excel').generarSemana(sem);
  igual('El Excel de la semana sale', xlsSem.slice(0, 2).toString(), 'PK');

  // ── La Visibilidad: las cuentas de Madrid con los datos de Barcelona ───────
  // Ana, con plaza de día, trabajó ayer de 08:00 a 16:00 (2 h de viaje) y
  // descansó de 16:00 a 17:00. Cada ventana pedida devuelve 100 € y 5 viajes.
  const VS = require('../modules/Barcelona/visibilidad.service');
  const hoyV = S.hoyMadrid(), ayerV = R.sumarDias(hoyV, -1);
  const apV = [
    ap('u-ana', ayerV, 8, 'waiting_orders'), ap('u-ana', ayerV, 9, 'has_order'), ap('u-ana', ayerV, 11, 'waiting_orders'),
    ap('u-ana', ayerV, 16, 'busy'), ap('u-ana', ayerV, 17, 'inactive'),
  ];
  repo.apuntesEntre = async (sede, ini, fin) => apV.filter(a => a.t >= ini && a.t < fin);
  repo.situaciones = async () => new Map(Object.entries(SIT));
  repo.dineroEntre = async () => ({ neto: 100, viajes: 5 });
  repo.asignacionesEntre = async () => [{ matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', desde: '2026-01-01', hasta: null }];
  repo.leerConfigVisibilidad = async () => null;
  const rv = await VS.resumen();
  igual('Ayer (día natural): 8 h, 2 de viaje, 1 de descanso', [rv.ayer.horasEfectivas, rv.ayer.viajeH, rv.ayer.descansoH, rv.ayer.conductores], [8, 2, 1, 1]);
  igual('Las métricas de Madrid: utilización y €·hora', [rv.ayer.utilizacion, rv.ayer.eurosHora, rv.ayer.viajesHora], [25, 12.5, 0.6]);
  igual('Sin meta guardada y los coches, los que se pueden planificar', [rv.config.meta, rv.config.vehiculos], [null, 3]);
  const ul = await VS.ultimosDias(5);
  igual('Últimos días: ayer 8 h (6 de espera), y hoy al final', [ul.dias.length, ul.dias[4].total, ul.dias[4].waiting, ul.dias[5].esHoy], [6, 8, 6, true]);
  const [ya, ym, yd] = ayerV.split('-').map(Number);
  const sv = await VS.serieMes(ya, ym);
  igual('La serie del mes: el día de ayer con sus 8 h', sv.dias[yd - 1].total, 8);
  igual('Sin meta, el ideal es cero (la pantalla no lo pinta)', sv.idealDiario, 0);

  // Sin db/181.
  repo.conductores = async () => { const e = new Error('no existe'); e.code = '42P01'; throw e; };
  igual('Sin db/181 la pantalla lo dice', (await S.tablero({ fecha: '2026-10-07' })).faltaMigracion, true);

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
