// ============================================================
// LAS LIBRANZAS EN LAS VACACIONES — qué le tocaba cada día
// ============================================================
//   node scripts/comprobar-vacaciones-libranzas.js
//
// 06/11/2026, Camilo: «si pido 18 días de vacaciones, me tiene que contar solo
// días laborales para mí, se saltan los días de libranza … si se planifica un
// fijo para L M eso se va a ver siempre hasta que se cambie en el planificador».
// La regla, en modules/Vacaciones/libranzas.js (la de f_cobertura sin apartar a
// quien está ausente). No toca la base.
const L = require('../modules/Vacaciones/libranzas');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const INICIO = '2026-09-03';
const semana = (plan, desde) => {
  const out = [];
  for (let i = 0; i < 7; i++) { const d = new Date(Date.parse(desde + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10); const x = L.elDia(plan, d, INICIO); out.push(x.trabaja === null ? '?' : x.trabaja ? 'T' : 'L'); }
  return out.join('');
};
const fijo = (desde, hasta, vehiculo = '25', turno = 1) => ({ desde, hasta, rol: 'FIJO', turno_id: turno, vehiculo_id: vehiculo, dias: [] });
const ct = (desde, hasta, dias) => ({ desde, hasta, rol: 'CT', turno_id: 1, vehiculo_id: '25', dias });
const plan = (asignaciones, descansos = {}, ex = {}) => ({
  asignaciones,
  descansos: new Map(Object.entries(descansos)),
  libra: new Set(ex.libra || []), trabaja: new Set(ex.trabaja || []),
});
const desc = (desde, hasta, dias, turno = null) => ({ desde, hasta, dias, turno_id: turno });

// El lunes 16/11/2026.
const LUN = '2026-11-16';
igual('ISO: el 16/11/2026 es lunes (1) y el 22 domingo (7)', [L.isodow(LUN), L.isodow('2026-11-22')], [1, 7]);

// 1. Un fijo libra el descanso de su coche.
let p = plan([fijo('2026-09-30', null)], { 25: [desc('2026-09-03', null, [3, 4])] });
igual('Fijo con el coche que descansa X y J: TTLLTTT', semana(p, LUN), 'TTLLTTT');
igual('…y se mantiene: en marzo de 2027, igual', semana(p, '2027-03-01'), 'TTLLTTT');
// 2. Su descanso propio (coche sin correturnos, db/203) y el de otro turno no le toca.
p = plan([fijo('2026-09-30', null, '25', 2)], { 25: [desc('2026-09-03', null, [1], 1), desc('2026-09-03', null, [6, 7], 2)] });
igual('Fijo de noche: libra el descanso de SU turno (S y D), no el del de día (L)', semana(p, LUN), 'TTTTTLL');
// 3. Un correturnos trabaja los días que le pusieron.
p = plan([ct('2026-09-30', null, [3, 4, 5, 6])]);
igual('Correturnos de X a S: LLTTTTL', semana(p, LUN), 'LLTTTTL');
// 4. Con dos plazas a la vez trabaja si alguna lo dice.
p = plan([fijo('2026-09-30', null), ct('2026-10-01', null, [3])], { 25: [desc('2026-09-03', null, [3, 4])] });
igual('Fijo (libra X y J) y CT el miércoles: trabaja el miércoles', semana(p, LUN), 'TTTLTTT');
// 5. La libranza excepcional manda.
p = plan([fijo('2026-09-30', null)], { 25: [desc('2026-09-03', null, [3, 4])] }, { libra: ['2026-11-16'], trabaja: ['2026-11-18'] });
igual('Excepcional: libra el lunes 16 y trabaja el miércoles 18', semana(p, LUN), 'LTTLTTT');
// 6. Se le quitó la plaza (o se acabó): la última que tuvo se mantiene.
p = plan([fijo('2026-09-03', '2026-10-31', '60')], { 60: [desc('2026-09-03', null, [1, 2])] });
const x = L.elDia(p, '2026-11-16', INICIO);
igual('Sin plaza ese día: la última que tuvo (libra L y M)', [semana(p, LUN), x.por], ['LLTTTTT', 'su-ultima-plaza']);
// 7. Cambio de coche a mitad: cada día con el suyo.
p = plan([fijo('2026-09-03', '2026-11-17', '60'), fijo('2026-11-18', null, '25')],
  { 60: [desc('2026-09-03', null, [1, 2])], 25: [desc('2026-09-03', null, [6, 7])] });
igual('Cambia de coche el miércoles: L y M libra con el viejo, S y D con el nuevo', semana(p, LUN), 'LLTTTLL');
// 8. El descanso del coche cambió: cada día el que valía.
p = plan([fijo('2026-09-03', null)], { 25: [desc('2026-09-03', '2026-11-18', [1]), desc('2026-11-19', null, [7])] });
igual('El coche descansaba el lunes hasta el 18 y desde el 19 el domingo', semana(p, LUN), 'LTTTTTL');
// 9. Lo que no se sabe.
p = plan([fijo('2026-09-30', null)], { 25: [desc('2026-09-03', null, [3, 4])] });
igual('Antes del planificador (03/09/2026): no se sabe', [L.elDia(p, '2026-08-12', INICIO).trabaja, L.elDia(p, '2026-08-12', INICIO).por], [null, 'antes-del-cuadrante']);
igual('Desde el 03/09 y antes de su primera plaza: la primera', L.elDia(p, '2026-09-10', INICIO).trabaja, false);
igual('Quien nunca ha tenido plaza: no se sabe', L.elDia(plan([]), LUN, INICIO), { trabaja: null, por: 'sin-plaza' });
igual('Un día que no se sabe cuenta como vacaciones; uno que libra, no', [L.cuenta({ trabaja: null }), L.cuenta({ trabaja: false }), L.cuenta(null)], [true, false, true]);

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
