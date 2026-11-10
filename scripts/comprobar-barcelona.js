// ============================================================
// BARCELONA — el planificador y sus horas
// ============================================================
// Las reglas de modules/Barcelona: el plan de cada día (quién trabaja, quién
// libra y dónde hay hueco, con las libranzas de cada fijo y las casillas de CT
// del cuadrante: barcelona.plan.js, db/234 y db/236 del 06/11/2026), el
// tablero, lo que se comprueba antes de escribir (ninguna plaza se repite,
// nadie dobla, el todoturno solo), las rutas, y las horas: la misma regla que
// Madrid (día 00→24, noche 12→12 según la plaza; sin plaza, o librando, por su
// hora de inicio), «No salió» si le tocaba y no hizo horas, «Libra» si era su
// día, y el promedio de la casa sin letra.
//
//   node scripts/comprobar-barcelona.js
//
// No toca la base: el repositorio se sustituye por datos de mentira. El Excel
// del planificador tiene sus pruebas aparte (las de su generador); aquí solo se
// mira que el servicio y la ruta se lo pidan bien.
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

let PLAN = { asignaciones: [], casillas: [], descansos: [], cts: [] };
let EST = { zonas: [], cuadrantes: [], cochesCuadrante: [] };
let escrito = [];          // lo que el servicio le pide al repositorio que escriba
const ultimo = nombre => [...escrito].reverse().find(x => x.que === nombre) || {};
const apunta = (que, r) => async x => { escrito.push({ que, ...x }); return typeof r === 'function' ? r(x) : r; };
const sinQue = x => { const y = { ...x }; delete y.que; return y; };

repo.conductores = async () => CONDUCTORES;
repo.coches = async () => COCHES;
// El plan lleva la pertenencia de los coches, como repo.planEntre (la misma consulta que estructura).
repo.planEntre = async () => ({ cts: [], casillas: [], ...PLAN, cochesCuadrante: EST.cochesCuadrante });
repo.estructura = async () => EST;
repo.queFalta = async () => null;
repo.apuntesEntre = async () => [];
repo.situaciones = async () => new Map(Object.entries(SIT));
repo.rechazosEntre = async () => [];   // los pedidos rechazados del reporte: aquí, ninguno
repo.asignar = apunta('asignar', { cambio: true, movidaDe: null });
repo.ponerDescanso = apunta('descanso', undefined);
repo.agregarCasilla = apunta('agregarCasilla', undefined);
repo.personaCasilla = apunta('personaCasilla', { cambio: true });
repo.quitarCasilla = apunta('quitarCasilla', { cambio: true });
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
  // El 05/10/2026 es lunes. El C1 (1111AAA, 2222BBB y 5555EEE) tiene casilla de
  // día (Eva) y de noche (vacía); el C2 (6666FFF), una todoturno (Fran). El
  // 4444DDD no está en ningún cuadrante. Cada fijo libra lo suyo: Ana (día del
  // 1111AAA) el L y desde el 15 el J; Beto (su noche) el X; Caro (día del
  // 2222BBB) el M; el 5555EEE, sin fijos, libra de día el X; el 6666FFF, de día
  // y de noche el L (una plaza repetida en la todoturno, a propósito).
  igual('ISODOW: el 05/10/2026 es lunes y el 11 domingo', [P.isodow('2026-10-05'), P.isodow('2026-10-11')], [1, 7]);
  const CC = [{ matricula: '1111AAA', cuadranteId: '1' }, { matricula: '2222BBB', cuadranteId: '1' },
    { matricula: '5555EEE', cuadranteId: '1' }, { matricula: '6666FFF', cuadranteId: '2' }];
  const datos1 = {
    asignaciones: [
      { id: 1, matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', desde: '2026-10-01', hasta: null },   // sin rol: fijo
      { id: 2, matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: 3, matricula: '2222BBB', turno: 'dia', uuid: 'u-caro', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: 4, matricula: '4444DDD', turno: 'dia', uuid: 'u-dani', rol: 'fijo', desde: '2026-10-01', hasta: null },
    ],
    casillas: [
      { id: 'k1', cuadranteId: '1', jornada: 'dia', uuid: 'u-eva', desde: '2026-10-01', hasta: null },
      { id: 'k2', cuadranteId: '1', jornada: 'noche', uuid: null, desde: '2026-10-01', hasta: null },
      { id: 'k3', cuadranteId: '2', jornada: 'todoturno', uuid: 'u-fran', desde: '2026-10-01', hasta: null },
    ],
    descansos: [
      { matricula: '1111AAA', turno: 'dia', dias: [1], desde: '2026-10-01', hasta: '2026-10-14' },
      { matricula: '1111AAA', turno: 'dia', dias: [4], desde: '2026-10-15', hasta: null },
      { matricula: '1111AAA', turno: 'noche', dias: [3], desde: '2026-10-01', hasta: null },
      { matricula: '2222BBB', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null },
      { matricula: '2222BBB', turno: 'noche', dias: [4], desde: '2026-10-01', hasta: null },
      { matricula: '5555EEE', turno: 'dia', dias: [3], desde: '2026-10-01', hasta: null },
      { matricula: '5555EEE', turno: 'noche', dias: [5], desde: '2026-10-01', hasta: null },
      { matricula: '6666FFF', turno: 'dia', dias: [1], desde: '2026-10-01', hasta: null },
      { matricula: '6666FFF', turno: 'noche', dias: [1], desde: '2026-10-01', hasta: null },
      { matricula: '4444DDD', turno: 'dia', dias: [6], desde: '2026-10-01', hasta: null },
    ],
    cochesCuadrante: CC,
  };
  const reglas = P.crear(datos1);
  const a = id => reglas.asignaciones.find(x => x.id === id);
  const k = id => reglas.casillas.find(x => x.id === id);
  const plazaTxt = x => `${x.dia} ${x.matricula} ${x.turno}`;
  igual('La libranza de cada fijo, con sus fechas', [reglas.descansoDe('1111AAA', 'dia', '2026-10-05'), reglas.descansoDe('1111AAA', 'dia', '2026-10-16'), reglas.descansoDe('1111AAA', 'noche', '2026-10-16')], [[1], [4], [3]]);
  igual('Ana libra el lunes 05 y el 12, trabaja el miércoles, y desde el 15 libra el jueves',
    [reglas.libra(a(1), '2026-10-05'), reglas.libra(a(1), '2026-10-12'), reglas.trabaja(a(1), '2026-10-07'), reglas.libra(a(1), '2026-10-15'), reglas.libra(a(1), '2026-10-19')],
    [true, true, true, true, false]);
  igual('La casilla de día del C1 coge, cada día, la plaza de día que libra (Camilo: «las plazas que no se trabajan»)',
    reglas.cubreSemana(k('k1'), '2026-10-05').map(plazaTxt), ['1 1111AAA dia', '2 2222BBB dia', '3 5555EEE dia']);
  igual('La libranza del CT: los días que no coge nada (Camilo: «el día que no coja ninguno»)', reglas.libraCasilla(k('k1'), '2026-10-05'), [4, 5, 6, 7]);
  igual('…y con las libranzas de cada día: desde el 15, el 1111AAA libra el J y el CT, el L',
    [reglas.cubreSemana(k('k1'), '2026-10-16').map(plazaTxt), reglas.libraCasilla(k('k1'), '2026-10-16')],
    [['2 2222BBB dia', '3 5555EEE dia', '4 1111AAA dia'], [1, 5, 6, 7]]);
  igual('La de noche coge las de noche (vacía: lo que coja es hueco)', reglas.cubreSemana(k('k2'), '2026-10-05').map(plazaTxt),
    ['3 1111AAA noche', '4 2222BBB noche', '5 5555EEE noche']);
  igual('La todoturno coge las de día y las de noche juntas', reglas.cubreSemana(k('k3'), '2026-10-05').map(plazaTxt), ['1 6666FFF dia', '1 6666FFF noche']);
  igual('Una plaza repetida se dice (la todoturno cogería las dos el L)', reglas.repetidasSemana(k('k3'), '2026-10-05'),
    [{ dia: 1, plazas: [{ matricula: '6666FFF', turno: 'dia' }, { matricula: '6666FFF', turno: 'noche' }] }]);
  igual('El lunes Ana libra y la casilla de día la coge: «cubre-ct», con Eva',
    [reglas.estadoDelTurno('1111AAA', 'dia', '2026-10-05'), (reglas.quienCubre('1111AAA', 'dia', '2026-10-05') || {}).uuid, reglas.estadoDelTurno('1111AAA', 'noche', '2026-10-05')],
    ['cubre-ct', 'u-eva', 'trabaja']);
  igual('El miércoles libra Beto y la casilla de noche está vacía: hueco; el 5555EEE de día (sin fijo, libra) lo coge Eva',
    [reglas.estadoDelTurno('1111AAA', 'noche', '2026-10-07'), reglas.estadoDelTurno('5555EEE', 'dia', '2026-10-07')], ['hueco', 'cubre-ct']);
  igual('El jueves el 5555EEE de día no libra y no tiene fijo: hueco (la casilla solo coge lo que libra)', reglas.estadoDelTurno('5555EEE', 'dia', '2026-10-08'), 'hueco');
  igual('Un coche sin cuadrante no lleva CT: el sábado libra Dani y el coche no sale',
    [reglas.turnoDelCoche('4444DDD', 'dia', '2026-10-10'), reglas.estadoDelTurno('4444DDD', 'dia', '2026-10-10')], ['libra', 'libra']);
  igual('Plaza repetida: la todoturno coge la de día y la de noche queda en hueco (nadie lleva dos a la vez)',
    [reglas.estadoDelTurno('6666FFF', 'dia', '2026-10-05'), reglas.estadoDelTurno('6666FFF', 'noche', '2026-10-05')], ['cubre-ct', 'hueco']);
  const planTxt = l => l.map(x => `${x.uuid} ${x.matricula} ${x.turno} ${x.rol}`).sort();
  igual('El plan del lunes: los fijos que trabajan y cada CT en la plaza que coge',
    planTxt(reglas.planDelDia('2026-10-05')), ['u-beto 1111AAA noche fijo', 'u-caro 2222BBB dia fijo', 'u-dani 4444DDD dia fijo', 'u-eva 1111AAA dia ct', 'u-fran 6666FFF dia ct']);
  igual('El plan del jueves: Eva y Fran no cogen nada (libran)', planTxt(reglas.planDelDia('2026-10-08')).filter(x => / ct$/.test(x)), []);
  igual('Ninguna plaza se repite en el C1 (tres semanas)', reglas.plazasRepetidas('1', '2026-10-05', '2026-10-25'), null);
  igual('En el C2 sí: dice el día, la jornada y las plazas', reglas.plazasRepetidas('2', '2026-10-05', '2026-10-11'),
    { fecha: '2026-10-05', dia: 1, jornada: 'todoturno', plazas: [{ matricula: '6666FFF', turno: 'dia' }, { matricula: '6666FFF', turno: 'noche' }] });
  igual('Con foco en otra plaza, un choque que no la toca no cuenta', reglas.plazasRepetidas('2', '2026-10-05', '2026-10-11', { matricula: '1111AAA' }), null);
  igual('Con foco en una casilla, solo cuenta lo suyo', [!!reglas.plazasRepetidas('2', '2026-10-05', '2026-10-11', { casillaId: 'k3' }),
    reglas.plazasRepetidas('2', '2026-10-05', '2026-10-11', { casillaId: 'k1' })], [true, null]);
  // La pertenencia no tiene historial: un coche que entró en el cuadrante el
  // jueves 08 no es de sus casillas antes (no se inventa que su CT lo cogía).
  const reglasEntro = P.crear({ ...datos1, cochesCuadrante: CC.map(x => (x.matricula === '5555EEE' ? { ...x, desde: '2026-10-08' } : x)) });
  igual('Un coche que entró en el cuadrante el 08: el miércoles 07 su libranza no la coge nadie (libra); el 14, sí',
    [reglasEntro.estadoDelTurno('5555EEE', 'dia', '2026-10-07'), reglasEntro.estadoDelTurno('5555EEE', 'dia', '2026-10-14')], ['libra', 'cubre-ct']);
  // Lo de antes de db/236: el CT por coche y su bloque siguen valiendo para los
  // días de antes (el reporte de un día viejo tiene que seguir cuadrando).
  const viejo = P.crear({
    asignaciones: [
      { id: 'f', matricula: '2222BBB', turno: 'dia', uuid: 'u-caro', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: 'c', matricula: '2222BBB', turno: 'dia', uuid: 'u-eva', rol: 'ct', dias: [6, 7], desde: '2026-10-01', hasta: '2026-10-31' },
    ],
    cts: [{ matricula: '2222BBB', desde: '2026-10-01', hasta: '2026-10-31' }],
    descansos: [{ matricula: '2222BBB', turno: null, dias: [6, 7], desde: '2026-10-01', hasta: '2026-10-31' }],
  });
  igual('Antes de db/236: el bloque vale para los dos fijos, el CT por coche lo cubre y sin nadie de noche es hueco',
    [viejo.descansoDe('2222BBB', 'noche', '2026-10-10'), viejo.estadoDelTurno('2222BBB', 'dia', '2026-10-10'), (viejo.quienCubre('2222BBB', 'dia', '2026-10-10') || {}).uuid,
      viejo.estadoDelTurno('2222BBB', 'noche', '2026-10-10'), planTxt(viejo.planDelDia('2026-10-10'))],
    [[6, 7], 'cubre-ct', 'u-eva', 'hueco', ['u-eva 2222BBB dia ct']]);
  igual('…y pasado su fin, ni bloque ni CT', [viejo.descansoDe('2222BBB', 'dia', '2026-11-07'), planTxt(viejo.planDelDia('2026-11-07'))], [[], ['u-caro 2222BBB dia fijo']]);

  // Nadie lleva dos coches del mismo turno a la vez, contando las casillas.
  igual('Eva (CT de día del C1) no puede ser fija de día de otro coche: dobla los días que coge',
    P.choques(datos1, { matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', desde: '2026-10-05' }),
    [{ matricula: '1111AAA', turno: 'dia', rol: 'ct', cuadranteId: '1', jornada: 'dia', dias: [1], desde: '2026-10-05' },
      { matricula: '2222BBB', turno: 'dia', rol: 'ct', cuadranteId: '1', jornada: 'dia', dias: [2], desde: '2026-10-06' },
      { matricula: '5555EEE', turno: 'dia', rol: 'ct', cuadranteId: '1', jornada: 'dia', dias: [3], desde: '2026-10-07' }]);
  igual('De noche, sí (otro turno)', P.choques(datos1, { matricula: '4444DDD', turno: 'noche', uuid: 'u-eva', desde: '2026-10-05' }), []);
  igual('[2] Lo nuevo que acaba antes no choca los días de después', P.choques(datos1, { matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', desde: '2026-10-06', hasta: '2026-10-06' }),
    [{ matricula: '2222BBB', turno: 'dia', rol: 'ct', cuadranteId: '1', jornada: 'dia', dias: [2], desde: '2026-10-06' }]);
  igual('Lo que se va a cerrar al guardar no choca', P.choques(datos1, { matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', desde: '2026-10-05' }, x => x.id === 'k1'), []);
  igual('Ana en la casilla de día del C1: su propia libranza la puede coger; los demás días dobla con su coche',
    P.choques(datos1, { cuadranteId: '1', jornada: 'dia', uuid: 'u-ana', desde: '2026-10-05' }), [{ matricula: '1111AAA', turno: 'dia', rol: 'fijo', dias: [2, 3], desde: '2026-10-06' }]);
  igual('Ana en la de noche, no (otro turno)', P.choques(datos1, { cuadranteId: '1', jornada: 'noche', uuid: 'u-ana', desde: '2026-10-05' }), []);
  // [R2] choques mira hasta el tope, no solo la semana: Gil tiene escrita una
  // plaza fija de día en el 4444DDD desde el viernes 23/10; ponerla hoy (lunes
  // 05/10) en la casilla de día del C1 la haría doblar el martes 27 (libra Caro).
  // Antes (siete días desde el 05) no se veía.
  const conFuturo = { ...datos1, asignaciones: [...datos1.asignaciones,
    { id: 9, matricula: '4444DDD', turno: 'dia', uuid: 'u-gil', rol: 'fijo', desde: '2026-10-23', hasta: null }] };
  const casillaGil = { cuadranteId: '1', jornada: 'dia', uuid: 'u-gil', desde: '2026-10-05' };
  igual('[R2] Sin tope (la semana) no se ve el choque de dentro de tres semanas', P.choques(conFuturo, casillaGil), []);
  igual('[R2] Con el tope, sí: con qué, qué días y desde cuándo',
    P.choques(conFuturo, casillaGil, () => false, '2026-11-30'),
    [{ matricula: '4444DDD', turno: 'dia', rol: 'fijo', dias: [2, 3, 4], desde: '2026-10-27' }]);
  igual('[R2] …y nunca más allá de donde acaba lo nuevo', P.choques(conFuturo, { ...casillaGil, hasta: '2026-10-22' }, () => false, '2026-11-30'), []);

  // [R1] LA PERTENENCIA CON HISTORIAL (db/237). El 5555EEE estuvo en el C1
  // hasta el domingo 11/10 y desde el lunes 12 está en el C2 (todoturno de
  // Fran). Sus días de antes siguen siendo de la casilla de día del C1 (Eva).
  const movido = P.crear({ ...datos1, cochesCuadrante: [...CC.filter(x => x.matricula !== '5555EEE'),
    { matricula: '5555EEE', cuadranteId: '1', desde: '2026-10-01', hasta: '2026-10-11' },
    { matricula: '5555EEE', cuadranteId: '2', desde: '2026-10-12', hasta: null }] });
  igual('[R1] En qué cuadrante estaba cada día', [movido.cuadranteDe('5555EEE', '2026-09-30'), movido.cuadranteDe('5555EEE', '2026-10-07'),
    movido.cuadranteDe('5555EEE', '2026-10-14'), movido.cuadranteDe('4444DDD', '2026-10-14')], [null, '1', '2', null]);
  igual('[R1] El miércoles 07 (ya cerrado) su libranza la sigue cogiendo Eva, la del C1: no se reescribe el pasado',
    [movido.estadoDelTurno('5555EEE', 'dia', '2026-10-07'), (movido.quienCubre('5555EEE', 'dia', '2026-10-07') || {}).uuid,
      planTxt(movido.planDelDia('2026-10-07')).includes('u-eva 5555EEE dia ct')], ['cubre-ct', 'u-eva', true]);
  igual('[R1] El miércoles 14 la coge Fran (la todoturno del C2) y Eva ya no',
    [(movido.quienCubre('5555EEE', 'dia', '2026-10-14') || {}).uuid, movido.cubreSemana(k('k1'), '2026-10-14').map(plazaTxt),
      movido.cubreSemana(k('k3'), '2026-10-14').map(plazaTxt)],
    ['u-fran', ['1 1111AAA dia', '2 2222BBB dia'], ['1 6666FFF dia', '1 6666FFF noche', '3 5555EEE dia', '5 5555EEE noche']]);
  const sacado = P.crear({ ...datos1, cochesCuadrante: [...CC.filter(x => x.matricula !== '5555EEE'),
    { matricula: '5555EEE', cuadranteId: '1', desde: '2026-10-01', hasta: '2026-10-11' }] });
  igual('[R1] Sacado del cuadrante el 12: el 07 sigue «cubre-ct» (no «Libra» ni «Sin plaza»); el 14 ya no sale',
    [sacado.estadoDelTurno('5555EEE', 'dia', '2026-10-07'), sacado.estadoDelTurno('5555EEE', 'dia', '2026-10-14')], ['cubre-ct', 'libra']);

  // [R4] LA PERSONA DE UNA CASILLA QUE DOBLA CON UNA FIJA SUYA (lo puede dejar
  // la conversión de db/236): doblesSemana lo dice, por día de la semana.
  const conDoble = P.crear({ ...datos1, asignaciones: [...datos1.asignaciones,
    { id: 10, matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', rol: 'fijo', desde: '2026-10-01', hasta: null }] });
  igual('[R4] Eva, CT de día del C1 y fija de día del 4444DDD (que libra el S): dobla los días que coge',
    conDoble.doblesSemana(k('k1'), '2026-10-05'), [{ matricula: '4444DDD', turno: 'dia', dias: [1, 2, 3] }]);
  const anaEnK1 = P.crear({ ...datos1, casillas: datos1.casillas.map(x => (x.id === 'k1' ? { ...x, uuid: 'u-ana' } : x)) });
  igual('[R4] Ana en la casilla de día: coger su propia libranza (L) no es doblar; el M y el X, sí',
    anaEnK1.doblesSemana(anaEnK1.casillas.find(x => x.id === 'k1'), '2026-10-05'), [{ matricula: '1111AAA', turno: 'dia', dias: [2, 3] }]);
  igual('[R4] Sin fija suya, o de otro turno, nada', [reglas.doblesSemana(k('k1'), '2026-10-05'), reglas.doblesSemana(k('k3'), '2026-10-05')], [[], []]);
  igual('Las letras de la casa', P.letras([3, 1, 7]), 'L X D');

  // ══ 2 · EL TABLERO ════════════════════════════════════════════════════════
  // Fechas de esta semana: el servicio solo deja escribir de un mes atrás a dos
  // meses adelante, así que los datos van alrededor de hoy.
  const hoy = S.hoyMadrid();
  const LUN = H.lunesDe(hoy);
  const MIE = R.sumarDias(LUN, 2);
  const SAB = R.sumarDias(LUN, 5);
  const INI = R.sumarDias(LUN, -14);
  const CT2 = R.sumarDias(LUN, -7);
  const MAN = R.sumarDias(hoy, 1);
  const MAS2 = R.sumarDias(hoy, 14);
  const dmy = iso => iso.split('-').reverse().join('/');
  /** El primer día desde `f` que cae en ese día de la semana (1 = lunes): donde empieza un choque escrito para más adelante. */
  const primero = (f, dow) => { let x = f; while (P.isodow(x) !== dow) x = R.sumarDias(x, 1); return x; };
  // El C1 (1111AAA, 2222BBB, 5555EEE) con su casilla de día (Eva): Ana libra L M,
  // Caro S D y el 5555EEE (sin fijos) el V: Eva coge L M V S D y libra X J. De
  // noche, Beto libra X J y el C1 no tiene casilla de noche: esos días el coche
  // no sale. 4444DDD y 6666FFF, sin cuadrante.
  const basePlan = () => ({
    asignaciones: [
      { id: '1', matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '2', matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '3', matricula: '2222BBB', turno: 'dia', uuid: 'u-caro', rol: 'fijo', dias: null, desde: INI, hasta: null },
      { id: '5', matricula: '3333CCC', turno: 'noche', uuid: 'u-dani', rol: 'fijo', dias: null, desde: INI, hasta: null },
    ],
    casillas: [{ id: '10', cuadranteId: '1', jornada: 'dia', uuid: 'u-eva', desde: CT2, hasta: null }],
    descansos: [
      { matricula: '1111AAA', turno: 'dia', dias: [1, 2], desde: INI, hasta: null },
      { matricula: '1111AAA', turno: 'noche', dias: [3, 4], desde: INI, hasta: null },
      { matricula: '2222BBB', turno: 'dia', dias: [6, 7], desde: INI, hasta: null },
      { matricula: '5555EEE', turno: 'dia', dias: [5], desde: INI, hasta: null },
    ],
    cts: [],
  });
  const baseEst = () => ({
    zonas: [{ id: '1', nombre: 'Eixample', activa: true }, { id: '2', nombre: 'Vieja', activa: false }],
    cuadrantes: [{ id: '1', numero: 1, nombre: null, zonaId: '1' }, { id: '2', numero: 2, nombre: 'Sants', zonaId: null }],
    cochesCuadrante: [{ matricula: '1111AAA', cuadranteId: '1' }, { matricula: '2222BBB', cuadranteId: '1' }, { matricula: '5555EEE', cuadranteId: '1' }],
  });
  PLAN = basePlan();
  EST = baseEst();
  const t = await S.tablero({ fecha: SAB });
  const coche = (tt, m) => tt.coches.find(c => c.matricula === m) || {};
  const c1De = tt => tt.cuadrantes.find(q => q.id === '1') || {};
  igual('Coches: los activos (también el que no está en BOLT) y el desactivado que alguien lleva',
    t.coches.map(c => c.matricula), ['1111AAA', '2222BBB', '4444DDD', '5555EEE', '6666FFF', '3333CCC']);
  igual('El de Vehículos que no está en BOLT se puede planificar, y se avisa', [coche(t, '4444DDD').activo, coche(t, '4444DDD').enBolt], [true, false]);
  igual('Las claves de un coche son las del contrato (sin CT por coche)', Object.keys(coche(t, '1111AAA')),
    ['matricula', 'modelo', 'enBolt', 'enErp', 'activo', 'estadoBolt', 'cuadranteId', 'descansoTurno', 'plazas', 'turnos']);
  igual('Las plazas de un coche son sus dos fijos', Object.keys(coche(t, '1111AAA').plazas), ['fijoDia', 'fijoNoche']);
  igual('Siempre la libranza de cada fijo; el sábado salen los dos',
    [coche(t, '1111AAA').descansoTurno, coche(t, '1111AAA').turnos], [{ dia: [1, 2], noche: [3, 4] }, { dia: 'trabaja', noche: 'trabaja' }]);
  const b = coche(t, '2222BBB');
  igual('El sábado libra Caro y lo coge la casilla de día: «cubre-ct»; su noche, sin nadie, hueco',
    [b.plazas.fijoDia.nombre, b.plazas.fijoDia.libraHoy, b.turnos], ['Caro', true, { dia: 'cubre-ct', noche: 'hueco' }]);
  igual('Las claves de una persona son las del contrato', Object.keys(b.plazas.fijoDia),
    ['uuid', 'nombre', 'telefono', 'activa', 'desde', 'hasta', 'rol', 'dias', 'libraHoy', 'trabajaHoy', 'promedio']);
  igual('El promedio de cada persona, con su forma', Object.keys(b.plazas.fijoDia.promedio).filter(x => x !== 'etiqueta' && x !== 'total'),
    ['horas', 'salio', 'ausencias', 'media', 'periodo', 'mesAnterior', 'ne']);
  igual('Sin horas, N/E con el motivo', [b.plazas.fijoDia.promedio.horas, /menos de 5 días/.test(b.plazas.fijoDia.promedio.ne)], [null, true]);
  igual('Dani ya no está activo en BOLT y se marca', coche(t, '3333CCC').plazas.fijoNoche.activa, false);
  const c1 = c1De(t);
  igual('Las claves de un cuadrante son las del contrato', Object.keys(c1), ['id', 'numero', 'nombre', 'zonaId', 'zona', 'coches', 'casillas', 'puedeAgregar']);
  igual('El cuadrante: su zona y sus coches', [c1.zona, c1.coches], ['Eixample', ['1111AAA', '2222BBB', '5555EEE']]);
  const cas = c1.casillas[0] || {};
  igual('La casilla de día: su forma', Object.keys(cas), ['jornada', 'desde', 'hasta', 'persona', 'cubre', 'libra', 'hoy', 'repetidas', 'dobles']);
  igual('La casilla de día: Eva, lo que coge cada día, su libranza y a quién coge hoy',
    [cas.jornada, cas.desde, cas.persona && cas.persona.nombre, cas.persona && cas.persona.rol, cas.persona && cas.persona.dias, cas.cubre.map(plazaTxt), cas.libra, cas.hoy, cas.repetidas],
    ['dia', CT2, 'Eva', 'ct', [1, 2, 5, 6, 7], ['1 1111AAA dia', '2 1111AAA dia', '5 5555EEE dia', '6 2222BBB dia', '7 2222BBB dia'], [3, 4], { matricula: '2222BBB', turno: 'dia' }, []]);
  igual('La persona de la casilla, con su promedio y si trabaja hoy', [Object.keys(cas.persona), cas.persona.trabajaHoy, cas.persona.libraHoy],
    [['uuid', 'nombre', 'telefono', 'activa', 'desde', 'hasta', 'rol', 'dias', 'libraHoy', 'trabajaHoy', 'promedio'], true, false]);
  igual('«Agregar CT»: con la de día puesta, solo la de noche', c1.puedeAgregar, { dia: false, noche: true, todoturno: false });
  igual('Un cuadrante sin casillas lo admite todo', (t.cuadrantes.find(q => q.id === '2') || {}).puedeAgregar, { dia: true, noche: true, todoturno: true });
  igual('Las zonas: solo las vivas, con lo que tienen', t.zonas, [{ id: '1', nombre: 'Eixample', cuadrantes: 1, coches: 3 }]);
  igual('Sin plaza: Fran (Eva tiene casilla; Dani no cuenta: no está activo)', t.sinPlaza.map(c => c.nombre), ['Fran']);
  igual('Los conductores llevan sus plazas de ese día', t.conductores.find(c => c.nombre === 'Caro').plazas.map(p => `${p.matricula} ${p.turno} ${p.rol} ${p.libraHoy}`), ['2222BBB dia fijo true']);
  const evaPl = (t.conductores.find(c => c.nombre === 'Eva').plazas || [])[0] || {};
  igual('…y la casilla, con la plaza que coge ese día', [evaPl.rol, evaPl.cuadrante, evaPl.jornada, evaPl.matricula, evaPl.turno, evaPl.trabajaHoy], ['ct', 1, 'dia', '2222BBB', 'dia', true]);
  // Sábado: 4444DDD, 5555EEE y 6666FFF sin nadie; la noche del 2222BBB, también.
  igual('Resumen del sábado (lo que coge el CT cuenta como cubierto)', t.resumen, { coches: 5, turnos: 10, cubiertos: 3, huecos: 7, libran: 0, sinPlaza: 1, casillas: 1 });
  const tl = await S.tablero({ fecha: LUN });
  igual('El lunes libra Ana y la coge Eva', [coche(tl, '1111AAA').turnos.dia, (c1De(tl).casillas[0] || {}).hoy], ['cubre-ct', { matricula: '1111AAA', turno: 'dia' }]);
  const tm = await S.tablero({ fecha: MIE });
  igual('El miércoles libra Beto y el C1 no tiene CT de noche: el coche no sale (cuenta en «libran», no en huecos)',
    [coche(tm, '1111AAA').turnos, tm.resumen.libran, tm.resumen.turnos, tm.resumen.cubiertos], [{ dia: 'trabaja', noche: 'libra' }, 1, 9, 2]);
  igual('El miércoles Eva no coge nada: libra', [(c1De(tm).casillas[0] || {}).hoy, ((c1De(tm).casillas[0] || {}).persona || {}).libraHoy], [null, true]);
  // Con la casilla de noche (vacía): la noche del miércoles pasa a ser hueco.
  PLAN.casillas.push({ id: '11', cuadranteId: '1', jornada: 'noche', uuid: null, desde: CT2, hasta: null });
  const tmn = await S.tablero({ fecha: MIE });
  const noche = c1De(tmn).casillas[1] || {};
  igual('Con la casilla de noche vacía: el miércoles la noche del 1111AAA es hueco, y la casilla dice cuál cogería',
    [coche(tmn, '1111AAA').turnos.noche, noche.jornada, noche.persona, noche.hoy, c1De(tmn).puedeAgregar],
    ['hueco', 'noche', null, { matricula: '1111AAA', turno: 'noche' }, { dia: false, noche: false, todoturno: false }]);
  PLAN = basePlan();

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
  igual('La matrícula se normaliza y el selector puede mandar { valor }', sinQue(ultimo('asignar')),
    { sede: 'barcelona', matricula: '6666FFF', turno: 'noche', driverUuid: 'u-fran', desde: hoy, usuarioId: 7 });
  const r0 = await S.asignar({ matricula: '6666FFF', turno: 'noche', uuid: null }, 7);
  igual('Sin persona deja la plaza libre (desde hoy) y devuelve el tablero de ese día', [ultimo('asignar').driverUuid, ultimo('asignar').desde, r0.tablero.fecha], [null, hoy, hoy]);
  await S.asignar({ matricula: '9999ZZZ', turno: 'noche', uuid: null }, 7);
  igual('Dejar libre una plaza vale también en una matrícula que ya no es de la sede', ultimo('asignar').matricula, '9999ZZZ');
  // Lo que ya no existe: el CT por coche.
  let e400 = null;
  try { await S.asignar({ matricula: '2222BBB', turno: 'dia', rol: 'ct', uuid: 'u-fran', desde: hoy }); } catch (e) { e400 = e; }
  igual('Asignar de CT en una matrícula es un 400 que dice dónde está ahora', [e400 && e400.estado, e400 && /ya no van por coche/.test(e400.message), e400 && /«\+ CT»/.test(e400.message)], [400, true, true]);
  e400 = null;
  try { S.ctPorCoche(); } catch (e) { e400 = e; }
  igual('/api/ct y el CT del cuadrante coche a coche, igual (ctPorCoche)', [e400 && e400.estado, e400 && /casillas del cuadrante/.test(e400.message)], [400, true]);
  await lanza('Un rol que no existe', () => S.asignar({ matricula: '2222BBB', turno: 'dia', rol: 'jefe', uuid: 'u-fran', desde: hoy }), 'solo se pone a alguien de fijo');
  // Nadie dobla, contando lo que coge su casilla.
  await lanza('Eva (CT de día del C1) de fija de día en otro coche: dobla, y se dice con qué',
    () => S.asignar({ matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', desde: hoy }), 'no puede llevar también el 4444DDD esos días');
  await lanza('…con las plazas que coge su casilla', () => S.asignar({ matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', desde: hoy }), '(de CT) los');
  await S.asignar({ matricula: '4444DDD', turno: 'noche', uuid: 'u-eva', desde: hoy }, 7);
  igual('De noche sí (otro turno, como siempre)', [ultimo('asignar').matricula, ultimo('asignar').turno], ['4444DDD', 'noche']);
  await S.asignar({ matricula: '5555EEE', turno: 'dia', uuid: 'u-ana', desde: hoy }, 7);
  igual('Un fijo que ya era fijo de otro coche en ese turno se mueve: no choca con su plaza de antes', ultimo('asignar').matricula, '5555EEE');
  await S.asignar({ matricula: '6666FFF', turno: 'dia', uuid: 'u-beto', desde: hoy }, 7);
  igual('El fijo de noche de un coche puede ser fijo de día de otro (como hasta ahora)', ultimo('asignar').driverUuid, 'u-beto');
  // [2] Lo escrito para más adelante en la plaza se respeta (repo.asignarEn): lo
  // nuevo dura hasta su víspera, y «no doblar» no le cuenta los días de después.
  // La casilla de Eva solo coge el día de mañana (libra el 1111AAA ese día);
  // Fran tiene escrita la plaza del 6666FFF desde mañana: Eva allí desde hoy
  // estaría solo hoy, y no dobla.
  PLAN.descansos = [{ matricula: '1111AAA', turno: 'dia', dias: [P.isodow(MAN)], desde: INI, hasta: null }];
  PLAN.asignaciones.push({ id: '41', matricula: '6666FFF', turno: 'dia', uuid: 'u-fran', rol: 'fijo', dias: null, desde: MAN, hasta: null });
  escrito = [];
  let dobla = null;
  try { await S.asignar({ matricula: '6666FFF', turno: 'dia', uuid: 'u-eva', desde: hoy }, 7); } catch (e) { dobla = e.message; }
  igual('[2] No dobla con un día que ya no va a ser suyo (la plaza la tiene escrita otro desde mañana)', [dobla, ultimo('asignar').matricula], [null, '6666FFF']);
  PLAN.asignaciones = PLAN.asignaciones.filter(x => x.id !== '41');
  await lanza('[2] …y sin eso escrito, sí dobla', () => S.asignar({ matricula: '6666FFF', turno: 'dia', uuid: 'u-eva', desde: hoy }), 'Eva ya lleva el 1111AAA (de CT)');
  PLAN = basePlan();

  // La libranza de cada fijo.
  await lanza('El descanso común del coche ya no existe', () => S.fijarDescanso({ matricula: '1111AAA', turno: null, dias: [1], desde: hoy }), 'El descanso común del coche ya no existe');
  await lanza('Un turno que no es día ni noche', () => S.fijarDescanso({ matricula: '1111AAA', turno: 'tarde', dias: [1], desde: hoy }), 'de día o de noche');
  // En la primera semana cada día sale una vez: «el V» ya es el próximo viernes,
  // sin «desde el …» (eso queda para lo que viene de algo escrito más adelante).
  await lanza('Ninguna plaza se repite: el V ya lo libra el 5555EEE de día y el CT de día lo coge',
    () => S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: [5, 6], desde: hoy }), 'El V librarían el 2222BBB (de día) y el 5555EEE (de día) en el C1, y el CT de día no puede coger dos plazas a la vez');
  await S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: 'X S', desde: hoy }, 7);
  igual('La libranza se guarda (la suya no choca consigo misma)', [ultimo('descanso').turno, ultimo('descanso').dias], ['dia', [3, 6]]);
  await S.fijarDescanso({ matricula: '2222BBB', turno: 'noche', dias: [3], desde: hoy }, 7);
  igual('Sin casilla de noche, dos fijos de noche pueden librar el mismo día (Beto también libra el X)', [ultimo('descanso').turno, ultimo('descanso').dias], ['noche', [3]]);
  await S.fijarDescanso({ matricula: '4444DDD', turno: 'dia', dias: [1], desde: hoy }, 7);
  igual('Un coche sin cuadrante libra lo que se quiera', ultimo('descanso').dias, [1]);
  await S.fijarDescanso({ matricula: '1111AAA', turno: 'noche', dias: [], desde: hoy }, 7);
  igual('Sin días, deja de librar', ultimo('descanso').dias, []);
  // [1] Lo que otro coche del cuadrante tiene escrito para más adelante también
  // cuenta: el 5555EEE pasa a librar el X dentro de dos semanas.
  const futuro5555 = () => {
    PLAN = basePlan();
    PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '5555EEE' ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
    PLAN.descansos.push({ matricula: '5555EEE', turno: 'dia', dias: [3], desde: MAS2, hasta: null });
  };
  futuro5555();
  await lanza('[1] Una libranza que se repetirá con la que otro coche del cuadrante tiene escrita para más adelante',
    () => S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: [3, 6], desde: hoy }), `El X librarían el 2222BBB (de día) y el 5555EEE (de día) en el C1 desde el ${dmy(primero(MAS2, 3))}`);
  // Lo que la propia plaza ya tiene escrito para después se respeta: lo nuevo
  // dura hasta su víspera, así que no choca con lo que viene detrás.
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '2222BBB' ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
  PLAN.descansos.push({ matricula: '2222BBB', turno: 'dia', dias: [6, 7], desde: MAS2, hasta: null });
  escrito = [];
  await S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: [3, 6], desde: hoy }, 7);
  igual('[1] …pero no se para si la plaza ya tiene otra escrita para ese día', ultimo('descanso').dias, [3, 6]);
  // Una plaza repetida que ya hubiera entre otros coches no para escribir en otra.
  PLAN = basePlan();
  PLAN.descansos.push({ matricula: '5555EEE', turno: 'dia', dias: [1], desde: R.sumarDias(MAS2, 1), hasta: null });
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '5555EEE' && x.dias[0] === 5 ? { ...x, hasta: MAS2 } : x));
  escrito = [];
  await S.fijarDescanso({ matricula: '2222BBB', turno: 'dia', dias: [3], desde: hoy }, 7);
  igual('Un choque que ya hay entre otras plazas (1111AAA y 5555EEE) no para la libranza de una tercera', ultimo('descanso').dias, [3]);
  // Cambiar una libranza cambia los días que trabaja el CT: no puede acabar doblando.
  PLAN = basePlan();
  PLAN.casillas = [{ id: '10', cuadranteId: '1', jornada: 'dia', uuid: 'u-fran', desde: CT2, hasta: null }];
  PLAN.asignaciones.push({ id: '42', matricula: '6666FFF', turno: 'dia', uuid: 'u-fran', rol: 'fijo', dias: null, desde: INI, hasta: null });
  PLAN.descansos.push({ matricula: '6666FFF', turno: 'dia', dias: [1, 2, 5, 6, 7], desde: INI, hasta: null });
  await lanza('Una libranza con la que el CT de la casilla tendría que doblar',
    () => S.fijarDescanso({ matricula: '5555EEE', turno: 'dia', dias: [4], desde: hoy }), 'Con esa libranza, Fran (CT de día del C1) tendría que coger un coche los días que ya lleva el 6666FFF los J de día');
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
  PLAN.casillas.push({ id: '20', cuadranteId: '2', jornada: 'noche', uuid: 'u-fran', desde: CT2, hasta: null });
  await lanza('Ni uno con casillas de CT (su persona seguiría «en una casilla»)', () => S.borrarCuadrante('2'), 'El C2 tiene CT de noche: quita antes la casilla');
  PLAN = basePlan();
  await S.borrarCuadrante('2');
  igual('Sin coches ni casillas, se borra', ultimo('bajaCuadrante').id, '2');
  // El 4444DDD libra de día el S, como el 2222BBB, que ya está en el C1.
  PLAN.descansos.push({ matricula: '4444DDD', turno: 'dia', dias: [6], desde: INI, hasta: null });
  await lanza('Meter en el cuadrante un coche que libraría el mismo día que otro que coge la misma casilla',
    () => S.cocheEnCuadrante('1', { matricula: '4444DDD' }), 'el CT de día no puede coger dos plazas');
  await lanza('…y dice con cuál y qué hacer', () => S.cocheEnCuadrante('1', { matricula: '4444DDD' }),
    'El S librarían el 2222BBB (de día) y el 4444DDD (de día) en el C1, y el CT de día no puede coger dos plazas a la vez: ninguna plaza se puede repetir. Cámbiale antes la libranza al 4444DDD.');
  PLAN = basePlan();
  await S.cocheEnCuadrante('1', { matricula: '6666FFF' }, 7);
  igual('Un coche cuya libranza no se repite entra', [ultimo('cocheEnCuadrante').matricula, ultimo('cocheEnCuadrante').cuadranteId], ['6666FFF', '1']);
  await S.cocheEnCuadrante('1', { matricula: '1111AAA', quitar: true }, 7);
  igual('Sacar un coche del cuadrante', ultimo('cocheEnCuadrante').cuadranteId, null);
  await lanza('Sacar un coche que no está en ese cuadrante', () => S.cocheEnCuadrante('1', { matricula: '6666FFF', quitar: true }), 'no está en el C1');
  // [1] Lo escrito para más adelante también cuenta al meter un coche.
  PLAN.descansos.push({ matricula: '4444DDD', turno: 'dia', dias: [6], desde: MAS2, hasta: null });
  await lanza('[1] Meter un coche cuya libranza escrita para más adelante se repetirá', () => S.cocheEnCuadrante('1', { matricula: '4444DDD' }),
    `El S librarían el 2222BBB (de día) y el 4444DDD (de día) en el C1 desde el ${dmy(primero(MAS2, 6))}`);
  PLAN = basePlan();

  // ══ 3b · LAS CASILLAS DE CT ══════════════════════════════════════════════
  escrito = [];
  await lanza('Una jornada que no existe', () => S.agregarCasilla('1', { jornada: 'tarde', desde: hoy }), 'de día, de noche o todoturno');
  await lanza('Otra de día en el C1, que ya la tiene', () => S.agregarCasilla('1', { jornada: 'dia', desde: hoy }), 'El C1 ya tiene CT de día.');
  await lanza('Un todoturno en el C1, que tiene la de día (Camilo: «si se escoge día o noche no se puede elegir luego el todoturno»)',
    () => S.agregarCasilla('1', { jornada: 'todoturno', desde: hoy }), 'El C1 tiene CT de día: no puede tener también CT todoturno');
  const ra = await S.agregarCasilla('1', { jornada: 'noche', desde: '2020-01-01' }, 7);
  igual('La de noche junto a la de día, vacía y nunca antes de hoy', [sinQue(ultimo('agregarCasilla')), ra.tablero.fecha],
    [{ sede: 'barcelona', cuadranteId: '1', jornada: 'noche', desde: hoy, hasta: null, usuarioId: 7 }, hoy]);
  // Ninguna plaza se repite en lo que cogería la nueva.
  PLAN.descansos.push({ matricula: '2222BBB', turno: 'noche', dias: [3], desde: INI, hasta: null });
  await lanza('Una casilla de noche que cogería dos plazas el mismo día',
    () => S.agregarCasilla('1', { jornada: 'noche', desde: hoy }), 'El X librarían el 1111AAA (de noche) y el 2222BBB (de noche) en el C1');
  // Solo cuenta lo que cogería la nueva: una plaza repetida en la de día (lo
  // que pudo dejar db/236) no impide agregar la de noche.
  PLAN = basePlan();
  PLAN.descansos.push({ matricula: '5555EEE', turno: 'dia', dias: [1], desde: R.sumarDias(INI, 1), hasta: null });
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '5555EEE' && x.desde === INI ? { ...x, hasta: INI } : x));
  escrito = [];
  await S.agregarCasilla('1', { jornada: 'noche', desde: hoy }, 7);
  igual('Una plaza repetida en la otra casilla no impide agregar esta', ultimo('agregarCasilla').jornada, 'noche');
  PLAN = basePlan();
  // El todoturno, en un cuadrante sin casillas: día y noche juntos no repiten.
  EST.cochesCuadrante.push({ matricula: '6666FFF', cuadranteId: '2' });
  PLAN.descansos.push({ matricula: '6666FFF', turno: 'dia', dias: [1], desde: INI, hasta: null }, { matricula: '6666FFF', turno: 'noche', dias: [2], desde: INI, hasta: null });
  await S.agregarCasilla('2', { jornada: 'todoturno', desde: hoy }, 7);
  igual('Un todoturno en un cuadrante sin casillas (coge el L de día y el M de noche)', [ultimo('agregarCasilla').cuadranteId, ultimo('agregarCasilla').jornada], ['2', 'todoturno']);
  PLAN.descansos.push({ matricula: '6666FFF', turno: 'noche', dias: [1], desde: MAS2, hasta: null });
  PLAN.descansos = PLAN.descansos.map(x => (x.matricula === '6666FFF' && x.turno === 'noche' && x.desde === INI ? { ...x, hasta: R.sumarDias(MAS2, -1) } : x));
  await lanza('…pero no si el día y la noche libran el mismo día (aquí, desde más adelante)',
    () => S.agregarCasilla('2', { jornada: 'todoturno', desde: hoy }), `El L librarían el 6666FFF (de día) y el 6666FFF (de noche) en el C2 desde el ${dmy(primero(MAS2, 1))}`);
  // Lo escrito para más adelante se respeta: la nueva acaba la víspera.
  PLAN = basePlan();
  PLAN.casillas.push({ id: '21', cuadranteId: '2', jornada: 'noche', uuid: null, desde: MAS2, hasta: null });
  await S.agregarCasilla('2', { jornada: 'todoturno', desde: hoy }, 7);
  igual('Con una de noche escrita para más adelante, el todoturno acaba la víspera', ultimo('agregarCasilla').hasta, R.sumarDias(MAS2, -1));
  EST = baseEst();
  PLAN = basePlan();
  // La persona de la casilla.
  await lanza('Poner a alguien en una casilla que no hay', () => S.personaCasilla('1', 'noche', { uuid: 'u-fran', desde: hoy }), `El C1 no tiene CT de noche el ${dmy(hoy)}: agrégalo antes`);
  await lanza('Una cuenta desactivada', () => S.personaCasilla('1', 'dia', { uuid: 'u-dani', desde: hoy }), 'no está activa');
  await lanza('Una persona en dos casillas', () => {
    PLAN.casillas.push({ id: '22', cuadranteId: '2', jornada: 'dia', uuid: 'u-fran', desde: MAS2, hasta: null });
    return S.personaCasilla('1', 'dia', { uuid: 'u-fran', desde: hoy });
  }, `Fran ya es CT de día del C2 desde el ${dmy(MAS2)}: una persona está en una sola casilla`);
  PLAN = basePlan();
  await lanza('Una persona que doblaría con su plaza de fija (Ana: V S D)', () => S.personaCasilla('1', 'dia', { uuid: 'u-ana', desde: hoy }),
    'Ana ya lleva el 1111AAA los V S D de día: como CT de día del C1 tendría que coger otro coche esos días');
  escrito = [];
  const rp = await S.personaCasilla('1', 'dia', { uuid: { valor: 'u-fran' }, desde: hoy }, 7);
  igual('Poner a Fran en la casilla de día (en vez de Eva)', [sinQue(ultimo('personaCasilla')), rp.tablero.fecha],
    [{ sede: 'barcelona', cuadranteId: '1', jornada: 'dia', uuid: 'u-fran', desde: hoy, usuarioId: 7 }, hoy]);
  await S.personaCasilla('1', 'dia', { uuid: null, desde: hoy }, 7);
  igual('Vaciarla', ultimo('personaCasilla').uuid, null);
  escrito = [];
  const rmismo = await S.personaCasilla('1', 'dia', { uuid: 'u-eva', desde: hoy }, 7);
  igual('Si ya es ella, no se escribe nada', [escrito.length, rmismo.cambio], [0, false]);
  // Quitar la casilla.
  await lanza('Quitar una casilla que no hay', () => S.quitarCasilla('1', 'noche', { desde: hoy }), `El C1 no tiene CT de noche desde el ${dmy(hoy)}`);
  const rqq = await S.quitarCasilla('1', 'dia', { desde: '2020-01-01' }, 7);
  igual('Quitar la de día: nunca antes de hoy', [sinQue(ultimo('quitarCasilla')), rqq.tablero.fecha],
    [{ sede: 'barcelona', cuadranteId: '1', jornada: 'dia', desde: hoy, usuarioId: 7 }, hoy]);

  // ══ 3d · LA REVISIÓN DEL 10/11/2026 ([R1]…[R4]) ══════════════════════════
  /** El primer día desde `f` que cae en alguno de esos días de la semana. */
  const primeroEn = (f, dows) => { let x = f; while (!dows.includes(P.isodow(x))) x = R.sumarDias(x, 1); return x; };
  const MAS3 = R.sumarDias(hoy, 21);

  // [R1] Sacar un coche no reescribe el pasado. El 5555EEE estuvo en el C1
  // hasta ayer (hoy se sacó): el viernes de la semana pasada su libranza la
  // cogió Eva, y así lo siguen diciendo el tablero y el reporte de ese día.
  PLAN = basePlan();
  EST = baseEst();
  EST.cochesCuadrante = EST.cochesCuadrante.map(x => (x.matricula === '5555EEE' ? { ...x, desde: INI, hasta: R.sumarDias(hoy, -1) } : x));
  const VPAS = R.sumarDias(LUN, -3);
  const VSIG = R.sumarDias(LUN, 11);
  const tPas = await S.tablero({ fecha: VPAS });
  igual('[R1] Mirando el viernes pasado, el 5555EEE sigue en el C1 y su libranza la cogió Eva',
    [coche(tPas, '5555EEE').cuadranteId, coche(tPas, '5555EEE').turnos.dia, c1De(tPas).coches.includes('5555EEE'), (c1De(tPas).casillas[0] || {}).hoy],
    ['1', 'cubre-ct', true, { matricula: '5555EEE', turno: 'dia' }]);
  const tSig = await S.tablero({ fecha: VSIG });
  igual('[R1] …y el viernes que viene ya no está en el C1: ese día no sale (libra)',
    [coche(tSig, '5555EEE').cuadranteId, coche(tSig, '5555EEE').turnos.dia, c1De(tSig).coches.includes('5555EEE')], [null, 'libra', false]);
  const apEva = [{ uuid: 'u-eva', veh: '5555EEE', estado: 'waiting_orders', t: R.instante(VPAS, 8) },
    { uuid: 'u-eva', veh: '5555EEE', estado: 'inactive', t: R.instante(VPAS, 16) }];
  repo.apuntesEntre = async (sede, ini, fin) => apEva.filter(x => x.t >= ini && x.t < fin);
  const repPas = await S.reporte({ desde: VPAS, hasta: VPAS });
  const filaEva = repPas.filas.find(f => f.uuid === 'u-eva') || {};
  igual('[R1] El reporte de ese día: Eva salió como CT en el 5555EEE, y no está en «Sin plaza»',
    [filaEva.matricula, filaEva.rol, filaEva.estado, filaEva.horas > 0, repPas.sinPlan.some(x => x.uuid === 'u-eva')], ['5555EEE', 'ct', 'salio', true, false]);
  // Sin el historial (como antes de db/237: sacarlo borraba su pertenencia),
  // las horas de ese día se iban a «Sin plaza».
  EST.cochesCuadrante = EST.cochesCuadrante.filter(x => x.matricula !== '5555EEE');
  const repSin = await S.reporte({ desde: VPAS, hasta: VPAS });
  igual('[R1] (la prueba es la que toca) sin historial, Eva iba a «Sin plaza»', repSin.sinPlan.some(x => x.uuid === 'u-eva'), true);
  repo.apuntesEntre = async () => [];
  EST = baseEst();
  // Meter y sacar escriben desde hoy (el repositorio cierra lo de antes la víspera).
  escrito = [];
  await S.cocheEnCuadrante('1', { matricula: '5555EEE', quitar: true }, 7);
  igual('[R1] Sacar un coche se escribe desde hoy', sinQue(ultimo('cocheEnCuadrante')),
    { sede: 'barcelona', matricula: '5555EEE', cuadranteId: null, desde: hoy, usuarioId: 7 });
  await S.cocheEnCuadrante('1', { matricula: '6666FFF' }, 7);
  igual('[R1] …y meterlo, también', [ultimo('cocheEnCuadrante').cuadranteId, ultimo('cocheEnCuadrante').desde], ['1', hoy]);
  // Mover un coche que ya estaba en otro cuadrante: la comprobación mira el
  // plan como quedará (cerrado en el viejo la víspera, en el nuevo desde hoy).
  EST.cochesCuadrante.push({ matricula: '6666FFF', cuadranteId: '2', desde: INI, hasta: null });
  PLAN.descansos.push({ matricula: '6666FFF', turno: 'dia', dias: [6], desde: INI, hasta: null });
  await lanza('[R1] Mover al C1 un coche del C2 que repetiría plaza', () => S.cocheEnCuadrante('1', { matricula: '6666FFF' }),
    'El S librarían el 2222BBB (de día) y el 6666FFF (de día) en el C1');
  PLAN = basePlan();
  EST = baseEst();
  // Una libranza cambiada desde un día en que el coche estaba en otro
  // cuadrante mira también aquel: el 4444DDD estuvo en el C1 hasta hace tres días.
  EST.cochesCuadrante.push({ matricula: '4444DDD', cuadranteId: '1', desde: INI, hasta: R.sumarDias(hoy, -3) });
  const SABPAS = primeroEn(R.sumarDias(hoy, -9), [6]);
  await lanza('[R1] Una libranza desde un día pasado que repetiría plaza en el cuadrante en que estaba entonces',
    () => S.fijarDescanso({ matricula: '4444DDD', turno: 'dia', dias: [6], desde: R.sumarDias(hoy, -9) }),
    `El S librarían el 2222BBB (de día) y el 4444DDD (de día) en el C1`);
  igual('[R1] (la prueba es la que toca) ese sábado cae cuando aún estaba en el C1', SABPAS <= R.sumarDias(hoy, -3), true);
  EST = baseEst();

  // [R2] «No doblar» mira hasta lo último escrito, no solo la semana.
  PLAN = basePlan();
  PLAN.casillas = [{ id: '10', cuadranteId: '1', jornada: 'dia', uuid: 'u-eva', desde: CT2, hasta: R.sumarDias(MAS3, -1) },
    { id: '12', cuadranteId: '1', jornada: 'dia', uuid: 'u-fran', desde: MAS3, hasta: null }];
  await lanza('[R2] Fija de día desde hoy a quien es CT de día escrita desde dentro de tres semanas',
    () => S.asignar({ matricula: '4444DDD', turno: 'dia', uuid: 'u-fran', desde: hoy }),
    `Fran ya lleva el 1111AAA (de CT) los L M de día desde el ${dmy(primeroEn(MAS3, [1, 2]))}`);
  PLAN = basePlan();
  PLAN.asignaciones.push({ id: '43', matricula: '6666FFF', turno: 'dia', uuid: 'u-fran', rol: 'fijo', dias: null, desde: MAS3, hasta: null });
  await lanza('[R2] En la casilla desde hoy a quien es fija de día escrita desde dentro de tres semanas (el ejemplo de la revisión)',
    () => S.personaCasilla('1', 'dia', { uuid: 'u-fran', desde: hoy }),
    `Fran ya lleva el 6666FFF los L M V S D de día desde el ${dmy(primeroEn(MAS3, [1, 2, 5, 6, 7]))}: como CT de día del C1`);
  // Cambiar una libranza que haría doblar a la persona de la casilla dentro de
  // tres semanas (Fran es fija del 6666FFF desde entonces, que libra el J):
  PLAN.casillas = [{ id: '10', cuadranteId: '1', jornada: 'dia', uuid: 'u-fran', desde: CT2, hasta: null }];
  PLAN.descansos.push({ matricula: '6666FFF', turno: 'dia', dias: [1, 2, 3, 5, 6, 7], desde: MAS3, hasta: null });
  await lanza('[R2] Una libranza con la que el CT de la casilla doblaría con lo escrito para dentro de tres semanas',
    () => S.fijarDescanso({ matricula: '5555EEE', turno: 'dia', dias: [4], desde: hoy }),
    `Con esa libranza, Fran (CT de día del C1) tendría que coger un coche los días que ya lleva el 6666FFF los J de día desde el ${dmy(primeroEn(MAS3, [4]))}`);
  PLAN = basePlan();
  // Asignar carga el plan hasta el tope de lo escrito, que llega a una semana
  // entera después de lo último que puede empezar (dentro de 60 días): antes
  // era la semana (asignar) o 62 días (tres días del último estado).
  let topeVisto = '';
  const planDeVerdad = repo.planEntre;
  repo.planEntre = async (s, a, b, o) => { if (b > topeVisto) topeVisto = b; return planDeVerdad(s, a, b, o); };
  await S.asignar({ matricula: '4444DDD', turno: 'dia', uuid: 'u-fran', desde: hoy }, 7);
  repo.planEntre = planDeVerdad;
  igual('[R2] Asignar mira hasta el tope de lo escrito (hoy + 60 + 6)', topeVisto, R.sumarDias(hoy, 66));

  // [R3] Corregir una libranza desde antes de que db/236 cerrara el descanso
  // común del coche: aviso claro, sin tocar la base.
  PLAN = basePlan();
  const VISP236 = R.sumarDias(hoy, -5);
  PLAN.descansos.push({ matricula: '4444DDD', turno: null, dias: [6, 7], desde: INI, hasta: VISP236 },
    { matricula: '4444DDD', turno: 'dia', dias: [6, 7], desde: R.sumarDias(hoy, -4), hasta: null });
  escrito = [];
  await lanza('[R3] Una libranza desde antes del descanso común cerrado por db/236',
    () => S.fijarDescanso({ matricula: '4444DDD', turno: 'dia', dias: [1], desde: R.sumarDias(hoy, -10) }),
    `Hasta el ${dmy(VISP236)} el 4444DDD tenía el descanso común del coche (S D), de cuando los correturnos iban por coche, ` +
    `y esos días no se cambian desde aquí. Pon la libranza desde el ${dmy(R.sumarDias(hoy, -4))}.`);
  igual('[R3] …y no se escribe nada', escrito.filter(x => x.que === 'descanso').length, 0);
  await S.fijarDescanso({ matricula: '4444DDD', turno: 'dia', dias: [1], desde: R.sumarDias(hoy, -4) }, 7);
  igual('[R3] Desde el día en que ya no hay común, sí', ultimo('descanso').desde, R.sumarDias(hoy, -4));
  // Si aun así la base lo para (otra pantalla, una carrera), el aviso ya no engaña.
  const ponerDeVerdad = repo.ponerDescanso;
  repo.ponerDescanso = async () => { const e = new Error('conflicting key value violates exclusion constraint'); e.code = '23P01'; e.constraint = 'ex_sede_desc_solape'; throw e; };
  await lanza('[R3] El solape de libranzas que para la base, dicho claro', () => S.fijarDescanso({ matricula: '6666FFF', turno: 'dia', dias: [1], desde: hoy }),
    'Esa libranza se pisa con otra de la misma matrícula en esas fechas (o con el descanso común del coche');
  repo.ponerDescanso = ponerDeVerdad;
  PLAN = basePlan();

  // [R4] La persona de una casilla que dobla con una plaza fija suya (lo pudo
  // dejar db/236): el tablero lo trae en `dobles`.
  PLAN.asignaciones.push({ id: '44', matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', rol: 'fijo', dias: null, desde: INI, hasta: null });
  PLAN.descansos.push({ matricula: '4444DDD', turno: 'dia', dias: [6], desde: INI, hasta: null });
  const tDob = await S.tablero({ fecha: SAB });
  igual('[R4] El tablero trae los dobles de la casilla: Eva es fija del 4444DDD, que solo libra el S',
    (c1De(tDob).casillas[0] || {}).dobles, [{ matricula: '4444DDD', turno: 'dia', dias: [1, 2, 5, 7] }]);
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
  await lanza(`[3] La libranza desde ${imposible}`, () => S.fijarDescanso({ matricula: '1111AAA', turno: 'dia', dias: [1], desde: imposible }), 'Esa fecha no existe');
  await lanza(`[3] Agregar una casilla desde ${imposible}`, () => S.agregarCasilla('1', { jornada: 'noche', desde: imposible }), 'Esa fecha no existe');
  await lanza(`[3] La persona de una casilla desde ${imposibles[0]}`, () => S.personaCasilla('1', 'dia', { uuid: 'u-fran', desde: imposibles[0] }), 'Esa fecha no existe');
  igual(`[3] El tablero del ${imposible} es el de hoy (no un 500)`, (await S.tablero({ fecha: imposible })).fecha, hoy);
  igual('[3] Sin fecha, la escritura sigue valiendo desde hoy', (await S.asignar({ matricula: '6666FFF', turno: 'noche', uuid: null, desde: '' }, 7)).tablero.fecha, hoy);

  // ══ 3c · LAS RUTAS (barcelona.controller.js) ═════════════════════════════
  // El enrutador de verdad en un Express de prueba, con el servicio de arriba
  // (y el repositorio de mentira). Sin usuario en la petición, nadie firma.
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/barcelona', require('../modules/Barcelona/barcelona.controller'));
  const servidor = await new Promise(ok => { const s = app.listen(0, () => ok(s)); });
  const URL0 = `http://127.0.0.1:${servidor.address().port}/barcelona`;
  const pedir = async (metodo, ruta, cuerpo) => {
    const r = await fetch(URL0 + ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const tipo = r.headers.get('content-type') || '';
    return { estado: r.status, tipo, disp: r.headers.get('content-disposition'), json: /json/.test(tipo) ? await r.json() : null };
  };
  try {
    const ct = await pedir('POST', '/api/ct', { matricula: '1111AAA', activar: true });
    igual('POST /api/ct: 400 con el aviso', [ct.estado, /ya no van por coche/.test(ct.json.msg)], [400, true]);
    const ctq = await pedir('POST', '/api/cuadrantes/1/ct', { turno: 'dia', uuid: 'u-fran' });
    igual('POST /api/cuadrantes/:id/ct: 400 con el aviso', [ctq.estado, /casillas del cuadrante/.test(ctq.json.msg)], [400, true]);
    const asCt = await pedir('POST', '/api/asignar', { matricula: '2222BBB', turno: 'dia', rol: 'ct', uuid: 'u-fran' });
    igual('POST /api/asignar con rol ct: 400', [asCt.estado, /ya no van por coche/.test(asCt.json.msg)], [400, true]);
    const desc = await pedir('POST', '/api/descanso', { matricula: '1111AAA', turno: null, dias: [1] });
    igual('POST /api/descanso sin turno: 400', [desc.estado, /ya no existe/.test(desc.json.msg)], [400, true]);
    escrito = [];
    const ag = await pedir('POST', '/api/cuadrantes/1/casillas', { jornada: 'noche', desde: hoy });
    igual('POST /api/cuadrantes/:id/casillas: agrega y devuelve el tablero', [ag.estado, ultimo('agregarCasilla').jornada, ag.json.tablero.fecha], [200, 'noche', hoy]);
    const pc = await pedir('POST', '/api/cuadrantes/1/casillas/dia', { uuid: 'u-fran', desde: hoy });
    igual('POST /api/cuadrantes/:id/casillas/:jornada: pone a la persona', [pc.estado, ultimo('personaCasilla').uuid, ultimo('personaCasilla').jornada], [200, 'u-fran', 'dia']);
    const qc = await pedir('DELETE', `/api/cuadrantes/1/casillas/dia?desde=${MAN}`);
    igual('DELETE /api/cuadrantes/:id/casillas/:jornada?desde=: la quita desde ese día', [qc.estado, ultimo('quitarCasilla').desde, qc.json.tablero.fecha], [200, MAN, MAN]);
    const mal = await pedir('POST', '/api/cuadrantes/1/casillas/tarde', { uuid: 'u-fran', desde: hoy });
    igual('Una jornada que no existe en la ruta: 400', [mal.estado, /de día, de noche o todoturno/.test(mal.json.msg)], [400, true]);
    // La descarga del Excel del planificador: el servicio arma el tablero del día
    // y se lo pasa al generador con la zona y el buscador. El generador de
    // verdad es de su agente (y tiene sus pruebas): aquí se sustituye.
    let generador = null;
    try { generador = require('../modules/Barcelona/barcelona.planificador.excel'); } catch (e) { generador = null; }
    if (generador) {
      const deVerdad = generador.generar;
      let pedido = null;
      generador.generar = async x => { pedido = x; return Buffer.from('PK de prueba'); };
      try {
        const xl = await pedir('GET', `/planificador/excel?fecha=${SAB}&zona=1&q=ana`);
        igual('GET /planificador/excel: un xlsx con su nombre', [xl.estado, /spreadsheetml/.test(xl.tipo), xl.disp],
          [200, true, `attachment; filename="Planificador Barcelona ${SAB.split('-').reverse().join('-')}.xlsx"`]);
        igual('…y al generador le llega el tablero del día, la zona, el buscador y la hora',
          [pedido && pedido.tablero.fecha, pedido && pedido.zona, pedido && pedido.q, pedido && pedido.ahora instanceof Date], [SAB, '1', 'ana', true]);
      } finally { generador.generar = deVerdad; }
    } else {
      console.log('AVISO barcelona.planificador.excel.js aún no se puede cargar: la descarga no se ha probado.');
    }
  } finally {
    servidor.close();
  }

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

  // El reporte. Sin descansos ni casillas, todos son fijos que no libran: lo de antes de db/234.
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

  // UTILIZACIÓN Y VIAJES SIN COGER (Camilo, 10/11/2026: «el total de utilización
  // de la jornada del conductor y el total de viajes rechazados a dedo y
  // rechazados por no contestar separados»). Cada rechazo, en la fila de su
  // turno; el del de noche por la mañana, en su fila (como sus horas de fuera);
  // quien no trabajó ni tiene plaza pero tuvo ofertas, en «Sin plaza».
  const rch = (uuid, fecha, hora, estado) => ({ uuid, ts: en(fecha, hora), estado });
  const infR = H.informe({ desde: '2026-10-06', hasta: '2026-10-06', ivs: ivsR,
    asignaciones: ASIGS, conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-08', 9),
    rechazos: [
      rch('u-ana', '2026-10-06', 10, 'driver_rejected'),
      rch('u-beto', '2026-10-06', 20, 'driver_did_not_respond'), rch('u-beto', '2026-10-06', 20.5, 'driver_did_not_respond'),
      rch('u-beto', '2026-10-06', 9, 'driver_rejected'),
      rch('u-caro', '2026-10-06', 10, 'driver_did_not_respond'),
      rch('u-eva', '2026-10-06', 15, 'driver_rejected'),
      rch('u-ana', '2026-10-05', 10, 'driver_rejected'),   // otro día: no cuenta
      rch('u-ana', '2026-10-06', 11, 'client_cancelled'),  // no es suyo: no cuenta
    ] });
  const filaR = (uuid, turno) => infR.filas.find(f => f.uuid === uuid && f.turno === turno) || {};
  igual('Utilización de la fila: viaje / (viaje + espera) de su turno', [filaR('u-ana', 'dia').utilizacion, filaR('u-beto', 'noche').utilizacion], [20, 11.1]);
  igual('Sin horas, la utilización no es 0 %: no hay nada que medir', filaR('u-dani', 'dia').utilizacion, null);
  igual('A dedo y sin contestar, separados y en la fila de su turno', [filaR('u-ana', 'dia').aDedo, filaR('u-ana', 'dia').sinContestar], [1, 0]);
  igual('El rechazo del de noche por la mañana va a su fila, y se dice',
    [filaR('u-beto', 'noche').aDedo, filaR('u-beto', 'noche').sinContestar, /1 fueron fuera de su turno/.test(filaR('u-beto', 'noche').obs)], [1, 2, true]);
  igual('Sin plaza: Caro con su oferta sin contestar, y Eva sin horas pero con un rechazo',
    infR.sinPlan.map(f => `${f.uuid} ${f.turno} ${f.horas} ${f.aDedo}/${f.sinContestar}`), ['u-caro dia 3 0/1', 'u-eva noche 0 1/0']);
  igual('Eva no cuenta como «trabajó sin plaza» (0 h)', infR.resumen.personasSinPlan, 1);
  igual('Por conductor: su utilización y sus totales', infR.porConductor.map(c => `${c.uuid} ${c.utilizacion} ${c.aDedo}/${c.sinContestar}`),
    ['u-dani null 0/0', 'u-ana 20 1/0', 'u-beto 11.1 1/2']);
  igual('Resumen: la utilización de todo y los totales cuadran con las filas',
    [infR.resumen.utilizacion, infR.resumen.aDedo, infR.resumen.sinContestar,
      [...infR.filas, ...infR.sinPlan].reduce((s, f) => s + f.aDedo, 0), [...infR.filas, ...infR.sinPlan].reduce((s, f) => s + f.sinContestar, 0)],
    [28.2, 3, 3, 3, 3]);
  igual('Sin rechazos que leer, todo a cero', [inf.resumen.aDedo, inf.resumen.sinContestar, fila('u-ana', 'dia').aDedo], [0, 0, 0]);

  // CON LIBRANZAS Y EL CT POR COCHE DE ANTES DE db/236 (lo que el reporte de un
  // día viejo tiene que seguir leyendo). El martes 06 Ana libra (su descanso de
  // día, M) y aun así trabajó; Dani es CT de 2222BBB (con CT) solo los miércoles.
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
  const casoLibra = (plan, ivs) => H.informe({ desde: MARTES, hasta: MARTES, ivs, ...plan,
    conductores: CONDUCTORES, coches: [], ahoraMs: en('2026-10-08', 13) });
  const libraCT = casoLibra({
    asignaciones: [{ id: '1', matricula: 'AAAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null }],
    casillas: [{ id: 'k', cuadranteId: '9', jornada: 'dia', uuid: 'u-ana', desde: '2026-10-01', hasta: null }],
    descansos: [{ matricula: 'AAAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null }, { matricula: 'BBBB', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null }],
    cochesCuadrante: [{ matricula: 'BBBB', cuadranteId: '9' }],
  }, [{ uuid: 'u-ana', situacion: 'viaje', ini: en(MARTES, 8), fin: en(MARTES, 14.6), veh: 'BBBB' }]);
  igual('[5] Libra de fija y ese día es CT (su casilla coge otro coche): la fila lo dice y nada va a «Sin plaza»',
    [(libraCT.filas.find(f => f.matricula === 'AAAA') || {}).obs, (libraCT.filas.find(f => f.matricula === 'BBBB') || {}).horas, libraCT.sinPlan.length],
    ['Libraba; ese día trabajó en BBBB (CT)', 6.6, 0]);
  const libraNoche = casoLibra({
    asignaciones: [{ id: '1', matricula: 'AAAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { id: '3', matricula: 'CCCC', turno: 'noche', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null }],
    descansos: [{ matricula: 'AAAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null }],
  }, [{ uuid: 'u-ana', situacion: 'viaje', ini: en(MARTES, 20), fin: en('2026-10-07', 4), veh: 'CCCC' }]);
  igual('[5] Fija de día que libra y hace su noche: no se la acusa de trabajar en su libranza',
    [(libraNoche.filas.find(f => f.matricula === 'AAAA') || {}).obs, libraNoche.sinPlan.length], ['Libraba; ese día trabajó en CCCC', 0]);
  igual('El CT por coche de antes solo sale los días que cubre: el martes no, el miércoles sí', [filaL('u-dani', '2026-10-06').estado, filaL('u-dani', '2026-10-07').estado, filaL('u-dani', '2026-10-07').rol],
    [undefined, 'no_salio', 'ct']);
  const anaL = infL.porConductor.find(c => c.nombre === 'Ana');
  igual('Por conductor: los días que le tocaba, los que no salió y los que libró', [anaL.plazas, anaL.salio, anaL.noSalio, anaL.libra], [1, 0, 1, 1]);
  igual('Resumen: las libranzas aparte', [infL.resumen.plazas, infL.resumen.libran, infL.resumen.noSalieron], [4, 1, 3]);

  // CON CASILLAS (db/236). El C1 (1111AAA) tiene la casilla de día de Eva. El
  // martes 06 libra Ana (de día) y la coge Eva, que trabajó de 07:00 a 15:00;
  // el miércoles 07 libra Beto (de noche) y el C1 no tiene casilla de noche:
  // «Libra». Beto trabajó esa noche igual (20:00 a 02:00): a «Sin plaza».
  const conCasillas = {
    asignaciones: [
      { matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', desde: '2026-10-01', hasta: null },
      { matricula: '1111AAA', turno: 'noche', uuid: 'u-beto', rol: 'fijo', desde: '2026-10-01', hasta: null },
    ],
    casillas: [{ id: 'k1', cuadranteId: '1', jornada: 'dia', uuid: 'u-eva', desde: '2026-10-01', hasta: null }],
    descansos: [{ matricula: '1111AAA', turno: 'dia', dias: [2], desde: '2026-10-01', hasta: null },
      { matricula: '1111AAA', turno: 'noche', dias: [3], desde: '2026-10-01', hasta: null }],
    cochesCuadrante: [{ matricula: '1111AAA', cuadranteId: '1' }],
  };
  const apCas = [...trabajoEn('u-eva', '2026-10-06', 7, 8), ap('u-beto', '2026-10-07', 20, 'waiting_orders'), ap('u-beto', '2026-10-08', 2, 'inactive')];
  // A mitad, un viaje: un estado de más de 6 h sin otro apunte se corta (TOPE_H).
  function trabajoEn(uuid, fecha, desde, horas) {
    return [ap(uuid, fecha, desde, 'waiting_orders'), ap(uuid, fecha, desde + horas / 2, 'has_order'), ap(uuid, fecha, desde + horas, 'inactive')];
  }
  const infC = H.informe({ desde: '2026-10-06', hasta: '2026-10-07', ivs: H.intervalos(apCas, sit, iniR, en('2026-10-08', 12)),
    ...conCasillas, conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-09', 9) });
  igual('Con casilla: la persona de la casilla sale en la plaza que coge, con sus horas; el fijo, «Libra»',
    infC.filas.map(f => `${f.fecha.slice(8)} ${f.turno} ${f.matricula} ${f.nombre} ${f.rol} ${f.estado} ${f.horas}`),
    ['06 dia 1111AAA Ana fijo libra 0', '06 dia 1111AAA Eva ct salio 8', '06 noche 1111AAA Beto fijo no_salio 0',
      '07 dia 1111AAA Ana fijo no_salio 0', '07 noche 1111AAA Beto fijo libra 0']);
  igual('Sin casilla de ese turno, «Libra» y lo que hizo va a «Sin plaza»', infC.sinPlan.map(f => `${f.fecha.slice(8)} ${f.nombre} ${f.turno} ${f.horas} ${f.libraba}`),
    ['07 Beto noche 6 1111AAA']);
  // Una todoturno: el miércoles libra Beto de noche y la casilla lo coge de
  // noche. Eva trabaja de 20:00 a 04:00: su noche (12:00 a 12:00), en esa plaza.
  const infT = H.informe({ desde: '2026-10-07', hasta: '2026-10-07',
    ivs: H.intervalos(trabajoEn('u-eva', '2026-10-07', 20, 8), sit, en('2026-10-06', 12), en('2026-10-08', 12)),
    ...conCasillas, casillas: [{ id: 'k1', cuadranteId: '1', jornada: 'todoturno', uuid: 'u-eva', desde: '2026-10-01', hasta: null }],
    conductores: CONDUCTORES, coches: COCHES, ahoraMs: en('2026-10-09', 9) });
  igual('Una todoturno que va de noche ese día: sus horas, en la noche de la plaza que coge',
    infT.filas.filter(f => f.nombre === 'Eva').map(f => `${f.turno} ${f.matricula} ${f.rol} ${f.horas} ${f.estado}`), ['noche 1111AAA ct 8 salio']);
  const xlsL = await require('../modules/Barcelona/barcelona.excel').generar(infL);
  const ExcelJS = require('exceljs');
  const libroL = new ExcelJS.Workbook();
  await libroL.xlsx.load(xlsL);
  const hojaDia = libroL.getWorksheet('Por día');
  const filasDia = [...Array(hojaDia.rowCount).keys()].map(i => hojaDia.getRow(i + 1));
  // Columnas desde el 10/11: … Espera (8), Utilización (9), A dedo (10), Sin contestar (11), Estado (12).
  const libraEnExcel = filasDia.find(r => r.getCell(4).value === 'Ana' && r.getCell(12).value === 'Libra');
  igual('Excel: el estado «Libra», sin horas', [!!libraEnExcel, libraEnExcel && libraEnExcel.getCell(6).value], [true, null]);
  igual('Excel: el CT lleva su turno con «CT»', filasDia.some(r => r.getCell(4).value === 'Dani' && r.getCell(2).value === 'Día · CT'), true);
  igual('Excel: la leyenda ya no dice que Barcelona no tiene libranzas', /no tiene libranzas/.test(String(hojaDia.getCell(3, 1).value)), false);
  igual('[5] Excel: la leyenda dice que, si libraba y trabajó en otra plaza suya, sus horas van allí',
    /la otra plaza que trabajara ese día/.test(String(hojaDia.getCell(3, 1).value)), true);
  const sinPlazaXls = libroL.getWorksheet('Sin plaza');
  igual('Excel: en «Sin plaza» se dice que libraba', [...Array(sinPlazaXls.rowCount).keys()].map(i => sinPlazaXls.getRow(i + 1))
    .some(r => r.getCell(3).value === 'Ana' && r.getCell(12).value === 'Libraba (1111AAA)'), true);
  const libroC = new ExcelJS.Workbook();
  await libroC.xlsx.load(await require('../modules/Barcelona/barcelona.excel').generar(infC));
  const hojaC = libroC.getWorksheet('Por día');
  igual('Excel con casillas: la persona de la casilla, «Día · CT» en la matrícula que cogió',
    [...Array(hojaC.rowCount).keys()].map(i => hojaC.getRow(i + 1)).some(r => r.getCell(4).value === 'Eva' && r.getCell(2).value === 'Día · CT' && r.getCell(3).value === '1111AAA'), true);

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
  // Con casillas: Eva coge el martes (libra Ana) y no salió; el resto no coge nada.
  const semC = H.semana({ lunes: '2026-10-05', ivs: [], ...conCasillas, conductores: CONDUCTORES, ahoraMs: en('2026-10-13', 13) });
  const evaC = semC.filas.find(f => f.nombre === 'Eva');
  igual('Semana con casilla: la persona de la casilla tiene plaza solo el día que coge, y si no sale es «no salió»',
    [evaC.celdas.map(x => x.plazas.map(p => `${p.matricula} ${p.turno} ${p.rol}`).join()), evaC.noSalio, evaC.asignadas],
    [['', '1111AAA dia ct', '', '', '', '', ''], 1, [{ turno: 'dia', matricula: '1111AAA', rol: 'ct' }]]);
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
  // Con casillas: Eva solo trabaja los martes (lo que coge su casilla). Del 1 al
  // 19 de octubre: el 06 salió, el 13 no (ausencia); los demás días son su
  // libranza y no cuentan. Ana, sin horas: sus martes (06 y 13) son libranza, y
  // los otros 17 días, ausencias.
  const promC = H.promedios({ hoy: '2026-10-20', ivs: H.intervalos(trabajoEn('u-eva', '2026-10-06', 7, 8), sit, en('2026-09-30', 12), en('2026-10-20', 12)),
    ...conCasillas, ahoraMs: en('2026-10-20', 13) });
  igual('Promedio con casilla: la persona de la casilla solo tiene ausencia el día que tocaba coger una plaza',
    [promC('u-eva').salio, promC('u-eva').total, promC('u-eva').ausencias, promC('u-ana').ausencias], [1, 8, 1, 17]);

  // ══ 6 · LA VISIBILIDAD: las cuentas de Madrid con los datos de Barcelona ══
  // Ana, con plaza de día, trabajó ayer de 08:00 a 16:00 (2 h de viaje) y
  // descansó de 16:00 a 17:00. Cada ventana pedida devuelve 100 € y 5 viajes.
  const VS = require('../modules/Barcelona/visibilidad.service');
  const hoyV = S.hoyMadrid(), ayerV = R.sumarDias(hoyV, -1);
  const apV = [
    ap('u-ana', ayerV, 8, 'waiting_orders'), ap('u-ana', ayerV, 9, 'has_order'), ap('u-ana', ayerV, 11, 'waiting_orders'),
    ap('u-ana', ayerV, 16, 'busy'), ap('u-ana', ayerV, 17, 'inactive'),
  ];
  const planV = () => ({ asignaciones: [{ matricula: '1111AAA', turno: 'dia', uuid: 'u-ana', rol: 'fijo', dias: null, desde: '2026-01-01', hasta: null }],
    cts: [], descansos: [], casillas: [], cochesCuadrante: [] });
  repo.apuntesEntre = async (sede, ini, fin) => apV.filter(x => x.t >= ini && x.t < fin);
  repo.dineroEntre = async () => ({ neto: 100, viajes: 5 });
  repo.planEntre = async () => planV();
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
  // Sin db/236 (sin la tabla de casillas): el tablero lo dice; las horas siguen, sin casillas.
  let sinCasillas = 0;
  repo.planEntre = async (sede, d, h, o) => { if (!o || o.casillas !== false) throw sinTabla(); sinCasillas++; return planV(); };
  repo.queFalta = async () => 'db/236';
  igual('Sin db/236 la pantalla del planificador lo dice, con cuál', (await S.tablero({ fecha: hoy })).faltaMigracion, 'db/236');
  const rv236 = await VS.resumen();
  igual('Sin db/236 la Visibilidad sigue saliendo, leyendo el plan sin casillas', [sinCasillas > 0, rv236.ayer.horasEfectivas], [true, 8]);
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
  igual('Con las migraciones aplicadas, un 42703 es un error de verdad y no se esconde', otro, '42703');
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
  // su IIFE se sacan con una línea que se añade AQUÍ, no en el fichero; si una
  // pieza ya no existe en la pantalla, su prueba se salta y se dice. El tablero
  // que se le da es el que monta el servicio con los datos de mentira.
  repo.conductores = async () => CONDUCTORES;
  repo.planEntre = async () => ({ cts: [], casillas: [], ...PLAN, cochesCuadrante: EST.cochesCuadrante });
  repo.queFalta = async () => null;
  const PIEZAS = ['aplicar', 'celdaPlaza', 'filaCoche', 'cuentaZona', 'tituloPromedio', 'cocheAlCuad', 'meterEnCuad', 'tablaCoches', 'quitarCasilla'];
  const montarPantalla = tableroInicial => {
    const fs = require('fs'), vm = require('vm'), path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'vistas', 'Barcelona', 'barcelona-planificador.js'), 'utf8');
    const fin = src.lastIndexOf('})();');
    const codigo = src.slice(0, fin) +
      `\n  window.__P = { ${PIEZAS.map(n => `${n}: typeof ${n} === 'function' ? ${n} : undefined`).join(', ')}, tablero: () => T };\n` +
      src.slice(fin);
    const els = new Map();
    const elemento = () => {
      const cl = new Set();
      return { innerHTML: '', textContent: '', value: '', dataset: {}, style: {}, addEventListener() {}, scrollIntoView() {}, setAttribute() {}, querySelectorAll: () => [],
        classList: { add: x => cl.add(x), remove: x => cl.delete(x), toggle: (x, f) => ((f === undefined ? !cl.has(x) : f) ? cl.add(x) : cl.delete(x)), contains: x => cl.has(x) } };
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
      document: { querySelector: s => { if (!s.startsWith('#')) return null; if (!els.has(s)) els.set(s, elemento()); return els.get(s); }, querySelectorAll: () => [], addEventListener() {} },
      location: { pathname: '/barcelona', search: '', hash: '' },
      history: { pushState() {}, replaceState() {} },
      CSS: { escape: s => s }, addEventListener() {}, setTimeout, clearTimeout, console, URLSearchParams,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(codigo, ctx, { filename: 'barcelona-planificador.js' });
    if (ctx.__P.aplicar) ctx.__P.aplicar(tableroInicial);
    return { P: ctx.__P, dialogos, peticiones, respuestas, responder: fn => { respuestaApi = fn; } };
  };
  const sinEspacios = html => String(html).replace(/\s+/g, ' ');
  const hay = (v, ...piezas) => {
    const faltan = piezas.filter(n => typeof v.P[n] !== 'function');
    if (faltan.length) console.log(`SALTA la pantalla ya no tiene ${faltan.join(', ')}: revisar estas pruebas con la pantalla nueva.`);
    return !faltan.length;
  };
  const DOM = R.sumarDias(LUN, 6);
  PLAN = basePlan();
  EST = baseEst();
  const tDom = await S.tablero({ fecha: DOM });

  // [7] «+ Coche» y «Meter en un cuadrante» mandan el día que se mira: el
  // servidor devuelve el tablero de ese día y no salta a hoy.
  const v7 = montarPantalla(tDom);
  if (hay(v7, 'cocheAlCuad', 'meterEnCuad')) {
    v7.respuestas.push({ mat: '4444DDD' });
    await v7.P.cocheAlCuad(c1De(tDom));
    v7.respuestas.push({ cua: '1' });
    await v7.P.meterEnCuad('6666FFF');
    igual('[7] Meter un coche en un cuadrante lleva la fecha que se mira', v7.peticiones.map(p => p.datos),
      [{ matricula: '4444DDD', fecha: DOM }, { matricula: '6666FFF', fecha: DOM }]);
  }

  // [10] Un coche desactivado en BOLT: «desactivado» en castellano, su turno sin
  // nadie no es un hueco rojo y no cuenta en las tarjetas de zona (como en la
  // cifra de Huecos, que es del servidor y solo cuenta los activos).
  const v10 = montarPantalla(tDom);
  const c3 = tDom.coches.find(c => c.matricula === '3333CCC');
  igual('[10] (la prueba es la que toca) el 3333CCC está desactivado y sin fijo de día', [c3.activo, c3.estadoBolt, c3.turnos.dia], [false, 'deactivated', 'hueco']);
  if (hay(v10, 'filaCoche', 'celdaPlaza', 'cuentaZona')) {
    const fila3 = sinEspacios(v10.P.filaCoche(c3, false, false));
    igual('[10] La fila dice «desactivado en BOLT», no «deactivated»', [/desactivado en BOLT/.test(fila3), /deactivated/.test(fila3)], [true, false]);
    const celda3 = sinEspacios(v10.P.celdaPlaza(c3, 'dia', 'fijo'));
    igual('[10] Su turno sin nadie: «no sale», en gris, no un hueco rojo', [/no sale · coche desactivado/.test(celda3), /telecab-red/.test(celda3)], [true, false]);
    const sumaHuecos = ['sin', ...tDom.zonas.map(z => String(z.id))].reduce((s, z) => s + v10.P.cuentaZona(z).huecos, 0);
    igual('[10] Los huecos de las tarjetas de zona suman lo mismo que la cifra de Huecos', sumaHuecos, tDom.resumen.huecos);
  }

  // [11] La ayuda del chip del promedio dice la regla de verdad.
  if (hay(v10, 'tituloPromedio')) {
    const ayuda = v10.P.tituloPromedio({ horas: 8.6, total: 120, salio: 13, ausencias: 1, media: 9.2, periodo: '2026-11' });
    igual('[11] La ayuda: un día con horas cuenta siempre, tuviera plaza o no',
      [/tuviera plaza o no/.test(ayuda), /los días sin plaza no cuentan/.test(ayuda), /hasta ayer/.test(ayuda)], [true, false, true]);
    const ayudaAnt = v10.P.tituloPromedio({ horas: 9.4, total: 150, salio: 16, ausencias: 0, media: 9.4, periodo: '2026-10', mesAnterior: true });
    igual('[11] El del mes anterior es de octubre entero, no «hasta ayer»', [/octubre entero/.test(ayudaAnt), /hasta ayer/.test(ayudaAnt)], [true, false]);
  }

  // [13] Quitar una casilla mirando un día pasado: el servidor nunca la quita
  // antes de hoy (fechaCT), así que la pantalla tampoco lo promete: el diálogo
  // dice «desde hoy» y la petición va desde hoy.
  PLAN = basePlan();
  EST = baseEst();
  const ANTEAYER = R.sumarDias(hoy, -2);
  const tAnt = await S.tablero({ fecha: ANTEAYER });
  const v13 = montarPantalla(tAnt);
  if (hay(v13, 'quitarCasilla')) {
    v13.respuestas.push(true);
    await v13.P.quitarCasilla(c1De(tAnt), 'dia');
    const conf = (v13.dialogos.find(d => d.tipo === 'confirmar') || { args: [{}] }).args[0];
    const pet = v13.peticiones.find(p => p.metodo === 'DELETE') || {};
    igual('[13] Mirando un día pasado, «quitar la casilla» dice desde hoy y la pide desde hoy',
      [sinEspacios(conf.html).includes(`Desde hoy, el <b>${dmy(hoy)}</b>`), /hasta ayer sigue como estaba/.test(conf.html), pet.url, pet.datos],
      [true, true, `/barcelona/api/cuadrantes/1/casillas/dia?desde=${hoy}`, { desde: hoy }]);
  }

  // [14] Una plaza repetida que dejó db/236 (el 1111AAA y el 2222BBB libran de
  // día el L): el tablero la trae en `repetidas` y la casilla lo dice en rojo.
  PLAN = basePlan();
  PLAN.descansos = PLAN.descansos.map(d => (d.matricula === '2222BBB' ? { ...d, dias: [1, 6, 7] } : d));
  const tRep = await S.tablero({ fecha: SAB });
  igual('[14] El tablero trae la plaza repetida de la casilla', (c1De(tRep).casillas[0] || {}).repetidas,
    [{ dia: 1, plazas: [{ matricula: '1111AAA', turno: 'dia' }, { matricula: '2222BBB', turno: 'dia' }] }]);
  const v14 = montarPantalla(tRep);
  if (hay(v14, 'tablaCoches')) {
    const tabla = sinEspacios(v14.P.tablaCoches(tRep.coches.filter(c => c.cuadranteId === '1'), c1De(tRep)));
    igual('[14] …y la casilla la dice en rojo', tabla.includes('Plaza repetida: libran el L 1111AAA (día) y 2222BBB (día)'), true);
  }

  // [15] EL EXCEL DEL PLANIFICADOR DE VERDAD con el tablero del servicio: cada
  // casilla de CT es una celda combinada en todas las filas de su cuadrante.
  // (Su comprobador completo es scripts/comprobar-barcelona-planificador-excel.js.)
  PLAN = basePlan();
  EST = baseEst();
  {
    const ExcelJS = require('exceljs');
    const xl = await S.planificadorExcel({ fecha: SAB, zona: '1', q: '' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.bytes);
    const ws = wb.getWorksheet('Planificador');
    const texto = c => { const v = ws.getCell(c).value; return v && v.richText ? v.richText.map(r => r.text).join('') : String(v == null ? '' : v); };
    let fCab = 0;
    ws.eachRow((row, n) => { if (!fCab && texto(`A${n}`) === 'Matrícula') fCab = n; });
    igual('[15] El Excel: la cabecera del C1 con su casilla de día', [fCab > 0, texto(`E${fCab}`).replace(/\s+/g, ' ').trim()], [true, '☀ CT día']);
    igual('[15] …y la casilla, UNA celda en las tres filas del C1, con Eva', [(ws.model.merges || []).includes(`E${fCab + 1}:E${fCab + 3}`), texto(`E${fCab + 1}`).includes('Eva')], [true, true]);
    igual('[15] …y se llama como los de la casa', xl.nombre, `Planificador Barcelona ${SAB.split('-').reverse().join('-')}.xlsx`);
  }

  // [R4] La persona de una casilla que dobla con una plaza fija suya (la pudo
  // dejar db/236): la casilla lo dice en rojo en la pantalla y en ámbar en el Excel.
  PLAN = basePlan();
  EST = baseEst();
  const t0 = await S.tablero({ fecha: SAB });
  const v0 = montarPantalla(t0);
  if (hay(v0, 'tablaCoches')) {
    igual('[R4] Sin dobles, la casilla no dice nada', sinEspacios(v0.P.tablaCoches(t0.coches.filter(c => c.cuadranteId === '1'), c1De(t0))).includes('Dobla turno'), false);
  }
  PLAN.asignaciones.push({ id: '44', matricula: '4444DDD', turno: 'dia', uuid: 'u-eva', rol: 'fijo', dias: null, desde: INI, hasta: null });
  PLAN.descansos.push({ matricula: '4444DDD', turno: 'dia', dias: [6], desde: INI, hasta: null });
  const tDobP = await S.tablero({ fecha: SAB });
  const vR4 = montarPantalla(tDobP);
  if (hay(vR4, 'tablaCoches')) {
    const tabla = sinEspacios(vR4.P.tablaCoches(tDobP.coches.filter(c => c.cuadranteId === '1'), c1De(tDobP)));
    igual('[R4] La casilla dice el doble turno en rojo', tabla.includes('Dobla turno: Eva también es fija del 4444DDD de día (los L M V D). Quítala de una de las dos.'), true);
  }
  {
    const ExcelJS = require('exceljs');
    const xl = await S.planificadorExcel({ fecha: SAB, zona: '1', q: '' });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.bytes);
    const ws = wb.getWorksheet('Planificador');
    let todo = '';
    ws.eachRow(row => row.eachCell(c => { const v = c.value; todo += ' ' + (v && v.richText ? v.richText.map(r => r.text).join('') : String(v == null ? '' : v)); }));
    igual('[R4] …y el Excel, en la casilla', todo.includes('ojo: Eva también es fija del 4444DDD de día los L M V D: dobla turno'), true);
  }
  PLAN = basePlan();

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
