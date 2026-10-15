// ============================================================
// EL INFORME DE SALIDAS EN PDF — las reglas
// ============================================================
// El PDF del histórico (15/10/2026): en qué grupo cae cada persona del turno,
// qué coches cuentan como «sin conductor», cómo se cuentan las llamadas y que
// el PDF sale aunque los nombres o las notas traigan lo que las fuentes del
// PDF no saben escribir (emojis, flechas, saltos de línea).
//
//   node scripts/comprobar-historico-pdf.js
//
// No toca la base: el parte del día se inventa aquí.
const { PDFDocument } = require('pdf-lib');
const P = require('../modules/Control/historico.pdf');
const { cochesSinConductor } = require('../modules/Control/historico.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

let sec = 0;
const persona = (nombre, turno, salida, extra = {}) => ({
  conductorId: String(++sec), conductor: nombre, turno, turnoEtiqueta: { dia: 'Día', noche: 'Noche', todoturno: 'TodoTurno' }[turno],
  rol: 'FIJO', cuadrante: 'CUADRANTE 1', matriculas: ['1234ABC'], salida, primera: '05:12',
  alertas: [], llamadas: [], noSale: null, justificante: null, ...extra,
});
const llamada = (id, cid, hora, extra = {}) => ({ id, conductorId: cid, hora, agente: 'Laura', resultado: 'No contesta', nota: '', alertas: [], ...extra });

const parte = {
  dia: '2026-10-14',
  conductores: [
    persona('Ana Salió', 'dia', 'salio'),
    persona('Beto Conectado', 'dia', 'conectado'),
    persona('Carla Descanso', 'dia', 'descanso'),
    persona('Dani Avisó', 'dia', 'no_salio', { noSale: { motivo: 'asuntos', etiqueta: 'Asuntos propios', comentario: 'Médico', quien: 'Laura', hora: '06:10' } }),
    persona('Eva Avisó pero Salió', 'dia', 'salio', { noSale: { motivo: 'asuntos', etiqueta: 'Asuntos propios' } }),
    persona('Fran Faltó', 'dia', 'no_salio'),
    persona('Gema Faltó Llamada', 'dia', 'no_salio'),
    persona('Hugo Noche', 'noche', 'salio'),
    persona('Iris Noche Pendiente', 'noche', 'pendiente'),
    persona('Juan Dobla', 'todoturno', 'salio', {
      alertas: [{ codigo: 'no_llego', tono: 'error', nombre: 'No llegó a su jornada', contestada: true },
        { codigo: 'km_parado', tono: 'error', nombre: 'Km rodando fuera de la app', contestada: false },
        { codigo: 'j_presunta', tono: 'aviso', nombre: 'Llega solo con horas presuntas', contestada: false }],
    }),
  ],
  sinConductor: { dia: [{ matricula: '1111AAA', cuadrante: 'CUADRANTE 2' }], noche: [{ matricula: '2222BBB', cuadrante: 'CUADRANTE 3' }] },
  sinPlan: [
    { conductorId: '90', conductor: 'Nico Sin Plaza', turno: 'dia', horasBolt: 6.5, matriculas: ['3333CCC'], llamadas: [] },
    { conductorId: '90', conductor: 'Nico Sin Plaza', turno: 'noche', horasBolt: 2, matriculas: ['3333CCC'], llamadas: [] },
  ],
};
const gema = parte.conductores.find(c => c.conductor === 'Gema Faltó Llamada');
gema.llamadas = [llamada('L1', gema.conductorId, '07:02'), llamada('L2', gema.conductorId, '07:40', { agente: 'Pedro', resultado: 'Se ha quedado dormido', nota: 'Entra a las 9' })];
const juan = parte.conductores.find(c => c.conductor === 'Juan Dobla');
juan.llamadas = [llamada('L3', juan.conductorId, '06:00', { alertas: [{ alerta: 'no_llego' }] })];

(async () => {
  // ── 1. Los grupos del turno de día ─────────────────────────────────────────
  const d = P.resumen(parte, 'dia');
  const nombres = l => l.map(c => c.conductor);
  igual('Planificados del día: los de día y quien dobla', d.planificados, 8);
  igual('Salieron: salió, conectado, en descanso… y quien avisó pero salió', nombres(d.salieron),
    ['Ana Salió', 'Beto Conectado', 'Carla Descanso', 'Eva Avisó pero Salió', 'Juan Dobla']);
  igual('No saldrán: avisó y no salió', nombres(d.noSaldran), ['Dani Avisó']);
  igual('Sin avisar: no salió y nadie avisó', nombres(d.ausencias), ['Fran Faltó', 'Gema Faltó Llamada']);
  igual('De los que faltaron, uno con llamada', d.ausenciasLlamadas, 1);
  igual('Coches sin conductor: los del día', d.sinConductor.map(k => k.matricula), ['1111AAA']);
  igual('Fuera del plan: la fila del día', d.fueraDelPlan.map(n => n.horasBolt), [6.5]);
  igual('Llamadas del turno: las tres, a dos personas', [d.llamadas, d.llamados], [3, 2]);
  igual('Por agente, de más a menos', d.agentes.map(a => [a.agente, a.llamadas, a.conductores]), [['Laura', 2, 2], ['Pedro', 1, 1]]);
  igual('Alertas: solo las rojas, con las atendidas', d.alertas.map(a => [a.codigo, a.n, a.atendidas]), [['no_llego', 1, 1], ['km_parado', 1, 0]]);

  // ── 2. La noche y el día completo ──────────────────────────────────────────
  const n = P.resumen(parte, 'noche');
  igual('Noche: su gente y quien dobla', [n.planificados, nombres(n.salieron), nombres(n.pendientes)],
    [3, ['Hugo Noche', 'Juan Dobla'], ['Iris Noche Pendiente']]);
  igual('Noche: sus coches sin conductor', n.sinConductor.map(k => k.matricula), ['2222BBB']);
  const t = P.resumen(parte, 'todo');
  igual('Día completo: todos una vez', t.planificados, 10);
  igual('Día completo: los coches sin conductor de los dos turnos', t.sinConductor.map(k => [k.matricula, k.turno]), [['1111AAA', 'dia'], ['2222BBB', 'noche']]);
  igual('Día completo: el de fuera del plan una sola vez, con su fila de más horas', t.fueraDelPlan.map(x => x.horasBolt), [6.5]);
  igual('Un turno que no existe se lee como el día completo', P.resumen(parte, 'tarde').turno, 'todo');

  // ── 3. La frase ────────────────────────────────────────────────────────────
  igual('La frase del día', P.frase(d),
    'Salieron 5 de 8 conductores planificados (63 %). 1 avisó de que no saldría. 2 no salieron sin avisar: 1 con llamada de Control y 1 sin llamar. 1 coche del plan se quedó sin conductor.');
  igual('La frase de la noche', P.frase(n),
    'Salieron 2 de 3 conductores planificados (67 %). Nadie faltó sin avisar. A 1 aún no le tocaba salir. 1 coche del plan se quedó sin conductor.');

  // ── 4. Los coches sin conductor ────────────────────────────────────────────
  igual('Coches sin conductor: operativos del plan con la celda vacía, por cuadrante', cochesSinConductor([
    { matricula: '9999ZZZ', cuadrante: 'CUADRANTE 10', enPlan: true, operativo: true, plan: { dia: '', noche: 'Pepe' } },
    { matricula: '8888YYY', cuadrante: 'CUADRANTE 2', enPlan: true, operativo: true, plan: { dia: '', noche: '' } },
    { matricula: '7777XXX', cuadrante: 'CUADRANTE 1', enPlan: true, operativo: false, plan: { dia: '', noche: '' } },
    { matricula: '6666WWW', cuadrante: '', enPlan: false, operativo: true, plan: { dia: '', noche: '' } },
  ]), { dia: [{ matricula: '8888YYY', cuadrante: 'CUADRANTE 2' }, { matricula: '9999ZZZ', cuadrante: 'CUADRANTE 10' }],
    noche: [{ matricula: '8888YYY', cuadrante: 'CUADRANTE 2' }] });
  igual('Celda sin nombre pero con alguien del plan en el coche: no es «sin conductor»', cochesSinConductor([
    { matricula: '9528 MMX', cuadrante: 'CUADRANTE 24', enPlan: true, operativo: true, plan: { dia: '', noche: '' } },
  ], { dia: new Set(['9528MMX']), noche: new Set() }), { dia: [], noche: [{ matricula: '9528 MMX', cuadrante: 'CUADRANTE 24' }] });

  // ── 5. El PDF sale ─────────────────────────────────────────────────────────
  igual('Lo que las fuentes no saben escribir se va; los acentos y la ñ se quedan',
    P.L('Peña → Núñez 🚗\nOK “sí” — fin'), 'Peña -> Núñez OK “sí” — fin');

  const raro = JSON.parse(JSON.stringify(parte));
  raro.conductores[5].conductor = 'José 🚕 Ñúñez\nConductor con un nombre larguísimo que no cabe en ninguna columna';
  raro.conductores[6].llamadas[1].nota = 'Dice → que viene 👍 '.repeat(30);
  const pdf = await P.generar(raro, { turno: 'dia' });
  igual('Con emojis, flechas y textos largos el PDF sale', pdf.slice(0, 5).toString(), '%PDF-');

  const muchos = { dia: '2026-10-14', conductores: Array.from({ length: 140 }, (_, i) => persona('Conductor número ' + (i + 1), 'dia', i % 9 ? 'salio' : 'no_salio')) };
  const grande = await PDFDocument.load(await P.generar(muchos, { turno: 'dia' }));
  igual('Un turno con mucha gente pasa a más páginas', grande.getPageCount() > 1, true);

  const vacio = await PDFDocument.load(await P.generar({ dia: '2026-10-14', conductores: [] }, { turno: 'noche' }));
  igual('Un día sin nadie: una página, sin reventar', vacio.getPageCount(), 1);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
