// ============================================================
// PROBAR: la aritmetica de la reconciliacion del mes
// ============================================================
//   node scripts/probar-conciliacion.js
//
// La vista v_conciliacion_mes (db/34) hace esta cuenta en SQL. Aqui esta la
// misma cuenta en JS, para probarla sin base. Las cinco cifras del mapa:
//
//   NETA    = max(0, BRUTA - REDUCE)
//   DEFECTO = max(0, NETA - CUMPLE - CUBRE)
//   EXCESO  = max(0, CUMPLE - NETA)
//
// Los casos son los que de verdad pasan: un mes normal, uno con vacaciones que
// bajan el objetivo, uno con exceso (horas extra), y el borde en que la
// reduccion se come el mes entero.

let mal = 0;
const ok = (t, cond, extra) => { if (!cond) mal++; console.log((cond ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// Espejo EXACTO de la vista. Entra en minutos, sale en minutos.
function conciliar({ bruta, reduce = 0, cumple = 0, cubre = 0 }) {
  const neta = Math.max(0, bruta - reduce);
  const defecto = Math.max(0, neta - cumple - cubre);
  const exceso = Math.max(0, cumple - neta);
  return { bruta, reduce, neta, cumple, cubre, defecto, exceso };
}

const H = h => h * 60;   // horas a minutos, para leer los casos en horas

console.log('\n== Mes normal: cumple justo el objetivo ==');
let r = conciliar({ bruta: H(150), cumple: H(150) });
ok('neta = 150 h', r.neta === H(150));
ok('sin defecto', r.defecto === 0);
ok('sin exceso', r.exceso === 0);

console.log('\n== Mes con defecto: trabaja de menos ==');
r = conciliar({ bruta: H(150), cumple: H(120) });
ok('defecto = 30 h', r.defecto === H(30), `(${r.defecto/60} h)`);
ok('sin exceso', r.exceso === 0);

console.log('\n== Vacaciones: la reduccion baja el objetivo ==');
// Objetivo 150 h, 40 h de vacaciones (REDUCE), trabaja 110. Neta = 110, cumple
// 110 -> no hay defecto: las vacaciones no se le reclaman.
r = conciliar({ bruta: H(150), reduce: H(40), cumple: H(110) });
ok('neta = 110 h', r.neta === H(110));
ok('sin defecto (las vacaciones no cuentan como falta)', r.defecto === 0);

console.log('\n== Justificaciones: taller y trafico cubren ==');
// Neta 150, trabaja 100 (CUMPLE) y 50 justificadas de taller (CUBRE). CUMPLE +
// CUBRE = 150 -> sin defecto. Es la regla de que CUBRE cuenta.
r = conciliar({ bruta: H(150), cumple: H(100), cubre: H(50) });
ok('cumple + cubre tapan el objetivo', r.defecto === 0);

console.log('\n== Exceso: horas extraordinarias (art. 20) ==');
// Neta 150, trabaja 165. Exceso = 15 h -> extraordinarias.
r = conciliar({ bruta: H(150), cumple: H(165) });
ok('exceso = 15 h', r.exceso === H(15), `(${r.exceso/60} h)`);
ok('sin defecto', r.defecto === 0);

console.log('\n== Borde: la reduccion se come el mes entero ==');
// De baja todo el mes: REDUCE >= BRUTA. Neta = 0, no cumple nada, y NO hay
// defecto: no se le puede reclamar jornada estando de baja el mes completo.
r = conciliar({ bruta: H(150), reduce: H(200), cumple: 0 });
ok('neta = 0 (no negativa)', r.neta === 0);
ok('sin defecto estando de baja todo el mes', r.defecto === 0);

console.log('\n== Defecto y algo de cubre a la vez ==');
// Neta 150, trabaja 90, 20 justificadas. Falta 150-90-20 = 40.
r = conciliar({ bruta: H(150), cumple: H(90), cubre: H(20) });
ok('defecto = 40 h', r.defecto === H(40), `(${r.defecto/60} h)`);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa reconciliacion cuadra');
process.exitCode = mal ? 1 : 0;
