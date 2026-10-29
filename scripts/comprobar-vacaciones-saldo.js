// ============================================================
// EL SALDO DE VACACIONES, CON LAS REGLAS DE CAMILO (14/10/2026)
// ============================================================
//   + 0,0821 días por día natural desde el alta (o el 01/01/2026; hasta el
//     19/10/2026 era el 01/01/2025), sin las
//     suspensiones; la baja médica y la libranza sí generan
//   + 1 día por festivo trabajado MÁS de 6 horas
//   − vacaciones disfrutadas (ningún permiso resta)
//
// Y LOS ASUNTOS PROPIOS, UN BANCO APARTE (29/10/2026): + 2 días por año natural
// desde que se le calcula, − cada día en la situación «Asuntos propios»
// (db/225; o un permiso de los de antes con ese tipo). No tocan las vacaciones.
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
const perm = (desde, hasta, tipo = 'PR_ASUNTOS_PROPIOS') => ({ estado: 'permiso', desde, hasta, fila: '2', leave_type_code: tipo });
const susp = (desde, hasta, estado = 'suspendido') => ({ estado, desde, hasta, fila: '3' });
const ap = (desde, hasta) => ({ estado: 'asuntos_propios', desde, hasta, fila: '4', leave_type_code: 'PR_ASUNTOS_PROPIOS' });

(async () => {
  // ── 1. Lo que se genera ──────────────────────────────────────────────────
  let s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY);
  igual('Alta el 13/07: 94 días naturales hasta hoy, incluido', s.diasNaturales, 94);
  igual('…× 0,0821 = 7,72 días', s.generadas, 7.72);
  igual('…se le calcula desde el alta', [s.inicio, s.desdeElAlta], ['2026-07-13', true]);

  s = saldoDe({ alta: '2023-11-13' }, [], [], new Map(), HOY);
  // 19/10/2026, Camilo: «Reinicia las vacaciones desde el 1 … que empiecen a contar desde este año».
  igual('Alta en 2023: se le calcula desde el 01/01/2026', [s.inicio, s.desdeElAlta, s.diasNaturales], ['2026-01-01', false, 287]);
  igual('…287 × 0,0821 = 23,56', s.generadas, 23.56);
  s = saldoDe({ alta: '2023-11-13' }, [vac('2025-08-01', '2025-08-20'), vac('2025-12-28', '2026-01-03')], [], new Map(), HOY);
  igual('Las vacaciones de 2025 no restan; las que cruzan el 1 de enero, solo sus días de 2026 (3)',
    [s.disfrutadas, s.detalle.vacaciones.length], [3, 1]);

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
  s = saldoDe({ alta: '2026-07-13' }, [perm('2026-08-23', '2026-08-31', null), perm('2026-10-08', '2026-11-08', 'PR_MATRIMONIO')], [], new Map(), HOY);
  igual('Un permiso sin tipo y uno de matrimonio: no restan nada, ni hoy ni después', [s.saldo, s.saldoTras], [7.72, 7.72]);
  igual('…pero se ven en la ficha, con sus días', s.detalle.permisos.map(p => [p.dentro, p.programados]), [[9, 0], [7, 25]]);

  // ── 2b. Los asuntos propios: su banco, aparte (29/10/2026) ─────────────────
  // Camilo: «que no reste a las vacaciones, él se restará solo».
  s = saldoDe({ alta: '2026-07-13' }, [ap('2026-09-01', '2026-09-01'), ap('2026-10-20', '2026-10-20')], [], new Map(), HOY);
  igual('Asuntos propios: no tocan el saldo de vacaciones', [s.saldo, s.saldoTras, s.generadas], [7.72, 7.72, 7.72]);
  igual('…su banco: 2 este año, 1 cogido, 1 programado',
    [s.asuntosPropios.generados, s.asuntosPropios.usados, s.asuntosPropios.programados, s.asuntosPropios.saldo, s.asuntosPropios.saldoTras], [2, 1, 1, 1, 0]);
  igual('…y se ven aparte en la ficha, no entre los permisos', [s.detalle.asuntos.length, s.detalle.permisos.length], [2, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [perm('2026-09-01', '2026-09-01')], [], new Map(), HOY);
  igual('Un permiso de los de antes con el tipo de asuntos propios cuenta igual (si db/225 aún no lo ha pasado)',
    [s.saldo, s.asuntosPropios.usados, s.detalle.asuntos.length], [7.72, 1, 1]);
  s = saldoDe({ alta: '2023-11-13' }, [], [], new Map(), HOY);
  igual('Quien entró antes: 2 días en 2026, enteros', [s.asuntosPropios.anios, s.asuntosPropios.generados, s.asuntosPropios.desde], [1, 2, '2026']);
  s = saldoDe({ alta: '2026-10-01' }, [], [], new Map(), HOY);
  igual('Quien entró en octubre: también 2 (sin prorratear)', s.asuntosPropios.generados, 2);
  s = saldoDe({ alta: '2026-07-13' }, [ap('2026-09-01', '2026-09-01')], [], new Map(), '2027-03-01');
  igual('En 2027 suma otros 2 encima de lo que no cogió: 4 − 1 = 3',
    [s.asuntosPropios.anios, s.asuntosPropios.generados, s.asuntosPropios.saldo], [2, 4, 3]);
  s = saldoDe({ alta: '2026-07-13' }, [ap('2026-08-01', '2026-08-03')], [], new Map(), HOY);
  igual('Más días de los que tiene: el banco queda en negativo', s.asuntosPropios.saldo, -1);

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
  igual('Los festivos de 2025 ya no entran (todo empieza el 01/01/2026)',
    [s.detalle.festivos.some(f => f.fecha < '2026-01-01'), s.festivosSinDatos, s.festivosSuman], [false, 0, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, new Map(), HOY);
  igual('Un festivo con horas calculadas y sin fila suya: no trabajó, no suma', s.detalle.festivos[0].estado, 'no-suma');

  // ── 4. Todo junto ────────────────────────────────────────────────────────
  s = saldoDe({ alta: '2026-07-13' },
    [vac('2026-08-01', '2026-08-05'), ap('2026-09-01', '2026-09-01'), susp('2026-09-10', '2026-09-11'), vac('2026-10-20', '2026-10-22')],
    cal, H({ '2026-08-15': 9 * 3600 }), HOY);
  igual('92 días que generan (7,55) + 1 festivo − 5 disfrutadas = 3,55 (el día de asuntos propios no resta)',
    [s.diasQueGeneran, s.generadas, s.festivosSuman, s.disfrutadas, s.saldo], [92, 7.55, 1, 5, 3.55]);
  igual('…y tras las vacaciones del 20 al 22, 0,55', s.saldoTras, 0.55);
  igual('…y le queda 1 día de asuntos propios', s.asuntosPropios.saldo, 1);

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

  // ── 6. Cambiar unas vacaciones aprobadas: solo a futuro (16/10/2026) ──────
  const val = svc._validarCambio;
  const prueba = (t, d) => { try { return val(t, d, HOY); } catch (e) { return e.message; } };
  const fut = { desde: '2026-10-20', hasta: '2026-10-24' };
  const emp = { desde: '2026-10-12', hasta: '2026-10-18' };
  igual('Futuras: se mueven a partir de mañana', prueba(fut, { desde: '2026-10-15', hasta: '2026-10-19' }),
    { desde: '2026-10-15', hasta: '2026-10-19' });
  igual('Futuras: no a hoy', /como pronto, desde mañana \(15\/10\/2026\)/.test(prueba(fut, { desde: HOY, hasta: '2026-10-19' })), true);
  igual('Empezadas: el primer día no se mueve', /el primer día no se puede mover/.test(prueba(emp, { desde: '2026-10-13', hasta: '2026-10-18' })), true);
  igual('Empezadas: la vuelta se adelanta hasta hoy', prueba(emp, { hasta: HOY }), { desde: '2026-10-12', hasta: HOY });
  igual('Empezadas: no antes de hoy', /Como pronto pueden terminar hoy/.test(prueba(emp, { hasta: '2026-10-13' })), true);
  igual('Empezadas: la vuelta se retrasa', prueba(emp, { hasta: '2026-10-30' }), { desde: '2026-10-12', hasta: '2026-10-30' });
  igual('Pasadas: no se tocan', /ya pasaron/.test(prueba({ desde: '2026-10-01', hasta: '2026-10-13' }, { hasta: '2026-10-20' })), true);
  igual('Las que terminan hoy aún se pueden alargar', prueba({ desde: '2026-10-10', hasta: HOY }, { hasta: '2026-10-16' }),
    { desde: '2026-10-10', hasta: '2026-10-16' });
  igual('La vuelta no antes que el primer día', /no puede ser antes/.test(prueba(fut, { desde: '2026-10-22', hasta: '2026-10-21' })), true);
  // Borrar (Plantilla): solo las que aún no han empezado
  const borra = t => { try { require('../services/vacacionesAFuturo').validarBorrado(t, HOY); return 'se borra'; } catch (e) { return e.message; } };
  igual('Borrar: las futuras sí', borra(fut), 'se borra');
  igual('Borrar: las empezadas no', /ya empezaron el 12\/10\/2026/.test(borra(emp)), true);
  igual('Borrar: las de hoy tampoco', /ya empezaron/.test(borra({ desde: HOY, hasta: '2026-10-20' })), true);
  igual('Borrar: las pasadas no', /ya pasaron/.test(borra({ desde: '2026-10-01', hasta: '2026-10-05' })), true);
  const conTicket = saldoDe({ alta: '2026-01-01' },
    [{ ...vac('2026-10-12', '2026-10-18'), ticket_id: '5', ticket_codigo: 'RH-1' }, vac('2026-10-01', '2026-10-05')], cal, H({}), HOY);
  igual('La ficha dice cuáles se pueden cambiar y de qué ticket salieron',
    conTicket.detalle.vacaciones.map(v => [v.desde, v.editable, v.empezadas, v.ticket && v.ticket.codigo]),
    [['2026-10-12', true, true, 'RH-1'], ['2026-10-01', false, true, null]]);

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
