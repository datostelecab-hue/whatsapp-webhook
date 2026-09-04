// Test de la cobertura PG (parte pura, sin base de datos).
const cob = require('../services/repo/cobertura');

let fallos = 0;
const ok = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { console.log('  ✗ ' + msg); fallos++; } };
const eq = (a, b, msg) => ok(a === b, `${msg}  (esperado ${JSON.stringify(b)}, salió ${JSON.stringify(a)})`);

// ── Tablero de ejemplo ───────────────────────────────────────────────────────
// Coche A: fijo día María(1), fijo noche Pedro(2), CT día Ana(3). Descansa X y J
// (ISODOW 3 y 4): esos días el fijo no cubre; Ana cubre el DÍA y la NOCHE queda sola.
const cel = (id, nombre) => ({ id, nombre, conflicto: false });
const vacia = () => ({ id: '', nombre: '', conflicto: false });
const semanaA = [];
for (let d = 0; d < 7; d++) {
  const descansa = d === 2 || d === 3;
  semanaA.push(descansa ? cel('3', 'Ana') : cel('1', 'María'));       // día
  semanaA.push(descansa ? vacia() : cel('2', 'Pedro'));                // noche
}
// Coche B: en taller, y su fijo día está de vacaciones (sale en "ausentes en plaza").
const semanaB = Array.from({ length: 14 }, vacia);

const tab = {
  dia: '2026-09-07',
  fechas: ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'],
  conductores: [
    { id: '1', nombre: 'María', ausente: false },
    { id: '2', nombre: 'Pedro', ausente: false },
    { id: '3', nombre: 'Ana', ausente: false },
    { id: '9', nombre: 'Luis', ausente: true, estado: 'Vacaciones', vuelveEl: '20/09/2026' },
  ],
  coches: [
    { matricula: '1888LTJ', zona: 'Usera', operativo: true, estadoVeh: 'O', descanso: [3, 4],
      personas: [{ id: '1', nombre: 'María' }, { id: '2', nombre: 'Pedro' }, { id: '3', nombre: 'Ana' }, {}, {}, {}],
      semana: semanaA },
    { matricula: '5736LGK', zona: 'Canillejas', operativo: false, estadoVeh: 'T', descanso: [],
      personas: [{ id: '9', nombre: 'Luis' }, {}, {}, {}, {}, {}],
      semana: semanaB },
  ],
  resumen: { diasSinCubrirDia: 0, diasSinCubrirNoche: 2, ctQueFaltanDia: 0, ctQueFaltanNoche: 1 },
};
const contac = new Map([['1', { telefono: '600111222' }], ['2', { telefono: '600333444' }], ['3', { telefono: '600555666' }]]);

const D = cob.construir(tab, contac, 0);

console.log('\n=== SEMANA ===');
eq(D.semanaInfo.etiqueta, '07/09 – 13/09', 'etiqueta de la semana');
eq(D.semanaInfo.inicio, '2026-09-07', 'inicio (lo que pinta la pantalla)');
eq(D.semanaInfo.fin, '2026-09-13', 'fin');
eq(D.semanaInfo.esActual, true, 'marcada como semana actual (offset 0)');

console.log('\n=== COCHES / TRAMOS ===');
eq(D.coches.length, 1, 'solo 1 coche operativo en la lista');
const A = D.coches[0];
eq(A.semana.length, 14, 'la semana del coche tiene 14 tramos');
eq(A.semana[0].diaNombre, 'Lunes', 'tramo 0 = Lunes');
eq(A.semana[0].turno, 'Día', 'tramo 0 = Día');
eq(A.semana[1].turno, 'Noche', 'tramo 1 = Noche');
eq(A.numLibres, 2, 'dos tramos libres (las noches de X y J)');

console.log('\n=== RELEVOS ===');
eq(D.relevos.length, 10, '10 relevos en la semana (Ana->Ana no cuenta)');
const r0 = D.relevos[0];
eq(r0.entrega.nombre, 'María', 'primer relevo lo entrega María');
eq(r0.recibe.nombre, 'Pedro', 'y lo recibe Pedro');
eq(r0.directo, true, 'es un relevo directo (tramos pegados)');
const saltado = D.relevos.find(r => r.entrega.nombre === 'Ana' && r.recibe.nombre === 'María');
ok(saltado && saltado.directo === false, 'Ana -> María (tras la noche vacía) NO es directo');

console.log('\n=== COBERTURA POR TURNO (quién sale / quién no) ===');
eq(D.cobertura.length, 14, '14 entradas (7 días x 2 turnos)');
const lunDia = D.cobertura[0];
eq(lunDia.enCalle.length, 1, 'lunes día: 1 coche en la calle');
eq(lunDia.sinConductor.length, 1, 'lunes día: 1 coche no sale');
eq(lunDia.sinConductor[0].tipo, 'vehiculo', 'y no sale por el vehículo (taller)');
ok(/taller/i.test(lunDia.sinConductor[0].motivo), 'el motivo dice que está en taller');

const mieNoche = D.cobertura.find(c => c.diaNombre === 'Miércoles' && c.turno === 'Noche');
const sinA = mieNoche.sinConductor.find(s => s.matricula === '1888LTJ');
eq(sinA.tipo, 'descanso', 'miércoles noche: el coche no sale porque descansa');
const mieDia = D.cobertura.find(c => c.diaNombre === 'Miércoles' && c.turno === 'Día');
eq(mieDia.enCalle.length, 1, 'miércoles día sí sale (lo cubre el correturnos)');
eq(mieDia.enCalle[0].conductor, 'Ana', 'y lo cubre Ana');

console.log('\n=== AUSENTES EN PLAZA ===');
eq(D.ausentesEnPlaza.length, 1, 'un titular ausente en plaza');
eq(D.ausentesEnPlaza[0].nombre, 'Luis', 'es Luis');
eq(D.ausentesEnPlaza[0].estado, 'Vacaciones', 'de vacaciones');

console.log('\n=== POR CONDUCTOR ===');
const maria = D.porConductor.find(p => p.nombre === 'María');
ok(!!maria, 'María está en la lista');
eq(maria.telefono, '600111222', 'con su teléfono');
eq(maria.dias.filter(d => d.trabaja).length, 5, 'María trabaja 5 días');
const lunes = maria.dias[0];
eq(lunes.trabaja, true, 'María trabaja el lunes');
eq(lunes.matricula, '1888LTJ', 'en el 1888LTJ');
eq(lunes.recibeDe, null, 'el lunes no recibe de nadie (empieza la semana)');
eq(lunes.entregaA && lunes.entregaA.nombre, 'Pedro', 'y se lo entrega a Pedro');
eq(lunes.entregaA && lunes.entregaA.telefono, '600333444', 'con el teléfono de Pedro');
const miercoles = maria.dias[2];
eq(miercoles.trabaja, false, 'María libra el miércoles (el coche descansa)');

const ana = D.porConductor.find(p => p.nombre === 'Ana');
eq(ana.dias.filter(d => d.trabaja).length, 2, 'Ana (correturnos) trabaja 2 días');
const anaMie = ana.dias[2];
eq(anaMie.entregaA, null, 'Ana no entrega el miércoles (la noche queda vacía)');
eq(anaMie.recibeDe && anaMie.recibeDe.nombre, 'Pedro', 'Ana recibe el coche de Pedro');

console.log('\n=== RESUMEN ===');
eq(D.resumen.coches, 1, 'un coche operativo');
eq(D.resumen.relevos, 10, '10 relevos');
eq(D.resumen.sinCubrir, 2, '2 tramos sin cubrir');
eq(D.resumen.cochesFueraDeServicio, 1, 'un coche fuera de servicio');

(async () => {
  const { mensajeTurnos, resolver } = require('../services/turnosConductor');

  console.log('\n=== MENSAJE DE WHATSAPP ===');
  const msg = mensajeTurnos(maria);
  ok(msg.includes('María'), 'saluda por su nombre');
  ok(msg.includes('1888LTJ'), 'nombra el coche');
  ok(msg.includes('Pedro'), 'dice a quién le entrega el coche');
  ok(msg.includes('600 333 444') || msg.includes('600333444'), 'con el teléfono del relevo');
  ok(/libras/.test(msg), 'agrupa los días que libra');
  ok(mensajeTurnos(null).includes('No encuentro'), 'sin entrada, avisa en vez de romper');

  // Sin BD, el primer camino (teléfono contra la base) falla y caen los respaldos.
  console.log('\n=== RESOLVER (respaldos, sin BD) ===');
  const r1 = await resolver(D.porConductor, { phone: '+34600111222' });
  eq(r1.entrada && r1.entrada.nombre, 'María', 'resuelve por el teléfono que ya trae la lista');
  eq(r1.como, 'telefono-lista', 'y deja dicho por dónde lo resolvió');
  const r2 = await resolver(D.porConductor, { phone: '+34999999999', nombreSesion: 'ana' });
  eq(r2.entrada && r2.entrada.nombre, 'Ana', 'resuelve por el nombre de la sesión');
  const r3 = await resolver(D.porConductor, { phone: '+34999999999' });
  eq(r3.entrada, null, 'sin pistas, no identifica a nadie');
  eq(r3.como, 'no-identificado', 'y lo dice para poder diagnosticarlo');

  // ── La semana de la migración: lunes y martes SIN PLAN cargado ──────────────
  console.log('');
  console.log('=== DÍAS SIN PLAN (como la semana de la migración) ===');
  const semanaCorta = semanaA.map((c, i) => (i < 4 ? vacia() : c));   // lun y mar vacíos
  const D2 = cob.construir({ ...tab, coches: [{ ...tab.coches[0], semana: semanaCorta }] }, contac, 0);
  const maria2 = D2.porConductor.find(p => p.nombre === 'María');
  eq(maria2.dias[0].sinPlan, true, 'el lunes queda marcado como SIN PLAN');
  eq(maria2.dias[0].trabaja, false, 'y por tanto no figura trabajando');
  eq(maria2.dias[4].sinPlan, false, 'el viernes sí tiene plan');
  const msg2 = mensajeTurnos(maria2);
  ok(!/Lunes/.test(msg2), 'el mensaje NO menciona el lunes (no hay dato, no es que libre)');
  ok(!/Martes/.test(msg2), 'ni el martes');
  ok(/Viernes/.test(msg2), 'pero sí habla de los días que sí tienen plan');
  ok(/libras/.test(mensajeTurnos(maria)), 'en una semana normal sigue diciendo cuándo libra');

  // Semana entera sin plan: se dice claro, no un saludo huérfano.
  ok(mensajeTurnos({ nombre: 'Ana', dias: maria2.dias.map(d => ({ ...d, sinPlan: true, trabaja: false })) })
       .includes('todavía no tengo cargados'), 'una semana entera sin plan se dice claro');

  console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ Todo correcto');
  process.exit(fallos ? 1 : 0);
})();
