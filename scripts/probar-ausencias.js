// ============================================================
// PROBAR: la aritmetica de las ausencias del convenio
// ============================================================
//   node scripts/probar-ausencias.js
//
// Las funciones viven en la base (db/39) y no corren sin Postgres, pero la
// cuenta es la de aqui. Lo que se prueba:
//
//   1. Un dia de ausencia resta 8h (480 min) del objetivo del mes.
//   2. El derecho a vacaciones se prorratea por dias de alta, igual que el
//      objetivo, asi que cuadran por construccion.
//   3. En la reconciliacion, las vacaciones bajan la NETA y no cuentan como
//      defecto (ya cubierto en probar-conciliacion; aqui se ve el encaje).

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

const H = h => h * 60;

// ── 1. Un dia de ausencia resta la TASA DIARIA del objetivo (no 8h planos) ───
console.log('\n== Cada dia de ausencia resta la tasa diaria del objetivo ==');
// base_anual*60/dias_anio. 2026: 1776*60/365 = 291.9 -> 292 min/dia.
const MIN_DIA = Math.round(1776 * 60 / 365);
ok('un dia (2026) = 292 min', MIN_DIA === 292, '(' + MIN_DIA + ')');
// Un mes ENTERO de ausencia deja la neta en cero: los dias suman el objetivo.
const objAgosto = Math.round(1776 * 60 * 31 / 365);   // agosto completo
ok('31 dias de ausencia ~= el objetivo del mes (neta 0)',
   Math.abs(31 * MIN_DIA - objAgosto) <= 31);
const diasVac = 5;
ok('5 dias = 1460 min de REDUCE', diasVac * MIN_DIA === 1460, '(' + diasVac * MIN_DIA + ')');

// ── 2. El derecho a vacaciones, prorrateado ─────────────────────────────────
console.log('\n== Derecho a vacaciones prorrateado por dias de alta (art. 21) ==');
const BASE_DIAS = 22;   // VACATION_WORKDAYS_PER_YEAR, del convenio.
const diasAnio = anio => Math.round(
  (new Date(Date.UTC(anio, 11, 31)) - new Date(Date.UTC(anio, 0, 1))) / 86400000) + 1;
const D = (a, m, d) => new Date(Date.UTC(a, m - 1, d));
function derecho(desde, hasta, anio) {
  const ini = D(anio, 1, 1), fin = D(anio, 12, 31);
  const a = desde > ini ? desde : ini;
  const b = (hasta && hasta < fin) ? hasta : fin;
  const dias = Math.round((b - a) / 86400000) + 1;
  if (dias <= 0) return 0;
  return Math.round(BASE_DIAS * dias / diasAnio(anio) * 10) / 10;
}
// Ano completo: los 22 dias enteros.
ok('ano completo (2026) = 22 dias', derecho(D(2025, 1, 1), null, 2026) === 22, `(${derecho(D(2025,1,1),null,2026)})`);
// Alta el 1 de julio: medio ano, ~11 dias.
const medio = derecho(D(2026, 7, 1), null, 2026);
ok('alta 1-jul = ~11 dias', medio > 10.9 && medio < 11.2, `(${medio})`);
// Alta el 1 de octubre: un trimestre, ~5.5 dias.
const cuarto = derecho(D(2026, 10, 1), null, 2026);
ok('alta 1-oct = ~5.5 dias', cuarto > 5.4 && cuarto < 5.7, `(${cuarto})`);

// ── 3. Encaje en la reconciliacion ──────────────────────────────────────────
console.log('\n== La ausencia baja la NETA a su tasa, no son defecto ==');
// Objetivo de un mes de 30 dias. 5 dias de ausencia restan 5*292.
const bruta = Math.round(1776 * 60 * 30 / 365);
const reduce = diasVac * MIN_DIA;
const neta = Math.max(0, bruta - reduce);
ok('la ausencia baja la neta en 5 dias', bruta - neta === reduce, '(' + reduce + ' min)');
ok('un mes entero de ausencia dejaria la neta en 0',
   Math.max(0, bruta - 30 * MIN_DIA) === 0);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa aritmetica de las ausencias cuadra');
process.exitCode = mal ? 1 : 0;
