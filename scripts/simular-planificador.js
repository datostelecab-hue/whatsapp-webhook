// ============================================================
// SIMULACION del planificador (logica, sin base de datos)
// ============================================================
//   node scripts/simular-planificador.js
//
// Replica las reglas que implementan f_cobertura (db/56/57/58), el filtro del
// banquillo y el auto-corte por fecha (colocar). NO toca la base: prueba que la
// LOGICA hace lo que Trafico espera, con el caso real (vacaciones desde 21/08).

let mal = 0;
const ok = (t, c) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t); };
const isodow = iso => { const d = new Date(iso + 'T00:00:00'); return (d.getDay() + 6) % 7 + 1; }; // 1=Lun..7=Dom
const DIAS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const entre = (d, a, b) => d >= a && d <= b;

// ── La regla de f_cobertura para un FIJO (db/56/57/58) ──────────────────────
// Cubre si: (su coche no descansa ese dia  O  es su dia de reposicion)  Y  no es
// su libranza excepcional  Y  no esta AUSENTE ese dia (cualquier es_ausencia).
function cubreFijo(iso, { descansoCoche, excepcional = null, ausencias = [] }) {
  const wd = isodow(iso);
  const descansaCoche = descansoCoche.includes(wd);
  const repone = excepcional && excepcional.trabaja === iso;
  const libraExc = excepcional && excepcional.libra === iso;
  const ausente = ausencias.some(a => a.esAusencia && entre(iso, a.desde, a.hasta || '9999-12-31'));
  return !!((!descansaCoche || repone) && !libraExc && !ausente);
}

// ── El caso real: MENENDEZ, fijo dia de 2514LNF (bloque L/M), de VACACIONES ──
console.log('\n== MENENDEZ (fijo día de 2514LNF, bloque L/M) de vacaciones 21/08–25/08 ==');
const menendez = { descansoCoche: [1, 2], ausencias: [{ estado: 'vacaciones', esAusencia: true, desde: '2026-08-21', hasta: '2026-08-25' }] };
const semana = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30']; // Lun..Dom
console.log('   día        cubre?   (por qué)');
for (const d of semana) {
  const c = cubreFijo(d, menendez);
  const wd = isodow(d);
  const libra = menendez.descansoCoche.includes(wd);
  const vac = entre(d, '2026-08-21', '2026-08-25');
  const motivo = libra ? 'descansa (bloque L/M)' : vac ? 'VACACIONES → hueco' : 'trabaja';
  console.log(`   ${DIAS[wd]} ${d}  ${c ? 'SÍ    ' : 'no    '}  ${motivo}`);
}
// Comprobaciones clave:
ok('lunes 24: no cubre (descansa por bloque)', cubreFijo('2026-08-24', menendez) === false);
ok('martes 25: no cubre (descansa por bloque)', cubreFijo('2026-08-25', menendez) === false);
ok('miércoles 26: SÍ cubre (ya volvió, día de trabajo)', cubreFijo('2026-08-26', menendez) === true);
// Un dia de trabajo DENTRO de las vacaciones = hueco. Metemos una ausencia que
// pise un miercoles para verlo:
const menVacMiercoles = { descansoCoche: [1, 2], ausencias: [{ estado: 'vacaciones', esAusencia: true, desde: '2026-08-24', hasta: '2026-08-28' }] };
ok('miércoles 26 EN vacaciones: NO cubre (hueco)', cubreFijo('2026-08-26', menVacMiercoles) === false);
ok('lunes 31 (fuera de vacaciones): descansa por bloque, no cubre', cubreFijo('2026-08-31', menVacMiercoles) === false);
ok('miércoles 2/9 (ya volvió): SÍ cubre', cubreFijo('2026-09-02', menVacMiercoles) === true);

// ── El banquillo: disponibles + ausentes con vuelta prevista ────────────────
console.log('\n== Banquillo: quién aparece (sin plaza) ==');
const enBanquillo = p => !p.plazas && (!p.ausente || p.finPrevisible);
const casos = [
  { nombre: 'Pendiente de asignar', plazas: 0, ausente: false, finPrevisible: false, esperado: true },
  { nombre: 'De vacaciones (vuelve el 26)', plazas: 0, ausente: true, finPrevisible: true, esperado: true },
  { nombre: 'Permiso retribuido', plazas: 0, ausente: true, finPrevisible: true, esperado: true },
  { nombre: 'Baja médica (indefinida)', plazas: 0, ausente: true, finPrevisible: false, esperado: false },
  { nombre: 'Suspendido', plazas: 0, ausente: true, finPrevisible: false, esperado: false },
  { nombre: 'Ya colocado en una plaza', plazas: 1, ausente: false, finPrevisible: false, esperado: false },
];
for (const c of casos) {
  const r = enBanquillo(c);
  ok(`${c.nombre} → ${c.esperado ? 'en banquillo' : 'fuera'}`, r === c.esperado);
}

// ── El auto-corte por fecha (colocar): A entra hasta que llega B ────────────
console.log('\n== Máquina del tiempo: coloco a A el 1/9; B ya entra el 6/9 ==');
const pad2 = n => String(n).padStart(2, '0');
const vispera = iso => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function autoCorte(desdeA, hastaA, desdeFuturoB) {
  let hasta = hastaA || null;
  if (desdeFuturoB && desdeFuturoB > desdeA) {
    const tope = vispera(desdeFuturoB);
    if (!hasta || hasta > tope) hasta = tope;
  }
  return hasta;
}
const hastaA = autoCorte('2026-09-01', null, '2026-09-06');
ok('A (desde 1/9, sin hasta) se corta el 5/9 (víspera de B)', hastaA === '2026-09-05');
ok('sin ocupante futuro, A queda indefinido', autoCorte('2026-09-01', null, null) === null);
ok('si A ya tenía un hasta antes de B, se respeta', autoCorte('2026-09-01', '2026-09-03', '2026-09-06') === '2026-09-03');
console.log(`   → A: 1/9 → ${hastaA} · B: 6/9 → indefinido. Del 1 al 5 sale A; del 6, B.`);

console.log(mal ? `\n${mal} COMPROBACIÓN(ES) MAL` : '\nLa lógica del planificador cuadra');
process.exitCode = mal ? 1 : 0;
