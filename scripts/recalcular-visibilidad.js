// ============================================================
// RECALCULAR LAS FOTOS DIARIAS DE VISIBILIDAD
// ============================================================
// Visibilidad no lee fv_tramo en vivo: guarda una FOTO por dia (visibilidad_dia) y
// solo recalcula los dias que faltan o estan a cero. Asi que si se reconstruye el
// historico (un backfill), la pantalla sigue enseñando el numero viejo para siempre.
// Esto fuerza el recalculo de uno o varios meses.
//
// USO:
//   node scripts/recalcular-visibilidad.js "postgresql://...url..." 2026-08
//   node scripts/recalcular-visibilidad.js "postgresql://...url..." 2026-08 2026-09

const args = process.argv.slice(2);
const url = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const meses = args.filter(a => /^\d{4}-\d{2}$/.test(a));
if (!url || !meses.length) {
  console.error('Uso: node scripts/recalcular-visibilidad.js "<URL>" <AAAA-MM> [AAAA-MM...]');
  process.exit(1);
}
process.env.DATABASE_URL = url;

(async () => {
  const vis = require('../services/visibilidad');
  const db = require('../services/db');
  const fv = require('../services/flotaViva/db');
  try {
    await fv.preparar();
    for (const m of meses) {
      const [anio, mes] = m.split('-').map(Number);
      const antes = (await db.consulta(
        `SELECT COALESCE(round((SUM(viaje_seg + espera_seg)/3600.0)::numeric,1),0) AS h
           FROM visibilidad_dia
          WHERE date_trunc('month', dia) = $1::date`, [`${m}-01`])).rows[0].h;
      const r = await vis.backfillMes(anio, mes);
      const despues = (await db.consulta(
        `SELECT COALESCE(round((SUM(viaje_seg + espera_seg)/3600.0)::numeric,1),0) AS h
           FROM visibilidad_dia
          WHERE date_trunc('month', dia) = $1::date`, [`${m}-01`])).rows[0].h;
      console.log(`${m}: ${r.dias} dia(s) recalculados · ${antes} h -> ${despues} h`);
    }
  } catch (e) {
    console.error('ERROR:', e.message);
    process.exitCode = 1;
  } finally {
    await fv.cerrar?.().catch(() => {});
    await db.cerrar?.().catch(() => {});
  }
})();
