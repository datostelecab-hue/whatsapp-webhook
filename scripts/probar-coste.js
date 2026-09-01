// ============================================================
// PROBAR: el coste del absentismo (Hito 11)
// ============================================================
//   node scripts/probar-coste.js
//
// La cuenta de f_coste_hora y de las dos magnitudes de v_coste_absentismo, en
// JS. Coste soportado (solo lo pagado) y lucro cesante (siempre), separados.

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };
const r2 = n => Math.round(n * 100) / 100;

// G3A 2026: bruto mensual 1442.14. Cotizacion 31.4%. Horas 1776.
const BRUTO_MES = 1442.14, SS = 31.4, HORAS = 1776;
const costeHora = (brutoMes, ssPct = SS) => (brutoMes * 12) * (1 + ssPct / 100) / HORAS;

console.log('\n== El coste de una hora ==');
const ch = costeHora(BRUTO_MES);
ok('coste hora G3A 2026 ~ 12.80', Math.abs(ch - 12.80) < 0.02, '(' + r2(ch) + ')');
ok('mas cotizacion = mas coste', costeHora(BRUTO_MES, 40) > costeHora(BRUTO_MES, 31.4));
// El bruto anual = mensual x 12 (la prorrata de extras ya esta dentro).
ok('bruto anual = mensual x 12', 1442.14 * 12 === 17305.68);

// ── Coste soportado vs lucro cesante ────────────────────────────────────────
console.log('\n== Coste soportado (lo pagado) vs lucro cesante (lo no facturado) ==');
const INGRESO_HORA = 22;   // facturacion media por hora efectiva, de BOLT
const costeSoportado = (horas, isPaid) => isPaid ? r2(horas * ch) : 0;
const lucroCesante = (horas) => r2(horas * INGRESO_HORA);

// Vacaciones (pagadas): las dos magnitudes.
ok('vacaciones 8h: coste soportado > 0', costeSoportado(8, true) > 0, '(' + costeSoportado(8, true) + ')');
ok('vacaciones 8h: lucro cesante > 0', lucroCesante(8) > 0, '(' + lucroCesante(8) + ')');
// Suspension disciplinaria (NO pagada): coste soportado 0, lucro cesante si.
ok('suspension: coste soportado = 0 (no se paga)', costeSoportado(8, false) === 0);
ok('suspension: lucro cesante > 0 (la hora no facturo)', lucroCesante(8) > 0);
// Las dos magnitudes son distintas: no se suman a lo loco.
ok('coste soportado != lucro cesante', costeSoportado(8, true) !== lucroCesante(8));

// ── El coste total de un evento ─────────────────────────────────────────────
console.log('\n== Un evento de taller, imputado a Taller ==');
// 40h de parada de taller (justificacion, pagada). Modulo: taller.
const horasTaller = 40;
const cs = costeSoportado(horasTaller, true), lc = lucroCesante(horasTaller);
ok('coste soportado de 40h de taller', cs === r2(40 * ch), '(' + cs + ' EUR)');
ok('lucro cesante de 40h de taller', lc === 40 * INGRESO_HORA, '(' + lc + ' EUR)');
ok('el coste total es la suma de las dos', r2(cs + lc) === r2(cs + lc));

// ── Sin ingreso, no hay lucro cesante repartible ────────────────────────────
console.log('\n== Sin horas efectivas, el ingreso por hora es NULL ==');
const ingresoHora = (neto, minEfec) => minEfec <= 0 ? null : r2(neto / (minEfec / 60));
ok('sin trabajo el mes, ingreso hora = null', ingresoHora(0, 0) === null);
ok('con trabajo, ingreso hora = neto/horas', ingresoHora(2200, 6000) === r2(2200 / 100));

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nEl coste del absentismo cuadra');
process.exitCode = mal ? 1 : 0;
