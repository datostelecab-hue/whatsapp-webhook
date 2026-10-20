// ============================================================
// LA NÓMINA VARIABLE — las reglas
// ============================================================
// Las que cambiaron el 16/10/2026 y las que no se pueden romper:
//   · cada J vale SUS horas, sumadas a las rodadas (como en la bitácora); sin
//     horas no suma, y antes del arranque no cuenta; en un día de vacaciones,
//     permiso o baja tampoco (20/10/2026: manda la marca, como en la bitácora);
//   · utilización: quien llega al 75 % no pierde nada; a quien no llega se le
//     quita espera hasta dejarlo en el 85 %, nunca viaje;
//   · la ETT no cobra MBO y no sale en la nómina, pero sí en su parte;
//   · la config guardada con claves retiradas no se cuela;
//   · las vacaciones (5,84 h por día natural) y los permisos (8 h) suman para
//     el objetivo, solo en su ventana;
//   · la NÓMINA BASE: del 26 al 25 y hasta ayer, horas × 8,16 € con tope en el
//     salario base de su jornada prorrateado por los días de contrato, y la
//     nómina entera = base + variables.
//
//   node scripts/comprobar-nomina.js
//
// No toca la base: el repositorio se sustituye.
const path = require('path');

const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};

// Septiembre de 2026: tres personas de propia y una de ETT (y, para la base,
// una que entra el 6 de octubre y otra que se fue el 20 de septiembre).
const H = h => h * 3600;
const tramos = new Map([
  [1, { horasSeg: H(180), viajeSeg: H(135), esperaSeg: H(45), nocSeg: H(10), primerDia: 1, porDia: new Map([[3, H(2)]]) }],     // 75 % justo
  [2, { horasSeg: H(180), viajeSeg: H(133.2), esperaSeg: H(46.8), nocSeg: 0, primerDia: 1, porDia: new Map() }],               // 74 %
  [3, { horasSeg: H(100), viajeSeg: H(90), esperaSeg: H(10), nocSeg: 0, primerDia: 1, porDia: new Map() }],                    // 90 %
  [4, { horasSeg: H(200), viajeSeg: H(100), esperaSeg: H(100), nocSeg: H(20), primerDia: 1, porDia: new Map() }],             // ETT al 50 %
  [5, { horasSeg: H(40), viajeSeg: H(36), esperaSeg: H(4), nocSeg: 0, primerDia: 6, porDia: new Map() }],                     // entra el 06/10
  [6, { horasSeg: H(120), viajeSeg: H(108), esperaSeg: H(12), nocSeg: H(5), primerDia: 1, porDia: new Map() }],               // se fue el 20/09
]);
// Lo que da el repositorio de verdad: recortado a las fechas que se piden.
const entre = (lista, desde, hasta) => lista.filter(iso => iso >= desde && iso <= hasta);
const AUSENCIAS = { 1: { vacaciones: ['2026-09-20', '2026-09-21'], permiso: ['2026-09-22', '2026-10-02'] },
  3: { vacaciones: ['2026-09-05'], permiso: [] } };
sustituir('modules/Nominas/nominas.repo.js', {
  leerConfig: async () => ({ eurHoraNoc: 9.9, utilMinima: 0.65, lUtilizacion: 0.75, diasObjetivo: 22 }),
  horasDelMes: async () => tramos,
  dineroDelMes: async () => new Map([[4, { neto: 9000, propinas: 10, peajes: 5 }]]),
  fichasDelMes: async () => new Map([
    [1, { nombre: 'Uno', alta: '2025-01-01', jornada: 40 }],
    [2, { nombre: 'Dos', alta: '2025-01-01', jornada: 40 }],
    [3, { nombre: 'Tres', alta: '2026-09-10', jornada: 40 }],
    [4, { nombre: 'Cuatro', alta: '2025-01-01', jornada: 40, ett: true }],
    [5, { nombre: 'Cinco', alta: '2026-10-06', jornada: 32 }],
    [6, { nombre: 'Seis', alta: '2025-01-01', baja: '2026-09-20', jornada: 40 }],
  ]),
  ausenciasDelPeriodo: async (desde, hasta) => new Map(Object.entries(AUSENCIAS).map(([cid, a]) =>
    [Number(cid), { vacaciones: entre(a.vacaciones, desde, hasta), permiso: entre(a.permiso, desde, hasta) }])),
  // J: a Uno una de 3,5 h el día 3 (en el que rodó 2 h) y otra sin horas el 4;
  // a Tres una de 8 h el día 5, ANTES de su alta del 10.
  justificantesDelMes: async () => new Map([
    // Y una de 8 h el 20, en sus vacaciones: el repositorio la aparta (tapadas).
    [1, { aprobados: [3, 4], horas: new Map([[3, H(3.5)], [4, 0]]), fechas: new Map([['2026-09-03', H(3.5)], ['2026-09-04', 0]]),
      pendientes: 1, pendientesDias: [9], tapadas: [{ dia: 20, fecha: '2026-09-20', estado: 'vacaciones', horas: 8, aprobada: true }] }],
    [3, { aprobados: [5], horas: new Map([[5, H(8)]]), fechas: new Map([['2026-09-05', H(8)], ['2026-09-30', H(4)]]),
      pendientes: 0, pendientesDias: [] }],
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

  igual('La nómina es solo de propia; la ETT va aparte (y quien entra el 06/10 no es de septiembre)',
    [r.filas.map(f => f.conductorId).sort(), r.filasETT.map(f => f.conductorId), r.avisos.ett], [[1, 2, 3, 6], [4], 1]);

  // ── Las J ──────────────────────────────────────────────────────────────────
  igual('Cada J vale sus horas, sumadas a lo rodado (3,5 h aunque ese día rodó 2)',
    [uno.horasJustificadas, uno.diasJustificados], [3.5, 2]);
  igual('Una J aprobada sin horas no suma, y se avisa', [uno.jSinHoras, r.avisos.jSinHoras], [1, 1]);
  igual('Una J anterior al alta no cuenta', [tres.horasJustificadas, tres.diasJustificados], [0, 0]);
  igual('Vacaciones a 5,84 h por día y permiso a 8 h, solo los del mes',
    [uno.diasVacaciones, uno.horasVacaciones, uno.diasPermiso, uno.horasPermiso], [2, 11.68, 1, 8]);
  igual('Las vacaciones antes del alta no cuentan', [tres.diasVacaciones, tres.horasVacaciones], [0, 0]);
  igual('La diferencia lleva dentro las J, las vacaciones y los permisos',
    uno.deltaHoras, Math.round((180 + 3.5 + 11.68 + 8 - 172) * 100) / 100);
  igual('Las J pendientes no cuentan, pero se avisan', r.avisos.jPendientes, 1);
  igual('Una J en un día de vacaciones no suma (manda la marca), y se dice cuál y se avisa',
    [uno.horasJustificadas, uno.jTapadas, r.avisos.jTapadas], [3.5, [{ fecha: '2026-09-20', estado: 'vacaciones', horas: 8 }], 1]);
  const texto = require('../modules/Nominas/nominas.excel.js')._comoSale(uno, cfg);
  igual('«Cómo sale su total» dice qué J no ha contado y por qué', texto.includes('+ 3,5 de J (sin la J del 20/09, de vacaciones)'), true);

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

  // ── La nómina base ───────────────────────────────────────────────────────
  const v = N._ventanaBase(10, 2026, '2026-10-16');
  igual('La base de octubre va del 26/09 al 25/10, y hoy hasta ayer',
    [v.desde, v.cierre, v.hasta, v.diasPeriodo, v.diasHastaAhora, v.enCurso], ['2026-09-26', '2026-10-25', '2026-10-15', 30, 20, true]);
  const vc = N._ventanaBase(10, 2026, '2026-11-03');
  igual('Cerrado el periodo, va hasta el 25', [vc.hasta, vc.enCurso], ['2026-10-25', false]);
  igual('La de enero cruza el año', [N._ventanaBase(1, 2027, '2027-02-01').desde, N._ventanaBase(1, 2027, '2027-02-01').diasPeriodo], ['2026-12-26', 31]);

  const b = await N.nominaBase(10, 2026, { hoy: '2026-10-16', variables: r });
  const bde = id => b.filas.find(x => x.conductorId === id);
  igual('En la base, solo propia: quien tiene contrato en el periodo y quien solo tiene variables',
    b.filas.map(x => x.conductorId).sort(), [1, 2, 3, 5, 6]);
  const b1 = bde(1);
  igual('Las J y las vacaciones de fuera del periodo no cuentan en la base; el permiso del 02/10 sí',
    [b1.horasJustificadas, b1.diasVacaciones, b1.diasPermiso, b1.horasBase], [0, 0, 1, 188]);
  igual('Quien pasa del tope cobra el tope; lo que pasa va a las variables',
    [b1.importe, b1.tope, b1.base, b1.sobreElTope, b1.llegaAlTope], [1534.08, 1443, 1443, 91.08, true]);
  const b2 = bde(2);
  const h2 = Math.round((180 - (180 - 133.2 / 0.85)) * 100) / 100;
  igual('La base lleva el mismo recorte por utilización (74 % → 85 %)', b2.horasBase, h2);
  igual('Quien no llega cobra lo que hizo', [b2.base, b2.llegaAlTope, b2.faltaParaElTope],
    [Math.round(h2 * 8.16 * 100) / 100, false, Math.round((1443 - h2 * 8.16) * 100) / 100]);
  igual('La J del 30/09 de Tres sí entra en la base', bde(3).horasJustificadas, 4);
  const b5 = bde(5);
  igual('Quien entra el 06/10 con 32 h: tope de 20 de 30 días de 1.154 €',
    [b5.diasContrato, b5.tope, b5.base], [20, Math.round(1154 * 20 / 30 * 100) / 100, Math.round(40 * 8.16 * 100) / 100]);
  const b6 = bde(6);
  igual('Quien se fue antes del 26: base 0 y cobra sus variables',
    [b6.diasContrato, b6.base, b6.variables, b6.total], [0, 0, de(6).total, de(6).total]);
  igual('La nómina entera = base + variables', b1.total, Math.round((1443 + uno.total) * 100) / 100);
  igual('Ordenada de mayor a menor total', b.filas.every((x, i) => i === 0 || b.filas[i - 1].total >= x.total), true);
  const tope20 = N._filaBase({ jornada: 20, alta: '2025-01-01', horas: 200, viajeH: 180, esperaH: 20, jFechas: new Map(), vacaciones: [], permiso: [] },
    cfg, v).tope;
  igual('Una jornada de 20 h: el tope de 40 por regla de tres', tope20, Math.round(1443 / 2 * 100) / 100);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
