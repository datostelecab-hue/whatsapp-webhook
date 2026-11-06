// ============================================================
// BARCELONA — el planificador y sus horas
// ============================================================
// Las reglas de modules/Barcelona: el plan de cada día (quién trabaja, quién
// libra y dónde hay hueco, con y sin correturnos: barcelona.plan.js, db/234 del
// 06/11/2026), el tablero, lo que se comprueba antes de escribir, y las horas:
// la misma regla que Madrid (día 00→24, noche 12→12 según la plaza; sin plaza, o
// librando, por su hora de inicio), «No salió» si le tocaba y no hizo horas,
// «Libra» si era su día, y el promedio de la casa sin letra.
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
  try { await fn(); igual(nombre, 'no lanzó', `lanza «${trozo}»`); } catch (e) {
    const ok = e.message.includes(trozo);
    igual(nombre, ok ? true : e.message, true);
  }
}

// ── Los datos de mentira ─────────────────────────────────────────────────────
const CONDUCTORES = [
  { uuid: 'u-ana', nombre: 'Ana', telefono: '600000001', estado: 'active' },
  { uuid: 'u-beto', nombre: 'Beto', telefono: '600000002', estado: 'active' },
  { uuid: 'u-caro', nombre: 'Caro', telefono: '600000003', estado: 'active' },
  { uuid: 'u-dani', nombre: 'Dani', telefono: '600000004', estado: 'deactivated' },
  { uuid: 'u-eva', nombre: 'Eva', telefono: '600000005', estado: 'active' },
  { uuid: 'u-fran', nombre: 'Fran', telefono: '600000006', estado: 'active' },
];
const COCHES = [
  { uuid: 'v1', matricula: '1111AAA', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
  { uuid: 'v2', matricula: '2222BBB', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
  { uuid: 'v3', matricula: '3333CCC', modelo: 'Prius', estado: 'deactivated', enBolt: true, enErp: false },
  // En Vehículos con sede Barcelona, pero aún no dado de alta en BOLT (como la 3035LTX).
  { uuid: null, matricula: '4444DDD', modelo: 'Corolla', estado: '', enBolt: false, enErp: true },
  { uuid: 'v5', matricula: '5555EEE', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
  { uuid: 'v6', matricula: '6666FFF', modelo: 'Corolla', estado: 'active', enBolt: true, enErp: true },
];
const SIT = { has_order: 'viaje', waiting_orders: 'espera', busy: 'descanso', inactive: 'desconectado' };

let PLAN = { asignaciones: [], cts: [], descansos: [] };
let EST = { zonas: [], cuadrantes: [], cochesCuadrante: [] };
let escrito = [];          // lo que el servicio le pide al repositorio que escriba
const ultimo = nombre => [...escrito].reverse().find(x => x.que === nombre) || {};
const apunta = (que, r) => async x => { escrito.push({ que, ...x }); return typeof r === 'function' ? r(x) : r; };

repo.conductores = async () => CONDUCTORES;
repo.coches = async () => COCHES;
repo.planEntre = async () => PLAN;
repo.estructura = async () => EST;
repo.queFalta = async () => null;
repo.apuntesEntre = async () => [];
repo.situaciones = async () => new Map(Object.entries(SIT));
repo.asignar = apunta('asignar', { cambio: true, movidaDe: null });
repo.asignarVarias = async lista => { lista.forEach(x => escrito.push({ que: 'varias', ...x })); return lista.map(() => ({ cambio: true })); };
repo.ponerDescanso = apunta('descanso', undefined);
repo.activarCT = apunta('activarCT', undefined);
repo.desactivarCT = apunta('desactivarCT', x => ({ quitados: [{ uuid: 'u-eva', turno: 'dia', desde: x.desde }] }));
repo.crearZona = apunta('crearZona', { id: '9' });
repo.cambiarZona = apunta('cambiarZona', { id: '1' });
repo.crearCuadrante = apunta('crearCuadrante', { id: '7', numero: 2 });
repo.cambiarCuadrante = apunta('cambiarCuadrante', { id: '1' });
repo.bajaCuadrante = apunta('bajaCuadrante', { numero: 1 });
repo.cocheEnCuadrante = apunta('cocheEnCuadrante', undefined);

const P = require('../modules/Barcelona/barcelona.plan');
const H = require('../modules/Barcelona/barcelona.horas');
const R = require('../services/flotaViva/repartoTurnos');
const S = require('../modules/Barcelona/barcelona.service');

(async () => {
  // ══ 1 · LAS REGLAS DEL PLAN (barcelona.plan.js) ══════════════════════════
  // El 05/10/2026 es lunes. 1111AAA, sin CT: cada fijo libra lo suyo (Ana, de
  // día, L M y desde el 15 solo el V; Beto, de noche, X J). 2222BBB lleva CT
  // desde el 10 con el bloque S D: antes, su fijo de día libraba el L.
  igual('ISODOW: el 05/10/2026 es lunes y el 11 domingo', [P.isodow('2026-10-05'), P.isodow('2026-10-11')], [1, 7]);
  const reglas = P.crear({
    asignaciones: [
      { id: 1, matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', desde: '2026-10-01', hasta: null },   // sin rol: fijo, como antes de db/234
      { id: 2, matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: 3, matricula: '2222BBB', turno: 'dia', uuid: 'u-caro', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: 4, matricula: '2222BBB', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [5, 6, 7], desde: '2026-10-01', hasta: null },
    ],
    cts: [{ matricula: '2222BBB', desde: '2026-10-10', hasta: null }],
    descansos: [
      { matricula: '1111AAA', turno: 'dia', dias: [1, 2], desde: '2026-10-01', hasta: '2026-10-14' },
      { matricula: '1111AAA', turno: 'dia', dias: [5], desde: '2026-10-15', hasta: null },
      { matricula: '1111AAA', turno: 'noche', dias: [3, 4], desde: '2026-10-01', hasta: null },
      { matricula: '2222BBB', turno: 'dia', dias: [1], desde: '2026-10-01', hasta: '2026-10-09' },
      { matricula: '2222BBB', turno: null, dias: [6, 7], desde: '2026-10-10', hasta: null },
    ],
  });
  const a = id => reglas.asignaciones.find(x => x.id === id);
  igual('Sin periodo con CT, el coche no lleva (lo de por defecto); con él, sí', [reglas.conCT('2222BBB', '2026-10-09'), reglas.conCT('2222BBB', '2026-10-10'), reglas.conCT('1111AAA', '2026-10-10')], [false, true, false]);
  igual('El descanso de cada fijo, con sus fechas', [reglas.descansoDe('1111AAA', 'dia', '2026-10-05'), reglas.descansoDe('1111AAA', 'dia', '2026-10-16'), reglas.descansoDe('1111AAA', 'noche', '2026-10-16')], [[1, 2], [5], [3, 4]]);
  igual('Con CT, los dos fijos libran el bloque (el de su turno ya no cuenta)', [reglas.descansoDe('2222BBB', 'dia', '2026-10-05'), reglas.descansoDe('2222BBB', 'dia', '2026-10-12'), reglas.descansoDe('2222BBB', 'noche', '2026-10-12')], [[1], [6, 7], [6, 7]]);
  igual('Ana libra el lunes 05 y el 12, trabaja el miércoles, y desde el 15 libra el viernes',
    [reglas.libra(a(1), '2026-10-05'), reglas.libra(a(1), '2026-10-12'), reglas.trabaja(a(1), '2026-10-07'), reglas.libra(a(1), '2026-10-19'), reglas.libra(a(1), '2026-10-16')],
    [true, true, true, false, true]);
  igual('Sin CT, el día que libra el fijo ese turno no sale: no es hueco', [reglas.turnoDelCoche('1111AAA', 'dia', '2026-10-05'), reglas.estadoDelTurno('1111AAA', 'dia', '2026-10-05')], ['libra', 'libra']);
  igual('La noche del 05 la lleva Beto; el miércoles libra él', [reglas.estadoDelTurno('1111AAA', 'noche', '2026-10-05'), reglas.estadoDelTurno('1111AAA', 'noche', '2026-10-07')], ['trabaja', 'libra']);
  igual('El CT solo trabaja si el coche lleva CT ese día y es uno de sus días',
    [reglas.trabaja(a(4), '2026-10-09'), reglas.trabaja(a(4), '2026-10-10'), reglas.trabaja(a(4), '2026-10-12'), reglas.libra(a(4), '2026-10-10')], [false, true, false, false]);
  igual('Con CT el coche siempre sale: el sábado libra Caro y lo cubre Eva',
    [reglas.turnoDelCoche('2222BBB', 'dia', '2026-10-10'), (reglas.quienCubre('2222BBB', 'dia', '2026-10-10') || {}).uuid, reglas.estadoDelTurno('2222BBB', 'dia', '2026-10-10')], ['sale', 'u-eva', 'trabaja']);
  igual('Antes del CT, el lunes 05 libra Caro y el coche no sale', reglas.estadoDelTurno('2222BBB', 'dia', '2026-10-05'), 'libra');
  igual('Con CT y sin nadie de noche: hueco', reglas.estadoDelTurno('2222BBB', 'noche', '2026-10-12'), 'hueco');
  igual('El plan del sábado 10: quién trabaja (Caro libra)', reglas.planDelDia('2026-10-10').map(x => x.uuid).sort(), ['u-ana', 'u-beto', 'u-eva']);
  igual('El plan del lunes 05: Ana y Caro libran, Eva no tiene CT que cubrir', reglas.planDelDia('2026-10-05').map(x => x.uuid), ['u-beto']);
  // Nadie lleva dos coches del mismo turno a la vez.
  const datosChoque = {
    asignaciones: [{ id: 9, matricula: '2222BBB', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [6, 7], desde: '2026-10-10', hasta: null }],
    cts: [{ matricula: '2222BBB', desde: '2026-10-10', hasta: null }, { matricula: '5555EEE', desde: '2026-10-10', hasta: null }],
    descansos: [],
  };
  igual('Un CT en otro coche del mismo turno con un día que se pisa: choca el domingo',
    P.choques(datosChoque, { matricula: '5555EEE', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [1, 7], desde: '2026-10-12' }),
    [{ matricula: '2222BBB', rol: 'ct', dias: [7] }]);
  igual('En otros días, no: un CT lleva varios coches',
    P.choques(datosChoque, { matricula: '5555EEE', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [1, 2], desde: '2026-10-12' }), []);
  igual('De noche tampoco choca (otro turno)',
    P.choques(datosChoque, { matricula: '5555EEE', turno: 'noche', uuid: 'u-eva', rol: 'ct', dias: [7], desde: '2026-10-12' }), []);
  igual('Lo que se va a sustituir no choca',
    P.choques(datosChoque, { matricula: '2222BBB', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [6], desde: '2026-10-12' }, x => x.matricula === '2222BBB'), []);
  // [2] Lo nuevo que acaba antes (la víspera de lo que ya hay escrito después en
  // esa plaza, o el fin del CT del coche) no choca los días de después.
  igual('[2] Una plaza nueva que acaba el sábado no choca el domingo',
    P.choques(datosChoque, { matricula: '5555EEE', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [1, 7], desde: '2026-10-12', hasta: '2026-10-17' }), []);
  igual('Las letras de la casa', P.letras([3, 1, 7]), 'L X D');

  // ══ 2 · EL TABLERO ════════════════════════════════════════════════════════
  // Fechas de esta semana: el servicio solo deja escribir de un mes atrás a dos
  // meses adelante, así que los datos van alrededor de hoy.
  const hoy = S.hoyMadrid();
  const LUN = H.lunesDe(hoy);
  const SAB = R.sumarDias(LUN, 5);
  const INI = R.sumarDias(LUN, -14);
  const CT2 = R.sumarDias(LUN, -7);
  const basePlan = () => ({
    asignaciones: [
      { id: '1', matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '2', matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '3', matricula: '2222BBB', turno: 'dia', uuid: 'u-caro', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '4', matricula: '2222BBB', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [6, 7], desde: CT2, hasta: null },
      { id: '5', matricula: '3333CCC', turno: 'noche', uuid: 'u-dani', rol: 'fijo', dias: null, desde: INI, hasta: null },
    ],
    cts: [{ matricula: '2222BBB', desde: CT2, hasta: null }, { matricula: '5555EEE', desde: CT2, hasta: null },
      { matricula: '6666FFF', desde: CT2, hasta: null }],
    descansos: [
      { matricula: '1111AAA', turno: 'dia', dias: [1, 2], desde: INI, hasta: null },
      { matricula: '1111AAA', turno: 'noche', dias: [3, 4], desde: INI, hasta: null },
      { matricula: '2222BBB', turno: null, dias: [6, 7], desde: CT2, hasta: null },
      { matricula: '5555EEE', turno: null, dias: [1], desde: CT2, hasta: null },
      { matricula: '6666FFF', turno: null, dias: [7], desde: CT2, hasta: null },
    ],
  });
  const baseEst = () => ({
    zonas: [{ id: '1', nombre: 'Eixample', activa: true }, { id: '2', nombre: 'Vieja', activa: false }],
    cuadrantes: [{ id: '1', numero: 1, nombre: null, zonaId: '1' }],
    cochesCuadrante: [{ matricula: '1111AAA', cuadranteId: '1' }, { matricula: '2222BBB', cuadranteId: '1' }, { matricula: '5555EEE', cuadranteId: '1' }],
  });
  PLAN = basePlan();
  EST = baseEst();
  const t = await S.tablero({ fecha: SAB });
  const coche = m => t.coches.find(c => c.matricula === m) || {};
  igual('Coches: los activos (también el que no está en BOLT) y el desactivado que alguien lleva',
    t.coches.map(c => c.matricula), ['1111AAA', '2222BBB', '4444DDD', '5555EEE', '6666FFF', '3333CCC']);
  igual('El de Vehículos que no está en BOLT se puede planificar, y se avisa', [coche('4444DDD').activo, coche('4444DDD').enBolt], [true, false]);
  igual('Las claves de un coche son las del contrato', Object.keys(coche('1111AAA')),
    ['matricula', 'modelo', 'enBolt', 'enErp', 'activo', 'estadoBolt', 'cuadranteId', 'conCT', 'conCTDesde', 'descanso', 'descansoTurno', 'plazas', 'turnos']);
  igual('Sin CT: un descanso por fijo y el sábado salen los dos',
    [coche('1111AAA').conCT, coche('1111AAA').descanso, coche('1111AAA').descansoTurno, coche('1111AAA').turnos],
    [false, [], { dia: [1, 2], noche: [3, 4] }, { dia: 'trabaja', noche: 'trabaja' }]);
  const b = coche('2222BBB');
  igual('Con CT: el bloque, desde cuándo, y el sábado libra Caro y lo cubre Eva',
    [b.conCT, b.conCTDesde, b.descanso, b.descansoTurno, b.plazas.fijoDia.libraHoy, b.plazas.ctDia.nombre, b.plazas.ctDia.trabajaHoy, b.plazas.ctDia.dias, b.turnos],
    [true, CT2, [6, 7], { dia: [], noche: [] }, true, 'Eva', true, [6, 7], { dia: 'trabaja', noche: 'hueco' }]);
  igual('Las claves de una persona son las del contrato', Object.keys(b.plazas.fijoDia),
    ['uuid', 'nombre', 'telefono', 'activa', 'desde', 'hasta', 'rol', 'dias', 'libraHoy', 'trabajaHoy', 'promedio']);
  igual('El promedio de cada persona, con su forma', Object.keys(b.plazas.fijoDia.promedio).filter(k => k !== 'etiqueta' && k !== 'total'),
    ['horas', 'salio', 'ausencias', 'media', 'periodo', 'mesAnterior', 'ne']);
  igual('Sin horas, N/E con el motivo', [b.plazas.fijoDia.promedio.horas, /menos de 5 días/.test(b.plazas.fijoDia.promedio.ne)], [null, true]);
  igual('Dani ya no está activo en BOLT y se marca', coche('3333CCC').plazas.fijoNoche.activa, false);
  igual('El cuadrante: su zona, sus coches, su CT de día y sus bloques', [t.cuadrantes[0].zona, t.cuadrantes[0].coches, t.cuadrantes[0].ct.dia.map(p => p.nombre),
    t.cuadrantes[0].ct.noche, t.cuadrantes[0].bloques], ['Eixample', ['1111AAA', '2222BBB', '5555EEE'], ['Eva'], [], [{ matricula: '2222BBB', dias: [6, 7] }, { matricula: '5555EEE', dias: [1] }]]);
  igual('Las zonas: solo las vivas, con lo que tienen', t.zonas, [{ id: '1', nombre: 'Eixample', cuadrantes: 1, coches: 3 }]);
  igual('Sin plaza: Fran (Dani no cuenta: no está activo)', t.sinPlaza.map(c => c.nombre), ['Fran']);
  igual('Los conductores llevan sus plazas de ese día', t.conductores.find(c => c.nombre === 'Caro').plazas.map(p => `${p.matricula} ${p.turno} ${p.rol} ${p.libraHoy}`), ['2222BBB dia fijo true']);
  // Sábado: 4444DDD, 5555EEE y 6666FFF sin nadie (los dos con CT siempre salen).
  igual('Resumen del sábado', t.resumen, { coches: 5, turnos: 10, cubiertos: 3, huecos: 7, libran: 0, sinPlaza: 1, conCT: 3 });
  const tl = await S.tablero({ fecha: LUN });
  igual('El lunes Ana libra (sin CT): ese turno no sale y cuenta en «libran», no en huecos',
    [tl.coches.find(c => c.matricula === '1111AAA').turnos, tl.resumen.libran, tl.resumen.turnos, tl.resumen.cubiertos], [{ dia: 'libra', noche: 'trabaja' }, 1, 9, 2]);

  // ══ 3 · LO QUE SE COMPRUEBA AL ESCRIBIR ═══════════════════════════════════
  escrito = [];
  await lanza('Un turno que no es día ni noche', () => S.asignar({ matricula: '1111AAA', turno: 'tarde', uuid: 'u-fran' }), 'día o de noche');
  await lanza('Una matrícula que no es de Barcelona', () => S.asignar({ matricula: '9999ZZZ', turno: 'dia', uuid: 'u-fran' }), 'no es de un coche de Barcelona');
  await lanza('Una cuenta que no es de Barcelona', () => S.asignar({ matricula: '1111AAA', turno: 'dia', uuid: 'u-otro' }), 'no es una cuenta de BOLT de Barcelona');
  await lanza('Una cuenta desactivada', () => S.asignar({ matricula: '1111AAA', turno: 'dia', uuid: 'u-dani' }), 'no está activa');
  await lanza('Una fecha de hace dos meses', () => S.asignar({ matricula: '1111AAA', turno: 'dia', uuid: 'u-fran', desde: '2020-01-01' }), 'un mes atrás');
  await S.asignar({ matricula: '4444DDD', turno: 'dia', uuid: 'u-fran', desde: hoy }, 7);
  igual('Se puede asignar un coche que aún no está en BOLT', ultimo('asignar').matricula, '4444DDD');
  await S.asignar({ matricula: '6666-fff', turno: 'noche', conductor: { valor: 'u-fran' }, desde: hoy }, 7);
  const pedido = { ...ultimo('asignar') };
  delete pedido.que;
  igual('La matrícula se normaliza, el selector puede mandar { valor } y por omisión es un fijo', pedido,
    { sede: 'barcelona', matricula: '6666FFF', turno: 'noche', rol: 'fijo', driverUuid: 'u-fran', dias: null, desde: hoy, hasta: null, usuarioId: 7 });
  const r0 = await S.asignar({ matricula: '6666FFF', turno: 'noche', uuid: null }, 7);
  igual('Sin persona deja la plaza libre (desde hoy) y devuelve el tablero de ese día', [ultimo('asignar').driverUuid, ultimo('asignar').desde, r0.tablero.fecha], [null, hoy, hoy]);
  await S.asignar({ matricula: '9999ZZZ', turno: 'noche', uuid: null }, 7);
  igual('Dejar libre una plaza vale también en una matrícula que ya no es de la sede', ultimo('asignar').matricula, '9999ZZZ');
  // El CT.
  await lanza('CT en un coche sin CT', () => S.asignar({ matricula: '1111AAA', turno: 'dia', rol: 'ct', uuid: 'u-fran', desde: hoy }), 'no lleva correturnos');
  await lanza('Un rol que no existe', () => S.asignar({ matricula: '2222BBB', turno: 'dia', rol: 'jefe', uuid: 'u-fran', desde: hoy }), 'fijo o de correturnos');
  await S.asignar({ matricula: '2222BBB', turno: 'noche', rol: 'ct', uuid: 'u-fran', desde: hoy }, 7);
  igual('CT sin días: los del bloque del coche', [ultimo('asignar').rol, ultimo('asignar').dias], ['ct', [6, 7]]);
  await S.asignar({ matricula: '2222BBB', turno: 'noche', rol: 'ct', uuid: 'u-fran', dias: 'S', desde: hoy }, 7);
  igual('CT con sus días (en letras)', ultimo('asignar').dias, [6]);
  await lanza('Días que no se entienden', () => S.asignar({ matricula: '2222BBB', turno: 'noche', rol: 'ct', uuid: 'u-fran', dias: 'S Q', desde: hoy }), 'No entiendo los días');
  await S.asignar({ matricula: '5555EEE', turno: 'dia', rol: 'ct', uuid: 'u-eva', desde: hoy }, 7);
  igual('Un CT en varios coches del mismo turno, en días distintos (Eva: S D en 2222BBB, L en 5555EEE)', [ultimo('asignar').matricula, ultimo('asignar').dias], ['5555EEE', [1]]);
  await lanza('Un CT cuyos días se pisan con otro coche suyo del mismo turno, dice con cuál',
    () => S.asignar({ matricula: '6666FFF', turno: 'dia', rol: 'ct', uuid: 'u-eva', desde: hoy }), 'Eva ya lleva el 2222BBB (de CT) los D de día');
  await lanza('Un fijo que trabaja los días que sería CT en otro coche del mismo turno',
    () => S.asignar({ matricula: '2222BBB', turno: 'dia', rol: 'ct', uuid: 'u-ana', desde: hoy }), 'Ana ya lleva el 1111AAA los S D de día');
  await S.asignar({ matricula: '5555EEE', turno: 'dia', uuid: 'u-ana', desde: hoy }, 7);
  igual('Un fijo que ya era fijo de otro coche en ese turno se mueve: no choca con su plaza de antes', [ultimo('asignar').matricula, ultimo('asignar').rol], ['5555EEE', 'fijo']);
  await S.asignar({ matricula: '6666FFF', turno: 'dia', uuid: 'u-beto', desde: hoy }, 7);
  igual('El fijo de noche de un coche puede ser fijo de día de otro (como hasta ahora)', ultimo('asignar').driverUuid, 'u-beto');

  // [0] Una plaza de CT dura, como mucho, lo que dura el periodo con CT del
  // coche. Si ya está escrito que se le quita el CT, la plaza acaba ese día: si
  // no, quedaría abierta en un coche sin CT y volvería sola al reactivarlo.
  const FIN_CT = R.sumarDias(hoy, 3);
  const conFinCT = () => { PLAN = basePlan(); PLAN.cts = PLAN.cts.map(p => (p.matricula === '5555EEE' ? { ...p, hasta: FIN_CT } : p)); };
  conFinCT();
  await S.asignar({ matricula: '5555EEE', turno: 'noche', rol: 'ct', uuid: 'u-fran', desde: hoy }, 7);
  igual('[0] Una plaza de CT acaba, como mucho, el último día con CT del coche', [ultimo('asignar').matricula, ultimo('asignar').hasta], ['5555EEE', FIN_CT]);
  await S.asignar({ matricula: '2222BBB', turno: 'noche', rol: 'ct', uuid: 'u-fran', desde: hoy }, 7);
  igual('[0] …y si el CT del coche no tiene fin, la plaza tampoco', [ultimo('asignar').matricula, ultimo('asignar').hasta], ['2222BBB', null]);
  PLAN = basePlan();

  // [2] Lo escrito para más adelante en la plaza se respeta (repo.asignarEn): lo
  // nuevo dura hasta su víspera. La comprobación de «no doblar» lo sabe y no le
  // cuenta los días de después. Eva es CT del 5555EEE solo mañana; Fran ya tiene
  // escrito el CT del 6666FFF desde mañana: poner a Eva en el 6666FFF desde hoy
  // la deja ahí solo hoy, y no dobla.
  const MAN = R.sumarDias(hoy, 1);
  PLAN.asignaciones = PLAN.asignaciones.filter(x => x.id !== '4');
  PLAN.asignaciones.push({ id: '40', matricula: '5555EEE', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [P.isodow(MAN)], desde: CT2, hasta: null },
    { id: '41', matricula: '6666FFF', turno: 'dia', uuid: 'u-fran', rol: 'ct', dias: [P.isodow(MAN)], desde: MAN, hasta: null });
  escrito = [];
  let dobla = null;
  try { await S.asignar({ matricula: '6666FFF', turno: 'dia', rol: 'ct', uuid: 'u-eva', dias: [P.isodow(hoy), P.isodow(MAN)], desde: hoy }, 7); } catch (e) { dobla = e.message; }
  igual('[2] No dobla con un día que ya no va a ser suyo (la plaza la tiene escrita otro desde mañana)', [dobla, ultimo('asignar').matricula], [null, '6666FFF']);
  PLAN = basePlan();

  // El descanso.
  await lanza('El bloque en un coche sin CT', () => S.fijarDescanso({ matricula: '1111AAA', turno: null, dias: [1], desde: hoy }), 'cada fijo tiene su propio descanso');
  await lanza('El descanso de un fijo en un coche con CT', () => S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: [1], desde: hoy }), 'sus dos fijos libran el bloque');
  await lanza('Dos bloques del cuadrante no comparten día: dice con cuál', () => S.fijarDescanso({ matricula: '2222BBB', turno: null, dias: [1, 6], desde: hoy }), 'chocan con 5555EEE (L)');
  await S.fijarDescanso({ matricula: '2222BBB', turno: null, dias: 'S D', desde: hoy }, 7);
  igual('El bloque se guarda (el suyo no choca consigo mismo)', [ultimo('descanso').turno, ultimo('descanso').dias], [null, [6, 7]]);
  await S.fijarDescanso({ matricula: '1111AAA', turno: 'noche', dias: [5], desde: hoy }, 7);
  igual('El descanso del fijo de noche de un coche sin CT', [ultimo('descanso').turno, ultimo('descanso').dias], ['noche', [5]]);
  await S.fijarDescanso({ matricula: '1111AAA', turno: 'noche', dias: [], desde: hoy }, 7);
  igual('Sin días, deja de librar', ultimo('descanso').dias, []);

  // El CT del coche.
  await lanza('Activar el CT de un coche que ya lo lleva', () => S.correturnos({ matricula: '2222BBB', activar: true, dias: [3], desde: hoy }), 'ya lleva correturnos');
  await lanza('Activar sin bloque', () => S.correturnos({ matricula: '1111AAA', activar: true, dias: [], desde: hoy }), 'Elige los días del bloque');
  await lanza('Activar con un bloque que choca en el cuadrante', () => S.correturnos({ matricula: '1111AAA', activar: true, dias: [1, 3], desde: hoy }), 'chocan con 5555EEE');
  const ra = await S.correturnos({ matricula: '1111AAA', activar: true, dias: 'X', desde: '2020-01-01' }, 7);
  igual('Activar: con su bloque y nunca antes de hoy', [ultimo('activarCT').dias, ultimo('activarCT').desde, ra.tablero.fecha], [[3], hoy, hoy]);
  await lanza('Desactivar el CT de un coche que no lo lleva', () => S.correturnos({ matricula: '1111AAA', activar: false, desde: hoy }), 'no lleva correturnos');
  const rd = await S.correturnos({ matricula: '2222BBB', activar: false, desde: hoy }, 7);
  igual('Desactivar copia el bloque a cada fijo y dice a quién saca', [ultimo('desactivarCT').dias, ultimo('desactivarCT').desde, rd.quitados.map(x => x.nombre), rd.descanso], [[6, 7], hoy, ['Eva'], [6, 7]]);
  // Un CT escrito para más adelante se quita desde que empieza.
  const MAS = R.sumarDias(hoy, 10);
  PLAN.cts.push({ matricula: '4444DDD', desde: MAS, hasta: null });
  PLAN.descansos.push({ matricula: '4444DDD', turno: null, dias: [2], desde: MAS, hasta: null });
  await S.correturnos({ matricula: '4444DDD', activar: false, desde: hoy }, 7);
  igual('Un CT que aún no ha empezado se quita desde que empieza, con su bloque', [ultimo('desactivarCT').desde, ultimo('desactivarCT').dias], [MAS, [2]]);
  PLAN = basePlan();

  // Las zonas y los cuadrantes.
  await lanza('Una zona «Sin zona»', () => S.crearZona({ nombre: ' sin  zona ' }), 'Sin zona');
  await lanza('Una zona que ya existe (sin mirar mayúsculas)', () => S.crearZona({ nombre: 'eixample' }), 'Ya hay una zona');
  const rz = await S.crearZona({ nombre: '  Gràcia ' }, 7);
  igual('Zona nueva, con el nombre limpio y sin tablero si no se dice el día', [ultimo('crearZona').nombre, rz.zona, 'tablero' in rz], ['Gràcia', { id: '9', nombre: 'Gràcia' }, false]);
  igual('Con el día, el tablero de ese día', (await S.crearZona({ nombre: 'Sants', fecha: SAB })).tablero.fecha, SAB);
  await lanza('No se retira una zona con cuadrantes', () => S.cambiarZona('1', { activa: false }), 'cámbialos de zona');
  await lanza('Renombrar a una que ya existe', () => S.cambiarZona('2', { nombre: 'Eixample', activa: true }), 'Ya hay una zona');
  await S.cambiarZona('1', { nombre: 'Eixample Dreta' });
  igual('Renombrar', [ultimo('cambiarZona').nombre, ultimo('cambiarZona').activa], ['Eixample Dreta', null]);
  await lanza('Un cuadrante en una zona retirada', () => S.crearCuadrante({ zonaId: '2' }), 'retirada');
  const rq = await S.crearCuadrante({ zonaId: 1, nombre: '' }, 7);
  igual('Cuadrante nuevo: el número lo pone el repositorio (el siguiente libre)', [ultimo('crearCuadrante').zonaId, ultimo('crearCuadrante').nombre, rq.cuadrante], ['1', null, { id: '7', numero: 2 }]);
  await S.cambiarCuadrante('1', { zonaId: null });
  igual('Pasar un cuadrante a «Sin zona» (el nombre no se toca)', [ultimo('cambiarCuadrante').cambiaZona, ultimo('cambiarCuadrante').zonaId, ultimo('cambiarCuadrante').cambiaNombre], [true, null, false]);
  await lanza('No se borra un cuadrante con coches', () => S.borrarCuadrante('1'), 'sácalos antes de borrarlo');
  await lanza('Meter en un cuadrante un coche con CT cuyo bloque choca', () => S.cocheEnCuadrante('1', { matricula: '6666FFF' }), 'choca con 2222BBB (S/D)');
  await S.cocheEnCuadrante('1', { matricula: '4444DDD' }, 7);
  igual('Un coche sin CT entra sin más', [ultimo('cocheEnCuadrante').matricula, ultimo('cocheEnCuadrante').cuadranteId], ['4444DDD', '1']);
  await S.cocheEnCuadrante('1', { matricula: '1111AAA', quitar: true }, 7);
  igual('Sacar un coche del cuadrante', ultimo('cocheEnCuadrante').cuadranteId, null);
  await lanza('Sacar un coche que no está en ese cuadrante', () => S.cocheEnCuadrante('1', { matricula: '6666FFF', quitar: true }), 'no está en el C1');

  // El CT del cuadrante.
  escrito = [];
  const rc = await S.ctDelCuadrante('1', { turno: 'dia', uuid: 'u-fran', desde: hoy }, 7);
  igual('CT del cuadrante: en cada coche con CT con su bloque; el que ya lleva otro se salta; el sin CT no cuenta',
    [escrito.filter(x => x.que === 'varias').map(x => `${x.matricula} ${x.rol} ${x.dias}`), rc.saltados.map(s => `${s.matricula} ${s.nombre}`)],
    [['5555EEE ct 1'], ['2222BBB Eva']]);
  escrito = [];
  await S.ctDelCuadrante('1', { turno: 'dia', uuid: null, desde: hoy }, 7);
  igual('Sin persona, se quita el CT de ese turno de todos los coches del cuadrante', escrito.map(x => `${x.matricula} ${x.driverUuid}`), ['2222BBB null']);
  // Beto es fijo de noche del 1111AAA y libra X J: el S D y el L los trabaja allí.
  await lanza('El CT del cuadrante también mira que no doble', () => S.ctDelCuadrante('1', { turno: 'noche', uuid: 'u-beto', desde: hoy }), 'Beto ya lleva el 1111AAA los S D de noche');
  // [0] El CT del cuadrante: cada plaza acaba con el periodo con CT de su coche.
  conFinCT();
  escrito = [];
  await S.ctDelCuadrante('1', { turno: 'noche', uuid: 'u-fran', desde: hoy }, 7);
  igual('[0] El CT del cuadrante: la plaza del coche al que se le quita el CT acaba ese día',
    escrito.filter(x => x.que === 'varias').map(x => `${x.matricula} ${x.hasta}`), ['2222BBB null', `5555EEE ${FIN_CT}`]);
  // …y si ya estaba así hasta ese mismo día, no se vuelve a escribir.
  PLAN.asignaciones.push({ id: '20', matricula: '5555EEE', turno: 'noche', uuid: 'u-fran', rol: 'ct', dias: [1], desde: R.sumarDias(hoy, -1), hasta: FIN_CT });
  escrito = [];
  await S.ctDelCuadrante('1', { turno: 'noche', uuid: 'u-fran', desde: hoy }, 7);
  igual('[0] …y si ya estaba así hasta el fin del periodo con CT, no se vuelve a escribir', escrito.filter(x => x.que === 'varias').map(x => x.matricula), ['2222BBB']);
  PLAN = basePlan();

  // [1] Dos bloques del cuadrante no comparten día en NINGÚN día desde el que se
  // escribe: lo que ya hay escrito para más adelante también cuenta. El 5555EEE
  // pasa del bloque L al V dentro de dos semanas.
  const MAS2 = R.sumarDias(hoy, 14);
  const dmy = iso => iso.split('-').reverse().join('/');
  const futuro5555 = () => {
    PLAN = basePlan();
    PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '5555EEE' ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
    PLAN.descansos.push({ matricula: '5555EEE', turno: null, dias: [5], desde: MAS2, hasta: null });
  };
  futuro5555();
  await lanza('[1] Un bloque que chocará con el que otro coche del cuadrante tiene escrito para más adelante',
    () => S.fijarDescanso({ matricula: '2222BBB', turno: null, dias: [5, 6], desde: hoy }), `chocan con 5555EEE (V) en el cuadrante desde el ${dmy(MAS2)}`);
  await lanza('[1] Activar el CT con un bloque que chocará más adelante',
    () => S.correturnos({ matricula: '1111AAA', activar: true, dias: [5], desde: hoy }), `chocan con 5555EEE (V) en el cuadrante desde el ${dmy(MAS2)}`);
  // Lo que el propio coche tiene escrito para después se respeta: el bloque nuevo
  // dura hasta su víspera, así que no choca con lo que viene detrás.
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '2222BBB' ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
  PLAN.descansos.push({ matricula: '2222BBB', turno: null, dias: [6, 7], desde: MAS2, hasta: null });
  escrito = [];
  await S.fijarDescanso({ matricula: '2222BBB', turno: null, dias: [5, 6], desde: hoy }, 7);
  igual('[1] …pero no choca si el coche ya tiene escrito otro bloque para ese día', ultimo('descanso').dias, [5, 6]);
  // Dejar de librar tampoco se para por un choque que ya hubiera más adelante y
  // que esta escritura no toca: el 2222BBB tiene escrito el V desde dentro de dos
  // semanas, como el 5555EEE (colado de antes). Poner otro bloque hasta entonces
  // sí se deja; quitarlo tenía que dejarse igual.
  futuro5555();
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '2222BBB' ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
  PLAN.descansos.push({ matricula: '2222BBB', turno: null, dias: [5], desde: MAS2, hasta: null });
  escrito = [];
  await S.fijarDescanso({ matricula: '2222BBB', turno: null, dias: [], desde: hoy }, 7);
  igual('[1] …y dejar de librar no se para por un choque de más adelante que no toca', ultimo('descanso').dias, []);
  // Meter un coche cuyo CT empieza más adelante, con un bloque que chocará.
  PLAN = basePlan();
  PLAN.cts.push({ matricula: '4444DDD', desde: MAS2, hasta: null });
  PLAN.descansos.push({ matricula: '4444DDD', turno: null, dias: [6], desde: MAS2, hasta: null });
  await lanza('[1] Meter en el cuadrante un coche cuyo CT empieza más adelante con un bloque que choca',
    () => S.cocheEnCuadrante('1', { matricula: '4444DDD' }), `choca con 2222BBB (S/D) en el C1 desde el ${dmy(MAS2)}`);
  PLAN = basePlan();

  // [3] Una fecha con buena forma que no existe: ni se convierte en otra ni
  // llega a la base (allí sería un 22008 en inglés). La del día 32 y la del mes
  // 13 rompían en V8; la del 31 de un mes de 30 días, V8 la pasa al día 1 del
  // siguiente y PostgreSQL la rechaza. Se busca una de esas cerca de hoy.
  const imposibles = [`${hoy.slice(0, 7)}-32`, `${hoy.slice(0, 4)}-13-01`];
  for (let x = R.sumarDias(hoy, -31); x < R.sumarDias(hoy, 59); x = R.sumarDias(x, 1)) {
    if (R.sumarDias(x, 1).endsWith('-01') && !x.endsWith('-31')) { imposibles.push(x.slice(0, 8) + '31'); break; }
  }
  const imposible = imposibles[imposibles.length - 1];
  for (const f of imposibles) {
    await lanza(`[3] Asignar desde ${f}`, () => S.asignar({ matricula: '1111AAA', turno: 'dia', uuid: 'u-fran', desde: f }), 'Esa fecha no existe');
  }
  await lanza(`[3] El descanso desde ${imposible}`, () => S.fijarDescanso({ matricula: '1111AAA', turno: 'dia', dias: [1], desde: imposible }), 'Esa fecha no existe');
  await lanza(`[3] Activar el CT desde ${imposible}`, () => S.correturnos({ matricula: '1111AAA', activar: true, dias: [3], desde: imposible }), 'Esa fecha no existe');
  await lanza(`[3] El CT del cuadrante desde ${imposibles[0]}`, () => S.ctDelCuadrante('1', { turno: 'noche', uuid: 'u-fran', desde: imposibles[0] }), 'Esa fecha no existe');
  igual(`[3] El tablero del ${imposible} es el de hoy (no un 500)`, (await S.tablero({ fecha: imposible })).fecha, hoy);
  igual('[3] Sin fecha, la escritura sigue valiendo desde hoy', (await S.asignar({ matricula: '6666FFF', turno: 'noche', uuid: null, desde: '' }, 7)).tablero.fecha, hoy);

  // ══ 4 · LAS HORAS ═════════════════════════════════════════════════════════
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

  // El reporte. Sin descansos ni CT, todos son fijos que no libran: lo de antes de db/234.
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
  const ivsR = H.intervalos(apuntes, sit, iniR, finR);
  const inf = H.informe({ desde: '2026-10-06', hasta: '2026-10-06', ivs: ivsR,
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
  igual('Resumen', [inf.resumen.plazas, inf.resumen.salieron, inf.resumen.noSalieron, inf.resumen.horas, inf.resumen.abierto, inf.resumen.libran],
    [3, 2, 1, 16.5, false, 0]);

  // CON LIBRANZAS (db/234). El martes 06 Ana libra (su descanso de día, M) y
  // aun así trabajó; Dani es CT de 2222BBB (con CT) solo los miércoles.
  const conLibra = {
    asignaciones: [
      { matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', desde: '2026-10-06', hasta: null },
      { matricula: '2222BBB', turno: 'dia', uuid: 'u-dani', rol: 'ct', dias: [3], desde: '2026-10-01', hasta: null },
    ],
    cts: [{ matricula: '2222BBB', desde: '2026-10-01', hasta: null }],
    descansos: [{ matricula: '1111AAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null },
      { matricula: '2222BBB', turno: null, dias: [3], desde: '2026-10-01', hasta: null }],
  };
  const infL = H.informe({ desde: '2026-10-06', hasta: '2026-10-07', ivs: H.intervalos(apuntes, sit, iniR, en('2026-10-08', 12)),
    ...conLibra, conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-09', 9) });
  const filaL = (uuid, fecha) => infL.filas.find(f => f.uuid === uuid && f.fecha === fecha) || {};
  igual('El día que libra no es «No salió»: es «Libra», sin horas en su plaza', [filaL('u-ana', '2026-10-06').estado, filaL('u-ana', '2026-10-06').horas], ['libra', 0]);
  igual('Si libraba y trabajó, se dice, y sus horas van en «Sin plaza» (por su hora de inicio)',
    [/Libraba, pero trabajó 7,5 h/.test(filaL('u-ana', '2026-10-06').obs), infL.sinPlan.filter(f => f.uuid === 'u-ana').map(f => `${f.fecha} ${f.horas} ${f.libraba}`)],
    [true, ['2026-10-06 7.5 1111AAA']]);
  igual('El miércoles Ana no libra y no salió', filaL('u-ana', '2026-10-07').estado, 'no_salio');
  // [5] El día que libra en una plaza y trabaja en otra suya, sus horas están en
  // la fila de esa otra plaza: la de «Libra» lo dice, no las manda a «Sin plaza».
  const MARTES = '2026-10-06';
  const casoLibra = (asignaciones, cts, descansos, ivs) => H.informe({ desde: MARTES, hasta: MARTES, ivs, asignaciones, cts, descansos,
    conductores: CONDUCTORES, coches: [], ahoraMs: en('2026-10-08', 13) });
  const libraCT = casoLibra(
    [{ id: '1', matricula: 'AAAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: '2', matricula: 'BBBB', turno: 'dia', uuid: 'u-ana', rol: 'ct', dias: [2], desde: '2026-10-01', hasta: null }],
    [{ matricula: 'BBBB', desde: '2026-10-01', hasta: null }],
    [{ matricula: 'AAAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null }, { matricula: 'BBBB', turno: null, dias: [2], desde: '2026-10-01', hasta: null }],
    [{ uuid: 'u-ana', situacion: 'viaje', ini: en(MARTES, 8), fin: en(MARTES, 14.6), veh: 'BBBB' }]);
  igual('[5] Libra de fija y ese día es CT en otro coche: la fila lo dice y nada va a «Sin plaza»',
    [(libraCT.filas.find(f => f.matricula === 'AAAA') || {}).obs, (libraCT.filas.find(f => f.matricula === 'BBBB') || {}).horas, libraCT.sinPlan.length],
    ['Libraba; ese día trabajó en BBBB (CT)', 6.6, 0]);
  const libraNoche = casoLibra(
    [{ id: '1', matricula: 'AAAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: '3', matricula: 'CCCC', turno: 'noche', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null }],
    [], [{ matricula: 'AAAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null }],
    [{ uuid: 'u-ana', situacion: 'viaje', ini: en(MARTES, 20), fin: en('2026-10-07', 4), veh: 'CCCC' }]);
  igual('[5] Fija de día que libra y hace su noche: no se la acusa de trabajar en su libranza',
    [(libraNoche.filas.find(f => f.matricula === 'AAAA') || {}).obs, libraNoche.sinPlan.length], ['Libraba; ese día trabajó en CCCC', 0]);
  igual('El CT solo sale los días que cubre: el martes no, el miércoles sí', [filaL('u-dani', '2026-10-06').estado, filaL('u-dani', '2026-10-07').estado, filaL('u-dani', '2026-10-07').rol],
    [undefined, 'no_salio', 'ct']);
  const anaL = infL.porConductor.find(c => c.nombre === 'Ana');
  igual('Por conductor: los días que le tocaba, los que no salió y los que libró', [anaL.plazas, anaL.salio, anaL.noSalio, anaL.libra], [1, 0, 1, 1]);
  igual('Resumen: las libranzas aparte', [infL.resumen.plazas, infL.resumen.libran, infL.resumen.noSalieron], [4, 1, 3]);
  const xlsL = await require('../modules/Barcelona/barcelona.excel').generar(infL);
  const ExcelJS = require('exceljs');
  const libroL = new ExcelJS.Workbook();
  await libroL.xlsx.load(xlsL);
  const hojaDia = libroL.getWorksheet('Por día');
  const filasDia = [...Array(hojaDia.rowCount).keys()].map(i => hojaDia.getRow(i + 1));
  const libraEnExcel = filasDia.find(r => r.getCell(4).value === 'Ana' && r.getCell(9).value === 'Libra');
  igual('Excel: el estado «Libra», sin horas', [!!libraEnExcel, libraEnExcel && libraEnExcel.getCell(6).value], [true, null]);
  igual('Excel: el CT lleva su turno con «CT»', filasDia.some(r => r.getCell(4).value === 'Dani' && r.getCell(2).value === 'Día · CT'), true);
  igual('Excel: la leyenda ya no dice que Barcelona no tiene libranzas', /no tiene libranzas/.test(String(hojaDia.getCell(3, 1).value)), false);
  igual('[5] Excel: la leyenda dice que, si libraba y trabajó en otra plaza suya, sus horas van allí',
    /la otra plaza que trabajara ese día/.test(String(hojaDia.getCell(3, 1).value)), true);
  const sinPlazaXls = libroL.getWorksheet('Sin plaza');
  igual('Excel: en «Sin plaza» se dice que libraba', [...Array(sinPlazaXls.rowCount).keys()].map(i => sinPlazaXls.getRow(i + 1))
    .some(r => r.getCell(3).value === 'Ana' && r.getCell(9).value === 'Libraba (1111AAA)'), true);

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
  igual('De menor a mayor; Dani (desactivada y sin horas) no sale; Eva y Fran, activas sin horas, sí',
    sem.filas.map(f => `${f.nombre} ${f.total}`), ['Eva 0', 'Fran 0', 'Caro 3', 'Ana 7.5', 'Beto 11']);
  const beto = sem.filas.find(f => f.nombre === 'Beto');
  const martes = beto.celdas[1];
  igual('Beto el martes: su noche (9 h) más lo de la mañana (2 h)', [martes.horas, martes.dia, martes.noche], [11, 2, 9]);
  igual('Beto: tenía plaza de noche del miércoles al domingo y no salió', [beto.noSalio, beto.celdas[0].noSalio, beto.celdas[2].noSalio], [5, false, true]);
  const ana = sem.filas.find(f => f.nombre === 'Ana');
  igual('Ana: un día trabajado, media de ese día', [ana.dias, ana.media], [1, 7.5]);
  const caro = sem.filas.find(f => f.nombre === 'Caro');
  igual('Caro trabajó sin plaza: sus horas cuentan, sin «no salió»', [caro.celdas[1].horas, caro.noSalio, caro.celdas[1].plazas.length], [3, 0, 0]);
  igual('Semana cerrada', [sem.resumen.cerrada, sem.resumen.enCurso, sem.resumen.horas], [true, false, 21.5]);
  // Con libranzas: Beto (noche de 1111AAA) libra J V.
  const semL = H.semana({ lunes: '2026-10-05', ivs: ivsSemana, asignaciones: ASIGS, conductores: CONDUCTORES, ahoraMs: en('2026-10-13', 13),
    cts: [], descansos: [{ matricula: '1111AAA', turno: 'noche', dias: [4, 5], desde: '2026-10-01', hasta: null }] });
  const betoL = semL.filas.find(f => f.nombre === 'Beto');
  igual('Semana: el día que libra no es «no salió» (Beto libra J V: de 5 a 3)', [betoL.noSalio, betoL.libra, betoL.celdas[3].libra, betoL.celdas[3].noSalio],
    [3, 2, [{ matricula: '1111AAA', turno: 'noche' }], false]);
  const curso = H.semana({ lunes: '2026-10-05', ivs: H.intervalos(apuntes, sit, en('2026-10-04', 12), en('2026-10-07', 10)), asignaciones: ASIGS, conductores: CONDUCTORES, ahoraMs: en('2026-10-07', 10) });
  const anaCurso = curso.filas.find(f => f.nombre === 'Ana');
  igual('La semana en curso: el martes aún abierto (su noche acaba el miércoles a las 12), el jueves por venir',
    [anaCurso.celdas[1].estado, anaCurso.celdas[3].estado, curso.resumen.enCurso, curso.resumen.cerrada], ['abierto', 'futuro', true, false]);
  igual('En curso, un día abierto sin horas no es «no salió»', anaCurso.celdas[2].noSalio, false);
  const xlsSem = await require('../modules/Barcelona/barcelona.excel').generarSemana(sem);
  igual('El Excel de la semana sale', xlsSem.slice(0, 2).toString(), 'PK');
  const libroSL = new ExcelJS.Workbook();
  await libroSL.xlsx.load(await require('../modules/Barcelona/barcelona.excel').generarSemana(semL));
  const hojaSL = libroSL.getWorksheet('Semana');
  const fBetoL = [...Array(hojaSL.rowCount).keys()].map(i => hojaSL.getRow(i + 1)).find(r => r.getCell(1).value === 'Beto');
  igual('Excel semanal: el jueves que libra Beto sale «L»', [fBetoL.getCell(8).value, fBetoL.getCell(10).value], ['L', 0]);

  // ── El turno asignado de cada conductor ───────────────────────────────────
  igual('Semana: el turno asignado de cada uno (Caro, sin plaza)',
    sem.filas.filter(f => f.total > 0).map(f => `${f.nombre}:${f.asignadas.map(p => p.turno + ' ' + p.matricula).join('/') || 'sin plaza'}`),
    ['Caro:sin plaza', 'Ana:dia 1111AAA', 'Beto:noche 1111AAA']);
  igual('Si cambió de turno en el periodo, salen los dos', H.plazasDistintas([
    { turno: 'dia', matricula: '1111AAA' }, { turno: 'dia', matricula: '1111AAA' }, { turno: 'noche', matricula: '2222BBB' }]),
    [{ turno: 'dia', matricula: '1111AAA' }, { turno: 'noche', matricula: '2222BBB' }]);
  igual('La plaza de CT se distingue de la de fijo', H.plazasDistintas([{ turno: 'dia', matricula: '1111AAA' }, { turno: 'dia', matricula: '1111AAA', rol: 'ct' }]),
    [{ turno: 'dia', matricula: '1111AAA' }, { turno: 'dia', matricula: '1111AAA', rol: 'ct' }]);
  igual('Reporte diario, «Por conductor»: también con su turno',
    inf.porConductor.map(c => `${c.nombre}:${c.asignadas.map(p => p.turno).join('/')}`), ['Dani:dia', 'Ana:dia', 'Beto:noche']);
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(xlsSem);
  const hoja = libro.getWorksheet('Semana');
  const cab = hoja.getRow(4).values.slice(1, 6);
  const fBeto = [...Array(hoja.rowCount).keys()].map(i => hoja.getRow(i + 1)).find(r => r.getCell(1).value === 'Beto');
  igual('Excel semanal: Turno y Matrícula detrás del teléfono', cab, ['Conductor', 'Teléfono', 'Turno', 'Matrícula', 'Lun 05/10']);
  igual('Excel semanal: la fila de Beto', [fBeto.getCell(3).value, fBeto.getCell(4).value, fBeto.getCell(6).value, fBeto.getCell(12).value], ['Noche', '1111AAA', 11, 11]);
  const libroDia = new ExcelJS.Workbook();
  await libroDia.xlsx.load(xls);
  const porCond = libroDia.getWorksheet('Por conductor');
  igual('Excel diario, «Por conductor»: Turno y Matrícula', porCond.getRow(4).values.slice(1, 5), ['Conductor', 'Teléfono', 'Turno', 'Matrícula']);

  // ══ 5 · EL PROMEDIO (igual que Madrid, sin letra) ═════════════════════════
  // Ana, fija de día de 1111AAA desde el lunes 05/10 y libra S D. Trabaja el 01
  // (sin plaza, 4 h), del 05 al 08 (8 h cada día), el sábado 10 (su libranza,
  // 5 h) y el lunes 12 (6 h). Beto sale 3 días.
  // A mitad, un viaje: un estado de más de 6 h sin otro apunte se corta (TOPE_H).
  const trabajo = (uuid, fecha, desde, horas) => [ap(uuid, fecha, desde, 'waiting_orders'),
    ap(uuid, fecha, desde + horas / 2, 'has_order'), ap(uuid, fecha, desde + horas, 'inactive')];
  const apProm = [
    ...trabajo('u-ana', '2026-10-01', 8, 4),
    ...['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].flatMap(f => trabajo('u-ana', f, 7, 8)),
    ...trabajo('u-ana', '2026-10-10', 9, 5), ...trabajo('u-ana', '2026-10-12', 8, 6),
    ...['2026-10-05', '2026-10-06', '2026-10-07'].flatMap(f => trabajo('u-beto', f, 7, 9)),
  ];
  const planProm = {
    asignaciones: [{ matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-05', hasta: null }],
    cts: [], descansos: [{ matricula: '1111AAA', turno: 'dia', dias: [6, 7], desde: '2026-10-01', hasta: null }],
  };
  const ivsProm = H.intervalos(apProm, sit, en('2026-09-30', 12), en('2026-11-20', 12));
  igual('El periodo: el mes corrido hasta ayer; el mes es joven los primeros días',
    [H.periodosDelPromedio('2026-10-20', en('2026-10-20', 13)), H.periodosDelPromedio('2026-11-03', en('2026-11-03', 13)).anterior],
    [{ actual: { mes: '2026-10', desde: '2026-10-01', hasta: '2026-10-19' }, anterior: null, desde: '2026-10-01', hasta: '2026-10-19' },
      { mes: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' }]);
  const prom = H.promedios({ hoy: '2026-10-20', ivs: ivsProm, ...planProm, ahoraMs: en('2026-10-20', 13) });
  const pa = prom('u-ana');
  // Salió 7 días (47 h). Ausencias: los días laborables desde el 05 sin horas (9, 13, 14, 15, 16, 19).
  // Libranzas (11, 17, 18) y días antes de su plaza sin horas (02, 03, 04) no cuentan.
  igual('Ana: 47 h ÷ (7 días que salió + 6 ausencias) = 3,6 h; media de los días que salió, 6,7',
    [pa.horas, pa.total, pa.salio, pa.ausencias, pa.media, pa.periodo, pa.mesAnterior, pa.ne], [3.6, 47, 7, 6, 6.7, '2026-10', false, null]);
  igual('Beto: salió 3 días, menos del mínimo: N/E con el motivo', [prom('u-beto').horas, prom('u-beto').salio, prom('u-beto').ne],
    [null, 3, 'salió menos de 5 días en el mes (3)']);
  igual('Quien no ha hecho nada: N/E', [prom('u-fran').horas, prom('u-fran').salio], [null, 0]);
  const antesDeMediodia = H.promedios({ hoy: '2026-10-20', ivs: ivsProm, ...planProm, ahoraMs: en('2026-10-20', 10) })('u-ana');
  igual('Ayer no está cerrado hasta las 12:00 de hoy (acaba su noche): aún no es ausencia', antesDeMediodia.ausencias, 5);
  const joven = H.promedios({ hoy: '2026-11-03', ivs: ivsProm, ...planProm, ahoraMs: en('2026-11-03', 13) })('u-ana');
  // Octubre entero: 7 días que salió y 15 ausencias (los laborables del 05 al 30 sin horas).
  igual('Los primeros días del mes, el del mes anterior, rotulado', [joven.horas, joven.mesAnterior, joven.periodo, joven.etiqueta, joven.ausencias], [2.1, true, '2026-10', 'octubre', 15]);
  const tarde = H.promedios({ hoy: '2026-11-20', ivs: ivsProm, ...planProm, ahoraMs: en('2026-11-20', 13) })('u-ana');
  igual('Pasados los primeros días, sin 5 días que salió es N/E (no el del mes anterior)', [tarde.horas, tarde.mesAnterior, tarde.periodo], [null, false, '2026-11']);
  // [4] «Joven» se mide con los días CERRADOS, que es lo que cuenta: el día 6
  // antes de las 12:00 el 05 aún no ha cerrado (acaba su noche), así que el mes
  // solo lleva cuatro y vale el del mes anterior. Antes, toda Barcelona salía
  // en N/E el día 6 por la mañana.
  igual('[4] El 06/11 a las 09:00 el mes aún es joven (solo 4 días cerrados): se carga el mes anterior',
    H.periodosDelPromedio('2026-11-06', en('2026-11-06', 9)).anterior, { mes: '2026-10', desde: '2026-10-01', hasta: '2026-10-31' });
  igual('[4] …y a las 12:30, cerrado el 05, ya no', H.periodosDelPromedio('2026-11-06', en('2026-11-06', 12.5)).anterior, null);
  const seisM = H.promedios({ hoy: '2026-11-06', ivs: ivsProm, ...planProm, ahoraMs: en('2026-11-06', 9) })('u-ana');
  igual('[4] El 06/11 a las 09:00 Ana sale con el de octubre, no en N/E', [seisM.horas, seisM.mesAnterior, seisM.periodo], [2.1, true, '2026-10']);
  const seisT = H.promedios({ hoy: '2026-11-06', ivs: ivsProm, ...planProm, ahoraMs: en('2026-11-06', 12.5) })('u-ana');
  igual('[4] A las 12:30, el de noviembre (y sin 5 días que salió, N/E)', [seisT.horas, seisT.mesAnterior, seisT.periodo], [null, false, '2026-11']);

  // ══ 6 · LA VISIBILIDAD: las cuentas de Madrid con los datos de Barcelona ══
  // Ana, con plaza de día, trabajó ayer de 08:00 a 16:00 (2 h de viaje) y
  // descansó de 16:00 a 17:00. Cada ventana pedida devuelve 100 € y 5 viajes.
  const VS = require('../modules/Barcelona/visibilidad.service');
  const hoyV = S.hoyMadrid(), ayerV = R.sumarDias(hoyV, -1);
  const apV = [
    ap('u-ana', ayerV, 8, 'waiting_orders'), ap('u-ana', ayerV, 9, 'has_order'), ap('u-ana', ayerV, 11, 'waiting_orders'),
    ap('u-ana', ayerV, 16, 'busy'), ap('u-ana', ayerV, 17, 'inactive'),
  ];
  repo.apuntesEntre = async (sede, ini, fin) => apV.filter(x => x.t >= ini && x.t < fin);
  repo.dineroEntre = async () => ({ neto: 100, viajes: 5 });
  repo.planEntre = async () => ({ asignaciones: [{ matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', dias: null, desde: '2026-01-01', hasta: null }], cts: [], descansos: [] });
  repo.leerConfigVisibilidad = async () => null;
  const rv = await VS.resumen();
  igual('Ayer (día natural): 8 h, 2 de viaje, 1 de descanso', [rv.ayer.horasEfectivas, rv.ayer.viajeH, rv.ayer.descansoH, rv.ayer.conductores], [8, 2, 1, 1]);
  igual('Las métricas de Madrid: utilización y €·hora', [rv.ayer.utilizacion, rv.ayer.eurosHora, rv.ayer.viajesHora], [25, 12.5, 0.6]);
  igual('Sin meta guardada y los coches, los que se pueden planificar', [rv.config.meta, rv.config.vehiculos], [null, 5]);
  // El rango de los días (25/10/2026: sustituye a «los últimos 15 días»).
  repo.primerDiaApuntes = async () => R.sumarDias(hoyV, -10);
  const ul = await VS.rango({ ultimos: 5 });
  igual('El rango de 5 días: ayer 8 h (6 de espera), y hoy al final, en curso', [ul.puntos.length, ul.puntos[4].valor, ul.puntos[4].esperaH, ul.puntos[5].enCurso], [6, 8, 6, true]);
  let malo = null;
  try { await VS.rango({ ultimos: 'x' }); } catch (e) { malo = e.estado; }
  igual('Un rango que no vale es un 400, no un 500', malo, 400);
  const [ya, ym, yd] = ayerV.split('-').map(Number);
  const sv = await VS.serieMes(ya, ym);
  igual('La serie del mes: el día de ayer con sus 8 h', sv.dias[yd - 1].total, 8);
  igual('Sin meta, el ideal es cero (la pantalla no lo pinta)', sv.idealDiario, 0);
  const cv = await VS.comoVamos(`${ya}-${String(ym).padStart(2, '0')}`);
  igual('Cómo vamos: el acumulado al último día cerrado lleva las 8 h de ayer', cv.comoVamos && cv.comoVamos.acumulado, 8);
  const cr = await VS.crecimiento();
  igual('Cómo hemos crecido: un mes con sus 8 h, sin base para un %', cr.meses.map(m => [m.horas, m.cambioHorasDiaPct]).filter(x => x[0] > 0), [[8, null]]);
  // Las tarjetas de turno, con el plan del día: si ayer Ana libraba, sus horas
  // van por su hora de inicio (empezó a las 08:00: siguen siendo del día).
  const aE = await VS.aEstaHora();
  igual('«A esta hora» sale con el plan del día', !!aE && !aE.faltaMigracion, true);

  // ══ 7 · SIN LAS MIGRACIONES ═══════════════════════════════════════════════
  const sinTabla = () => { const e = new Error('no existe la relación'); e.code = '42P01'; return e; };
  const sinColumna = () => { const e = new Error('no existe la columna «rol»'); e.code = '42703'; return e; };
  repo.planEntre = async () => { throw sinColumna(); };
  repo.queFalta = async () => 'db/234';
  igual('Sin db/234 la pantalla del planificador lo dice, con cuál', (await S.tablero({ fecha: hoy })).faltaMigracion, 'db/234');
  let leidoDeAntes = false;
  repo.asignacionesEntre = async () => { leidoDeAntes = true; return [{ matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', dias: null, desde: '2026-01-01', hasta: null }]; };
  const rvSin = await VS.resumen();
  igual('Sin db/234 la Visibilidad sigue saliendo, con las asignaciones de antes (todos fijos)', [leidoDeAntes, rvSin.ayer.horasEfectivas], [true, 8]);
  repo.planEntre = async () => { throw sinColumna(); };
  repo.queFalta = async () => null;
  let otro = null;
  try { await S.tablero({ fecha: hoy }); } catch (e) { otro = e.code; }
  igual('Con las dos migraciones aplicadas, un 42703 es un error de verdad y no se esconde', otro, '42703');
  // [12] …y tampoco en el reporte, la semana ni la Visibilidad: antes se lo
  // tragaban como «falta la migración» (o como 0 €).
  let otroR = null, otroS = null, otroV = null;
  try { await S.reporte({}); } catch (e) { otroR = e.code; }
  try { await S.reporteSemanal({}); } catch (e) { otroS = e.code; }
  try { await VS.resumen(); } catch (e) { otroV = e.code; }
  igual('[12] …y tampoco se esconde en el reporte, la semana ni la Visibilidad', [otroR, otroS, otroV], ['42703', '42703', '42703']);
  repo.conductores = async () => { throw sinTabla(); };
  repo.queFalta = async () => 'db/181';
  igual('Sin db/181 la pantalla lo dice', (await S.tablero({ fecha: hoy })).faltaMigracion, 'db/181');

  // ══ 8 · LA PANTALLA (public/assets/js/vistas/Barcelona/barcelona-planificador.js) ══
  // La de verdad, en un vm, con los componentes de la casa de mentira (Dialogo,
  // Api, Casa) que apuntan qué se pide y qué se enseña. Las piezas de dentro de
  // su IIFE se sacan con una línea que se añade AQUÍ, no en el fichero. El
  // tablero que se le da es el que monta el servicio con los datos de mentira.
  repo.conductores = async () => CONDUCTORES;
  repo.planEntre = async () => PLAN;
  repo.queFalta = async () => null;
  const montarPantalla = tableroInicial => {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'vistas', 'Barcelona', 'barcelona-planificador.js'), 'utf8');
    const fin = src.lastIndexOf('})();');
    const codigo = src.slice(0, fin) +
      '\n  window.__P = { aplicar, celdaPlaza, filaCoche, cuentaZona, tituloPromedio, fijarBloque, cocheAlCuad, meterEnCuad, ctDelCuad, tablero: () => T };\n' +
      src.slice(fin);
    const els = new Map();
    const elemento = () => {
      const cl = new Set();
      return { innerHTML: '', textContent: '', value: '', addEventListener() {}, scrollIntoView() {},
        classList: { add: x => cl.add(x), remove: x => cl.delete(x), toggle: (x, f) => ((f === undefined ? !cl.has(x) : f) ? cl.add(x) : cl.delete(x)) } };
    };
    const dialogos = [], peticiones = [], respuestas = [];
    let respuestaApi = () => ({ tablero: tableroInicial });
    const dlg = tipo => (...args) => {
      dialogos.push({ tipo, args });
      if (tipo === 'hecho') return undefined;
      const r = respuestas.shift();
      return Promise.resolve(typeof r === 'function' ? r(...args) : r);
    };
    const ctx = {
      Casa: { esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) },
      Dialogo: { formulario: dlg('formulario'), aviso: dlg('aviso'), confirmar: dlg('confirmar'), elegir: dlg('elegir'), hecho: dlg('hecho') },
      Api: {
        get: async () => tableroInicial,
        pedir: async (url, o = {}) => { peticiones.push({ url, metodo: o.metodo, datos: o.datos }); return respuestaApi(url, o); },
      },
      document: { querySelector: s => { if (!s.startsWith('#')) return null; if (!els.has(s)) els.set(s, elemento()); return els.get(s); } },
      location: { pathname: '/barcelona', search: '', hash: '' },
      history: { pushState() {}, replaceState() {} },
      CSS: { escape: s => s }, addEventListener() {}, setTimeout, clearTimeout, console,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(codigo, ctx, { filename: 'barcelona-planificador.js' });
    ctx.__P.aplicar(tableroInicial);
    return { P: ctx.__P, dialogos, peticiones, respuestas, responder: fn => { respuestaApi = fn; } };
  };
  const sinEspacios = html => String(html).replace(/\s+/g, ' ');
  const DOM = R.sumarDias(LUN, 6);

  // [6] El CT que trabaja un día que el fijo también trabaja no «cubre» a nadie:
  // sus días no son los del bloque (se cambió el bloque y sus días no cambian
  // solos, como en Madrid). El 2222BBB pasa al bloque V S; Eva sigue con S D.
  PLAN = basePlan();
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '2222BBB' ? { ...x, dias: [5, 6] } : x));
  const tBloqueNuevo = await S.tablero({ fecha: DOM });
  PLAN = basePlan();
  const tDom = await S.tablero({ fecha: DOM });
  const v6 = montarPantalla(tBloqueNuevo);
  const c2 = tBloqueNuevo.coches.find(c => c.matricula === '2222BBB');
  igual('[6] (la prueba es la que toca) el domingo trabajan el fijo y el CT del 2222BBB', [c2.plazas.fijoDia.trabajaHoy, c2.plazas.ctDia.trabajaHoy], [true, true]);
  const celdaCT = sinEspacios(v6.P.celdaPlaza(c2, 'dia', 'ct'));
  igual('[6] La celda del CT no dice «cubre»: avisa de que trabaja con el fijo', [/cubre (hoy|el )/.test(celdaCT), /con el fijo/.test(celdaCT), /telecab-warn/.test(celdaCT)], [false, true, true]);
  const v6b = montarPantalla(tDom);
  v6b.respuestas.push({ dias: [5, 6] });
  v6b.responder(() => ({ tablero: tBloqueNuevo, dias: [5, 6] }));
  await v6b.P.fijarBloque('2222BBB');
  const avisoBloque = v6b.dialogos.find(x => x.tipo === 'aviso');
  igual('[6] Al cambiar el bloque, si el CT sigue con sus días de antes, se dice quién y cuáles',
    [v6b.peticiones.length, !!avisoBloque && /Eva \(CT de día\) sigue con S D/.test(avisoBloque.args[0].texto)], [1, true]);

  // [7] «+ Coche» y «Meter en un cuadrante» mandan el día que se mira: el
  // servidor devuelve el tablero de ese día y no salta a hoy.
  const v7 = montarPantalla(tDom);
  v7.respuestas.push({ mat: '4444DDD' });
  await v7.P.cocheAlCuad(tDom.cuadrantes[0]);
  v7.respuestas.push({ cua: '1' });
  await v7.P.meterEnCuad('6666FFF');
  igual('[7] Meter un coche en un cuadrante lleva la fecha que se mira', v7.peticiones.map(p => p.datos),
    [{ matricula: '4444DDD', fecha: DOM }, { matricula: '6666FFF', fecha: DOM }]);

  // [8] Los «saltados» del CT del cuadrante se dicen por lo que son: un coche
  // que ya lleva otro, o uno cuyo bloque no tiene días (ese no lo cubre nadie).
  const v8 = montarPantalla(tDom);
  v8.respuestas.push({ uuid: 'u-fran', desde: DOM });
  v8.responder(() => ({ tablero: tDom, cambiados: 1, saltados: [{ matricula: '5555EEE', motivo: 'aún no tiene los días del bloque' }, { matricula: '2222BBB', nombre: 'Eva', motivo: 'ya lo lleva otro' }] }));
  await v8.P.ctDelCuad(tDom.cuadrantes[0], 'dia');
  const aviso8 = (v8.dialogos.find(x => x.tipo === 'aviso') || { args: [{}] }).args[0];
  igual('[8] Saltados: el que ya lleva otro y el que no tiene días en su bloque, cada uno con lo suyo',
    [/2222BBB, lo lleva Eva: esos días ya los cubre otro/.test(aviso8.texto), /5555EEE no tiene días en su bloque/.test(aviso8.texto),
      /5555EEE[^.]*ya los cubre otro/.test(aviso8.texto), /Puesto en 1 coche/.test(aviso8.texto)], [true, true, false, true]);

  // [9] Con dos CT de día en el cuadrante («Varios»), el selector sale sin nadie:
  // «Guardar» tal cual los quitaría a todos. Se pregunta antes.
  PLAN = basePlan();
  PLAN.asignaciones.push({ id: '30', matricula: '5555EEE', turno: 'dia', uuid: 'u-fran', rol: 'ct', dias: [1], desde: CT2, hasta: null });
  const tVarios = await S.tablero({ fecha: DOM });
  PLAN = basePlan();
  const v9 = montarPantalla(tVarios);
  igual('[9] (la prueba es la que toca) el C1 tiene dos CT de día', tVarios.cuadrantes[0].ct.dia.map(p => p.nombre).sort(), ['Eva', 'Fran']);
  v9.respuestas.push({ uuid: '', desde: DOM }, false);
  await v9.P.ctDelCuad(tVarios.cuadrantes[0], 'dia');
  const conf9 = v9.dialogos.find(x => x.tipo === 'confirmar');
  igual('[9] Quitar a «Varios» pide confirmación, con quiénes y dónde; si se cancela no se manda nada',
    [!!conf9 && /Eva \(2222BBB\)/.test(conf9.args[0].texto) && /Fran \(5555EEE\)/.test(conf9.args[0].texto), v9.peticiones.length], [true, 0]);
  v9.respuestas.length = 0;
  v9.respuestas.push({ uuid: '', desde: DOM }, true);
  await v9.P.ctDelCuad(tVarios.cuadrantes[0], 'dia');
  igual('[9] …y si se confirma, se quitan', v9.peticiones.map(p => p.datos), [{ turno: 'dia', uuid: null, desde: DOM }]);

  // [10] Un coche desactivado en BOLT: «desactivado» en castellano, su turno sin
  // nadie no es un hueco rojo y no cuenta en las tarjetas de zona (como en la
  // cifra de Huecos, que es del servidor y solo cuenta los activos).
  const v10 = montarPantalla(tDom);
  const c3 = tDom.coches.find(c => c.matricula === '3333CCC');
  igual('[10] (la prueba es la que toca) el 3333CCC está desactivado y sin fijo de día', [c3.activo, c3.estadoBolt, c3.turnos.dia], [false, 'deactivated', 'hueco']);
  const fila3 = sinEspacios(v10.P.filaCoche(c3, false, false));
  igual('[10] La fila dice «desactivado en BOLT», no «deactivated»', [/desactivado en BOLT/.test(fila3), /deactivated/.test(fila3)], [true, false]);
  const celda3 = sinEspacios(v10.P.celdaPlaza(c3, 'dia', 'fijo'));
  igual('[10] Su turno sin nadie: «no sale», en gris, no un hueco rojo', [/no sale · coche desactivado/.test(celda3), /telecab-red/.test(celda3)], [true, false]);
  const sumaHuecos = ['sin', ...tDom.zonas.map(z => String(z.id))].reduce((s, k) => s + v10.P.cuentaZona(k).huecos, 0);
  igual('[10] Los huecos de las tarjetas de zona suman lo mismo que la cifra de Huecos', sumaHuecos, tDom.resumen.huecos);

  // [11] La ayuda del chip del promedio dice la regla de verdad.
  const ayuda = v10.P.tituloPromedio({ horas: 8.6, total: 120, salio: 13, ausencias: 1, media: 9.2, periodo: '2026-11' });
  igual('[11] La ayuda: un día con horas cuenta siempre, tuviera plaza o no',
    [/tuviera plaza o no/.test(ayuda), /los días sin plaza no cuentan/.test(ayuda), /hasta ayer/.test(ayuda)], [true, false, true]);
  const ayudaAnt = v10.P.tituloPromedio({ horas: 9.4, total: 150, salio: 16, ausencias: 0, media: 9.4, periodo: '2026-10', mesAnterior: true });
  igual('[11] El del mes anterior es de octubre entero, no «hasta ayer»', [/octubre entero/.test(ayudaAnt), /hasta ayer/.test(ayudaAnt)], [true, false]);

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
