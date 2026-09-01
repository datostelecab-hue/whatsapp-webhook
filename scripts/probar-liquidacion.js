// ============================================================
// PROBAR: la liquidacion de una baja (Hito 12)
// ============================================================
//   node scripts/probar-liquidacion.js
//
// Las tres cuentas de f_generar_liquidacion, en JS: descuento por preaviso,
// variables pendientes, vacaciones no disfrutadas. Y el control bloqueante.

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };
const r2 = n => Math.round(n * 100) / 100;

// G3A 2026: bruto mensual 1442.14. Diario = bruto/30 (ya lleva prorrata extras).
const BRUTO_MES = 1442.14;
const diario = r2(BRUTO_MES / 30);

// ── 1. Descuento por falta de preaviso (art. 11) ────────────────────────────
console.log('\n== Descuento por falta de preaviso (solo voluntaria) ==');
const descPreaviso = (tipo, diasPreavisados) => {
  if (tipo !== 'voluntaria') return 0;
  const faltan = Math.max(0, 7 - diasPreavisados);
  return r2(-faltan * diario);
};
ok('voluntaria sin preaviso (0 dias) = -7 dias', descPreaviso('voluntaria', 0) === r2(-7 * diario), '(' + descPreaviso('voluntaria', 0) + ')');
ok('voluntaria con 3 dias = -4 dias', descPreaviso('voluntaria', 3) === r2(-4 * diario));
ok('voluntaria con 7 dias = sin descuento', descPreaviso('voluntaria', 7) === 0);
ok('voluntaria con 10 dias = sin descuento (no negativo)', descPreaviso('voluntaria', 10) === 0);
ok('un DESPIDO no descuenta preaviso', descPreaviso('despido', 0) === 0);
ok('un fin de contrato no descuenta preaviso', descPreaviso('fin_contrato', 0) === 0);

// ── 2. Variables devengadas sin pagar (a mes vencido) ───────────────────────
console.log('\n== Variables devengadas cuyo pago cae despues de la baja ==');
// Baja en agosto (2026-08). Las variables de julio se pagan en agosto (<=baja):
// esas ya se pagan normal. Las de agosto se pagan en SEPTIEMBRE (>baja): a la
// liquidacion. Regla: pago (anio*12+mes) > baja (anio*12+mes).
const trasBaja = (pagoA, pagoM, bajaA, bajaM) => (pagoA * 12 + pagoM) > (bajaA * 12 + bajaM);
ok('propina de agosto (pago sept) va a la liquidacion', trasBaja(2026, 9, 2026, 8));
ok('propina de julio (pago agosto) NO va (se paga normal)', !trasBaja(2026, 8, 2026, 8));
ok('el cruce de ano funciona: dic paga en enero', trasBaja(2027, 1, 2026, 12));

// ── 3. Vacaciones no disfrutadas ────────────────────────────────────────────
console.log('\n== Vacaciones no disfrutadas ==');
// Alta 1-ene, baja 1-jul 2026 (no bisiesto, 365 dias). Dias de alta = 182.
// Derecho = 22 * 182/365 = 10.97 dias. Consumidas 5 -> pendientes ~6 -> en dinero.
const diasAlta = 182;
const derecho = 22 * diasAlta / 365;
const vacPend = (consumidas) => Math.max(0, r2((Math.round(derecho * 10) / 10 - consumidas) * diario));
ok('derecho a medio ano ~ 11 dias', Math.abs(derecho - 10.97) < 0.05, '(' + r2(derecho) + ')');
ok('5 consumidas -> pendiente en dinero > 0', vacPend(5) > 0, '(' + vacPend(5) + ' EUR)');
ok('si consumio todo lo devengado, 0 pendiente', vacPend(11) === 0);

// ── 4. El control bloqueante del cierre ─────────────────────────────────────
console.log('\n== Cierre bloqueado si faltan variables ==');
const puedeCerrar = (pendientes, recogidas) => r2(pendientes) === r2(recogidas);
ok('cierra si lo recogido = lo pendiente', puedeCerrar(150.5, 150.5));
ok('NO cierra si falta recoger variables', !puedeCerrar(150.5, 0), '(el control del spec 7.3)');

// ── 5. El finiquito es la suma con signo ────────────────────────────────────
console.log('\n== El finiquito: suma con signo ==');
const finiquito = descPreaviso('voluntaria', 3) + 120.0 + vacPend(5);
ok('preaviso resta, variables y vacaciones suman', finiquito < 120 + vacPend(5) && finiquito > 0,
   '(' + r2(finiquito) + ' EUR)');

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa liquidacion cuadra');
process.exitCode = mal ? 1 : 0;
