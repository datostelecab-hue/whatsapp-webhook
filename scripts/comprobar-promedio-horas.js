// ============================================================
// EL PROMEDIO DE HORAS DE LA CASA — las reglas
// ============================================================
// El que usan la bitácora, la ficha, la letra (calificación), el planificador,
// Control y los reportes desde el 15/10/2026 (bitacora.service.promedioHoras):
//
//   promedio = horas ÷ (días que salió + «Ausencias» a 0 h), hasta ayer
//
// con las horas de BOLT de su turno más las J APROBADAS, y sin contar libranzas,
// vacaciones, bajas, permisos, situaciones sin marca, días sin plaza, fuera de
// contrato ni hoy.
//
//   node scripts/comprobar-promedio-horas.js
//
// No toca la base: la rejilla de la bitácora se inventa aquí.
const path = require('path');

let rejilla = null;
const sustituir = (rel, exp) => {
  const f = require.resolve(path.join(__dirname, '..', rel));
  require.cache[f] = { id: f, filename: f, loaded: true, exports: exp };
};
sustituir('modules/Operaciones/bitacora.repo.js', { leerBitacora: async () => rejilla });
const bit = require('../modules/Operaciones/bitacora.service');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

// Octubre de 2026: el índice 0 es el día 1 y hoy es el 15 (índice 14).
const INICIO = { y: 2026, m: 9, d: 1 };
const HOY = 14;
// Lo que no se dice, libranza: así cada caso solo cuenta lo que pone.
const persona = (id, dias, extra = {}) => ({
  conductorId: id, altaIdx: 0, bajaIdx: null, huecos: [], sinPlaza: [], situaciones: [],
  justif: {}, horasBolt: {}, dias: dias.concat(new Array(31 - dias.length).fill('L')), ...extra,
});
const de = (porId, id) => porId.get(String(id)) || null;

(async () => {
  rejilla = {
    inicio: INICIO, hoyIdx: HOY,
    conductores: [
      // 1. Lucía: tres días de noche y una J aprobada de 1 h el 14.
      persona(1, [null, null, null, null, null, null, null, null, null, 10.25, 10.53, 'L', 'L', 'J', null],
        { altaIdx: 9, justif: { '2026-10-14': { estado: 'aprobada', horas: 1 } }, horasBolt: { '2026-10-14': 8.36 } }),
      // 2. Salió dos días, falta uno, libra dos, vacaciones dos.
      persona(2, [8, 'L', 'L', null, 6, 'V', 'V']),
      // 3. Una J pendiente: cuenta el día, no sus horas.
      persona(3, ['J', 8], { justif: { '2026-10-01': { estado: 'pendiente', horas: 8 } }, horasBolt: { '2026-10-01': 2 } }),
      // 4. Días sin plaza y una suspensión: no son ausencias.
      persona(4, [null, null, 7, null, null, null], { sinPlaza: [[0, 1]], situaciones: [[3, 4, 'Suspensión de empleo y sueldo']] }),
      // 5. Antes de su alta no cuenta, salvo que trabajara.
      persona(5, [5, null, 9], { altaIdx: 2 }),
      // 6. Hoy no cuenta: ni sus horas ni como ausencia.
      persona(6, Object.assign(new Array(15).fill(null), { 13: 8, 14: 3 })),
      // 7. Solo libranzas y vacaciones: no hay nada que promediar.
      persona(7, ['L', 'V', 'B', 'P']),
    ],
  };
  const r = await bit.promedioHoras({});
  igual('El mes corrido, hasta ayer', [r.desde, r.hasta], ['2026-10-01', '2026-10-14']);
  igual('Lucía: 3 turnos y una J aprobada sumada a sus horas → 10 h',
    de(r.porId, 1), { promedio: 10, conAus: 10, media: 10, horas: 30.1, dias: 3, ausencias: 0 });
  igual('Libranzas y vacaciones no cuentan; la ausencia sí, a 0 h',
    de(r.porId, 2), { promedio: 4.7, conAus: 4.7, media: 7, horas: 14, dias: 2, ausencias: 1 });
  igual('J pendiente: el día cuenta con lo de BOLT, sus horas aún no',
    de(r.porId, 3), { promedio: 5, conAus: 5, media: 5, horas: 10, dias: 2, ausencias: 0 });
  igual('Días sin plaza y suspensión no son ausencias; el resto sí',
    de(r.porId, 4), { promedio: 3.5, conAus: 3.5, media: 7, horas: 7, dias: 1, ausencias: 1 });
  igual('Antes del alta solo cuenta si trabajó',
    de(r.porId, 5), { promedio: 7, conAus: 7, media: 7, horas: 14, dias: 2, ausencias: 0 });
  const seis = de(r.porId, 6);
  igual('Hoy no cuenta: 8 h de ayer entre 1 día que salió y 13 ausencias', [seis.horas, seis.dias, seis.ausencias], [8, 1, 13]);
  igual('Solo libranzas, vacaciones, bajas y permisos: sin promedio', de(r.porId, 7), null);

  const sep = await bit.promedioHoras({ hasta: '2026-10-03' });
  igual('Con «hasta», el mes corrido de esa fecha', [sep.desde, sep.hasta, de(sep.porId, 2).dias], ['2026-10-01', '2026-10-03', 1]);
  const tramo = await bit.promedioHoras({ desde: '2026-10-05', hasta: '2026-10-07' });
  igual('Con «desde» y «hasta», ese tramo', de(tramo.porId, 2), { promedio: 6, conAus: 6, media: 6, horas: 6, dias: 1, ausencias: 0 });
  igual('mediaDelMes es el mismo número (lo lee el Excel de Plantilla)',
    de((await bit.mediaDelMes({})).porId, 2), de(r.porId, 2));

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
