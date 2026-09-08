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
    // OCHO. Cuando esto era "un cron y una pantalla" cuatro sobraban, pero el
    // cockpit de Control pide la actividad de los tres turnos a la vez y cada
    // una son cuatro consultas: doce que entraban de cuatro en cuatro.
    //
    // En la MEDIANA no se nota (unos 2 s con cuatro y con ocho), pero el peor
    // caso baja de 4,8 s a 2,0 s, y el peor caso es justo el que se siente como
    // "esto va lento". Sitio hay: la base admite 100 conexiones y entre los dos
    // pools no se pasa de veinte.
    max: Number(process.env.FLOTA_VIVA_POOL_MAX) || 8,
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
// Se guarda LA PROMESA, no un booleano. Con el booleano la marca se ponía
// DESPUÉS del await, así que varias llamadas a la vez pasaban todas el guardia y
// aplicaban el esquema en paralelo: PostgreSQL las mataba con "deadlock
// detected". Pasaba de verdad en un arranque en frío con varias peticiones a la
// vez, que es justo lo que ocurre al desplegar.
let preparando = null;
async function preparar() {
  if (preparando) return preparando;
  preparando = (async () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');
    await consulta(sql);
    console.log('🗂️  [FLOTA VIVA] Esquema listo');
    return true;
  })().catch(e => {
    // Si falla, se olvida: la siguiente petición vuelve a intentarlo en vez de
    // quedarse con el error pegado para toda la vida del proceso.
    preparando = null;
    throw e;
  });
  return preparando;
}

module.exports = { consulta, transaccion, preparar, HAY_BD };
