// ============================================================
// LA NÓMINA VARIABLE — las reglas
// ============================================================
// Las que cambiaron el 16/10/2026 y las que no se pueden romper:
//   · cada J vale SUS horas, sumadas a las rodadas (como en la bitácora); sin
//     horas no suma, y antes del arranque no cuenta;
//   · utilización: quien llega al 75 % no pierde nada; a quien no llega se le
//     quita espera hasta dejarlo en el 85 %, nunca viaje;
//   · la ETT no cobra MBO y no sale en la nómina, pero sí en su parte;
//   · la config guardada con claves retiradas no se cuela.
//
//   node scripts/comprobar-nomina.js
//
// No toca la base: el repositorio se sustituye.
const path = require('path');

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

// Septiembre de 2026: tres personas de propia y una de ETT.
const H = h => h * 3600;
const tramos = new Map([
  [1, { horasSeg: H(180), viajeSeg: H(135), esperaSeg: H(45), nocSeg: H(10), primerDia: 1, porDia: new Map([[3, H(2)]]) }],     // 75 % justo
  [2, { horasSeg: H(180), viajeSeg: H(133.2), esperaSeg: H(46.8), nocSeg: 0, primerDia: 1, porDia: new Map() }],               // 74 %
  [3, { horasSeg: H(100), viajeSeg: H(90), esperaSeg: H(10), nocSeg: 0, primerDia: 1, porDia: new Map() }],                    // 90 %
  [4, { horasSeg: H(200), viajeSeg: H(100), esperaSeg: H(100), nocSeg: H(20), primerDia: 1, porDia: new Map() }],             // ETT al 50 %
]);
sustituir('modules/Nominas/nominas.repo.js', {
  leerConfig: async () => ({ eurHoraNoc: 9.9, utilMinima: 0.65, lUtilizacion: 0.75, diasObjetivo: 22 }),
  horasDelMes: async () => tramos,
  dineroDelMes: async () => new Map([[4, { neto: 9000, propinas: 10, peajes: 5 }]]),
  fichasDelMes: async () => new Map([
    [1, { nombre: 'Uno', alta: '2025-01-01', jornada: 40 }],
    [2, { nombre: 'Dos', alta: '2025-01-01', jornada: 40 }],
    [3, { nombre: 'Tres', alta: '2026-09-10', jornada: 40 }],
    [4, { nombre: 'Cuatro', alta: '2025-01-01', jornada: 40, ett: true }],
  ]),
  // J: a Uno una de 3,5 h el día 3 (en el que rodó 2 h) y otra sin horas el 4;
  // a Tres una de 8 h el día 5, ANTES de su alta del 10.
  justificantesDelMes: async () => new Map([
    [1, { aprobados: [3, 4], horas: new Map([[3, H(3.5)], [4, 0]]), pendientes: 1, pendientesDias: [9] }],
    [3, { aprobados: [5], horas: new Map([[5, H(8)]]), pendientes: 0, pendientesDias: [] }],
  ]),
  sinSellarEnBitacora: async () => [],
});
const N = require('../modules/Nominas/nominas.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  const cfg = await N.leerConfig();
  igual('La config guardada con claves retiradas no se cuela, y manda lo guardado',
    [cfg.utilMinima, cfg.lUtilizacion, cfg.diasObjetivo, cfg.eurHoraNoc, cfg.utilUmbral, cfg.utilExigida],
    [undefined, undefined, undefined, 9.9, 0.75, 0.85]);

  const r = await N.calcular(10, 2026);
  const de = id => [...r.filas, ...r.filasETT].find(f => f.conductorId === id);
  const [uno, dos, tres, cuatro] = [1, 2, 3, 4].map(de);

  igual('La nómina es solo de propia; la ETT va aparte',
    [r.filas.map(f => f.conductorId).sort(), r.filasETT.map(f => f.conductorId), r.avisos.ett], [[1, 2, 3], [4], 1]);

  // ── Las J ──────────────────────────────────────────────────────────────────
  igual('Cada J vale sus horas, sumadas a lo rodado (3,5 h aunque ese día rodó 2)',
    [uno.horasJustificadas, uno.diasJustificados], [3.5, 2]);
  igual('Una J aprobada sin horas no suma, y se avisa', [uno.jSinHoras, r.avisos.jSinHoras], [1, 1]);
  igual('Una J anterior al alta no cuenta', [tres.horasJustificadas, tres.diasJustificados], [0, 0]);
  igual('La diferencia lleva las J dentro', uno.deltaHoras, Math.round((180 + 3.5 - 172) * 100) / 100);
  igual('Las J pendientes no cuentan, pero se avisan', r.avisos.jPendientes, 1);

  // ── La utilización ────────────────────────────────────────────────────────
  igual('Con el 75 % justo no se quita nada', uno.horasEsperaQuitadas, 0);
  igual('Con el 90 % tampoco', tres.horasEsperaQuitadas, 0);
  const x = 180 - 133.2 / 0.85;
  igual('Con el 74 % se le exige el 85 %: se quita espera hasta dejarlo ahí',
    [dos.horasEsperaQuitadas, Math.round(133.2 / (180 - dos.horasEsperaQuitadas) * 1000) / 1000],
    [Math.round(x * 100) / 100, 0.85]);
  igual('Nunca más espera de la que tuvo (ni viaje)', dos.horasEsperaQuitadas <= 46.8, true);
  const alReves = N._calcularFila({ conductorId: 9, alta: '2025-01-01', horas: 100, viajeH: 70, esperaH: 30, utilPct: 70, jDias: [] },
    30, { ...cfg, utilUmbral: 0.9, utilExigida: 0.6 }, 9, 2026);
  igual('Con el umbral por encima de la exigida no se quita nada en negativo', alReves.horasEsperaQuitadas, 0);
  igual('La ETT también lleva el recorte (es la hora que se le factura)', cuatro.horasEsperaQuitadas, Math.round((200 - 100 / 0.85) * 100) / 100);

  // ── Lo que se cobra ───────────────────────────────────────────────────────
  igual('Nocturnas a 9,9 € × 0,1 la hora', uno.nocturnas, 9.9);
  igual('La ETT no cobra ningún MBO, pero sí nocturnas, propinas y peajes',
    [cuatro.mboFAS, cuatro.mboHsExt, cuatro.diasExtra, cuatro.total], [0, 0, 0, Math.round((19.8 + 10 + 5) * 100) / 100]);
  igual('La fila lleva la facturación neta, de la que sale el FAS (la pide el resumen del Excel)',
    [uno.neto, cuatro.neto], [0, 9000]);
  igual('Los totales de la nómina son solo de propia',
    r.totales.nocturnas, Math.round(r.filas.reduce((a, f) => a + f.nocturnas, 0) * 100) / 100);

  // ── El parte de la ETT sale de las mismas filas ───────────────────────────
  const p = await N.paraETT(9, 2026);
  igual('El parte de la ETT trae a los suyos con sus listones',
    [p.filas.map(f => f.conductorId), p.utilUmbral, p.utilExigida, p.filas[0].horasTrabajadas],
    [[4], 0.75, 0.85, Math.round((200 - cuatro.horasEsperaQuitadas) * 100) / 100]);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
