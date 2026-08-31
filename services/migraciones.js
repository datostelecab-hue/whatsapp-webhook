// ============================================================
// MIGRACIONES — aplica los .sql de db/ en orden, una sola vez cada uno
// ============================================================
// Se puede ejecutar mil veces: lleva registro de lo aplicado en la tabla
// `_migracion`. Cada fichero va en su propia transacción, así que uno que falle
// no deja la base a medias ni impide reintentarlo tras corregirlo.
//
// Guarda además la huella (SHA-256) de cada fichero. Si uno ya aplicado cambia
// después, se avisa en vez de callar: en una base con datos, editar una
// migración vieja no la vuelve a ejecutar, y creer que sí es la forma más
// rápida de que producción y pruebas dejen de parecerse.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const DIR = path.join(__dirname, '..', 'db');

// La huella NO puede depender del sistema operativo. Con core.autocrlf=true el
// mismo fichero tiene CRLF en Windows y LF en el repositorio y en Render, así
// que hashear el texto crudo marcaba TODAS las migraciones como modificadas en
// cuanto se aplicaban desde un sitio y se leían desde otro. Se normalizan los
// saltos de línea y el espacio final antes de calcularla.
const normalizar = txt => String(txt).replace(/\r\n/g, '\n').trimEnd();
const huella = txt => crypto.createHash('sha256')
  .update(normalizar(txt), 'utf8').digest('hex').slice(0, 16);
const ficheros = () => fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
  : [];

async function asegurarRegistro() {
  await db.consulta(`
    CREATE TABLE IF NOT EXISTS _migracion (
      fichero     VARCHAR(120) PRIMARY KEY,
      huella      CHAR(16)     NOT NULL,
      aplicada_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
      duracion_ms INTEGER      NOT NULL,
      sentencias  INTEGER
    )`);
}

/** Qué hay aplicado y qué falta, sin tocar nada. */
async function estado() {
  if (!db.HAY_BD) return { configurada: false, pendientes: [], aplicadas: [] };
  await asegurarRegistro();
  const previas = new Map((await db.consulta('SELECT * FROM _migracion')).rows.map(r => [r.fichero, r]));
  const aplicadas = [], pendientes = [], modificadas = [];

  for (const f of ficheros()) {
    const h = huella(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const p = previas.get(f);
    if (!p) { pendientes.push({ fichero: f, huella: h }); continue; }
    aplicadas.push({ fichero: f, aplicada_at: p.aplicada_at, duracion_ms: p.duracion_ms });
    if (p.huella !== h) modificadas.push({ fichero: f, aplicadaCon: p.huella, ahora: h });
  }
  return { configurada: true, aplicadas, pendientes, modificadas };
}

/**
 * Aplica lo pendiente. Con `soloVer` no escribe nada: dice qué haría.
 * Devuelve el detalle de cada fichero para poder pegarlo en un informe.
 */
async function aplicar({ soloVer = false } = {}) {
  if (!db.HAY_BD) throw new Error('DATABASE_URL no está definida');
  const e = await estado();
  if (soloVer) return { soloVer: true, ...e };

  const hechas = [];
  for (const { fichero, huella: h } of e.pendientes) {
    const sql = fs.readFileSync(path.join(DIR, fichero), 'utf8');
    const t0 = Date.now();
    try {
      // El propio .sql trae BEGIN/COMMIT; se ejecuta tal cual para respetarlo.
      await db.consulta(sql);
      const ms = Date.now() - t0;
      await db.consulta(
        `INSERT INTO _migracion (fichero, huella, duracion_ms, sentencias)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (fichero) DO UPDATE SET huella=EXCLUDED.huella, aplicada_at=now(), duracion_ms=EXCLUDED.duracion_ms`,
        [fichero, h, ms, (sql.match(/;/g) || []).length]);
      hechas.push({ fichero, ok: true, ms });
      console.log(`🐘 [MIGRA] ${fichero} aplicada en ${ms} ms`);
    } catch (err) {
      // Se para aquí: las siguientes suelen depender de esta.
      hechas.push({ fichero, ok: false, error: err.message, detalle: err.detail, pista: err.hint });
      console.error(`❌ [MIGRA] ${fichero}: ${err.message}`);
      return { aplicadas: hechas, parado: true, modificadas: e.modificadas };
    }
  }
  if (!hechas.length) console.log('🐘 [MIGRA] Nada pendiente');
  return { aplicadas: hechas, parado: false, modificadas: e.modificadas };
}

/** Radiografía de lo que hay creado. Sirve para comprobar tras migrar. */
async function inventario() {
  const tablas = await db.consulta(`
    SELECT c.relname AS tabla,
           (SELECT count(*) FROM pg_attribute a
             WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columnas,
           (SELECT count(*) FROM pg_index i WHERE i.indrelid=c.oid) AS indices,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS tamano
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT LIKE '\\_%'
    ORDER BY c.relname`);
  const [fk, ck, parciales] = await Promise.all([
    db.consulta(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f'`),
    db.consulta(`SELECT count(*)::int n FROM pg_constraint WHERE contype='c'`),
    db.consulta(`SELECT count(*)::int n FROM pg_index WHERE indpred IS NOT NULL AND indisunique`),
  ]);
  return {
    tablas: tablas.rows,
    totales: {
      tablas: tablas.rowCount,
      foraneas: fk.rows[0].n,
      comprobaciones: ck.rows[0].n,
      indicesUnicosParciales: parciales.rows[0].n,
    },
  };
}

/**
 * Vacía la base entera y vuelve a aplicarlo todo desde cero. Durante el ensayo
 * de migración se necesita hacer esto muchas veces: cargar, comprobar, corregir
 * y repetir.
 *
 * SOLO funciona con MODO_PRUEBAS=1. En un servidor normal se niega: borrar el
 * esquema de producción por una URL sería el peor accidente posible, y aquí ya
 * ha pasado que dos entornos compartan credenciales.
 */
async function reiniciar({ confirmar } = {}) {
  const pruebas = require('./modoPruebas');
  if (!pruebas.ACTIVO) throw new Error('Reiniciar la base solo se permite con MODO_PRUEBAS=1');
  if (confirmar !== 'BORRAR TODO') throw new Error('Falta la confirmación exacta: "BORRAR TODO"');

  await db.consulta('DROP SCHEMA public CASCADE');
  await db.consulta('CREATE SCHEMA public');
  console.log('🧹 [MIGRA] Esquema vaciado');
  return { vaciada: true, ...(await aplicar()) };
}

module.exports = { estado, aplicar, inventario, ficheros, reiniciar };

// Permite lanzarlo también desde la línea de órdenes:
//   node services/migraciones.js          → aplica lo pendiente
//   node services/migraciones.js --ver    → solo dice qué haría
if (require.main === module) {
  const soloVer = process.argv.includes('--ver');
  aplicar({ soloVer })
    .then(r => { console.log(JSON.stringify(r, null, 2)); return db.cerrar(); })
    .catch(e => { console.error('ERROR:', e.message); process.exit(1); });
}
