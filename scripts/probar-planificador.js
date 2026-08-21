// ============================================================
// PRUEBAS DEL MOTOR DEL PLANIFICADOR
// ============================================================
// `calcularTablero` y `aplicarCambios` son funciones puras: reciben los valores
// de las hojas y devuelven el resultado, sin tocar la red. Aqui se les pasan
// tableros hechos a mano para comprobar las reglas que importan.
//
//   node scripts/probar-planificador.js
//
// NO llama a Google ni necesita la base de datos.

const P9 = require('../services/planificadorV2');
const { calcularTablero, aplicarCambios, P, A, P_HEADERS, A_HEADERS, FILAS_POR_COCHE, SLOTS } = P9;

let ok = 0, mal = 0;
const comprobar = (que, condicion, detalle) => {
  if (condicion) { ok++; console.log(`  ok  ${que}`); }
  else { mal++; console.log(`  NO  ${que}${detalle ? '  → ' + detalle : ''}`); }
};

// ---------- constructores de filas ----------

/** Una fila de AGENDA_V2 para un conductor que trabaja todos los dias menos los que libre. */
function conductor({ id, nombre, turno = 'Día', libra = [], alta = '01/01/2024', estado = 'Activo' }) {
  const f = new Array(A_HEADERS.length).fill('');
  f[A.ACTIVO - 1] = 'SI';
  f[A.ESTADO - 1] = estado;
  f[A.NOMBRE - 1] = nombre;
  f[A.ID_BOLT - 1] = id;
  f[A.DNI - 1] = '00000000X';
  f[A.FECHA_ALTA - 1] = alta;
  f[A.TURNO - 1] = turno;
  f[A.CONTRATO - 1] = '40h';
  f[A.TELEFONO - 1] = '600000000';
  // Libranzas: lunes = indice 0.
  [A.L_LUN, A.L_MAR, A.L_MIE, A.L_JUE, A.L_VIE, A.L_SAB, A.L_DOM].forEach((col, i) => {
    f[col - 1] = libra.includes(i) ? 'SI' : '';
  });
  return f;
}

/** Las 6 filas de un coche en PLANIFICADOR_V2. `slots` = {0: {id, dias, desde, hasta}, …} */
function coche({ matricula, estado = '✓', zona = '', slots = {} }) {
  return Array.from({ length: FILAS_POR_COCHE }, (_, k) => {
    const f = new Array(P_HEADERS.length).fill('');
    if (k === 0) {
      f[P.ESTADO_VEH - 1] = estado;
      f[P.MATRICULA - 1] = matricula;
      f[P.ZONA - 1] = zona;
    }
    const s = slots[k];
    if (s) {
      f[P.ID_BOLT - 1] = s.id || '';
      if (s.dias) f[P.DIAS_TRABAJA - 1] = s.dias;
      if (s.desde) f[P.DESDE - 1] = s.desde;
      if (s.hasta) f[P.HASTA - 1] = s.hasta;
    }
    return f;
  });
}

const conflictosDe = t => t.coches.flatMap(c => (c.conflictos || []).map(x => x.msg));

// ============================================================
console.log('\n1. La misma persona en dos coches el mismo dia');
// ============================================================
{
  // Ana es TodoTurno, asi que el motor la deja tanto en una plaza de Día como en
  // una de Noche. La meten de fija de Día en el coche A y de correturno de Noche
  // en el B el mismo dia: son dos jornadas seguidas.
  //
  // (Con un conductor de turno fijo esto no puede pasar: el motor ya lo rechaza
  // antes como "turno cruzado". Por eso el caso real es el TodoTurno.)
  const agenda = [conductor({ id: 'ana', nombre: 'Ana Garcia', turno: 'TodoTurno', libra: [5, 6] })];
  const plan = [
    ...coche({ matricula: 'AAA111', slots: { 0: { id: 'ana' } } }),
    // Slot 3 = CT1 Noche (ver SLOTS). Se le dan los mismos dias laborables.
    ...coche({ matricula: 'BBB222', slots: { 3: { id: 'ana', dias: 'L M X J V' } } }),
  ];
  const t = calcularTablero(agenda, plan, []);
  const msgs = conflictosDe(t);
  const dosCoches = msgs.filter(m => /en dos coches|está en \d+ coches/.test(m));
  comprobar('se detecta el doble coche', dosCoches.length > 0, msgs.join(' | ') || '(ningun conflicto)');
  comprobar('lo avisan LAS DOS tarjetas',
    t.coches.filter(c => (c.conflictos || []).some(x => /dos coches|coches el/.test(x.msg))).length === 2,
    'tarjetas que avisan: ' + t.coches.filter(c => (c.conflictos || []).length).map(c => c.matricula).join(', '));
  if (dosCoches.length) console.log('      «' + dosCoches[0] + '»');
}

// ============================================================
console.log('\n2. Dos coches el mismo dia y el MISMO turno (lo de siempre)');
// ============================================================
{
  const agenda = [conductor({ id: 'luis', nombre: 'Luis Perez', turno: 'Día', libra: [6] })];
  const plan = [
    ...coche({ matricula: 'AAA111', slots: { 0: { id: 'luis' } } }),
    ...coche({ matricula: 'BBB222', slots: { 0: { id: 'luis' } } }),
  ];
  const t = calcularTablero(agenda, plan, []);
  const msgs = conflictosDe(t);
  comprobar('sigue detectandose', msgs.some(m => /coches el/.test(m)), msgs.join(' | ') || '(nada)');
  comprobar('NO se avisa dos veces del mismo caso',
    msgs.filter(m => /en dos coches/.test(m)).length === 0,
    'el aviso por turno ya lo cubre; el de dia no debe duplicarlo');
}

// ============================================================
console.log('\n3. Dos coches en dias DISTINTOS: eso es legitimo');
// ============================================================
{
  // Un correturno puede cubrir un coche los lunes y otro los miercoles.
  const agenda = [conductor({ id: 'ct', nombre: 'Marta CT', turno: 'Día', libra: [5, 6] })];
  const plan = [
    ...coche({ matricula: 'AAA111', slots: { 2: { id: 'ct', dias: 'L M' } } }),
    ...coche({ matricula: 'BBB222', slots: { 2: { id: 'ct', dias: 'X J' } } }),
  ];
  const t = calcularTablero(agenda, plan, []);
  const msgs = conflictosDe(t);
  comprobar('no se inventa un conflicto', !msgs.some(m => /coches/.test(m)), msgs.join(' | '));
}

// ============================================================
console.log('\n4. El Desde se rellena solo al asignar');
// ============================================================
{
  const hoy = new Date();
  const p = n => String(n).padStart(2, '0');
  const HOY = `${p(hoy.getDate())}/${p(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;

  const plan = [new Array(P_HEADERS.length).fill('')].concat(coche({ matricula: 'AAA111' }));
  const { datos } = aplicarCambios(plan, [{ coche: 0, slots: [{ slot: 0, id: 'ana' }] }]);
  comprobar('se pone la fecha de hoy', datos[0][P.DESDE - 1] === HOY,
    `puso "${datos[0][P.DESDE - 1]}", esperaba "${HOY}"`);

  // Si viene una fecha, manda la que viene.
  const plan2 = [new Array(P_HEADERS.length).fill('')].concat(coche({ matricula: 'AAA111' }));
  const r2 = aplicarCambios(plan2, [{ coche: 0, slots: [{ slot: 0, id: 'ana', desde: '01/09/2026' }] }]);
  comprobar('una fecha explicita manda', r2.datos[0][P.DESDE - 1] === '01/09/2026',
    `puso "${r2.datos[0][P.DESDE - 1]}"`);

  // Una plaza que YA tenia fecha no se toca.
  const plan3 = [new Array(P_HEADERS.length).fill('')]
    .concat(coche({ matricula: 'AAA111', slots: { 0: { id: 'viejo', desde: '01/01/2020' } } }));
  const r3 = aplicarCambios(plan3, [{ coche: 0, slots: [{ slot: 0, id: 'nuevo' }] }]);
  comprobar('no se pisa una fecha que ya estaba', r3.datos[0][P.DESDE - 1] === '01/01/2020',
    `puso "${r3.datos[0][P.DESDE - 1]}"`);

  // Vaciar la plaza no debe inventar fecha.
  const plan4 = [new Array(P_HEADERS.length).fill('')]
    .concat(coche({ matricula: 'AAA111', slots: { 0: { id: 'ana' } } }));
  const r4 = aplicarCambios(plan4, [{ coche: 0, slots: [{ slot: 0, id: '' }] }]);
  comprobar('al vaciar la plaza no se pone fecha', !r4.datos[0][P.DESDE - 1],
    `puso "${r4.datos[0][P.DESDE - 1]}"`);
}

// ============================================================
console.log('\n5. La ventana Desde/Hasta sigue mandando en la cobertura');
// ============================================================
{
  const agenda = [conductor({ id: 'ana', nombre: 'Ana Garcia', turno: 'Día', libra: [5, 6] })];
  // Una asignacion que empieza dentro de un ano: esta semana no cuenta.
  const dentroDeUnAno = new Date(Date.now() + 365 * 86400000);
  const p = n => String(n).padStart(2, '0');
  const futuro = `${p(dentroDeUnAno.getDate())}/${p(dentroDeUnAno.getMonth() + 1)}/${dentroDeUnAno.getFullYear()}`;

  const plan = [...coche({ matricula: 'AAA111', slots: { 0: { id: 'ana', desde: futuro } } })];
  const t = calcularTablero(agenda, plan, []);
  const c = t.coches[0];
  comprobar('la plaza NO cuenta como cubierta antes del Desde',
    (c.preAltas || []).length > 0 || (c.huecos || []).length > 0,
    `preAltas=${(c.preAltas || []).length} huecos=${(c.huecos || []).length}`);
}

console.log(`\n${ok} bien · ${mal} mal`);
process.exitCode = mal ? 1 : 0;
