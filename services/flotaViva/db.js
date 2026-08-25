// ============================================================
// FLOTA VIVA — su propia conexión
// ============================================================
// Módulo aparte a propósito, y no por capricho de arquitectura: este desarrollo
// vive en `main` mientras la migración a PostgreSQL vive en otra rama, y las dos
// necesitan una conexión. Si compartieran fichero, el día del merge habría que
// resolver a mano el trozo más delicado de las dos.
//
// Con su propio pool y su propia variable no se tocan. Y cuando las ramas se
// junten, colapsar dos pools en uno es un rato de trabajo tranquilo; deshacer un
// merge mal resuelto, no.
//
// LA VARIABLE ES SUYA: `FLOTA_VIVA_DB_URL`. Puede apuntar a la misma base que
// todo lo demás —las tablas empiezan por `fv_` y no pisan nada— o a una nueva.
// Esa decisión no se hornea aquí: se cambia una variable y ya.

const { Pool } = require('pg');

const URL = process.env.FLOTA_VIVA_DB_URL || process.env.DATABASE_URL || '';
const HAY_BD = !!URL;

// La interna de Render (sin dominio público) no lleva TLS; la externa sí.
const esExterna = /\.render\.com|amazonaws|\.rds\./i.test(URL);

let _pool = null;

function pool() {
  if (!HAY_BD) {
    throw new Error('FLOTA_VIVA_DB_URL no está definida: la flota viva no tiene dónde guardar');
  }
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: URL,
    // Cuatro conexiones sobran: esto es un cron cada cinco minutos y una
    // pantalla. Pedir más solo le quita sitio al resto en un plan pequeño.
    max: Number(process.env.FLOTA_VIVA_POOL_MAX) || 4,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: esExterna ? { rejectUnauthorized: false } : false,
  });
  _pool.on('error', e => console.error('❌ [FLOTA VIVA] conexión inactiva:', e.message));
  console.log(`🐘 [FLOTA VIVA] Pool listo (${esExterna ? 'externa con TLS' : 'interna'})`);
  return _pool;
}

const consulta = (sql, params) => pool().query(sql, params);

/** Varias sentencias como una sola cosa: o entran todas o no entra ninguna. */
async function transaccion(fn) {
  const cli = await pool().connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
}

/**
 * Crea las tablas si no están.
 *
 * El esquema se aplica solo, al arrancar. Son cinco tablas de un módulo nuevo
 * que no comparte nada con nadie: pedir que alguien se acuerde de correr un
 * fichero a mano es una forma de que el módulo no funcione el día del despliegue
 * y nadie sepa por qué.
 */
let preparada = false;
async function preparar() {
  if (preparada) return true;
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');
  await consulta(sql);
  preparada = true;
  console.log('🗂️  [FLOTA VIVA] Esquema listo');
  return true;
}

module.exports = { consulta, transaccion, preparar, HAY_BD };
