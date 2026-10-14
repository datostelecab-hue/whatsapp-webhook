// ============================================================
// EL SALDO DE VACACIONES, CON LAS REGLAS DE CAMILO (14/10/2026)
// ============================================================
//   + 0,0821 días por día natural desde el alta (o el 01/01/2025), sin las
//     suspensiones; la baja médica y la libranza sí generan
//   + 1 día por festivo trabajado MÁS de 6 horas
//   − vacaciones disfrutadas  − cada día de permiso retribuido
//
//   node scripts/comprobar-vacaciones-saldo.js
//
// No toca la base: la cuenta es una función pura (vacaciones.service._saldoDe)
// y el cálculo de las horas de los festivos se prueba con dobles.

const repo = require('../modules/Vacaciones/vacaciones.repo');
const nominas = require('../modules/Nominas/nominas.service');
const svc = require('../modules/Vacaciones/vacaciones.service');
const saldoDe = svc._saldoDe;

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

const HOY = '2026-10-14';
const F = (fecha, horas_at = '2026-10-01T00:00:00Z', nombre = 'Festivo') => ({ fecha, nombre, ambito: 'nacional', horas_at });
const H = obj => new Map(Object.entries(obj));
const vac = (desde, hasta) => ({ estado: 'vacaciones', desde, hasta, fila: '1' });
const perm = (desde, hasta) => ({ estado: 'permiso', desde, hasta, fila: '2' });
const susp = (desde, hasta, estado = 'suspendido') => ({ estado, desde, hasta, fila: '3' });

(async () => {
  // ── 1. Lo que se genera ──────────────────────────────────────────────────
  let s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY);
  igual('Alta el 13/07: 94 días naturales hasta hoy, incluido', s.diasNaturales, 94);
  igual('…× 0,0821 = 7,72 días', s.generadas, 7.72);
  igual('…se le calcula desde el alta', [s.inicio, s.desdeElAlta], ['2026-07-13', true]);

  s = saldoDe({ alta: '2023-11-13' }, [], [], new Map(), HOY);
  igual('Alta en 2023: se le calcula desde el 01/01/2025', [s.inicio, s.desdeElAlta, s.diasNaturales], ['2025-01-01', false, 652]);
  igual('…652 × 0,0821 = 53,53', s.generadas, 53.53);

  s = saldoDe({ alta: '2026-07-13' }, [susp('2026-08-01', '2026-08-10')], [], new Map(), HOY);
  igual('Diez días de suspensión no generan: 84 × 0,0821', [s.diasSuspension, s.generadas], [10, 6.9]);
  s = saldoDe({ alta: '2026-07-13' }, [susp('2026-10-10', null, 'suspension_permiso')], [], new Map(), HOY);
  igual('Una suspensión por retirada del permiso, abierta: no genera hasta hoy (5 días)', s.diasSuspension, 5);
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-08-01', hasta: '2026-09-30' }], [], new Map(), HOY);
  igual('La baja médica SÍ genera', s.generadas, 7.72);

  // ── 2. Lo que resta ──────────────────────────────────────────────────────
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-08-01', '2026-08-15')], [], new Map(), HOY);
  igual('Vacaciones del 01/08 al 15/08: −15', [s.disfrutadas, s.saldo], [15, -7.28]);
  igual('…en negativo, con su signo', s.saldo < 0, true);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-10-15', '2026-10-17')], [], new Map(), HOY);
  igual('Vacaciones de mañana en adelante: no tocan el saldo de hoy', [s.disfrutadas, s.programadas, s.saldo], [0, 3, 7.72]);
  igual('…pero sí lo que quedará', s.saldoTras, 4.72);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-10-10', '2026-10-20')], [], new Map(), HOY);
  igual('Vacaciones que cruzan hoy: 5 disfrutados (10–14) y 6 programados', [s.disfrutadas, s.programadas], [5, 6]);
  igual('…y está de vacaciones hasta el 20', s.deVacacionesHasta, '2026-10-20');
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-03-01', '2026-03-10')], [], new Map(), HOY);
  igual('Vacaciones de antes de su alta (otro contrato): no cuentan', [s.disfrutadas, s.detalle.vacaciones.length], [0, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-07-10', '2026-07-15')], [], new Map(), HOY);
  igual('Unas que empiezan antes del alta: solo cuentan los días desde el alta (3)', s.disfrutadas, 3);
  s = saldoDe({ alta: '2026-07-13' }, [perm('2026-09-01', '2026-09-01'), perm('2026-10-20', '2026-10-21')], [], new Map(), HOY);
  igual('Un día de permiso pasado resta 1 entero; los de mañana van aparte', [s.permisos, s.permisosProgramados, s.saldo, s.saldoTras], [1, 2, 6.72, 4.72]);
  igual('…y el permiso sí genera su día natural', s.generadas, 7.72);

  // ── 3. Los festivos ──────────────────────────────────────────────────────
  const cal = [F('2025-05-01', null), F('2025-12-25'), F('2026-08-15'), F('2026-10-12', null), F('2026-10-14', null), F('2026-07-01')];
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-08-15': 7 * 3600 }), HOY);
  igual('Festivos de su periodo: los de antes del alta no entran', s.detalle.festivos.map(f => f.fecha), ['2026-08-15', '2026-10-12', '2026-10-14']);
  igual('El 15/08 trabajó 7 h: +1; el 12/10 aún se calcula; el de hoy no ha terminado',
    s.detalle.festivos.map(f => f.estado), ['suma', 'pendiente', 'hoy']);
  igual('…suma 1 día al saldo', [s.festivosSuman, s.saldo], [1, 8.72]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-08-15': 6 * 3600 }), HOY);
  igual('Seis horas justas NO suman (tiene que ser más de 6)', [s.detalle.festivos[0].estado, s.festivosSuman], ['no-suma', 0]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-08-15': 6 * 3600 + 1 }), HOY);
  igual('Un segundo más, sí', s.festivosSuman, 1);
  s = saldoDe({ alta: '2023-01-01' }, [], cal, H({ '2025-12-25': 8 * 3600 }), HOY);
  igual('Uno de antes de junio de 2025 sin horas: sin datos, y no suma', [s.detalle.festivos[0].estado, s.festivosSinDatos], ['sin-datos', 1]);
  igual('…el 25/12/2025 sí suma (horas de BOLT)', s.detalle.festivos.find(f => f.fecha === '2025-12-25').estado, 'suma');
  s = saldoDe({ alta: '2026-07-13' }, [], cal, new Map(), HOY);
  igual('Un festivo con horas calculadas y sin fila suya: no trabajó, no suma', s.detalle.festivos[0].estado, 'no-suma');

  // ── 4. Todo junto ────────────────────────────────────────────────────────
  s = saldoDe({ alta: '2026-07-13' },
    [vac('2026-08-01', '2026-08-05'), perm('2026-09-01', '2026-09-01'), susp('2026-09-10', '2026-09-11'), vac('2026-10-20', '2026-10-22')],
    cal, H({ '2026-08-15': 9 * 3600 }), HOY);
  igual('92 días que generan (7,55) + 1 festivo − 5 disfrutadas − 1 permiso = 2,55',
    [s.diasQueGeneran, s.generadas, s.festivosSuman, s.disfrutadas, s.permisos, s.saldo], [92, 7.55, 1, 5, 1, 2.55]);
  igual('…y tras las vacaciones del 20 al 22, −0,45', s.saldoTras, -0.45);

  // ── 5. Las horas de los festivos ─────────────────────────────────────────
  const guardado = [];
  repo.festivosPorSellar = async (desde, hoy, margen) => { guardado.push(['pide', desde, hoy, margen]); return ['2026-08-15']; };
  nominas.horasDelDia = async dia => new Map([[12, 7 * 3600], [13, 3600]]);
  repo.guardarHorasFestivo = async (fecha, horas, fuente) => { guardado.push(['guarda', fecha, [...horas.entries()], fuente]); return horas.size; };
  const r = await svc.sellarFestivos({ hoy: HOY });
  igual('Pide los festivos desde el 01/07/2026, con 4 días de margen', guardado[0], ['pide', '2026-07-01', HOY, 4]);
  igual('Guarda las horas de la nómina de ese día, como del sistema', guardado[1], ['guarda', '2026-08-15', [[12, 25200], [13, 3600]], 'nucleo']);
  igual('…y dice cuántos pasan de 6 h', r.hechos, [{ fecha: '2026-08-15', personas: 2, masDe6: 1 }]);
  repo.festivosPorSellar = async () => { const e = new Error('no existe'); e.code = '42P01'; throw e; };
  igual('Sin la migración aplicada, el cron no revienta', await svc.sellarFestivos({ hoy: HOY }), { sinTabla: true, hechos: [] });

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
