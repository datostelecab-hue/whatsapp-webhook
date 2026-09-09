// ============================================================
// SEMBRAR EL PUNTO DE PARTIDA DEL RITMO
// ============================================================
//   node scripts/sembrar-km-dia.js            (ensayo)
//   node scripts/sembrar-km-dia.js --aplicar
//
// El ritmo (km/día) del módulo de taller sale de `vehiculo_km_dia`, y esa tabla
// empieza vacía: harían falta 30 días de fotos para que la columna "le quedan X
// días" dijera algo. Este script pone la primera piedra.
//
// Para cada coche con odómetro:
//     km de hace 30 días = odómetro de hoy − km que Mapon dice que ha rodado
//
// Los km del periodo los mide Mapon trayecto a trayecto (route/list), así que
// la fila no es una estimación: es una resta entre dos medidas. Aun así se
// guarda con origen='reconstruido', porque no se observó ese día.
//
// Se ejecuta UNA vez. A partir de ahí el cron va dejando fotos de verdad.

const path = require('path');

const mapon = require(path.join(__dirname, '..', 'services', 'mapon'));
const db = require(path.join(__dirname, '..', 'services', 'db'));

const APLICAR = process.argv.includes('--aplicar');
const DIAS = 30;
const CONC = 3;

const num = v => Number(v).toLocaleString('es-ES', { useGrouping: 'always', maximumFractionDigits: 0 });

async function enParalelo(items, n, fn) {
  const it = items[Symbol.iterator]();
  const runner = async () => { for (let x = it.next(); !x.done; x = it.next()) await fn(x.value); };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, runner));
}

async function main() {
  if (!process.env.MAPON_API_KEY) throw new Error('Falta MAPON_API_KEY');
  if (!db.HAY_BD) throw new Error('Falta DATABASE_URL');

  // Los coches con odómetro y con unidad de Mapon: sin las dos cosas no hay
  // resta que hacer.
  const coches = (await db.consulta(`
    SELECT v.id, v.matricula, o.km AS odometro,
           (SELECT al.externo_id FROM vehiculo_alias al
             WHERE al.vehiculo_id = v.id AND al.sistema = 'mapon' AND al.visto_hasta IS NULL
             LIMIT 1) AS unit_id
      FROM vehiculo v JOIN v_vehiculo_odometro o ON o.vehiculo_id = v.id
     WHERE v.baja_at IS NULL AND o.km IS NOT NULL
     ORDER BY v.matricula`)).rows.filter(v => v.unit_id);

  console.log(`\n🌱 ${coches.length} coches con odómetro y unidad de Mapon.`);
  console.log(`   Midiendo lo que han rodado en ${DIAS} días…\n`);

  const fin = Date.now();
  const ini = fin - DIAS * 86400 * 1000;
  const filas = [];
  let hechas = 0;
  await enParalelo(coches, CONC, async v => {
    try {
      const { km } = await mapon.kmEnVentana({
        unitId: v.unit_id,
        fromTs: Math.floor(ini / 1000),
        tillTs: Math.floor(fin / 1000),
      });
      const antes = Math.round(Number(v.odometro) - km);
      // Un odómetro que no llega a cubrir sus propios km del mes es un dato
      // roto: mejor no sembrar nada que sembrar un ritmo falso.
      if (antes < 0) {
        console.log(`   ⚠ ${v.matricula}: odómetro ${num(v.odometro)} < ${num(km)} km rodados. Se salta.`);
        return;
      }
      filas.push({ id: v.id, matricula: v.matricula, km: antes, rodados: km, hoy: Number(v.odometro) });
    } catch (e) {
      console.log(`   ⚠ ${v.matricula}: ${e.message}`);
    }
    if (++hechas % 25 === 0) console.log(`   … ${hechas}/${coches.length}`);
  });

  filas.sort((a, b) => b.rodados - a.rodados);
  console.log(`\n${'Matrícula'.padEnd(10)} ${'Hoy'.padStart(10)} ${('Hace ' + DIAS + 'd').padStart(10)} ${'Rodados'.padStart(10)} ${'Km/día'.padStart(8)}`);
  console.log('─'.repeat(54));
  filas.forEach(f => console.log(
    `${f.matricula.padEnd(10)} ${num(f.hoy).padStart(10)} ${num(f.km).padStart(10)} ` +
    `${num(f.rodados).padStart(10)} ${(Math.round(f.rodados / DIAS * 10) / 10).toLocaleString('es-ES').padStart(8)}`));
  console.log(`\n${filas.length} fila(s) a sembrar.`);

  if (!APLICAR) return console.log('\n(ensayo: no se ha escrito nada. Añade --aplicar)');

  await db.transaccion(async cli => {
    for (const f of filas) {
      await cli.query(`
        INSERT INTO vehiculo_km_dia (vehiculo_id, dia, km, origen)
        VALUES ($1, CURRENT_DATE - $2::int, $3, 'reconstruido')
        ON CONFLICT (vehiculo_id, dia) DO NOTHING`, [f.id, DIAS, f.km]);
    }
  });
  console.log(`\n✅ Sembradas. El ritmo ya sale desde hoy.`);
}

main()
  .then(() => db.cerrar())
  .catch(e => { console.error('\n❌', e.message); process.exit(1); });
