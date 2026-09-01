// ============================================================
// PROBAR: bonus y garantia de convenio (Hito 9)
// ============================================================
//   node scripts/probar-bonus.js
//
// La cuenta que hacen f_convenio_minimo_mes y f_garantia_convenio, en JS. El
// minimo del convenio (bruto + permanencia + antiguedad) y el comparador: si el
// bonus deja por debajo, el complemento es la diferencia.
//
// Valores G3A 2026, de la tabla salarial: base 1236.12, bruto 1442.14,
// permanencia 3m 22.54, 6m 45.07.

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };
const eur = n => Math.round(n * 100) / 100;

const BASE = 1236.12, BRUTO = 1442.14, PERM3 = 22.54, PERM6 = 45.07;

// Permanencia por antiguedad en meses (art. 25.b).
function permanencia(meses) {
  if (meses > 6) return PERM6;
  if (meses > 3) return PERM3;
  return 0;
}
// Antiguedad por tramos de anos (art. 25.d), sobre base + permanencia.
function pctAntiguedad(anios) {
  if (anios >= 20) return 27;
  if (anios >= 15) return 20;
  if (anios >= 10) return 13;
  if (anios >= 5) return 6;
  return 0;
}
function minimoConvenio(meses) {
  const perm = permanencia(meses);
  const pct = pctAntiguedad(Math.floor(meses / 12));
  const antig = (BASE + perm) * pct / 100;
  return eur(BRUTO + perm + antig);
}

// ── 1. El minimo del convenio por antiguedad ────────────────────────────────
console.log('\n== El minimo garantizado del convenio ==');
// Recien entrado (<3 meses): solo el bruto.
ok('2 meses = solo bruto (1442.14)', minimoConvenio(2) === 1442.14, '(' + minimoConvenio(2) + ')');
// >3 meses: bruto + permanencia 3m.
ok('4 meses = bruto + perm3', minimoConvenio(4) === eur(BRUTO + PERM3), '(' + minimoConvenio(4) + ')');
// >6 meses: bruto + permanencia 6m.
ok('8 meses = bruto + perm6', minimoConvenio(8) === eur(BRUTO + PERM6), '(' + minimoConvenio(8) + ')');
// 5 anos: + 6% de antiguedad sobre base+permanencia.
const m5 = minimoConvenio(60);
ok('5 anos anade el 6% de antiguedad', m5 === eur(BRUTO + PERM6 + (BASE + PERM6) * 0.06), '(' + m5 + ')');
// 20 anos: el 27%.
const m20 = minimoConvenio(240);
ok('20 anos anade el 27%', m20 === eur(BRUTO + PERM6 + (BASE + PERM6) * 0.27), '(' + m20 + ')');
ok('mas antiguedad = mas minimo', minimoConvenio(240) > minimoConvenio(60));

// ── 2. El comparador de garantia ────────────────────────────────────────────
console.log('\n== El comparador: el bonus tiene que llegar al minimo ==');
const complemento = (bonus, meses) => Math.max(0, eur(minimoConvenio(meses) - bonus));

// Un bonus generoso por encima del convenio: sin complemento.
ok('bonus de 2000 (>minimo) = sin complemento', complemento(2000, 8) === 0);
// Un bonus que deja por debajo: complemento por la diferencia.
const min8 = minimoConvenio(8);
ok('bonus de 1400 (<minimo) = complemento por la diferencia',
   complemento(1400, 8) === eur(min8 - 1400), '(' + complemento(1400, 8) + ')');
// Bonus justo en el minimo: sin complemento.
ok('bonus justo en el minimo = sin complemento', complemento(min8, 8) === 0);
// El complemento SIEMPRE deja al trabajador exactamente en el minimo.
ok('bonus + complemento = el minimo', eur(1400 + complemento(1400, 8)) === min8);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nBonus y garantia cuadran');
process.exitCode = mal ? 1 : 0;
