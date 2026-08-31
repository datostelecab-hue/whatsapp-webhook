// ============================================================
// PROBAR: la aritmetica del objetivo mensual
// ============================================================
//   node scripts/probar-objetivo.js
//
// Las funciones viven en la base (db/33) y no se pueden correr sin Postgres.
// Pero la CUENTA que hacen es la de aqui, clavada, asi que si estos numeros
// salen, los de la base tambien. Lo que se prueba:
//
//   1. Un ano completo suma la jornada anual (1776 h). Es el invariante: el
//      prorrateo reparte, no crea ni pierde horas.
//   2. Un alta a mitad de mes cobra su parte, ni de mas ni de menos.
//   3. El ano bisiesto se ajusta solo: 366 dias, misma suma anual.
//
// El 1776 se pone aqui a mano SOLO para la prueba. En la base sale del convenio.

let mal = 0;
const ok = (t, cond, extra) => { if (!cond) mal++; console.log((cond ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// Espejo EXACTO de f_dias_alta_mes: dias del mes cubiertos por [desde, hasta].
function diasAltaMes(desde, hasta, anio, mes) {
  const ini = new Date(Date.UTC(anio, mes - 1, 1));
  const fin = new Date(Date.UTC(anio, mes, 0));           // dia 0 del mes siguiente = ultimo del mes
  const a = desde > ini ? desde : ini;
  const b = (hasta && hasta < fin) ? hasta : fin;
  if (b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;              // ambos extremos incluidos
}

const diasAnio = anio => Math.round(
  (new Date(Date.UTC(anio, 11, 31)) - new Date(Date.UTC(anio, 0, 1))) / 86400000) + 1;

// Espejo de f_objetivo_min, con la base pasada (en la base sale del convenio).
function objetivoMin(baseHoras, desde, hasta, anio, mes) {
  const d = diasAltaMes(desde, hasta, anio, mes);
  if (d === 0) return 0;
  // round() de Postgres redondea el .5 hacia arriba (half up); Math.round hace
  // lo mismo con positivos, asi que coinciden.
  return Math.round(baseHoras * 60 * d / diasAnio(anio));
}

const BASE = 1776;   // ANNUAL_EFFECTIVE_HOURS, art. 16. Aqui a mano solo para probar.
const D = (a, m, dia) => new Date(Date.UTC(a, m - 1, dia));

// ── 1. Un ano completo suma 1776 h ──────────────────────────────────────────
console.log('\n== Ano completo: la suma da la jornada anual ==');
for (const anio of [2025, 2026]) {
  const alta = D(anio - 1, 1, 1);   // de alta desde antes: todos los meses completos
  let total = 0;
  for (let m = 1; m <= 12; m++) total += objetivoMin(BASE, alta, null, anio, m);
  const horas = total / 60;
  // Con redondeo por mes hay un residuo minusculo (< 6 min al ano). Se admite
  // esa tolerancia: es un objetivo de trabajo, no una factura.
  ok(`${anio}: suma = ${horas.toFixed(2)} h`, Math.abs(horas - BASE) < 0.1, `(objetivo ${BASE} h)`);
}

// ── 2. Enero pesa mas que febrero, y los numeros del spec ───────────────────
console.log('\n== El reparto por longitud del mes (2026, 365 dias) ==');
const alta2026 = D(2025, 1, 1);
const ene = objetivoMin(BASE, alta2026, null, 2026, 1);
const feb = objetivoMin(BASE, alta2026, null, 2026, 2);
ok(`enero  = ${ene} min (${(ene/60).toFixed(1)} h)`, ene === Math.round(106560 * 31 / 365));
ok(`febrero= ${feb} min (${(feb/60).toFixed(1)} h)`, feb === Math.round(106560 * 28 / 365));
ok('enero pesa mas que febrero', ene > feb);

// ── 3. Alta a mitad de mes: solo su parte ───────────────────────────────────
console.log('\n== Alta a mitad de mes: prorrateo del arranque ==');
// Alta el 8 de julio de 2026: en julio cuenta del 8 al 31 = 24 dias.
const dJul = diasAltaMes(D(2026, 7, 8), null, 2026, 7);
ok(`8-jul: dias de alta en julio = ${dJul}`, dJul === 24);
const objJul = objetivoMin(BASE, D(2026, 7, 8), null, 2026, 7);
ok(`objetivo de ese julio = ${objJul} min`, objJul === Math.round(106560 * 24 / 365));
const objJulFull = objetivoMin(BASE, D(2025, 1, 1), null, 2026, 7);
ok('cobra menos que un julio completo', objJul < objJulFull);
// Un mes ANTES del alta: cero.
ok('junio (antes del alta) = 0', objetivoMin(BASE, D(2026, 7, 8), null, 2026, 6) === 0);

// ── 4. Ano bisiesto: 366 dias, misma suma anual ─────────────────────────────
console.log('\n== Ano bisiesto (2028, 366 dias) ==');
ok('2028 tiene 366 dias', diasAnio(2028) === 366);
let total2028 = 0;
for (let m = 1; m <= 12; m++) total2028 += objetivoMin(BASE, D(2027, 1, 1), null, 2028, m);
ok(`2028: suma = ${(total2028/60).toFixed(2)} h`, Math.abs(total2028/60 - BASE) < 0.1, '(el bisiesto se ajusta solo)');

// ── 5. Baja a mitad de mes: cuenta hasta la baja ────────────────────────────
console.log('\n== Baja a mitad de mes ==');
// Contrato del 1 al 15 de marzo de 2026: 15 dias.
const dMar = diasAltaMes(D(2026, 3, 1), D(2026, 3, 15), 2026, 3);
ok(`1-15 marzo: dias = ${dMar}`, dMar === 15);
ok('abril (tras la baja) = 0', objetivoMin(BASE, D(2026, 3, 1), D(2026, 3, 15), 2026, 4) === 0);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLa aritmetica del objetivo cuadra');
process.exitCode = mal ? 1 : 0;
