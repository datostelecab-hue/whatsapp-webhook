// ============================================================
// RECONSTRUIR HORAS (fv_tramo) DE UN RANGO
// ============================================================
// Para cuando faltan horas de un periodo ya pasado: por ejemplo, un coche que no
// se estaba vigilando y cuyas horas nunca se guardaron (agosto 2026: 3035LTX, 513 h).
//
// Hace dos cosas, en este orden:
//   1. REFRESCA EL PADRÓN -> los coches que ahora se vigilan entran en fv_vehiculo.
//      Sin esto, el reconstructor no puede guardarles nada (la clave foránea lo exige).
//   2. RECONSTRUYE fv_tramo del rango desde los state-logs de BOLT. Es idempotente:
//      borra los tramos CERRADOS del rango y los vuelve a escribir. El tramo VIVO
//      (hasta IS NULL) no se toca.
//
// USO:
//   node scripts/backfill-tramos.js "postgresql://...url..." 2026-08-01 2026-09-01
//   node scripts/backfill-tramos.js "postgresql://...url..." 2026-08-01 2026-09-01 --dry
//
// Con --dry solo refresca el padrón y dice qué falta; NO reconstruye nada.

const args = process.argv.slice(2);
const url = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const fechas = args.filter(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
const dry = args.includes('--dry');
// Reparar un dia suelto no necesita refrescar el padron (los coches ya estan). Y el
// padron llama a BOLT, que con sus 429 es justo donde se cayo el arreglo del dia 19.
const sinPadron = args.includes('--sin-padron');

if (!url || fechas.length < 2) {
  console.error('❌ Uso: node scripts/backfill-tramos.js "<URL>" <desde YYYY-MM-DD> <hasta YYYY-MM-DD> [--dry] [--sin-padron]');
  process.exit(1);
}
process.env.DATABASE_URL = url;

const [desde, hasta] = fechas;

(async () => {
  const db = require('../services/flotaViva/db');
  const dominio = require('../services/db');
  const motor = require('../services/flotaViva/motor');
  const { backfillTramos } = require('../services/flotaViva/backfill');

  try {
    await db.preparar();

    if (sinPadron) {
      console.log('=== 1. PADRON — saltado (--sin-padron) ===');
    } else {
    console.log(`\n=== 1. PADRÓN — registrar los coches que se vigilan ===`);
    const antes = (await db.consulta('SELECT count(*)::int n FROM fv_vehiculo')).rows[0].n;
    // OJO: BOLT quiere epoch en SEGUNDOS (así lo llama la pasada viva), no en ms.
    // Y para LISTAR la flota vale una ventana reciente: no es el rango a reconstruir.
    const hastaTs = Math.floor(Date.now() / 1000);
    await motor.padron(hastaTs - 24 * 3600, hastaTs);
    const despues = (await db.consulta('SELECT count(*)::int n FROM fv_vehiculo')).rows[0].n;
    console.log(`   fv_vehiculo: ${antes} → ${despues} coche(s)` + (despues > antes ? `  (+${despues - antes} nuevos)` : ''));
    }

    // Los que se vigilan pero aún no tienen ni un tramo en el rango: son los agujeros.
    const huecos = (await db.consulta(
      `SELECT v.matricula FROM fv_vehiculo v
        WHERE NOT EXISTS (
          SELECT 1 FROM fv_tramo t
           WHERE t.vehiculo_uuid = v.uuid
             AND t.desde >= $1::timestamptz AND t.desde < $2::timestamptz)
        ORDER BY 1`, [desde, hasta])).rows.map(r => r.matricula);
    console.log(`   Sin NINGÚN tramo en ${desde} → ${hasta}: ${huecos.length ? huecos.join(', ') : '(ninguno)'}`);

    if (dry) {
      console.log('\n(--dry) No se reconstruye nada. Quita --dry para hacerlo de verdad.');
      return;
    }

    console.log(`\n=== 2. RECONSTRUIR fv_tramo de ${desde} a ${hasta} ===`);
    console.log('   (idempotente: reescribe los tramos cerrados del rango)');
    const t0 = Date.now();
    const r = await backfillTramos({ desde, hasta });
    console.log(`   Hecho en ${Math.round((Date.now() - t0) / 1000)} s`, r ? JSON.stringify(r) : '');

    const horas = (await db.consulta(
      `SELECT round((SUM(EXTRACT(EPOCH FROM (COALESCE(t.hasta, now()) - t.desde)))
                     FILTER (WHERE t.situacion IN ('viaje','espera')) / 3600.0)::numeric, 1) AS h
         FROM fv_tramo t
        WHERE t.desde >= $1::timestamptz AND t.desde < $2::timestamptz`, [desde, hasta])).rows[0];
    console.log(`\n   Horas efectivas (viaje+espera) del rango: ${horas.h} h`);
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally {
    await db.cerrar?.().catch(() => {});
    await dominio.cerrar?.().catch(() => {});
  }
})();
