// ============================================================
// EL ESQUEMA DE FLOTA VIVA AL ARRANCAR — las reglas (28/10/2026)
// ============================================================
//   node scripts/comprobar-esquema-flota-viva.js
//
// services/flotaViva/esquema.sql se reaplicaba entero en cada arranque y, al
// desplegar, bloqueaba tablas y chocaba con las lecturas («deadlock detected»
// en el log de Render del 28/10). Se prueba contra la copia de verdad que:
//   · se aplica una vez y deja su huella en `fv_esquema`;
//   · con la misma huella, el siguiente arranque no ejecuta nada;
//   · si una tabla está ocupada, el esquema CEDE y reintenta: ni muere la
//     lectura que la ocupa ni sale ningún «deadlock detected».
//
// HACE FALTA EL ENTORNO LOCAL (Docker telecab-pg en 127.0.0.1:5433) con la marca
// `entorno_local`; la dirección va escrita aquí y no puede apuntar a producción.
// OJO: el esquema trae su propio COMMIT, así que esto NO se deshace. Deja la
// copia como la dejaría arrancar el ERP en local: con el esquema aplicado y su
// huella guardada. Es idempotente.
const LOCAL = 'postgresql://telecab:pruebas@127.0.0.1:5433/telecab';
process.env.FLOTA_VIVA_DB_URL = LOCAL;
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

let fallos = 0;
function igual(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (ok ? '' : '\n      esperado ' + JSON.stringify(esperado) + '\n      real     ' + JSON.stringify(real)));
}

(async () => {
  const otro = new Client(LOCAL);
  await otro.connect();
  const marca = await otro.query(`SELECT to_regclass('entorno_local') IS NOT NULL AS ok`);
  if (!marca.rows[0].ok) { console.error('Esta base no lleva la marca entorno_local: no se prueba aquí.'); process.exit(1); }

  const fv = require('../services/flotaViva/db');
  const huella = fv.huellaDe(fs.readFileSync(path.join(__dirname, '..', 'services', 'flotaViva', 'esquema.sql'), 'utf8'));
  const lineas = [];
  const [log, warn, err] = [console.log, console.warn, console.error];
  const oir = () => {
    console.log = (...a) => lineas.push(a.join(' '));
    console.warn = (...a) => lineas.push(a.join(' '));
    console.error = (...a) => lineas.push(a.join(' '));
  };
  const callar = () => { console.log = log; console.warn = warn; console.error = err; };
  const olvidarHuella = () => otro.query(`DELETE FROM fv_esquema`).catch(() => {});

  try {
    // ── 1. Sin huella: se aplica y la deja ─────────────────────────────────
    await olvidarHuella();
    fv._olvidar();
    oir();
    await fv.preparar();
    callar();
    const [fila] = (await otro.query('SELECT huella FROM fv_esquema WHERE id = 1')).rows;
    igual('Sin huella, se aplica y deja la del fichero', [lineas.some(l => /Esquema listo/.test(l)), fila && fila.huella], [true, huella]);

    // ── 2. Con la misma huella no se ejecuta nada ──────────────────────────
    lineas.length = 0;
    fv._olvidar();
    // Una lectura con la tabla de situaciones cogida: si el esquema la pidiera
    // en exclusiva, se quedaría esperando.
    await otro.query('BEGIN');
    await otro.query('SELECT 1 FROM fv_cat_situacion LIMIT 1');
    const t0 = Date.now();
    oir();
    await fv.preparar();
    callar();
    await otro.query('COMMIT');
    igual('Con la misma huella no se toca nada: ni espera a una lectura en curso',
      [lineas.some(l => /Esquema al día/.test(l)), Date.now() - t0 < 1500], [true, true]);

    // ── 3. Tabla ocupada al aplicarlo: cede y reintenta ────────────────────
    await olvidarHuella();
    lineas.length = 0;
    fv._olvidar();
    await otro.query('BEGIN');
    await otro.query('SELECT 1 FROM fv_cat_situacion LIMIT 1');
    oir();
    const p = fv.preparar();
    // La lectura sigue 2,5 s y termina bien: el esquema tiene que esperarla.
    await new Promise(r => setTimeout(r, 2500));
    let lecturaBien = true;
    await otro.query('SELECT count(*) FROM fv_vehiculo').catch(() => { lecturaBien = false; });
    await otro.query('COMMIT').catch(() => { lecturaBien = false; });
    await p;
    callar();
    const [fila3] = (await otro.query('SELECT huella FROM fv_esquema WHERE id = 1')).rows;
    igual('Con una tabla ocupada, el esquema cede y reintenta en vez de pelear',
      lineas.some(l => /tablas ocupadas \(55P03\), se cede y se reintenta/.test(l)), true);
    igual('…la lectura que la ocupaba termina bien', lecturaBien, true);
    igual('…nadie se lleva un «deadlock detected»', lineas.some(l => /deadlock/i.test(l)), false);
    igual('…y al quedar libre se aplica y deja su huella', [lineas.some(l => /Esquema listo/.test(l)), fila3 && fila3.huella], [true, huella]);

    // ── 4. Nunca espera con una tabla cogida ───────────────────────────────
    // Lo que daba el deadlock: el esquema cogía fv_cat_situacion y se quedaba
    // esperando a fv_tramo, y quien leía fv_cat_situacion se quedaba detrás.
    // Ahora, con fv_tramo ocupada, el esquema no se queda con nada: una lectura
    // de fv_cat_situacion entra al momento.
    await olvidarHuella();
    lineas.length = 0;
    fv._olvidar();
    await otro.query('BEGIN');
    await otro.query('SELECT 1 FROM fv_tramo LIMIT 1');
    oir();
    const p4 = fv.preparar();
    await new Promise(r => setTimeout(r, 300));
    const tercero = new Client(LOCAL);
    await tercero.connect();
    const t4 = Date.now();
    await tercero.query(`SET statement_timeout = '3s'`);
    await tercero.query('SELECT count(*) FROM fv_cat_situacion');
    const ms4 = Date.now() - t4;
    await tercero.end();
    await new Promise(r => setTimeout(r, 1200));
    await otro.query('COMMIT');
    await p4;
    callar();
    igual('Con fv_tramo ocupada, una lectura de fv_cat_situacion no espera al esquema', ms4 < 300, true);
    igual('…y el esquema acaba aplicándose sin ningún «deadlock»',
      [lineas.some(l => /Esquema listo/.test(l)), lineas.some(l => /deadlock/i.test(l))], [true, false]);
    igual('La huella va en la misma transacción que el esquema', (await otro.query('SELECT huella FROM fv_esquema WHERE id = 1')).rows[0].huella, huella);
  } finally {
    callar();
    await otro.end();
  }
  console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo bien.');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
