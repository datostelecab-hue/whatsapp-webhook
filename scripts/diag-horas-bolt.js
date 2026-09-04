// ============================================================
// DIAGNÓSTICO — por qué nuestras horas no cuadran con las de BOLT
// ============================================================
// Compara, para un mes, el TIEMPO DE CONEXIÓN que da el informe de BOLT (CSV de
// "Vehículos Rendimiento") con lo que tenemos en el núcleo (fv_tramo), separado
// por situación. Solo LEE.
//
// USO:
//   node scripts/diag-horas-bolt.js "postgresql://...url..." 2026-08 "C:/ruta/Vehiculos.csv"

const { Client } = require('pg');
const fs = require('fs');

const args = process.argv.slice(2);
const url = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const mes = args.find(a => /^\d{4}-\d{2}$/.test(a)) || '2026-08';
const csv = args.find(a => /\.csv$/i.test(a));
if (!url) { console.error('❌ Falta la URL entre comillas.'); process.exit(1); }

const norm = m => String(m || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const finDe = m => { const [y, n] = m.split('-').map(Number); return n === 12 ? `${y + 1}-01` : `${y}-${String(n + 1).padStart(2, '0')}`; };

function leerCsv(ruta) {
  const filas = fs.readFileSync(ruta, 'utf8').split(/\r?\n/).filter(Boolean).map(l => {
    const out = []; let cur = '', dentro = false;
    for (const ch of l) {
      if (ch === '"') { dentro = !dentro; continue; }
      if (ch === ',' && !dentro) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur); return out;
  });
  const cab = filas[0];
  const iMat = cab.indexOf('Matrícula'), iMin = cab.indexOf('Tiempo de conexión (min)');
  const m = new Map();
  filas.slice(1).forEach(r => m.set(norm(r[iMat]), (parseFloat(r[iMin] || '0') || 0) / 60));
  return m;
}

(async () => {
  const cli = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await cli.connect();
  const ini = `${mes}-01`, fin = `${finDe(mes)}-01`;
  const ventana = `
    WITH v AS (SELECT ($1::date)::timestamp AT TIME ZONE 'Europe/Madrid' AS ini,
                      ($2::date)::timestamp AT TIME ZONE 'Europe/Madrid' AS fin)`;
  // Segundos de solape del tramo con la ventana del mes.
  const seg = `EXTRACT(EPOCH FROM (LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini)))`;
  const donde = `WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini`;

  try {
    console.log(`\n================ HORAS ${mes} ================\n`);

    const porSit = (await cli.query(`${ventana}
      SELECT t.situacion, round((SUM(${seg}) / 3600.0)::numeric, 1) AS horas,
             count(*) AS tramos
        FROM fv_tramo t CROSS JOIN v ${donde}
       GROUP BY 1 ORDER BY 2 DESC NULLS LAST`, [ini, fin])).rows;
    console.log('--- Por situación (lo que hay en el núcleo) ---');
    let viajeEspera = 0, todo = 0, descanso = 0;
    porSit.forEach(r => {
      const h = Number(r.horas) || 0;
      console.log(`  ${String(r.situacion).padEnd(14)} ${String(r.horas).padStart(10)} h   (${r.tramos} tramos)`);
      todo += h;
      if (r.situacion === 'viaje' || r.situacion === 'espera') viajeEspera += h;
      if (r.situacion === 'descanso') descanso += h;
    });
    console.log('  ' + '-'.repeat(46));
    console.log(`  viaje+espera   ${viajeEspera.toFixed(1).padStart(10)} h   <- lo que enseña Visibilidad`);
    console.log(`  + descanso     ${(viajeEspera + descanso).toFixed(1).padStart(10)} h   <- "conexión" al estilo BOLT`);
    console.log(`  todo           ${todo.toFixed(1).padStart(10)} h`);

    if (csv) {
      const bolt = leerCsv(csv);
      const totalBolt = [...bolt.values()].reduce((a, b) => a + b, 0);
      console.log(`\n--- Informe de BOLT ---`);
      console.log(`  ${bolt.size} vehículos · ${totalBolt.toFixed(1)} h de conexión`);
      console.log(`\n  BOLT - (viaje+espera)          = ${(totalBolt - viajeEspera).toFixed(1)} h`);
      console.log(`  BOLT - (viaje+espera+descanso) = ${(totalBolt - viajeEspera - descanso).toFixed(1)} h  <- si es ~0, es el descanso`);

      const porMat = (await cli.query(`${ventana}
        SELECT veh.matricula,
               round((SUM(${seg}) FILTER (WHERE t.situacion IN ('viaje','espera')) / 3600.0)::numeric, 1) AS ve,
               round((SUM(${seg}) FILTER (WHERE t.situacion IN ('viaje','espera','descanso')) / 3600.0)::numeric, 1) AS ved
          FROM fv_tramo t CROSS JOIN v
          JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
         ${donde} GROUP BY 1`, [ini, fin])).rows;
      const nuestro = new Map(porMat.map(r => [norm(r.matricula), { ve: Number(r.ve) || 0, ved: Number(r.ved) || 0 }]));

      const difs = [];
      bolt.forEach((hb, mat) => {
        const n = nuestro.get(mat);
        difs.push({ mat, bolt: hb, ve: n ? n.ve : null, ved: n ? n.ved : null,
                    dif: hb - (n ? n.ved : 0), falta: !n });
      });
      difs.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
      console.log('\n--- Peores desfases por matrícula (BOLT vs nuestro viaje+espera+descanso) ---');
      console.log('  MATRÍCULA    BOLT      V+E     V+E+D     DIF');
      difs.slice(0, 20).forEach(d => console.log(
        `  ${d.mat.padEnd(10)} ${d.bolt.toFixed(1).padStart(8)} ${(d.ve === null ? '—' : d.ve.toFixed(1)).padStart(8)} ` +
        `${(d.ved === null ? '—' : d.ved.toFixed(1)).padStart(9)} ${d.dif.toFixed(1).padStart(8)}` +
        (d.falta ? '   ⚠ NO ESTÁ EN NUESTRA FLOTA' : '')));
      const sinNosotros = difs.filter(d => d.falta);
      if (sinNosotros.length) {
        console.log(`\n  ⚠ ${sinNosotros.length} matrícula(s) del informe que NO tenemos: ` +
                    sinNosotros.map(d => `${d.mat} (${d.bolt.toFixed(1)} h)`).join(', '));
      }
      const soloNuestras = [...nuestro.keys()].filter(m => !bolt.has(m));
      if (soloNuestras.length) console.log(`  ℹ ${soloNuestras.length} matrícula(s) nuestras que no salen en el informe: ${soloNuestras.join(', ')}`);
    }
  } catch (e) {
    console.error('❌', e.message);
    process.exitCode = 1;
  } finally { await cli.end().catch(() => {}); }
})();
