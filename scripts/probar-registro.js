// ============================================================
// PROBAR: el registro diario de jornada (art. 18.9)
// ============================================================
//   node scripts/probar-registro.js
//
// resumenDelDia es puro: de los tramos de un dia saca inicio, fin, efectivo
// (estricto y total), descanso y auxiliares. Aqui se prueba sin base.
// El plazo de 5 dias laborables (f_sumar_dias_laborables) vive en SQL; su
// logica -saltar findes- se comprueba con el espejo de aqui.

const path = require('path');
const j = require(path.join(__dirname, '..', 'services', 'repo', 'jornada'));

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

const CATALOGO = new Map([
  ['has_order',      { supuesto_te: 'TE_A3', tipo: 'EFFECTIVE_WORK', cuenta: true,  condicionado: false, supuesto_sin: null }],
  ['waiting_orders', { supuesto_te: 'TE_A1', tipo: 'EFFECTIVE_WORK', cuenta: true,  condicionado: true,  supuesto_sin: 'TE_NO' }],
  ['busy',           { supuesto_te: null,    tipo: null,             cuenta: false, condicionado: false, supuesto_sin: null }],
  ['inactive',       { supuesto_te: null,    tipo: null,             cuenta: false, condicionado: false, supuesto_sin: null }],
]);
const H = h => Math.floor(Date.UTC(2026, 7, 20, h - 2) / 1000);

// Un dia: 08:00 servicio (2h), 10:00 espera (1h), 11:00 descanso (2h), 13:00 off.
const tramos = [
  { estado: 'has_order',      desde: H(8),  hasta: H(10), veh: 'v1', minutos: 120 },
  { estado: 'waiting_orders', desde: H(10), hasta: H(11), veh: 'v1', minutos: 60 },
  { estado: 'busy',           desde: H(11), hasta: H(13), veh: 'v1', minutos: 120 },
  { estado: 'inactive',       desde: H(13), hasta: H(13) + 3600, veh: 'v1', minutos: 60 },
];
const asientos = j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20' });

console.log('\n== El resumen del dia (sin area) ==');
let r = j.resumenDelDia({ tramos, catalogo: CATALOGO, asientos, conductorId: 7, dia: '2026-08-20',
  gate: () => false });
ok('inicio = primer tramo (08:00)', r.inicio === H(8));
ok('fin = ultimo tramo', r.fin === H(13) + 3600);
ok('efectivo estricto = 120 (solo has_order)', r.efectivoEstricto === 120, `(${r.efectivoEstricto})`);
ok('efectivo total = 180 (has_order + espera)', r.efectivoTotal === 180, `(${r.efectivoTotal})`);
ok('descanso = 120 (el busy)', r.descanso === 120, `(${r.descanso})`);
ok('aux = 20', r.aux === 20);
ok('tramos en el desglose = 4', r.tramos.length === 4);
ok('la espera sin area sale como TE_NO en el desglose',
   r.tramos.some(t => t.estado === 'waiting_orders' && t.supuesto === 'TE_NO'));

console.log('\n== Con area, la espera cuenta en la estricta ==');
r = j.resumenDelDia({ tramos, catalogo: CATALOGO, asientos:
  j.asientosDeDia({ tramos, catalogo: CATALOGO, conductorId: 7, dia: '2026-08-20', areaConfirmada: () => true }),
  conductorId: 7, dia: '2026-08-20', gate: () => true });
ok('estricta = total = 180', r.efectivoEstricto === 180 && r.efectivoTotal === 180, `(${r.efectivoEstricto}/${r.efectivoTotal})`);
ok('la espera sale como TE_A1', r.tramos.some(t => t.estado === 'waiting_orders' && t.supuesto === 'TE_A1'));

console.log('\n== Dia sin actividad: registro vacio ==');
r = j.resumenDelDia({ tramos: [{ estado: 'inactive', desde: H(8), hasta: H(9), veh: 'v1', minutos: 60 }],
  catalogo: CATALOGO, asientos: [], conductorId: 7, dia: '2026-08-20', gate: () => false });
ok('efectivo total = 0', r.efectivoTotal === 0);
ok('descanso = 0', r.descanso === 0);

// ── El plazo de 5 dias laborables (espejo de f_sumar_dias_laborables) ────────
console.log('\n== Plazo de 5 dias laborables (salta findes) ==');
function sumarLaborables(fecha, n) {
  const d = new Date(fecha.getTime());
  let quedan = n;
  while (quedan > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();               // 0=domingo, 6=sabado
    if (dow !== 0 && dow !== 6) quedan--;
  }
  return d;
}
// Lunes 2026-08-03 + 5 laborables = lunes 2026-08-10 (salta sab 8 y dom 9).
const lunes = new Date(Date.UTC(2026, 7, 3));
const mas5 = sumarLaborables(lunes, 5);
ok('lunes + 5 laborables = lunes siguiente', mas5.getUTCDate() === 10 && mas5.getUTCMonth() === 7,
   `(${mas5.toISOString().slice(0,10)})`);
// Jueves + 5 = jueves siguiente (cruza un finde).
const jueves = new Date(Date.UTC(2026, 7, 6));
const jmas5 = sumarLaborables(jueves, 5);
ok('jueves + 5 laborables = jueves siguiente', jmas5.getUTCDate() === 13,
   `(${jmas5.toISOString().slice(0,10)})`);

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nEl registro de jornada cuadra');
process.exitCode = mal ? 1 : 0;
