// ============================================================
// RENDIMIENTO POR CUADRANTES — las reglas de la cuenta y del ejecutivo
// ============================================================
//   node scripts/comprobar-rendimiento-cuadrantes.js
//
// No toca la base: el planificador, las horas y la cobertura se inventan aquí.
// Comprueba la cuenta (modules/Control/rendimiento.service.js), que el ejecutivo
// salga en DOS páginas también con muchas filas y textos raros, y el Excel.
const { PDFDocument } = require('pdf-lib');
const R = require('../modules/Control/rendimiento.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}
const lanza = fn => { try { fn(); return 'no lanza'; } catch (e) { return e.message; } };
const r3 = x => (x == null ? null : Math.round(x * 1000) / 1000);

// ── El periodo y los meses ──
igual('Un mes en curso: corte hoy, planificador de hoy', (({ ini, fin, hoy, ayer, diaPlan, cerrados, enCurso }) => ({ ini, fin, hoy, ayer, diaPlan, cerrados, enCurso }))(R.periodo('2026-10', '2026-10-05')),
  { ini: '2026-10-01', fin: '2026-10-31', hoy: '2026-10-05', ayer: '2026-10-04', diaPlan: '2026-10-05', cerrados: 4, enCurso: true });
igual('Un mes pasado: entero, con el planificador de su último día', (({ hoy, ayer, diaPlan, cerrados, enCurso }) => ({ hoy, ayer, diaPlan, cerrados, enCurso }))(R.periodo('2026-09', '2026-10-05')),
  { hoy: '2026-10-01', ayer: '2026-09-30', diaPlan: '2026-09-30', cerrados: 30, enCurso: false });
igual('Un mes que no ha empezado, no', lanza(() => R.periodo('2026-11', '2026-10-05')), 'Ese mes aún no ha empezado');
igual('Antes de septiembre de 2026 no hay planificador', /septiembre de 2026/.test(lanza(() => R.periodo('2026-08', '2026-10-05'))), true);
igual('Los meses de la tarjeta: el en curso por defecto', R.meses('2026-11-06').map(m => m.mes + (m.porDefecto ? '*' : '')), ['2026-11*', '2026-10', '2026-09']);
igual('…el día 1, el anterior (aún no hay días cerrados)', R.meses('2026-11-01').filter(m => m.porDefecto).map(m => m.mes), ['2026-10']);
igual('Los ratos que se pisan cuentan una vez', R.fundir([[0, 10], [5, 20], [30, 40], [40, 45]]), [[0, 20], [30, 45]]);

// ── La cuenta ──
// Octubre de 2026 con corte el 05 (el 1 es jueves): cerrados el 1, 2, 3 y 4.
const per = R.periodo('2026-10', '2026-10-05');
const cocheA = { vehiculoId: 1, matricula: '1111AAA', cuadranteId: 10, operativo: true, sinCT: false, personas: [], falta: { fijo: {}, ct: { noche: 2 } } };
const cocheB = { vehiculoId: 2, matricula: '2222-BBB', cuadranteId: 20, operativo: true, sinCT: true, personas: [], falta: { fijo: {}, ct: { dia: 2 } } };
const cocheC = { vehiculoId: 3, matricula: '3333CCC', cuadranteId: null, operativo: true, sinCT: false, personas: [], falta: { fijo: { dia: true }, ct: { dia: 2 } } };
const tablero = {
  coches: [cocheA, cocheB, cocheC],
  cuadrantes: [{ id: 10, numero: 1, nombre: 'Cuadrante 1', zona: 'Norte' }, { id: 20, numero: 2, nombre: 'Cuadrante 2', zona: 'Norte' }],
  zonas: [{ nombre: 'Norte' }],
};
const cubierto = new Set();
per.dias.forEach(d => [1, 2, 3].forEach(v => [1, 2].forEach(t => cubierto.add(`${v}|${d}|${t}`))));
cubierto.delete('1|2026-10-01|2');              // A: la noche del jueves 1, día que libra su fijo → falta de CT
cubierto.delete('1|2026-10-02|1');              // A: el día del viernes 2 → sin fijo
const horas = new Map([
  ['1111AAA', new Map([['2026-10-01', 8], ['2026-10-02', 8], ['2026-10-03', 16], ['2026-10-04', 16]])],
  ['2222BBB', new Map([['2026-10-01', 16], ['2026-10-02', 8], ['2026-10-03', 8]])],
  ['3333CCC', new Map([['2026-10-02', 5], ['2026-10-03', 16], ['2026-10-04', 12]])],
]);
const r = R.calcular({
  per, tablero, horas, cubierto,
  primera: new Map([['1', '2026-09-03'], ['2', '2026-09-03'], ['3', '2026-10-03']]),
  parado: new Map([['2|2026-10-04', 'En taller']]),
  descansos: [{ v: '1', t: null, d: '2026-09-01', h: '9999-12-31', dias: [3, 4] }, { v: '2', t: 1, d: '2026-09-01', h: '9999-12-31', dias: [5] }, { v: '2', t: 2, d: '2026-09-01', h: '9999-12-31', dias: [6] }],
  sinCt: [{ v: '2', d: '2026-09-01', h: '9999-12-31' }],
});
const A = r.grupos.find(g => g.k === 'c10').coches[0], B = r.grupos.find(g => g.k === 'c20').coches[0], Cc = r.sinCuadrante.coches[0];
igual('Coche con CT: 16 h al día, todos los días (31 × 16 y 4 × 16 hasta el corte)', [A.objMes, A.objAyer, A.llevan, r3(A.pct)], [496, 64, 48, 0.75]);
igual('…la noche del jueves (libra su fijo) sin nadie es falta de CT; el día del viernes, falta de fijo', [A.sinPasados, A.sinCtPasados, A.perdidas, A.perdidasCt], [2, 1, 16, 8]);
igual('…de aquí a fin de mes: 27 días × 2 turnos, y lo que necesitan por turno', [A.restantes, r3(A.porTurno)], [54, r3(448 / 54)]);
igual('…y hoy le faltan 2 días de CT de noche', [A.falta, A.ctNoche, A.fijosFaltan], [['2 días de CT de noche'], 2, 0]);
igual('Coche sin CT: el turno del fijo que libra no se pide; el día de taller tampoco', [B.objAyer, B.llevan, r3(B.pct), B.diasParado, B.dias[3].parado], [32, 32, 1, 1, 'En taller']);
igual('…en el resto del mes: 27 días × 2 menos 4 viernes y 4 sábados', B.objMes - B.objAyer, (27 * 2 - 8) * 8);
igual('…y no pide CT aunque el planificador diga días', [B.ctDia, B.ctNoche, B.falta], [0, 0, []]);
igual('Coche que entra a mitad de mes: cuenta desde su primera plaza; las horas de antes no', [Cc.objAyer, Cc.llevan, Cc.dias[1].antes], [32, 28, true]);
igual('…sin fijo de día: falta el fijo y no se piden días de CT de ese turno', [Cc.fijosFaltan, Cc.ctDia, Cc.falta], [1, 0, ['el fijo de día']]);
igual('Los coches sin cuadrante van aparte: el total es de los cuadrantes', [r.total.coches, r.total.objAyer, r.total.llevan, r.sinCuadrante.tot.coches], [2, 96, 80, 1]);
igual('La zona suma sus cuadrantes', [r.zonas.length, r.zonas[0].zona, r.zonas[0].tot.objAyer], [1, 'Norte', 96]);
const parado = R.calcular({ per, tablero: { coches: [cocheB], cuadrantes: tablero.cuadrantes, zonas: [] }, horas: new Map([['2222BBB', new Map([['2026-10-04', 9]])]]), cubierto,
  primera: new Map(), parado: new Map([['2|2026-10-04', 'En taller']]), descansos: [], sinCt: [] });
igual('Si BOLT dice que rodó (1 h o más) el día de taller, el historial está mal y el día cuenta', [parado.grupos[0].coches[0].diasParado, parado.grupos[0].coches[0].dias[3].obj], [0, 16]);

// ── El ejecutivo ──
const inf = { per, horasTurno: 8, diasPorCt: 6, ...r, personas: new Map(), contactos: new Map(), modelo: new Map(), etiquetaEstado: new Map([['X', 'En taller']]) };
const e = R.ejecutivo(inf);
igual('La frase dice cómo van', /van al 83,3 %/.test(e.frase), true);
igual('El déficit, por su causa: CT, fijo y el resto', e.cascada.map(p => Math.round(p.valor)), [96, -8, -8, 0, 80]);
igual('Seis cifras arriba', e.kpis.length, 6);
igual('Los cuadrantes de peor a mejor', e.cuadrantes.map(c => c.etq), ['C1', 'C2']);
igual('Qué le pasa al peor: las causas en horas y, en curso, lo que falta hoy', e.peores[0].que,
  'Le faltan 16 h: 8 de turnos del fijo sin nadie (1 turno) y 8 de días de CT sin nadie (1 turno). Hoy falta el CT de noche.');
igual('Por qué mirar un coche: los turnos perdidos primero', e.coches.find(c => c.mat === '1111AAA').por, '2 turnos sin nadie (16 h, 1 de CT); hoy faltan 2 días de CT de noche.'.replace(/^./, m => m.toUpperCase()));
igual('Los que mejor van no repiten los de la tabla de peores', e.mejores, []);
igual('La falta de CT, la misma cifra en la cifra de arriba y en la cascada', [e.kpis[4].valor, -e.cascada[1].valor], ['8 h', 8]);
igual('Lo que falta: primero los fijos', e.faltan.map(f => f.que), ['Fijo de día: sin nadie', 'CT de noche (2 días)']);
igual('Prioridades: la cifra primero; CT, y luego los fijos', [/^La falta de CT ya ha costado 8 h\. Poner los correturnos que faltan/.test(e.prioridades[0]), /^Cubrir los fijos: /.test(e.prioridades[1])], [true, true]);
igual('Lo que falta hoy cuenta también los coches sin cuadrante', e.kpis[5].valor, '1 fijo · 1 CT');
const vacio = R.ejecutivo({ ...inf, per: R.periodo('2026-10', '2026-10-01'), ...R.calcular({ per: R.periodo('2026-10', '2026-10-01'), tablero, horas, cubierto, primera: new Map(), parado: new Map(), descansos: [], sinCt: [] }) });
igual('El día 1 aún no hay días cerrados, y lo dice (también arriba, sin «del 1 al 30»)', [/Aún no hay ningún día cerrado/.test(vacio.frase), /^Aún sin días cerrados/.test(vacio.sub), vacio.kpis[1].valor], [true, true, '—']);

// ── Un mes que ya terminó ──
// Octubre visto el 05/11: el coche B estuvo en el taller el 31; hoy el planificador lo da rodando.
const perC = R.periodo('2026-10', '2026-11-05');
const rc = R.calcular({ per: perC, tablero, horas, cubierto, primera: new Map([['1', '2026-09-03'], ['2', '2026-09-03'], ['3', '2026-10-03']]),
  parado: new Map([['2|2026-10-31', 'En taller']]), descansos: [], sinCt: [] });
const Bc = rc.grupos.find(g => g.k === 'c20').coches[0], Ac = rc.grupos.find(g => g.k === 'c10').coches[0];
igual('Mes cerrado: si rodaba sale de su historial del último día, no del planificador de hoy', [Bc.rueda, Bc.estadoCorte, Ac.rueda], [false, 'En taller', true]);
igual('…y lo que falta no se da: es una foto que no se puede rehacer', [Ac.falta, Ac.ctNoche, rc.total.fijosFaltan], [null, 0, 0]);
const ec = R.ejecutivo({ ...inf, per: perC, ...rc });
igual('…el ejecutivo habla en pasado y sin la foto', [ec.cerrado, ec.kpis[0].etq, ec.kpis[5].valor, ec.faltan.length, /^Octubre entero · reparto de cuadrantes de hoy/.test(ec.sub)], [true, 'Cómo fueron', '—', 0, true]);
// Un coche que tuvo plaza hasta el 2 y hoy ya no está en el planificador.
const extra = { vehiculoId: 9, matricula: '9999ZZZ', cuadranteId: null, operativo: true, sinCT: false, personas: [], falta: { fijo: {}, ct: {} }, extra: true };
const rx = R.calcular({ per, tablero: { ...tablero, coches: [extra] }, horas: new Map([['9999ZZZ', new Map([['2026-10-01', 10], ['2026-10-03', 7]])]]), cubierto,
  primera: new Map([['9', '2026-09-03']]), ultima: new Map([['9', '2026-10-02']]), parado: new Map(), descansos: [], sinCt: [] });
const X = rx.sinCuadrante.coches[0];
igual('Coche que dejó el planificador: cuenta hasta su último día con plaza, sin cuadrante', [X.objAyer, X.llevan, X.dias[2].despues, X.rueda, X.estadoCorte], [32, 10, true, false, 'ya no está en el planificador']);

(async () => {
  // DOS PÁGINAS SIEMPRE, también con cuarenta cuadrantes, cien coches y textos que
  // la fuente del PDF no sabe escribir (flechas, emojis, comillas).
  const muchos = [];
  for (let i = 0; i < 40; i++) {
    muchos.push({ vehiculoId: 100 + i, matricula: `${1000 + i}XYZ`, cuadranteId: 1000 + i, operativo: i % 7 !== 0, sinCT: false,
      personas: [{ id: 1, desde: '2026-01-01', hasta: '2026-10-20' }], falta: { fijo: { dia: i % 3 === 0, noche: i % 5 === 0 }, ct: { dia: 2, noche: 2 } } });
  }
  const per2 = R.periodo('2026-10', '2026-10-27');
  const r2 = R.calcular({ per: per2, tablero: { coches: muchos, cuadrantes: muchos.map((c, i) => ({ id: 1000 + i, numero: i + 1, nombre: 'C' + (i + 1), zona: `Zona larguísima → número ${i % 6} 🚗 “de prueba”` })), zonas: [] },
    horas: new Map(muchos.map((c, i) => [c.matricula, new Map(per2.dias.slice(0, 26).map(d => [d, (i * 3) % 17]))])), cubierto: new Set(), primera: new Map(), parado: new Map(), descansos: [], sinCt: [] });
  const e2 = R.ejecutivo({ ...inf, per: per2, ...r2 });
  const pdf = await require('../modules/Control/rendimiento.pdf').generar(e2);
  igual('Con 40 cuadrantes y textos raros, el ejecutivo sale y son 2 páginas', (await PDFDocument.load(pdf)).getPageCount(), 2);
  const pdf1 = await require('../modules/Control/rendimiento.pdf').generar(e);
  igual('El caso pequeño, también 2 páginas', (await PDFDocument.load(pdf1)).getPageCount(), 2);
  const pdfV = await require('../modules/Control/rendimiento.pdf').generar(vacio);
  igual('Sin días cerrados, también sale', (await PDFDocument.load(pdfV)).getPageCount(), 2);
  const xlsx = await require('../modules/Control/rendimiento.excel').generar(inf);
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsx);
  igual('El Excel: Resumen y una pestaña por cuadrante (y la de sin cuadrante)', wb.worksheets.map(w => w.name), ['Resumen', 'C1 Norte', 'C2 Norte', 'Sin cuadrante']);

  console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
