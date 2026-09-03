// ============================================================
// RUNNER DEL RESET DE MIGRACIÓN — sin psql, con ensayo en seco
// ============================================================
// Corre scripts/reset-migracion.sql en UNA transacción, imprime los NOTICE que va
// soltando (qué arrastra cada TRUNCATE, qué tablas de ingesta vacía) y:
//   · por DEFECTO hace ROLLBACK  → ENSAYO EN SECO: ves qué haría, sin tocar nada.
//   · con --commit (o --go)      → aplica de verdad.
//
// USO (desde la raíz del repo, con la URL EXTERNA de la BD en el entorno):
//   PowerShell:
//     $env:DATABASE_URL="postgresql://...externa..."; node scripts/reset.js          (ensayo)
//     $env:DATABASE_URL="postgresql://...externa..."; node scripts/reset.js --commit  (aplica)
//   Git Bash:
//     DATABASE_URL="postgresql://...externa..." node scripts/reset.js
//     DATABASE_URL="postgresql://...externa..." node scripts/reset.js --commit
//
// El fichero .sql ya trae su BEGIN; y NO trae COMMIT: quien confirma es este runner,
// para poder revisar los NOTICE antes de decidir.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const APLICAR = process.argv.includes('--commit') || process.argv.includes('--go');
const RUTA_SQL = path.join(__dirname, 'reset-migracion.sql');

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('❌ Falta DATABASE_URL. Ponla en el entorno (la URL EXTERNA de Render) y reintenta.');
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
