// ============================================================
// EL REPARTO DE LAS HORAS POR TURNO — de quién es cada hora
// ============================================================
// La regla de services/flotaViva/repartoTurnos.js, que comparten Control y
// Visibilidad (06/10/2026): el día cuenta de 00:00 a 24:00 y la noche de 12:00 a
// 12:00, según el turno de cada conductor; los NN, por su hora de inicio. Cada
// caso es uno que pidió Camilo o un borde que hay que guardar.
//
//   node scripts/comprobar-reparto-turnos.js
//
// No toca la base de datos: prueba la función pura.
const R = require('../services/flotaViva/repartoTurnos');

const D = '2026-10-06', AYER = '2026-10-05', MAN = '2026-10-07';
const t = (fecha, h) => R.instante(fecha, h);
const iv = (persona, f1, h1, f2, h2, situacion = 'espera') => ({ persona, situacion, ini: t(f1, h1), fin: t(f2, h2) });
const plan = mapa => (persona, fecha) => new Set(((mapa[persona] || {})[fecha]) || []);

let fallos = 0;
function caso(nombre, ivs, planes, esperado) {
  const { porPersona } = R.repartir(ivs, plan(planes));
  const real = {};
  porPersona.forEach((m, p) => m.forEach((v, k) => { real[p + ' ' + k + (v.nn ? ' (NN)' : '')] = Math.round(v.seg / 360) / 10; }));
  const ok = JSON.stringify(Object.entries(real).sort()) === JSON.stringify(Object.entries(esperado).sort());
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

caso('De día que entra a las 04:00', [iv('A', D, 4, D, 12)], { A: { [D]: ['dia'] } }, { ['A ' + D + '|dia']: 8 });
caso('De noche que entra a las 15:00 y acaba a las 03:00', [iv('B', D, 15, MAN, 3)], { B: { [D]: ['noche'] } }, { ['B ' + D + '|noche']: 12 });
caso('NN de 08:00 a 15:00 → día', [iv('N', D, 8, D, 15)], {}, { ['N ' + D + '|dia (NN)']: 7 });
caso('NN de 12:30 a 20:00 → noche', [iv('N', D, 12.5, D, 20)], {}, { ['N ' + D + '|noche (NN)']: 7.5 });
caso('De noche de ayer que remata a las 06:00', [iv('C', AYER, 18, D, 6)], { C: { [AYER]: ['noche'] } }, { ['C ' + AYER + '|noche']: 12 });
caso('NN de 13:00 a 02:00 y otra vez de 09:00 a 15:00 → sin contar dos veces',
  [iv('N', D, 13, MAN, 2), iv('N', MAN, 9, MAN, 15)], {},
  { ['N ' + D + '|noche (NN)']: 13, ['N ' + MAN + '|dia (NN)']: 6 });
caso('TodoTurno (día y noche) de 05:00 a 03:00 → pasa a noche a las 17:00',
  [iv('T', D, 5, MAN, 3)], { T: { [D]: ['dia', 'noche'] } },
  { ['T ' + D + '|dia']: 12, ['T ' + D + '|noche']: 10 });
caso('Noches seguidas: empieza a las 11:30',
  [iv('E', D, 11.5, D, 20)], { E: { [AYER]: ['noche'], [D]: ['noche'] } },
  { ['E ' + AYER + '|noche']: 0.5, ['E ' + D + '|noche']: 8 });
caso('De día con otra sesión por la tarde (18:00–22:00) → todo día',
  [iv('F', D, 5, D, 13), iv('F', D, 18, D, 22)], { F: { [D]: ['dia'] } }, { ['F ' + D + '|dia']: 12 });
caso('NN con hueco grande (08–11 y 18–22) → día y noche',
  [iv('N', D, 8, D, 11), iv('N', D, 18, D, 22)], {}, { ['N ' + D + '|dia (NN)']: 3, ['N ' + D + '|noche (NN)']: 4 });
caso('NN con hueco corto (08–11 y 12:30–15) → todo día',
  [iv('N', D, 8, D, 11), iv('N', D, 12.5, D, 15)], {}, { ['N ' + D + '|dia (NN)']: 5.5 });
caso('De noche que empieza a las 10:00 sin noche ayer → NN de día hasta que...',
  [iv('G', D, 10, D, 14)], { G: { [D]: ['noche'] } }, { ['G ' + D + '|dia (NN)']: 2, ['G ' + D + '|noche']: 2 });
caso('Cambio de hora (25/10, se atrasa el reloj): de noche 17:00 → 05:00 son 13 h reales',
  [iv('H', '2026-10-24', 17, '2026-10-25', 5)], { H: { '2026-10-24': ['noche'] } }, { ['H 2026-10-24|noche']: 13 });

caso('Dos cuentas de la misma persona que se pisan (08–12 y 10–14) → 6 h, no 8',
  [iv('P', D, 8, D, 12), iv('P', D, 10, D, 14)], { P: { [D]: ['dia'] } }, { ['P ' + D + '|dia']: 6 });
caso('Un tramo dentro de otro no suma nada',
  [iv('P', D, 8, D, 16), iv('P', D, 9, D, 10)], { P: { [D]: ['dia'] } }, { ['P ' + D + '|dia']: 8 });

// La suma de los turnos tiene que ser todo lo trabajado.
const ivs = [iv('A', D, 4, D, 12), iv('N', D, 13, MAN, 2), iv('N', MAN, 9, MAN, 15), iv('T', D, 5, MAN, 3)];
const { porClave } = R.repartir(ivs, plan({ A: { [D]: ['dia'] }, T: { [D]: ['dia', 'noche'] } }));
const total = ivs.reduce((s, x) => s + (x.fin - x.ini) / 1000, 0);
const repartido = [...porClave.values()].reduce((s, c) => s + c.viajeSeg + c.esperaSeg, 0);
const ok = Math.abs(total - repartido) < 1;
if (!ok) fallos++;
console.log((ok ? 'OK   ' : 'FALLA') + ' la suma de los turnos es todo lo trabajado (' + (total / 3600) + ' h)');

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
