// ============================================================
// PRÓXIMAS INCORPORACIONES — las reglas
// ============================================================
// Las de Control → Próximas incorporaciones (15/10/2026): quién entra cada día
// (NUEVO o de VACACIONES), cuándo sale «Sin plaza», qué no es entrar (de ETT a
// propia, quien ya trabajaba), cómo se apunta la llamada y cómo la clasifica el
// Call Center.
//
//   node scripts/comprobar-incorporaciones.js
//
// No toca la base ni Meta: el historial de llamadas se sustituye.
const path = require('path');

const llamadas = [];
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
sustituir('services/repo/llamadas.js', { registrar: async d => { llamadas.push(d); return { id: '1' }; } });

const S = require('../modules/Control/incorporaciones.service');
const CC = require('../modules/Control/callcenter.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
async function lanza(nombre, fn, trozo) {
  try { await fn(); igual(nombre + ' (tenía que fallar)', 'no falló', trozo); }
  catch (e) { igual(nombre, e.message.includes(trozo) ? trozo : e.message, trozo); }
}

// Mañana es el 16/10; se mira la cobertura desde el 04/10.
const VENT = { desde: '2026-10-16', hasta: '2026-10-16', inicio: '2026-10-04' };
const cub = (id, ...dias) => dias.map(dia => ({ dia, id, matricula: 'M' + id, rol: 'FIJO', turno: 'Día' }));
const resumen = r => r.map(e => [e.id, e.tipo, e.dia, e.sinPlaza]);

(async () => {
  // ── 1. Nuevos ──────────────────────────────────────────────────────────────
  igual('Alta mañana y coche mañana: NUEVO', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '1', alta: '2026-10-16' }], cobertura: cub('1', '2026-10-16', '2026-10-17') })),
  [['1', 'nuevo', '2026-10-16', false]]);

  igual('Alta el 14 y primer día con coche mañana (libraba el coche): NUEVO', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '2', alta: '2026-10-14' }], cobertura: cub('2', '2026-10-16') })),
  [['2', 'nuevo', '2026-10-16', false]]);

  igual('Alta el 14 y ya cubrió el 15: no es nuevo mañana', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '3', alta: '2026-10-14' }], cobertura: cub('3', '2026-10-15', '2026-10-16') })), []);

  igual('De la ETT a propia sin hueco: no entra', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '4', alta: '2026-10-16', baja_anterior: '2026-10-15' }], cobertura: cub('4', '2026-10-16') })), []);

  const vuelve = S.clasificar({ ...VENT,
    altas: [{ id: '5', alta: '2026-10-16', baja_anterior: '2026-03-01' }], cobertura: cub('5', '2026-10-16') });
  igual('Vuelve tras un contrato que acabó hace meses: NUEVO, y se dice', [resumen(vuelve), vuelve[0].bajaAnterior],
    [[['5', 'nuevo', '2026-10-16', false]], '2026-03-01']);

  igual('Alta mañana y sin ninguna plaza: NUEVO con «Sin plaza»', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '6', alta: '2026-10-16' }] })), [['6', 'nuevo', '2026-10-16', true]]);

  igual('Alta mañana con plaza pero su coche libra mañana: no sale (sale el día que cubra)', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '7', alta: '2026-10-16' }],
    asignaciones: [{ id: '7', desde: '2026-10-16', hasta: null }], cobertura: cub('7', '2026-10-18') })), []);

  igual('Alta antigua (antes de lo que se mira) con una plaza de antes: no es nuevo', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '8', alta: '2026-09-20' }],
    asignaciones: [{ id: '8', desde: '2026-09-20', hasta: null }], cobertura: cub('8', '2026-10-16') })), []);

  igual('Alta mañana pero de baja médica ese día y sin plaza: no sale', resumen(S.clasificar({ ...VENT,
    altas: [{ id: '9', alta: '2026-10-16' }], ausencias: [{ id: '9', desde: '2026-10-16', hasta: null }] })), []);

  const plazas = S.clasificar({ ...VENT, altas: [{ id: '10', alta: '2026-10-16' }],
    cobertura: [{ dia: '2026-10-16', id: '10', matricula: '1096MJY', rol: 'CT', turno: 'Noche' }] })[0].plazas;
  igual('Las plazas del primer día, con su puesto', plazas, [{ matricula: '1096MJY', puesto: 'Correturnos', turno: 'Noche' }]);

  // ── 2. Vacaciones ──────────────────────────────────────────────────────────
  igual('Vacaciones hasta hoy y coche mañana: VACACIONES', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '20', desde: '2026-10-01', hasta: '2026-10-15' }], cobertura: cub('20', '2026-10-16') })),
  [['20', 'vacaciones', '2026-10-16', false]]);

  igual('Acabaron el 13 y libró el 14 y el 15: entra mañana, VACACIONES', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '21', desde: '2026-10-01', hasta: '2026-10-13' }], cobertura: cub('21', '2026-10-16') })),
  [['21', 'vacaciones', '2026-10-16', false]]);

  igual('Acabaron el 13 y ya trabajó el 14: no vuelve mañana', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '22', desde: '2026-10-01', hasta: '2026-10-13' }], cobertura: cub('22', '2026-10-14', '2026-10-16') })), []);

  igual('Vacaciones hasta hoy y sin plaza mañana: VACACIONES con «Sin plaza»', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '23', desde: '2026-10-01', hasta: '2026-10-15' }] })), [['23', 'vacaciones', '2026-10-16', true]]);

  igual('Vacaciones hasta hoy, con plaza pero libra mañana: no sale', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '24', desde: '2026-10-01', hasta: '2026-10-15' }],
    asignaciones: [{ id: '24', desde: '2026-09-01', hasta: null }], cobertura: cub('24', '2026-10-18') })), []);

  igual('Vacaciones y detrás una baja: no vuelve de vacaciones', resumen(S.clasificar({ ...VENT,
    vacaciones: [{ id: '25', desde: '2026-10-01', hasta: '2026-10-10' }],
    ausencias: [{ id: '25', desde: '2026-10-11', hasta: '2026-10-15' }], cobertura: cub('25', '2026-10-16') })), []);

  igual('Una persona sale una vez, en su primera entrada', resumen(S.clasificar({ ...VENT, hasta: '2026-10-20',
    altas: [{ id: '26', alta: '2026-10-18' }], vacaciones: [{ id: '26', desde: '2026-10-01', hasta: '2026-10-15' }],
    cobertura: cub('26', '2026-10-16', '2026-10-18') })), [['26', 'vacaciones', '2026-10-16', false]]);

  igual('Por fecha, lo primero arriba', resumen(S.clasificar({ ...VENT, hasta: '2026-10-20',
    altas: [{ id: '27', alta: '2026-10-19' }, { id: '28', alta: '2026-10-16' }],
    cobertura: [...cub('27', '2026-10-19'), ...cub('28', '2026-10-16')] })).map(x => x[0]), ['28', '27']);

  igual('El coche de antes de las vacaciones, el de la víspera', S.cochesDeAntes([
    { id: '30', desde: '2026-09-01', hasta: '2026-09-30', matricula: '1111AAA' },
    { id: '30', desde: '2026-10-16', hasta: null, matricula: '2222BBB' },
  ], '30', '2026-09-30'), ['1111AAA']);

  // ── 3. La llamada ──────────────────────────────────────────────────────────
  await lanza('Sin decir qué ha dicho no se apunta', () => S.apuntarLlamada(1, {}), 'Elige qué ha dicho');
  await lanza('«No va a entrar» pide el porqué', () => S.apuntarLlamada(1, { resultado: 'no_entra' }), 'por qué no va a entrar');
  await lanza('«Entra otro día» pide qué día', () => S.apuntarLlamada(1, { resultado: 'otro_dia', nota: '' }), 'qué día entra');
  llamadas.length = 0;
  await S.apuntarLlamada(484, { resultado: 'confirma', dia: '2026-10-16', matricula: '1208MJY', nota: 'Llega a las 5' }, { usuarioId: 7 });
  igual('Confirma: queda en su historial, de Control y con su caso',
    [llamadas[0].conductorId, llamadas[0].tipo, llamadas[0].resultado, llamadas[0].nota, llamadas[0].matricula],
    [484, 'trafico', 'Incorporación: confirma que entra', 'Entra el 16/10/2026 · Llega a las 5', '1208MJY']);

  // ── 4. El Call Center las entiende ─────────────────────────────────────────
  igual('Todos los casos van a «confirmación de turno» en el Call Center',
    S.RESULTADOS_LLAMADA.map(r => CC.clasificarControl({ tipo: 'trafico', resultado: r.caso }).motivo),
    S.RESULTADOS_LLAMADA.map(() => 'Revisión de asistencia / confirmación de turno'));
  igual('Y caben en la columna del resultado (60)', S.RESULTADOS_LLAMADA.every(r => r.caso.length <= 60), true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
