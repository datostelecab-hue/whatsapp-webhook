// ============================================================
// COMPROBAR HORAS CAVEREL (db/238) — sin base de datos
// ============================================================
// Lo puro de modules/Operaciones/caverel.service.js: leer el CSV de BOLT, las
// cuentas de viaje, espera y utilización, y lo que se rechaza.
//
//   node scripts/comprobar-horas-caverel.js

const S = require('../modules/Operaciones/caverel.service');

let fallos = 0;
function igual(que, real, esperado) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) console.log(`OK    ${que}`);
  else { fallos++; console.log(`FALLA ${que}\n      esperado ${b}\n      real     ${a}`); }
}
function lanza(que, fn, patron) {
  try { fn(); fallos++; console.log(`FALLA ${que}: no lanzó`); }
  catch (e) { if (patron.test(e.message)) console.log(`OK    ${que}`); else { fallos++; console.log(`FALLA ${que}: ${e.message}`); } }
}

const CAB = ',Driver Name,Hashed External ID,Company Name,Dynamic Timeframe,Total Trip Payments,Net Trip Earnings,Finished Trips Count,Total Online Hours,Occupation Rate,Personal Code';
const csv = lineas => '﻿' + [CAB, ...lineas].join('\r\n') + '\r\n';

// ── El CSV ──────────────────────────────────────────────────────────────────
igual('CSV: comillas con coma dentro y "" escapadas',
  S.leerCsv('a,"b, c","d ""e"""\n1,2,3'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
igual('CSV: CRLF, BOM y líneas vacías fuera', S.leerCsv('﻿x,y\r\n\r\n1,2\r\n'), [['x', 'y'], ['1', '2']]);

// ── El archivo ──────────────────────────────────────────────────────────────
const ARCH = csv([
  '1,Ana Pérez,AAA111,"TIBUS LUXURY SERVICES, S.L.",2026-06,"9,678.37","7,366.97",595,282.50,90.00%,x1234567r',
  '2,Ana Pérez,AAA111,"TIBUS LUXURY SERVICES, S.L.",2026-05,"1,000.00",800.00,50,"1,00.00",50.00%,X1234567R',
  '3,Beto Gil,BBB222,"TIBUS LUXURY SERVICES, S.L.",2026-06,0.00,0.00,0,0.00,0.00%,Y7654321Z',
  '4,,,,2025-03,0.00,0.00,0,0.00,0.00%,',
  '5,Caro Ruiz,CCC333,"TIBUS LUXURY SERVICES, S.L.",2026-06,10.00,8.00,1,0.21,1.00%,',
  '6,Caro Ruiz,CCC333,"TIBUS LUXURY SERVICES, S.L.",2026-06,10.00,8.00,2,0.50,0.00%,',
]);
const L = S.interpretar(ARCH);
igual('Archivo: entran Ana (dos meses) y Caro; Beto sin actividad y la fila vacía, fuera',
  L.filas.map(f => `${f.nombre} ${f.mes} ${f.horas} ${f.ocupacion} ${f.viajes}`),
  ['Ana Pérez 2026-06-01 282.5 90 595', 'Ana Pérez 2026-05-01 100 50 50', 'Caro Ruiz 2026-06-01 0.5 0 2']);
igual('Archivo: lo que no entra, contado', [L.sinActividad, L.sinNombre, L.repetidas, L.malas.length], [1, 1, 1, 0]);
igual('Archivo: el DNI en mayúsculas; sin DNI, null', [L.filas[0].dni, L.filas[2].dni], ['X1234567R', null]);
igual('Archivo: la misma cuenta y mes dos veces, vale la última', L.filas[2].viajes, 2);

lanza('No es el informe: dice qué columnas faltan', () => S.interpretar('a,b\n1,2'), /le falta «Driver Name».*«Total Online Hours»/);
const malo = S.interpretar(csv([
  '1,Ana Pérez,AAA111,X,2026-13,1,1,1,10.00,50.00%,X1',
  '2,Beto Gil,BBB222,X,2026-06,1,1,1,diez,50.00%,Y1',
  '3,Caro Ruiz,CCC333,X,2026-06,1,1,1,10.00,150.00%,Z1',
  '4,Dani Sol,DDD444,X,2026-06-01,1,1,1,10.00,50.00%,W1',
]));
igual('Filas que no se pueden leer: mes 13, horas sin número, % de más, mes de día (no agrupado por meses)',
  malo.malas.map(m => m.linea), [2, 3, 4, 5]);

// ── Las cuentas ─────────────────────────────────────────────────────────────
igual('Desglose: viaje = horas × utilización; espera, el resto', S.desglose(282.5, 90), { horas: 282.5, viaje: 254.25, espera: 28.25, utilizacion: 90 });
igual('Desglose sin utilización: no se inventa el viaje', S.desglose(10, null), { horas: 10, viaje: null, espera: null, utilizacion: null });
igual('Suma: la utilización es la del tiempo total, no la media de los %',
  S.sumar([S.desglose(100, 90), S.desglose(10, 10)].map((d, i) => ({ ...d, viajes: i + 1 }))),
  { horas: 110, viajes: 3, viaje: 91, espera: 19, utilizacion: 82.7 });
igual('Suma: las filas sin utilización suman horas pero no entran en el %',
  S.sumar([{ ...S.desglose(100, 50), viajes: 0 }, { ...S.desglose(20, null), viajes: 0 }]),
  { horas: 120, viajes: 0, viaje: 50, espera: 50, utilizacion: 50 });

console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);
