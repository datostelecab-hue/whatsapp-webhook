// ============================================================
// LA JORNADA SEMANAL — ¿cumplió cada uno sus horas de la semana?
// ============================================================
// Las reglas del informe semanal de Control (modules/Control/jornadaSemanal.service.js,
// pedido por Camilo el 07/10/2026): la J suma a BOLT solo aprobada, la baja médica
// no suma pero deja su B, lo de fuera del contrato no cuenta, y de menor a mayor.
//
//   node scripts/comprobar-jornada-semanal.js
//
// No toca la base de datos: prueba las funciones puras.
const S = require('../modules/Control/jornadaSemanal.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// La semana del lunes 28/09 al domingo 04/10/2026, vista el miércoles 07/10.
const L = '2026-09-28';
const DIAS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
const HOY = '2026-10-07';
const ctx = { hoy: HOY, alta: '2026-01-01', baja: null };

igual('El lunes de un miércoles', S.lunesDe('2026-10-07'), '2026-10-05');
igual('El lunes de un domingo es el de antes', S.lunesDe('2026-10-04'), '2026-09-28');
igual('El lunes de un lunes es él mismo', S.lunesDe('2026-09-28'), '2026-09-28');

// Una persona: su fila de la rejilla de la Bitácora (índice 0 = el lunes).
const fila = (dias, extra = {}) => ({ dias, justif: {}, horasBolt: {}, ...extra });
const tipo = x => `${x.tipo}:${x.horas}`;

igual('Horas de BOLT tal cual', tipo(S.celda(fila([8.4]), 0, L, ctx)), 'horas:8.4');
igual('J aprobada: suma a lo de BOLT',
  tipo(S.celda(fila(['J'], { justif: { [L]: { horas: 3, estado: 'aprobada' } }, horasBolt: { [L]: 5.2 } }), 0, L, ctx)), 'J:8.2');
igual('J pendiente: no cuenta (solo lo de BOLT)',
  tipo(S.celda(fila(['J'], { justif: { [L]: { horas: 3, estado: 'pendiente' } }, horasBolt: { [L]: 5.2 } }), 0, L, ctx)), 'J:5.2');
igual('J aprobada sin nada en BOLT', tipo(S.celda(fila(['J'], { justif: { [L]: { horas: 8, estado: 'aprobada' } } }), 0, L, ctx)), 'J:8');
igual('Baja médica: B y no suma, aunque hiciera algo en BOLT',
  tipo(S.celda(fila(['B'], { horasBolt: { [L]: 2 } }), 0, L, ctx)), 'B:0');
igual('Vacaciones: V y no suma', tipo(S.celda(fila(['V']), 0, L, ctx)), 'V:0');
igual('Libranza: L y no suma', tipo(S.celda(fila(['L']), 0, L, ctx)), 'L:0');
igual('Un día pasado sin nada: no salió', tipo(S.celda(fila([null]), 0, L, ctx)), 'ausencia:0');
igual('Antes del alta: fuera, aunque tenga horas', tipo(S.celda(fila([7]), 0, L, { ...ctx, alta: '2026-10-01' })), 'fuera:0');
igual('Después de la baja: fuera', tipo(S.celda(fila([7]), 0, L, { ...ctx, baja: '2026-09-27' })), 'fuera:0');
igual('Un día que no ha llegado', tipo(S.celda(fila([null]), 0, '2026-10-08', ctx)), 'futuro:0');
igual('Hoy sin horas todavía no es una ausencia', tipo(S.celda(fila([null]), 0, HOY, ctx)), 'futuro:0');

// La semana entera: 40 h de contrato.
const semana = (dias, extra, opc = {}) => S.semanaDe(fila(dias, extra), 0, DIAS, { ...ctx, jornada: 40, cerrada: true, ...opc });
const cumple = semana([8, 8, 8, 8, 8, 'L', 'L']);
igual('40 h justas: cumple', [cumple.total, cumple.cumple, cumple.diferencia, cumple.estado], [40, true, 0, 'Sí']);
const corto = semana([8, 8, 8, 8, 7.9, 'L', 'L']);
igual('39,9 h: no cumple', [corto.total, corto.cumple, corto.diferencia, corto.estado], [39.9, false, -0.1, 'No']);
const conJ = semana([8, 8, 8, 'J', 8, 'L', 'L'], { justif: { '2026-10-01': { horas: 4, estado: 'aprobada' } }, horasBolt: { '2026-10-01': 4 } });
igual('Con una J aprobada de 4 h + 4 h de BOLT: cumple', [conJ.total, conJ.estado], [40, 'Sí']);
const conJp = semana([8, 8, 8, 'J', 8, 'L', 'L'], { justif: { '2026-10-01': { horas: 4, estado: 'pendiente' } }, horasBolt: { '2026-10-01': 4 } });
igual('Con la misma J pendiente: no cumple y lo dice', [conJp.total, conJp.estado, conJp.obs],
  [36, 'No', 'J pendiente de aprobar: +4 h si se aprueba']);
const baja = semana(['B', 'B', 8, 8, 8, 'L', 'L']);
igual('Dos días de baja: no suman, la jornada no se rebaja, y la observación lo cuenta',
  [baja.total, baja.estado, baja.celdas.map(x => x.tipo).join(','), baja.obs],
  [24, 'No', 'B,B,horas,horas,horas,L,L', '2 días de baja médica']);
const alta = semana([7, 7, 7, 8, 8, 8, 'L'], {}, { alta: '2026-10-01' });
igual('Alta el jueves: lo de antes no cuenta', [alta.total, alta.obs], [24, 'Alta el jueves 01/10']);
const sinJornada = semana([8, 8], {}, { jornada: null });
igual('Sin jornada en el contrato: no se juzga', [sinJornada.cumple, sinJornada.estado, sinJornada.obs.includes('no dice la jornada')], [null, '', true]);
const abierta = semana([8, 8, 8, null, null, null, null], {}, { cerrada: false, hoy: '2026-10-01' });
igual('Semana sin cerrar y aún sin llegar: «En curso», no «No»', [abierta.total, abierta.estado], [24, 'En curso']);

// De menor a mayor: los que no cumplieron, arriba.
const orden = S.ordenar([{ nombre: 'Beatriz', total: 41 }, { nombre: 'Ana', total: 30 }, { nombre: 'Carlos', total: 30 }, { nombre: 'Dani', total: 39.9 }]);
igual('De menor a mayor, y a igualdad por nombre', orden.map(x => x.nombre), ['Ana', 'Carlos', 'Dani', 'Beatriz']);

// Las semanas de la tarjeta: la última cerrada va marcada.
const sem = S.semanas('2026-10-07');
igual('Semanas: la en curso primero y la última cerrada por defecto',
  [sem[0].lunes, sem[1].lunes, sem[1].porDefecto, sem.length], ['2026-10-05', '2026-09-28', true, 9]);

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo bien');
process.exit(fallos ? 1 : 0);
