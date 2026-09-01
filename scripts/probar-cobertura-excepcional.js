// ============================================================
// PROBAR: la libranza excepcional en f_cobertura (Paso 1 planificador)
// ============================================================
//   node scripts/probar-cobertura-excepcional.js
//
// Replica en JS el booleano de la rama del FIJO de f_cobertura (db/54), que no
// puedo ejecutar contra Postgres desde aqui. El swap de una semana: trabaja un
// dia que libra por patron y libra uno que trabaja, y la semana siguiente vuelve
// a la normalidad.

let mal = 0;
const ok = (t, c) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t); };

// isoDow: 1=lunes .. 7=domingo (como EXTRACT(ISODOW ...)).
// patron = dias que libra por patron. exc = { trabaja: iso, libra: iso } o null.
// cubre = ( no libra por patron  O  ese dia repone ) Y no es su libranza excepcional
const cubre = (iso, patron, exc) => {
  const libraPatron = patron.includes(iso);
  const repone = !!exc && exc.trabaja === iso;
  const libraExc = !!exc && exc.libra === iso;
  return (!libraPatron || repone) && !libraExc;
};

const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const patron = [1, 2];   // libra lunes y martes

// ── Semana normal (sin excepcion): cubre todo menos lo que libra ────────────
console.log('\n== Semana normal (libra Lun/Mar) ==');
ok('lunes NO cubre (libra)',    cubre(1, patron, null) === false);
ok('martes NO cubre (libra)',   cubre(2, patron, null) === false);
ok('miércoles cubre',           cubre(3, patron, null) === true);
ok('jueves cubre',              cubre(4, patron, null) === true);
ok('domingo cubre',             cubre(7, patron, null) === true);

// ── La semana del swap: trabaja el lunes, libra el miércoles ────────────────
console.log('\n== Semana con libranza excepcional (trabaja Lun, libra Mié) ==');
const exc = { trabaja: 1, libra: 3 };
ok('lunes SÍ cubre (repone lo que normalmente libra)', cubre(1, patron, exc) === true);
ok('martes NO cubre (sigue librando por patron)',      cubre(2, patron, exc) === false);
ok('miércoles NO cubre (su libranza excepcional)',     cubre(3, patron, exc) === false);
ok('jueves cubre (normal)',                            cubre(4, patron, exc) === true);
ok('viernes cubre (normal)',                           cubre(5, patron, exc) === true);

// El total de dias trabajados no cambia: sigue trabajando 5 y librando 2.
console.log('\n== El swap no regala ni quita dias ==');
const trabajaNormal = [1,2,3,4,5,6,7].filter(d => cubre(d, patron, null)).length;
const trabajaSwap   = [1,2,3,4,5,6,7].filter(d => cubre(d, patron, exc)).length;
ok('mismos dias de trabajo con y sin swap', trabajaNormal === trabajaSwap);
ok('son 5 dias de trabajo, 2 de libranza', trabajaNormal === 5);

// ── La semana SIGUIENTE (sin fila de excepcion) vuelve a la normalidad ──────
console.log('\n== La semana siguiente, sin excepcion, es normal otra vez ==');
ok('lunes vuelve a librar', cubre(1, patron, null) === false);
ok('miércoles vuelve a trabajar', cubre(3, patron, null) === true);

// Muestra la semana del swap, para leerla de un vistazo.
console.log('\n  Semana del swap:');
for (let d = 1; d <= 7; d++) console.log(`   ${DIAS[d]}: ${cubre(d, patron, exc) ? 'trabaja' : 'libra'}`);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa libranza excepcional cuadra');
process.exitCode = mal ? 1 : 0;
