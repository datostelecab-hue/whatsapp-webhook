// ============================================================
// PROBAR: las reglas del motor de notificaciones
// ============================================================
//   node scripts/probar-notificaciones.js
//
// Las piezas puras del motor: que plantilla toca segun el modo de jornada, la
// version de los datos (que dispara la rectificativa), y la calificacion del
// art. 39 por dias de inasistencia. Sin base.

const path = require('path');
const n = require(path.join(__dirname, '..', 'services', 'repo', 'notificaciones'));

let mal = 0;
const ok = (t, c, extra) => { if (!c) mal++; console.log((c ? '  ok  ' : '  MAL ') + t + (extra ? '  ' + extra : '')); };

// ── 1. La plantilla segun el modo de jornada (restriccion legal spec 5.1) ────
console.log('\n== La plantilla correcta segun el modo de jornada ==');
ok('MARCO_TEMPORAL -> comunicacion MENSUAL',
   n.plantillaDefecto('MARCO_TEMPORAL') === 'COM_DEFECTO_JORNADA_MES');
ok('HORARIO_CONCRETO -> comunicacion DIARIA',
   n.plantillaDefecto('HORARIO_CONCRETO') === 'COM_DEFECTO_JORNADA_DIA');
// Por defecto (lo normal en la flota), la mensual.
ok('sin especificar -> mensual', n.plantillaDefecto(undefined) === 'COM_DEFECTO_JORNADA_MES');

// ── 2. La version de los datos y la rectificativa ───────────────────────────
console.log('\n== La version de los datos dispara la rectificativa ==');
const cifrasA = { defecto: 1200, cumple: 8000, neta: 9200 };
const cifrasB = { defecto: 900, cumple: 8300, neta: 9200 };   // cambiaron al reabrir
ok('mismos datos = misma version', n.versionDatos(cifrasA) === n.versionDatos({ ...cifrasA }));
ok('el orden de las claves no importa',
   n.versionDatos({ a: 1, b: 2 }) === n.versionDatos({ b: 2, a: 1 }));
ok('datos distintos = version distinta', n.versionDatos(cifrasA) !== n.versionDatos(cifrasB));

// ── 3. La calificacion del art. 39 por dias ─────────────────────────────────
console.log('\n== Calificacion del art. 39 (el sistema propone) ==');
ok('1 dia = leve, automatica', (() => {
  const c = n.calificacionInasistencia(1);
  return c.severidad === 'LEVE' && c.requiereAprob === false;
})());
ok('2 dias = grave, aprobacion humana', (() => {
  const c = n.calificacionInasistencia(2);
  return c.severidad === 'GRAVE' && c.requiereAprob === true;
})());
ok('4 dias = muy grave, aprobacion humana', (() => {
  const c = n.calificacionInasistencia(4);
  return c.severidad === 'MUY_GRAVE' && c.requiereAprob === true;
})());
ok('0 dias = nada', n.calificacionInasistencia(0) === null);
// El escalado coincide con la graduacion del convenio.
ok('3 dias siguen siendo grave (2..3)', n.calificacionInasistencia(3).severidad === 'GRAVE');

console.log(mal ? `\n${mal} PRUEBA(S) MAL` : '\nLas reglas de notificaciones cuadran');
process.exitCode = mal ? 1 : 0;
