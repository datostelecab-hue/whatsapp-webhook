// ============================================================
// ANULAR EL ALTA DE UN NUEVO QUE NO HA TRABAJADO — las reglas
// ============================================================
//   node scripts/comprobar-anular-alta.js
//
// 05/11/2026, Camilo: «Habilita un botón para los nuevos, solo para la gente en
// plantilla en la cual el sistema sepa si ha hecho horas o no». Ver
// modules/Conductores/conductores.repo.js (estadoParaAnular, porQueNoSeAnula,
// anularAlta) y plantilla.service.js (anulacionDeAlta, anularAlta).
//
// No toca ninguna base: el estado de cada persona y la ingesta se sustituyen.
// Lo que sí se usa de verdad es `porQueNoSeAnula`, la regla.
const path = require('path');
const fRepo = require.resolve(path.join(__dirname, '..', 'modules/Conductores/conductores.repo.js'));
const fIngesta = require.resolve(path.join(__dirname, '..', 'services/ingesta.js'));

const real = require(fRepo);
let estado = null, horasAlDia = true;
const llamadas = [];
require.cache[fRepo].exports = new Proxy({
  porQueNoSeAnula: real.porQueNoSeAnula,
  estadoParaAnular: async () => estado,
  anularAlta: async (id, datos, quien) => { llamadas.push({ id, datos, usuarioId: quien.usuarioId }); return { anulada: estado && estado.alta }; },
}, { get: (o, k) => (k in o ? o[k] : async () => null) });
require.cache[fIngesta] = { id: fIngesta, filename: fIngesta, loaded: true, exports: {
  estado: async () => ({ configurada: true, tareas: [{ tarea: 'state_logs_bolt', alDia: horasAlDia,
    ultimoAcierto: new Date(Date.now() - 42 * 60000).toISOString() }] }),
} };

const P = require('../modules/Conductores/plantilla.service');

let fallos = 0;
const ok = (nombre, cond, extra) => {
  if (!cond) fallos++;
  console.log(`${cond ? 'OK   ' : 'FALLA'} ${nombre}${!cond && extra !== undefined ? '\n      ' + JSON.stringify(extra) : ''}`);
};
// Un nuevo de ayer, con su cuenta y sin un minuto: el caso de Jordan.
const nuevo = (x = {}) => ({ periodoId: 1, tipo: 'propia', ettNombre: null, alta: '2026-11-04', dias: 1, futura: false,
  seguido: false, cuentas: 1, trabajoDia: null, trabajoSeg: 0, nomina: 0, ...x });

(async () => {
  const no = real.porQueNoSeAnula;
  // ── La regla ──
  ok('El de ayer, con cuenta y sin horas: se puede', no(nuevo()) === null, no(nuevo()));
  ok('Sin contrato nuevo (o de hace más de 30 días): no', /30 días/.test(no(null) || ''));
  ok('Viene de la ETT sin día de corte: no', /contrato anterior/.test(no(nuevo({ seguido: true })) || ''));
  ok('Sin cuenta de BOLT: no, porque no se puede saber', /ninguna cuenta de BOLT/.test(no(nuevo({ cuentas: 0 })) || ''));
  ok('…salvo que su alta aún no haya empezado', no(nuevo({ cuentas: 0, futura: true, dias: -2 })) === null);
  const m = no(nuevo({ trabajoSeg: 90, trabajoDia: '04/11/2026' })) || '';
  ok('Con un minuto y medio ya ha trabajado: no, y dice cuánto y desde cuándo', /Ya ha trabajado: 2 min.*04\/11\/2026/.test(m), m);
  const h = no(nuevo({ trabajoSeg: 3 * 3600 + 5 * 60, trabajoDia: '04/11/2026' })) || '';
  ok('…en horas, si pasa de una', /3 h 5 min/.test(h), h);
  ok('Con algo de la nómina en su contrato: no', /nómina/.test(no(nuevo({ nomina: 1 })) || ''));

  // ── La ficha ──
  estado = null;
  ok('Sin alta nueva no sale el botón', (await P.anulacionDeAlta(1)) === null);
  estado = nuevo({ seguido: true });
  ok('Al que pasó de la ETT a propia no le sale', (await P.anulacionDeAlta(1)) === null);
  estado = nuevo(); horasAlDia = true;
  let r = await P.anulacionDeAlta(1);
  ok('El de ayer sin horas: encendido', r && r.puede === true, r);
  horasAlDia = false;
  r = await P.anulacionDeAlta(1);
  ok('…pero con la lectura de BOLT parada, apagado y dice por qué', r && r.puede === false && /no están al día \(última lectura buena hace 42 min\)/.test(r.porque), r);
  estado = nuevo({ futura: true, dias: -2, cuentas: 0 });
  r = await P.anulacionDeAlta(1);
  ok('Un alta futura no depende de la lectura de BOLT', r && r.puede === true, r);
  estado = nuevo({ trabajoSeg: 600, trabajoDia: '05/11/2026' }); horasAlDia = true;
  r = await P.anulacionDeAlta(1);
  ok('Con horas: apagado, con el porqué', r && r.puede === false && /Ya ha trabajado/.test(r.porque), r);

  // ── Anular ──
  estado = nuevo(); horasAlDia = true;
  let msg = '';
  try { await P.anularAlta(1, { motivo: 'no vino' }, { rol: 'trafico', usuarioId: 3 }); } catch (e) { msg = e.message; }
  ok('Tráfico no anula', /cosa de RRHH/.test(msg), msg);
  horasAlDia = false; msg = '';
  try { await P.anularAlta(1, { motivo: 'no vino' }, { rol: 'rrhh', usuarioId: 3 }); } catch (e) { msg = e.message; }
  ok('Con la lectura de BOLT parada tampoco', /no están al día/.test(msg) && !llamadas.length, msg);
  horasAlDia = true;
  await P.anularAlta(1, { motivo: 'no vino' }, { rol: 'rrhh', usuarioId: 3 });
  ok('RRHH, con las horas al día: llega al repositorio con su motivo y quién',
    llamadas.length === 1 && llamadas[0].datos.motivo === 'no vino' && llamadas[0].usuarioId === 3, llamadas);

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.stack); process.exit(1); });
