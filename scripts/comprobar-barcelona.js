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
  { uuid: 'v1', matricula: '1111AAA', modelo: 'Corolla', estado: 'active' },
  { uuid: 'v2', matricula: '2222BBB', modelo: 'Corolla', estado: 'active' },
  { uuid: 'v3', matricula: '3333CCC', modelo: 'Prius', estado: 'deactivated' },
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
  igual('Filas: los activos y el desactivado que alguien lleva', t.filas.map(f => f.matricula), ['1111AAA', '2222BBB', '3333CCC']);
  igual('La plaza de día de 1111AAA es de Ana', t.filas[0].dia && t.filas[0].dia.nombre, 'Ana');
  igual('La noche de 1111AAA terminó el 05/10: libre el 07', t.filas[0].noche, null);
  igual('Dani ya no está activo en BOLT y se marca', t.filas[2].noche && t.filas[2].noche.activa, false);
  igual('Sin plaza: Beto y Caro (Dani no cuenta: no está activo)', t.sinPlaza.map(c => c.nombre), ['Beto', 'Caro']);
  igual('Resumen', t.resumen, { coches: 2, plazas: 4, cubiertas: 2, conductores: 3, sinPlaza: 2 });
  const t5 = await S.tablero({ fecha: '2026-10-05' });
  igual('El 05/10 la noche de 1111AAA aún era de Beto', t5.filas[0].noche && t5.filas[0].noche.nombre, 'Beto');

  // Asignar: lo que se comprueba.
  const hoy = S.hoyMadrid();
  await lanza('Un turno que no es día ni noche', () => S.asignar({ matricula: '1111AAA', turno: 'tarde', conductor: 'u-caro' }), 'día o de noche');
  await lanza('Una matrícula que no es de Barcelona', () => S.asignar({ matricula: '9999ZZZ', turno: 'dia', conductor: 'u-caro' }), 'no es de un coche de Barcelona');
  await lanza('Una cuenta que no es de Barcelona', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-otro' }), 'no es una cuenta de BOLT de Barcelona');
  await lanza('Una cuenta desactivada', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-dani' }), 'no está activa');
  await lanza('Una fecha de hace dos meses', () => S.asignar({ matricula: '1111AAA', turno: 'dia', conductor: 'u-caro', desde: '2020-01-01' }), 'un mes atrás');
  await S.asignar({ matricula: '2222-bbb', turno: 'noche', conductor: { valor: 'u-caro' }, desde: hoy }, 7);
  igual('La matrícula se normaliza y el selector puede mandar { valor }', ultimaAsignacion,
    { sede: 'barcelona', matricula: '2222BBB', turno: 'noche', driverUuid: 'u-caro', desde: hoy, usuarioId: 7 });
  await S.asignar({ matricula: '2222BBB', turno: 'noche', conductor: '' }, 7);
  igual('Sin conductor deja la plaza libre (desde hoy)', [ultimaAsignacion.driverUuid, ultimaAsignacion.desde], [null, hoy]);

  // Sin db/181.
  repo.conductores = async () => { const e = new Error('no existe'); e.code = '42P01'; throw e; };
  igual('Sin db/181 la pantalla lo dice', (await S.tablero({ fecha: '2026-10-07' })).faltaMigracion, true);

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
