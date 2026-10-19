// ============================================================
// LA PUNTUACIÓN DE CADA SEMANA, SELLADA (19/10/2026, db/210)
// ============================================================
//   node scripts/comprobar-puntuacion-semanal.js
//
// Lo que ve el conductor en su portal: una nota por semana (lunes a domingo),
// desde el 01/09/2026, con el modelo de la letra, sellada y sin cambios.
// No toca la base: las fechas son funciones puras, y el sellado se prueba con
// dobles de la base y del cálculo.

const db = require('../services/db');
const cal = require('../services/repo/calificacion');
const ps = require('../services/repo/puntuacionSemanal');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  // ── 1. Las semanas ───────────────────────────────────────────────────────
  igual('El lunes de un lunes es él mismo', ps.lunesDe('2026-10-19'), '2026-10-19');
  igual('El lunes de un domingo es el de seis días antes', ps.lunesDe('2026-10-18'), '2026-10-12');
  igual('La primera semana es la del 31/08 (el 01/09 es martes)', ps.lunesDe(ps.DESDE), '2026-08-31');
  igual('…y se cuenta desde el 01/09, no desde el lunes', ps.periodoDe('2026-08-31'), { desde: '2026-09-01', hasta: '2026-09-06' });
  igual('Las demás, de lunes a domingo', ps.periodoDe('2026-10-12'), { desde: '2026-10-12', hasta: '2026-10-18' });

  igual('Con el domingo 18/10 cerrado: siete semanas, la última la del 12/10',
    ps.semanasCerradas('2026-10-18'), ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  igual('Con el sábado 17/10 cerrado, la del 12/10 aún no', ps.semanasCerradas('2026-10-17').slice(-1), ['2026-10-05']);
  igual('Antes de acabar la primera semana, ninguna', ps.semanasCerradas('2026-09-05'), []);

  // ── 2. El sellado (con dobles) ───────────────────────────────────────────
  const hechas = new Set(['2026-08-31', '2026-09-07']);
  const insertados = [], periodos = [];
  db.consulta = async sql => {
    if (/SELECT DISTINCT semana_lunes/.test(sql)) return { rows: [...hechas].map(l => ({ l })) };
    throw new Error('consulta inesperada: ' + sql.slice(0, 60));
  };
  db.transaccion = async fn => fn({
    query: async (sql, params) => {
      igual('…se inserta sin pisar lo sellado', /ON CONFLICT \(conductor_id, semana_lunes\) DO NOTHING/.test(sql), true);
      insertados.push(params);
      return { rowCount: params.length / 19 };
    },
  });
  cal.calcular = async (hasta, promedio, { desde } = {}) => {
    periodos.push([desde, hasta]);
    return {
      telemetria: { completa: true },
      filas: [
        { conductorId: 7, letra: 'A', letraPorPuntos: 'A', total: 91, ptsHoras: 90, ptsUtilizacion: 90, ptsVelocidad: 100,
          horasProm: 8.4, utilProm: 76, excesosTotal: 0, diasTrabajados: 6, diasUtilizacion: 5, diasTelemetria: 7, versionModelo: '2.2' },
        { conductorId: 8, letra: 'N/E', motivo: 'lleva menos de 5 días en el periodo (3)', diasTrabajados: 3, versionModelo: '2.2' },
      ],
    };
  };
  let r = await ps.sellar({ promedioHoras: () => {}, ultimoDiaCerrado: '2026-09-27' });
  igual('Solo las semanas cerradas que faltan', r.selladas.map(x => x.lunes), ['2026-09-14', '2026-09-21']);
  igual('…cada una con su periodo de lunes a domingo', periodos, [['2026-09-14', '2026-09-20'], ['2026-09-21', '2026-09-27']]);
  igual('…y lo que se guarda de cada persona va en su sitio',
    insertados[0].slice(0, 19), [7, '2026-09-14', '2026-09-14', '2026-09-20', 'A', 'A', false, null, 91, 90, 90, 100, 8.4, 76, 0, 6, 5, 7, '2.2']);
  igual('El N/E se guarda también, con su motivo', insertados[0].slice(19, 27),
    [8, '2026-09-14', '2026-09-14', '2026-09-20', 'N/E', null, false, 'lleva menos de 5 días en el periodo (3)']);
  igual('…y cuenta como semana sin nota', r.selladas[0].conLetra, 1);

  // Si el cálculo no devuelve a nadie, la semana NO se da por hecha: no se
  // inserta nada y la próxima pasada lo vuelve a intentar.
  insertados.length = 0;
  cal.calcular = async () => ({ telemetria: { completa: true }, filas: [] });
  r = await ps.sellar({ promedioHoras: () => {}, ultimoDiaCerrado: '2026-09-20' });
  igual('Una semana sin nadie no se sella (se reintenta)', [r.selladas, insertados.length], [[{ lunes: '2026-09-14', filas: 0 }], 0]);

  // Sin el promedio de la casa no se calcula, igual que la letra.
  let error = '';
  try { await ps.sellar({ ultimoDiaCerrado: '2026-09-20' }); } catch (e) { error = e.message; }
  igual('Sin el promedio de la casa, no se sella', /promedio de la casa/.test(error), true);

  // ── 3. El periodo de la letra no cambia por esto ─────────────────────────
  const fuente = require('fs').readFileSync(require.resolve('../services/repo/calificacion'), 'utf8');
  igual('Sin `desde`, la letra sigue siendo del mes corrido',
    /const ini = desde \? String\(desde\)\.slice\(0, 10\) : inicioDe\(fin\);/.test(fuente), true);

  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('ERROR', e.stack); process.exit(1); });
