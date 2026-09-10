// ============================================================
// LOS CASOS DE PRUEBA DE LA ESPECIFICACIÓN (§12)
// ============================================================
// Los diez, tal cual vienen escritos. Se corren sin base de datos:
//
//     node scripts/prueba-calificacion.js
//
// Están aquí y no en un comentario porque el punto sensible del modelo son los
// escalones (los casos 8 y 9 documentan que un punto porcentual de utilización
// mueve de B a A) y esos son justo los que se rompen al recalibrar sin querer.
// El día que se toquen los umbrales, esto dirá qué se ha movido.

const { calificar, MODELO } = require('../services/repo/calificacion');

const CASOS = [
  { n: 1,  h: 9.2, u: 84, e: 1, dias: 14, ph: 100, pu: 100, pv: 90,  total: 98.00, letra: 'A', que: 'Caso alto normal' },
  { n: 2,  h: 8.5, u: 92, e: 3, dias: 14, ph: 90,  pu: 100, pv: 70,  total: 89.00, letra: 'B', que: 'Tope de seguridad: 89 pts serían A, baja a B' },
  { n: 3,  h: 7.1, u: 68, e: 0, dias: 14, ph: 70,  pu: 50,  pv: 100, total: 70.00, letra: 'B', que: 'Frontera exacta B (70,00 → B, no C)' },
  { n: 4,  h: 5.4, u: 58, e: 7, dias: 14, ph: 30,  pu: 45,  pv: 0,   total: 28.50, letra: 'D', que: 'Caso bajo' },
  { n: 5,  h: 9.5, u: 95, e: 5, dias: 14, ph: 100, pu: 100, pv: 30,  total: 86.00, letra: 'C', que: 'Tope duro: 86 pts serían A, baja a C' },
  { n: 6,  h: 9.0, u: 80, e: 0, dias: 14, ph: 100, pu: 100, pv: 100, total: 100.00, letra: 'A', que: 'Máximo perfecto en umbrales exactos' },
  { n: 7,  h: 4.9, u: 95, e: 0, dias: 14, ph: 0,   pu: 100, pv: 100, total: 50.00, letra: 'D', que: 'Horas por debajo del mínimo hunden el total' },
  { n: 8,  h: 8.0, u: 69, e: 1, dias: 14, ph: 90,  pu: 50,  pv: 90,  total: 78.00, letra: 'B', que: 'Escalón de utilización (lado bajo)' },
  { n: 9,  h: 8.0, u: 70, e: 1, dias: 14, ph: 90,  pu: 85,  pv: 90,  total: 88.50, letra: 'A', que: 'Escalón de utilización: 1 punto porcentual mueve B→A' },
  { n: 10, h: 9.0, u: 90, e: 0, dias: 4,                                            letra: 'N/E', que: 'Con dias_trabajados = 4' },
];

// Casos propios, de los bordes que la especificación deja implícitos.
const EXTRA = [
  { n: 'e1', h: 9.0, u: 80, e: null, dias: 14, letra: 'N/E', que: 'Telemetría caída: N/E, no se asume 0 excesos (§9.3)' },
  { n: 'e2', h: 9.0, u: 80, e: 0, dias: 5, letra: 'A', que: 'Justo 5 días trabajados: sí se califica' },
  { n: 'e3', h: 12.9, u: 99, e: 6, dias: 14, letra: 'C', que: '6 excesos: 0 pts de velocidad, el tope lo deja en C' },
  { n: 'e4', h: 0, u: 0, e: 0, dias: 14, letra: 'D', que: 'Sin horas ni utilización pero sin excesos: 20,00 → D' },
];

let fallos = 0;
const dif = (que, esperado, real) => {
  if (String(esperado) !== String(real)) { fallos++; return `  ❌ ${que}: esperado ${esperado}, sale ${real}`; }
  return null;
};

console.log(`Modelo ${MODELO.version} · ${CASOS.length} casos de la especificación + ${EXTRA.length} de borde\n`);
console.log('  #    horas  util  exc  días   pts h/u/v      total   letra   resultado');

for (const c of [...CASOS, ...EXTRA]) {
  const r = calificar({ horasProm: c.h, utilProm: c.u, excesosTotal: c.e, diasTrabajados: c.dias });
  const errores = [
    dif('letra', c.letra, r.letra),
    c.total != null ? dif('total', c.total.toFixed(2), (r.total || 0).toFixed(2)) : null,
    c.ph != null ? dif('pts_horas', c.ph, r.ptsHoras) : null,
    c.pu != null ? dif('pts_util', c.pu, r.ptsUtilizacion) : null,
    c.pv != null ? dif('pts_vel', c.pv, r.ptsVelocidad) : null,
  ].filter(Boolean);

  console.log(
    `  ${String(c.n).padEnd(4)} ${String(c.h).padStart(5)}  ${String(c.u).padStart(4)}` +
    `  ${String(c.e == null ? '—' : c.e).padStart(3)}  ${String(c.dias).padStart(4)}   ` +
    `${(r.letra === 'N/E' ? '—' : `${r.ptsHoras}/${r.ptsUtilizacion}/${r.ptsVelocidad}`).padEnd(12)} ` +
    `${String(r.total == null ? '—' : r.total.toFixed(2)).padStart(6)}   ${r.letra.padEnd(5)}   ` +
    `${errores.length ? 'FALLA' : 'ok'}   ${c.que}`);
  errores.forEach(e => console.log(e));
}

console.log(fallos
  ? `\n❌ ${fallos} comprobación(es) fallan. NO dar la implementación por buena.`
  : `\n✅ Los ${CASOS.length + EXTRA.length} casos pasan.`);
process.exit(fallos ? 1 : 0);
