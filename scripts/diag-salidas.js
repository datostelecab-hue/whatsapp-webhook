// ============================================================
// DIAGNÓSTICO — QUIÉN DEBE SALIR (la lista para llamar)
// ============================================================
// Ejecuta la MISMA función que usan la pantalla y el Excel (salidasHoy, sobre
// f_cobertura del planificador). Sirve para cuadrar la lista contra el
// planificador ANTES de fiarte: si aquí sale bien, sale bien en todos lados.
//
// Solo LEE. No toca nada.
//
// USO (desde la raíz del repo), pegando tu URL EXTERNA de Render entre comillas.
// Opcional: una fecha 'YYYY-MM-DD' (por defecto, hoy en Madrid).
//   node scripts/diag-salidas.js "postgresql://...tu-url..."
//   node scripts/diag-salidas.js "postgresql://...tu-url..." 2026-09-05

const args = process.argv.slice(2);
const urlArg = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const diaArg = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

if (!urlArg) {
  console.error('❌ Falta la URL. Pásala entre comillas como primer argumento.');
  process.exit(1);
}
// db.js lee DATABASE_URL al requerirse: hay que ponerla ANTES de importar nada.
process.env.DATABASE_URL = urlArg;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

(async () => {
  const { salidasHoy } = require('../services/repo/planificador');
  const db = require('../services/db');
  const dia = diaArg || hoyMadrid();

  try {
    const r = await salidasHoy(dia);
    console.log('\n============ QUIÉN SALE ' + dia + ' ============');
    console.log('(del planificador · f_cobertura · sin librantes ni ausentes)');
    console.log('Total conductores distintos: ' + r.total + '\n');

    if (!r.turnos.length) console.log('   (nadie planificado ese día)\n');

    r.turnos.forEach(t => {
      console.log('### ' + t.etiqueta.toUpperCase() + '  ·  ' + t.conductores.length + ' conductor(es)');
      t.conductores.forEach((c, i) => {
        console.log(
          '  ' + String(i + 1).padStart(2) + '. ' +
          (c.conductor || '(sin nombre)').padEnd(34) +
          '[' + c.rol + (c.todoTurno ? ' · TT' : '') + ']  ' +
          (c.telefono || '⚠ SIN TELÉFONO').padEnd(16) + '  ' +
          (c.matriculas.join(' / ') || '—') +
          (c.cuadrante ? '   (' + c.cuadrante + ')' : ''));
      });
      const sinTel = t.conductores.filter(c => !c.telefono).length;
      if (sinTel) console.log('   ⚠ ' + sinTel + ' sin teléfono (no se les puede llamar)');
      console.log('');
    });
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar().catch(() => {});
  }
})();
