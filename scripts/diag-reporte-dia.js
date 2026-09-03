// ============================================================
// DIAGNÓSTICO — CONTROL DEL DÍA (todos los conductores)
// ============================================================
// Ejecuta la MISMA función que la pantalla (reporteDia): salieron / no salieron /
// cumplieron / no cumplieron, con las marcas L/V/B/P/J de la bitácora. Sirve para
// cuadrar los números antes de fiarte. Solo LEE.
//
// USO (desde la raíz del repo), con la URL EXTERNA de Render entre comillas.
// Opcional: fecha 'YYYY-MM-DD' (por defecto hoy) y umbral de horas (por defecto 8).
//   node scripts/diag-reporte-dia.js "postgresql://...tu-url..."
//   node scripts/diag-reporte-dia.js "postgresql://...tu-url..." 2026-09-02 8

const args = process.argv.slice(2);
const urlArg = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const diaArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const umbArg = args.find(a => /^\d+(\.\d+)?$/.test(a));

if (!urlArg) {
  console.error('❌ Falta la URL. Pásala entre comillas como primer argumento.');
  process.exit(1);
}
process.env.DATABASE_URL = urlArg;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

(async () => {
  const { reporteDia } = require('../services/reporteDia');
  const db = require('../services/db');
  const dia = diaArg || hoyMadrid();
  const umbral = umbArg ? Number(umbArg) : 8;

  try {
    const r = await reporteDia(dia, umbral);
    const c = r.contadores;
    const fila = (etq, v) => console.log('  ' + etq.padEnd(20) + ': ' + v);
    console.log('\n======== CONTROL DEL DÍA ' + r.fecha + '  (umbral ' + r.umbral + ' h) ========');
    fila('Total conductores', c.total);
    fila('Previstos hoy', c.esperados);
    fila('Salieron', c.salieron);
    fila('NO salieron', c.noSalieron);
    fila('Cumplieron', c.cumplieron + '  (incl. ' + c.justificados + ' justificados J)');
    fila('NO cumplieron', c.noCumplieron);
    fila('Libranzas (L)', c.libranzas);
    fila('Ausencias V/B/P', c.ausencias + '  (V ' + c.marcas.V + ' · B ' + c.marcas.B + ' · P ' + c.marcas.P + ')');
    fila('Horas totales', c.horasTotal);
    console.log('');

    const lista = (titulo, estado, extra) => {
      const fs = r.conductores.filter(f => f.estado === estado);
      if (!fs.length) return;
      console.log('--- ' + titulo + ' (' + fs.length + ') ---');
      fs.forEach(f => console.log('  · ' + (f.nombre || '#' + f.conductorId).padEnd(34) +
        (f.turno ? '[' + f.turno + '] ' : '') + (extra ? extra(f) : '')));
      console.log('');
    };
    lista('NO SALIERON (previstos sin horas)', 'no_salio');
    lista('NO CUMPLIERON (salieron pero < umbral)', 'no_cumplio', f => (f.horas != null ? f.horas + ' h' : ''));
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar().catch(() => {});
  }
})();
