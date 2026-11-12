// ============================================================
// EL SALDO DE VACACIONES, CON LAS REGLAS DE CAMILO (14/10/2026)
// ============================================================
//   + 0,084 días por día LABORADO —uno con MÁS de 4 h, una J aprobada o un día
//     de baja médica, libre o no— con un TOPE de 1,85 al mes (12/11/2026; del
//     06/11 al 12/11, 0,05882 sin tope; antes, 0,0821 por día natural), desde
//     el alta (o el 01/01/2026; hasta el 19/10/2026 era el 01/01/2025)
//   + 1 día por festivo trabajado MÁS de 6 horas EN SU JORNADA (su turno de día
//     más su turno de noche de esa fecha; fuera del tope)
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
const reparto = require('../services/flotaViva/repartoTurnos');
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
// Días trabajados: de `desde` a `hasta`, cada uno con `horas` (como la bitácora).
const sig = d => new Date(Date.parse(d + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
function L(desde, hasta, horas, m = new Map()) { for (let d = desde; d <= hasta; d = sig(d)) m.set(d, Math.round(horas * 3600)); return m; }

(async () => {
  // ── 1. Lo que se genera: los días laborados (06/11/2026) ─────────────────
  // Camilo: «0,084 Dias generan por dia laborable completado. Con un maximo de 1.85 dias al mes».
  let s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-07-13', '2026-08-31', 8));
  igual('Alta el 13/07, 50 días de 8 h: 50 laborados', s.diasLaborados, 50);
  igual('…julio 19 × 0,084 = 1,60 y agosto 31 × 0,084 = 2,60, que se queda en el tope de 1,85: 3,45', s.generadas, 3.45);
  igual('…y el mes lo dice: lo que daría sin tope y que llegó al tope',
    s.detalle.meses.slice(0, 2).map(m => [m.mes, m.sinTope, m.generadas, m.tope]), [['2026-07', 1.6, 1.6, false], ['2026-08', 2.6, 1.85, true]]);
  igual('…se le calcula desde el alta', [s.inicio, s.desdeElAlta], ['2026-07-13', true]);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-09-01', '2026-09-10', 4));
  igual('Cuatro horas justas NO suman (tiene que ser más de 4)', [s.diasLaborados, s.generadas], [0, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-09-01', '2026-09-10', 4 + 1 / 3600));
  igual('Un segundo más, sí: 10 × 0,084 = 0,84', [s.diasLaborados, s.generadas], [10, 0.84]);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-07-01', '2026-07-20', 8));
  igual('Los días de antes de su alta no cuentan (solo del 13 al 20: 8)', s.diasLaborados, 8);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-10-14', '2026-10-20', 8));
  igual('Hoy sí cuenta, lo de después no', s.diasLaborados, 1);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY);
  igual('Sin días trabajados no genera nada, aunque lleve 94 días de alta', [s.diasNaturales, s.diasLaborados, s.generadas], [94, 0, 0]);
  // 06/11/2026, Camilo: «las bajas médicas y días justificados sí suman también, las libranzas y ausencias injustificadas no».
  // Con su plaza, y trabajando todos los días (para no mezclarlo con las libranzas).
  const todoTrabaja = () => ({ trabaja: true, por: 'plaza' });
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-08-01', hasta: '2026-09-30' }], [], new Map(), HOY, L('2026-07-13', '2026-07-31', 8), todoTrabaja);
  igual('La baja médica SÍ genera: 19 trabajados (1,60) + agosto y septiembre de baja (en el tope, 1,85 cada uno) = 5,30',
    [s.diasLaborados, s.diasBaja, s.diasQueGeneran, s.generadas], [19, 61, 80, 5.3]);
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, L('2026-09-01', '2026-09-03', 2), null, new Set(['2026-09-01', '2026-09-02', '2026-10-30']));
  igual('Un día con una J aprobada genera aunque trabajara 2 h; la J de mañana no', [s.diasJustificados, s.diasQueGeneran, s.generadas], [2, 2, 0.17]);
  igual('…el día de 2 h sin J se queda corto; y salen todos los meses desde el alta, aunque estén vacíos',
    s.detalle.meses.map(m => [m.mes, m.laborados, m.justificados, m.cortos]),
    [['2026-07', 0, 0, 0], ['2026-08', 0, 0, 0], ['2026-09', 0, 2, 1], ['2026-10', 0, 0, 0]]);
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-09-01', hasta: '2026-09-02' }], [], new Map(), HOY,
    L('2026-09-01', '2026-09-01', 9), todoTrabaja, new Set(['2026-09-01']));
  igual('Cada día cuenta una vez: trabajó, con J y de baja el 01/09 es un día; el 02/09, de baja', [s.diasLaborados, s.diasJustificados, s.diasBaja, s.diasQueGeneran], [1, 0, 1, 2]);
  // Con su plan: libra los miércoles y jueves.
  const libraXJ = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return { trabaja: w !== 3 && w !== 4, por: 'plaza' }; };

  // LA BAJA MÉDICA: CADA DÍA GENERA, también los que habría librado; lo frena
  // el tope del mes (12/11/2026, Camilo: «ahí es que se aplica más que todo el
  // límite de 1,85 días … ya que no tiene días de libranza, y cada B equivale a
  // 8 horas»). Antes la libranza no sumaba y, sin plaza, cada día valía 5/7.
  const sinPlaza = () => ({ trabaja: null, por: 'sin-plaza' });
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-09-01', hasta: '2026-09-14' }], [], new Map(), HOY, new Map(), sinPlaza);
  igual('Dos semanas de baja sin plaza: los 14 días, 14 × 0,084 = 1,18', [s.diasBaja, s.diasBajaSupuestos, s.diasQueGeneran, s.generadas], [14, 0, 14, 1.18]);
  igual('…y en su mes, como baja', s.detalle.meses.filter(m => m.mes === '2026-09').map(m => [m.bajas, m.generan, m.generadas]), [[14, 14, 1.18]]);
  s = saldoDe({ alta: '2023-11-13' }, [{ estado: 'baja_medica', desde: '2025-11-01', hasta: null }], [], new Map(), '2026-11-06', new Map(), sinPlaza);
  igual('Todo 2026 de baja (310 días): manda el tope, 10 meses × 1,85 + 6 días de noviembre × 0,084 = 19,00',
    [s.diasBaja, s.diasQueGeneran, s.generadas, s.detalle.meses.filter(m => m.tope).length], [310, 310, 19, 10]);
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-09-01', hasta: '2026-09-14' }], [], new Map(), HOY, new Map(), d => ({ trabaja: null, por: 'antes-del-cuadrante' }));
  igual('Antes del planificador, igual: los 14 días', [s.diasBajaSupuestos, s.diasQueGeneran], [0, 14]);
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-08-01', hasta: '2026-10-01' }], [], new Map(), HOY, new Map(), sinPlaza);
  igual('Dos meses de baja en el tope (1,85 cada uno) y el 01/10, 0,084: 3,78', [s.diasBaja, s.diasQueGeneran, s.generadas], [62, 62, 3.78]);
  // Libra X y J, y la baja pisa esos días: cuentan igual.
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-09-01', hasta: '2026-09-07' }], [], new Map(), HOY,
    L('2026-09-01', '2026-09-02', 8), sinPlaza, new Set(['2026-09-03']));
  igual('Lo que trabajó o justificó cuenta como tal y el resto de la baja como baja: 2 + 1 + 4 = 7',
    [s.diasLaborados, s.diasJustificados, s.diasBaja, s.diasQueGeneran], [2, 1, 4, 7]);
  s = saldoDe({ alta: '2026-07-13' }, [{ estado: 'baja_medica', desde: '2026-09-01', hasta: '2026-09-14' }], [], new Map(), HOY, new Map(), libraXJ);
  igual('Una baja de 14 días que pisa 4 libranzas: genera los 14 (la baja no tiene libranzas)', [s.diasBaja, s.generadas], [14, 1.18]);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-09-14', '2026-09-27'), vac('2026-11-02', '2026-11-08')], [], new Map(), HOY, new Map(), libraXJ);
  igual('Vacaciones del 14 al 27/09 con libranza X y J: 14 naturales, 4 libranzas, cuentan 10', [s.detalle.vacaciones[0].dias, s.detalle.vacaciones[0].libranzas, s.disfrutadas], [14, 4, 10]);
  igual('…y las de noviembre, 7 naturales menos sus 2 libranzas futuras: 5 programadas', [s.programadas, s.detalle.vacaciones[1].libranzas], [5, 2]);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-09-14', '2026-09-27')], [], new Map(), HOY, new Map(), d => ({ trabaja: null, por: 'antes-del-cuadrante' }));
  igual('Un día sin cuadrante (no se sabe si libraba) cuenta, y se dice', [s.disfrutadas, s.detalle.vacaciones[0].sinCuadrante], [14, 14]);

  s = saldoDe({ alta: '2023-11-13' }, [], [], new Map(), HOY, L('2025-12-01', '2026-01-31', 8));
  // 19/10/2026, Camilo: «Reinicia las vacaciones desde el 1 … que empiecen a contar desde este año».
  igual('Alta en 2023: se le calcula desde el 01/01/2026', [s.inicio, s.desdeElAlta, s.diasNaturales], ['2026-01-01', false, 287]);
  igual('…y los días de 2025 no cuentan: 31 de enero (2,60, en el tope de 1,85)', [s.diasLaborados, s.generadas], [31, 1.85]);
  s = saldoDe({ alta: '2023-11-13' }, [vac('2025-08-01', '2025-08-20'), vac('2025-12-28', '2026-01-03')], [], new Map(), HOY);
  // 12/11/2026, Camilo: las que empezaron en 2025 y acaban en 2026 tampoco
  // restan: «empezó en 2025, que le reste 0». Hasta entonces restaban sus días de 2026.
  igual('Las vacaciones de 2025 no restan, tampoco las que cruzan el 1 de enero (salen a 0, y se dice por qué)',
    [s.disfrutadas, s.detalle.vacaciones.length, s.detalle.vacaciones[0].disfrutados, s.detalle.vacaciones[0].deAntes], [0, 1, 0, true]);
  s = saldoDe({ alta: '2023-11-13' }, [vac('2026-01-01', '2026-01-03')], [], new Map(), HOY);
  igual('…y las que empiezan el 1 de enero sí restan', s.disfrutadas, 3);

  const meses = L('2026-07-13', '2026-07-31', 8, L('2026-08-01', '2026-08-05', 3, L('2026-08-06', '2026-08-10', 9)));
  s = saldoDe({ alta: '2026-07-13' }, [], [], new Map(), HOY, meses);
  igual('Mes a mes: julio 19 que suman; agosto 5 que suman y 5 que se quedan cortos',
    s.detalle.meses.map(m => [m.mes, m.laborados, m.cortos, m.generadas]),
    [['2026-07', 19, 0, 1.6], ['2026-08', 5, 5, 0.42], ['2026-09', 0, 0, 0], ['2026-10', 0, 0, 0]]);
  igual('…con las horas de cada mes', s.detalle.meses.map(m => m.segundos / 3600), [152, 60, 0, 0]);

  s = saldoDe({ alta: '2026-07-13' }, [susp('2026-08-01', '2026-08-10')], [], new Map(), HOY);
  igual('Las suspensiones se siguen viendo en la ficha (10 días)', s.diasSuspension, 10);
  s = saldoDe({ alta: '2026-07-13' }, [susp('2026-10-10', null, 'suspension_permiso')], [], new Map(), HOY);
  igual('Una suspensión por retirada del permiso, abierta: 5 días hasta hoy', s.diasSuspension, 5);

  // ── 2. Lo que resta ──────────────────────────────────────────────────────
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-08-01', '2026-08-15')], [], new Map(), HOY);
  igual('Vacaciones del 01/08 al 15/08: −15', [s.disfrutadas, s.saldo], [15, -15]);
  igual('…en negativo, con su signo', s.saldo < 0, true);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-10-15', '2026-10-17')], [], new Map(), HOY);
  igual('Vacaciones de mañana en adelante: no tocan el saldo de hoy', [s.disfrutadas, s.programadas, s.saldo], [0, 3, 0]);
  igual('…pero sí lo que quedará', s.saldoTras, -3);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-10-10', '2026-10-20')], [], new Map(), HOY);
  igual('Vacaciones que cruzan hoy: 5 disfrutados (10–14) y 6 programados', [s.disfrutadas, s.programadas], [5, 6]);
  igual('…y está de vacaciones hasta el 20', s.deVacacionesHasta, '2026-10-20');

  // LOS DOS DÍAS QUE LIBRA, A MANO (06/11/2026, db/233): en esas vacaciones
  // mandan sobre el planificador; sin ellos (las de antes), manda el planificador.
  const vacL = (desde, hasta, libra) => ({ ...vac(desde, hasta), libra_dias: libra });
  const dow = d => { const w = new Date(d + 'T12:00:00Z').getUTCDay(); return w === 0 ? 7 : w; };
  const soloMiercoles = d => ({ trabaja: dow(d) !== 3, por: 'plaza' });
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-08-03', '2026-08-16')], [], new Map(), HOY, new Map(), soloMiercoles);
  igual('Sin días a mano manda el planificador: libra solo el miércoles, 14 − 2 = 12', s.disfrutadas, 12);
  s = saldoDe({ alta: '2026-07-13' }, [vacL('2026-08-03', '2026-08-16', [3, 7])], [], new Map(), HOY, new Map(), soloMiercoles);
  igual('Con miércoles y domingo a mano (el caso de Angel Lopez Gomez): 14 − 4 = 10',
    [s.disfrutadas, s.detalle.vacaciones[0].libranzas, s.detalle.vacaciones[0].libraDias], [10, 4, [3, 7]]);
  s = saldoDe({ alta: '2026-07-13' }, [vacL('2026-08-03', '2026-08-16', [3, 4])], [], new Map(), HOY, new Map(), d => ({ trabaja: true, por: 'plaza' }));
  igual('Los dos días a mano mandan aunque el planificador diga que trabajaba todos', s.disfrutadas, 10);
  s = saldoDe({ alta: '2026-07-13' }, [vacL('2026-10-12', '2026-10-25', [6, 7])], [], new Map(), HOY);
  igual('Las que cruzan hoy librando sábado y domingo: 3 disfrutados (12–14) y 7 programados (15–25 sin dos fines de semana)',
    [s.disfrutadas, s.programadas], [3, 7]);
  s = saldoDe({ alta: '2026-07-13' }, [vacL('2026-08-03', '2026-08-09', ['3', '4'])], [], new Map(), HOY);
  igual('Los días que llegan como texto de la base también valen', s.disfrutadas, 5);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-03-01', '2026-03-10')], [], new Map(), HOY);
  igual('Vacaciones de antes de su alta (otro contrato): no cuentan', [s.disfrutadas, s.detalle.vacaciones.length], [0, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [vac('2026-07-10', '2026-07-15')], [], new Map(), HOY);
  igual('Unas que empiezan antes del alta: solo cuentan los días desde el alta (3)', s.disfrutadas, 3);
  s = saldoDe({ alta: '2026-07-13' }, [perm('2026-08-23', '2026-08-31', null), perm('2026-10-08', '2026-11-08', 'PR_MATRIMONIO')], [], new Map(), HOY);
  igual('Un permiso sin tipo y uno de matrimonio: no restan nada, ni hoy ni después', [s.saldo, s.saldoTras], [0, 0]);
  igual('…pero se ven en la ficha, con sus días', s.detalle.permisos.map(p => [p.dentro, p.programados]), [[9, 0], [7, 25]]);

  // ── 2b. Los asuntos propios: su banco, aparte (29/10/2026) ─────────────────
  // Camilo: «que no reste a las vacaciones, él se restará solo».
  s = saldoDe({ alta: '2026-07-13' }, [ap('2026-09-01', '2026-09-01'), ap('2026-10-20', '2026-10-20')], [], new Map(), HOY, L('2026-07-13', '2026-08-31', 8));
  igual('Asuntos propios: no tocan el saldo de vacaciones', [s.saldo, s.saldoTras, s.generadas], [3.45, 3.45, 3.45]);
  igual('…su banco: 2 este año, 1 cogido, 1 programado',
    [s.asuntosPropios.generados, s.asuntosPropios.usados, s.asuntosPropios.programados, s.asuntosPropios.saldo, s.asuntosPropios.saldoTras], [2, 1, 1, 1, 0]);
  igual('…y se ven aparte en la ficha, no entre los permisos', [s.detalle.asuntos.length, s.detalle.permisos.length], [2, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [perm('2026-09-01', '2026-09-01')], [], new Map(), HOY);
  igual('Un permiso de los de antes con el tipo de asuntos propios cuenta igual (si db/225 aún no lo ha pasado)',
    [s.saldo, s.asuntosPropios.usados, s.detalle.asuntos.length], [0, 1, 1]);
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
  // Los de septiembre para atrás se pagaron en la nómina (06/11/2026, Camilo:
  // «quita las vacaciones generadas por festivos de septiembre para atrás ya que
  // esas sí fueron pagas»): salen como «pagado» y no suman, aunque los trabajara.
  const cal = [F('2025-05-01', null), F('2025-12-25'), F('2026-08-15'), F('2026-10-12'), F('2026-10-13', null), F('2026-10-14', null), F('2026-07-01')];
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-08-15': 9 * 3600, '2026-10-12': 7 * 3600 }), HOY);
  igual('Festivos de su periodo: los de antes del alta no entran', s.detalle.festivos.map(f => f.fecha), ['2026-08-15', '2026-10-12', '2026-10-13', '2026-10-14']);
  igual('El 15/08 trabajó 9 h pero se pagó; el 12/10 trabajó 7 h: +1; el 13/10 aún se calcula; el de hoy no ha terminado',
    s.detalle.festivos.map(f => f.estado), ['pagado', 'suma', 'pendiente', 'hoy']);
  igual('…suma 1 día al saldo', [s.festivosSuman, s.saldo], [1, 1]);
  s = saldoDe({ alta: '2026-07-13' }, [], [F('2026-09-30'), F('2026-10-01')], H({ '2026-09-30': 8 * 3600, '2026-10-01': 8 * 3600 }), HOY);
  igual('El 30/09 aún se pagó; el 01/10 ya suma', [s.detalle.festivos.map(f => f.estado), s.festivosSuman], [['pagado', 'suma'], 1]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-10-12': 6 * 3600 }), HOY);
  igual('Seis horas justas NO suman (tiene que ser más de 6)', [s.detalle.festivos[1].estado, s.festivosSuman], ['no-suma', 0]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, H({ '2026-10-12': 6 * 3600 + 1 }), HOY);
  igual('Un segundo más, sí', s.festivosSuman, 1);
  s = saldoDe({ alta: '2023-01-01' }, [], cal, H({ '2025-12-25': 8 * 3600 }), HOY);
  igual('Los festivos de 2025 ya no entran (todo empieza el 01/01/2026)',
    [s.detalle.festivos.some(f => f.fecha < '2026-01-01'), s.festivosSinDatos, s.festivosSuman], [false, 0, 0]);
  s = saldoDe({ alta: '2026-07-13' }, [], cal, new Map(), HOY);
  igual('Un festivo con horas calculadas y sin fila suya: no trabajó, no suma', s.detalle.festivos[1].estado, 'no-suma');

  // ── 4. Todo junto ────────────────────────────────────────────────────────
  // Trabajó del 13 al 31/07 (19 días de 8 h), 10 días de 6 h en agosto, los
  // festivos del 15/08 y del 12/10 9 h (también son días laborados; el del 15/08
  // se pagó y no suma vacaciones) y 5 días de 3 h en septiembre (no suman).
  const trabajo = L('2026-07-13', '2026-07-31', 8, L('2026-08-16', '2026-08-25', 6, L('2026-09-01', '2026-09-05', 3,
    new Map([['2026-08-15', 9 * 3600], ['2026-10-12', 9 * 3600]]))));
  s = saldoDe({ alta: '2026-07-13' },
    [vac('2026-08-01', '2026-08-05'), ap('2026-09-01', '2026-09-01'), susp('2026-09-10', '2026-09-11'), vac('2026-10-20', '2026-10-22')],
    cal, H({ '2026-08-15': 9 * 3600, '2026-10-12': 9 * 3600 }), HOY, trabajo);
  igual('31 días laborados (2,60) + 1 festivo (el 12/10; el 15/08 se pagó) − 5 disfrutadas = −1,40 (el día de asuntos propios no resta)',
    [s.diasLaborados, s.generadas, s.festivosSuman, s.disfrutadas, s.saldo], [31, 2.6, 1, 5, -1.4]);
  igual('…y tras las vacaciones del 20 al 22, −4,40', s.saldoTras, -4.4);
  // EL MES A MES DEL EXCEL DE LA BITÁCORA (12/11/2026): lo generado, los
  // festivos, lo disfrutado y el saldo al acabar cada mes. El último cuadra con el saldo.
  igual('Mes a mes: generadas, festivos, disfrutadas y saldo al acabar el mes (el de octubre es el saldo de hoy)',
    s.detalle.meses.map(m => [m.mes, m.generadas, m.festivos, m.disfrutadas, m.saldoFin]),
    [['2026-07', 1.6, 0, 0, 1.6], ['2026-08', 0.92, 0, 5, -2.48], ['2026-09', 0, 0, 0, -2.48], ['2026-10', 0.08, 1, 0, -1.4]]);
  // El tope no cuenta los festivos: un mes en el tope con un festivo trabajado da 1,85 + 1.
  const tf = saldoDe({ alta: '2026-07-13' }, [], [F('2026-10-12')], H({ '2026-10-12': 8 * 3600 }), HOY, L('2026-09-01', '2026-09-30', 8, L('2026-10-01', '2026-10-14', 8)));
  igual('El tope no cuenta los festivos: septiembre 1,85 (en el tope) y octubre 14 × 0,084 = 1,18 + el festivo del 12/10',
    [tf.generadas, tf.festivosSuman, tf.saldo, tf.detalle.meses.map(m => [m.mes, m.generadas, m.festivos])],
    [3.03, 1, 4.03, [['2026-07', 0, 0], ['2026-08', 0, 0], ['2026-09', 1.85, 0], ['2026-10', 1.18, 1]]]);
  igual('…y le queda 1 día de asuntos propios', s.asuntosPropios.saldo, 1);

  // ── 5. Las horas de los festivos ─────────────────────────────────────────
  const guardado = [];
  repo.festivosPorSellar = async (desde, hoy, margen) => { guardado.push(['pide', desde, hoy, margen]); return ['2026-08-15']; };
  // LAS HORAS DE SU JORNADA, NO LAS DEL RELOJ (12/11/2026): su turno de día de
  // esa fecha más su turno de noche (de 12:00 a 12:00 del día siguiente). El 12
  // entró a las 20:00 y salió a las 04:00: 4 h de noche que caen ya en el día 16
  // siguen siendo de su jornada del festivo. Quien no tiene ficha («u…») no entra.
  reparto.porPersonaYDia = async fechas => new Map([
    ['c12', new Map([[fechas[0], { dia: 0, noche: 8 * 3600 }]])],
    ['c13', new Map([[fechas[0], { dia: 3600, noche: 0 }], ['2026-08-14', { dia: 9 * 3600, noche: 0 }]])],
    ['u-sin-ficha', new Map([[fechas[0], { dia: 9 * 3600, noche: 0 }]])],
  ]);
  repo.guardarHorasFestivo = async (fecha, horas, fuente) => { guardado.push(['guarda', fecha, [...horas.entries()], fuente]); return horas.size; };
  const r = await svc.sellarFestivos({ hoy: HOY });
  igual('Pide los festivos desde el 01/07/2026, con 4 días de margen', guardado[0], ['pide', '2026-07-01', HOY, 4]);
  igual('Guarda las horas de su jornada de ese día (turno de día + turno de noche), como del sistema',
    guardado[1], ['guarda', '2026-08-15', [[12, 28800], [13, 3600]], 'nucleo']);
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
  // Los dos días que libra (db/233): se cambian mientras no hayan empezado.
  const libraOk = (t, l) => { try { require('../services/vacacionesAFuturo').validarLibra(t, l, HOY); return 'se cambian'; } catch (e) { return e.message; } };
  igual('Los días que libra: en las futuras se cambian', libraOk({ ...fut, libra_dias: [3, 4] }, [6, 7]), 'se cambian');
  igual('…en las empezadas no', /ya empezaron el 12\/10\/2026/.test(libraOk({ ...emp, libra_dias: [3, 4] }, [6, 7])), true);
  igual('…pero mandar los mismos no es cambiarlos', libraOk({ ...emp, libra_dias: [4, 3] }, [3, 4]), 'se cambian');
  igual('…y a las de antes, sin días, se les ponen una vez aunque ya hayan empezado (las de Angel)', libraOk(emp, [3, 4]), 'se cambian');
  const conTicket = saldoDe({ alta: '2026-01-01' },
    [{ ...vac('2026-10-12', '2026-10-18'), ticket_id: '5', ticket_codigo: 'RH-1' }, vac('2026-10-01', '2026-10-05')], cal, H({}), HOY);
  igual('La ficha dice cuáles se pueden cambiar y de qué ticket salieron',
    conTicket.detalle.vacaciones.map(v => [v.desde, v.editable, v.empezadas, v.ticket && v.ticket.codigo]),
    [['2026-10-12', true, true, 'RH-1'], ['2026-10-01', false, true, null]]);

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
