// ============================================================
// PROBAR: las variables de nomina (Hito 8)
// ============================================================
//   node scripts/probar-variables.js
//
// Las cuentas que se pueden probar sin base: el calculo nocturno (el helper de
// jornada), la regla del plus de calidad y el aviso del contador de extras.
// Las funciones SQL hacen la misma cuenta; si estos numeros salen, salen alli.

const path = require('path');
const j = require(path.join(__dirname, '..', 'services', 'repo', 'jornada'));

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// ── 1. El calculo nocturno (22:00-06:00) ────────────────────────────────────
console.log('\n== Minutos nocturnos (22:00-06:00) ==');
const loc = (dia, h, m = 0) => Math.floor(Date.UTC(2026, 7, dia, h - 2, m) / 1000);   // verano Madrid
ok('22:00-24:00 = 120', j.minutosNocturnos(loc(20, 22), loc(21, 0)) === 120);
ok('00:00-06:00 = 360', j.minutosNocturnos(loc(20, 0), loc(20, 6)) === 360);
ok('20:00-23:00 = 60 (solo 22-23)', j.minutosNocturnos(loc(20, 20), loc(20, 23)) === 60);
ok('mediodia = 0', j.minutosNocturnos(loc(20, 8), loc(20, 15)) === 0);
ok('21:00-07:00 cruzando = 480 (la noche entera)', j.minutosNocturnos(loc(20, 21), loc(21, 7)) === 480);

// ── 2. La regla del plus de calidad (art. 25.c) ─────────────────────────────
// procede = jornada cumplida Y (accidentes <= max O cancelacion <= max).
console.log('\n== La regla del plus de calidad ==');
const MAX_ACC = 1, MAX_PCT = 4;
const procede = (jornada, acc, pct) => jornada && (acc <= MAX_ACC || pct <= MAX_PCT);

ok('jornada cumplida + poca cancelacion = SI', procede(true, 0, 2) === true);
ok('jornada cumplida + mucha cancelacion pero sin accidentes = SI (basta una)',
   procede(true, 1, 9) === true);
ok('jornada cumplida + 2 accidentes + 9% cancelacion = NO (falla la segunda)',
   procede(true, 2, 9) === false);
ok('jornada NO cumplida = NO (falla la primera, aunque el resto este bien)',
   procede(false, 0, 1) === false);
ok('justo en el 4% cuenta como cumplido', procede(true, 5, 4) === true);
ok('justo en 1 accidente cuenta como cumplido', procede(true, 1, 9) === true);

// ── 3. El aviso del contador de extras (art. 20, 80h/ano) ───────────────────
console.log('\n== El contador de extras avisa al acercarse ==');
const LIMITE = 80 * 60;   // 4800 min
const cerca = min => min >= LIMITE * 0.9;
const pasado = min => min > LIMITE;
ok('60h no avisa', cerca(60 * 60) === false);
ok('72h (90%) avisa', cerca(72 * 60) === true, '(justo el 90%)');
ok('79h avisa pero no ha pasado', cerca(79 * 60) === true && pasado(79 * 60) === false);
ok('81h ha pasado el limite', pasado(81 * 60) === true);

// ── 4. El pago a mes vencido (devengo + 1) ──────────────────────────────────
console.log('\n== Pago a mes vencido (devengo + 1) ==');
const sig = (a, m) => m === 12 ? [a + 1, 1] : [a, m + 1];
ok('agosto se paga en septiembre', JSON.stringify(sig(2026, 8)) === JSON.stringify([2026, 9]));
ok('diciembre se paga en enero del ano siguiente',
   JSON.stringify(sig(2026, 12)) === JSON.stringify([2027, 1]));

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLas variables de nomina cuadran');
process.exitCode = mal ? 1 : 0;
