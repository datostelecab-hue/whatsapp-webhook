// ============================================================
// RUNNER DEL RESET DE MIGRACIÓN — sin psql, con ensayo en seco
// ============================================================
// Corre scripts/reset-migracion.sql en UNA transacción, imprime los NOTICE que va
// soltando (qué arrastra cada TRUNCATE, qué tablas de ingesta vacía) y:
//   · por DEFECTO hace ROLLBACK  → ENSAYO EN SECO: ves qué haría, sin tocar nada.
//   · con --commit (o --go)      → aplica de verdad.
//
// USO (desde la raíz del repo). Pega tu URL EXTERNA de Render entre comillas; vale
// igual en cmd y en PowerShell:
//     node scripts/reset.js "postgresql://...tu-url..."            -> ENSAYO (no toca nada)
//     node scripts/reset.js --commit "postgresql://...tu-url..."   -> APLICA de verdad
//   (También por entorno: si defines DATABASE_URL, puedes omitir la URL del comando.)
//
// El fichero .sql ya trae su BEGIN; y NO trae COMMIT: quien confirma es este runner,
// para poder revisar los NOTICE antes de decidir.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const args = process.argv.slice(2);
const APLICAR = args.includes('--commit') || args.includes('--go');
// La URL puede ir como ARGUMENTO (node scripts/reset.js "postgresql://...") o en el
// entorno (DATABASE_URL). El argumento gana: así no hay que pelearse con las comillas
// de cmd/PowerShell — se pega la URL entre comillas y listo.
const urlArg = args.find(a => /^postgres(ql)?:\/\//i.test(a));
const RUTA_SQL = path.join(__dirname, 'reset-migracion.sql');

(async () => {
  const url = urlArg || process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ Falta la URL de la base. Pásala como argumento, entre comillas:\n' +
      '   node scripts/reset.js "postgresql://usuario:clave@host.render.com/telecab"');
    process.exit(1);
  }
  if (!fs.existsSync(RUTA_SQL)) {
    console.error(`❌ No encuentro ${RUTA_SQL}. Corre esto desde la raíz del repo.`);
    process.exit(1);
  }
  const sql = fs.readFileSync(RUTA_SQL, 'utf8');
  // La externa de Render lleva TLS; la interna no. Mismo criterio que services/db.
  const esExterna = /\.render\.com|amazonaws|\.rds\./i.test(url);
  const cli = new Client({ connectionString: url, ssl: esExterna ? { rejectUnauthorized: false } : false });

  // Los RAISE NOTICE del .sql llegan como eventos 'notice'.
  cli.on('notice', n => console.log('   · ' + String(n.message || '').trim()));

  console.log(APLICAR
    ? '⚠️  MODO --commit: se APLICARÁ el reset (destructivo) si todo va bien.\n'
    : '🧪 ENSAYO EN SECO (sin --commit): se hará ROLLBACK. No se toca nada.\n');

  try {
    await cli.connect();
    // El .sql abre su propia transacción (BEGIN;) y no la cierra: la cerramos aquí.
    await cli.query(sql);
    if (APLICAR) {
      await cli.query('COMMIT');
      console.log('\n✅ COMMIT: reset aplicado. La ingesta arrancará de cero al encender el motor.');
    } else {
      await cli.query('ROLLBACK');
      console.log('\n🧪 ROLLBACK: nada aplicado. Si los NOTICE de arriba cuadran, repite con --commit.');
    }
  } catch (e) {
    try { await cli.query('ROLLBACK'); } catch (_) {}
    console.error('\n❌ Error (ROLLBACK, no se aplicó nada):', e.message);
    process.exitCode = 1;
  } finally {
    try { await cli.end(); } catch (_) {}
  }
})();
