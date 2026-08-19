// ============================================================
// POSTGRESQL — pool de conexiones
// ============================================================
// Único sitio donde se abre conexión a la base. Todo lo demás pide `consulta`
// o `transaccion` a este módulo.
//
// El tamaño del pool NO es un detalle menor: Render Postgres no trae PgBouncer
// ni ningún gestor de conexiones, y su límite de conexiones simultáneas crece
// con la RAM de la instancia. Como el backend es UN solo proceso de Node, con
// 10 conexiones va sobrado y nunca se agotan — que es la causa número uno de
// caídas de base de datos en aplicaciones pequeñas.

const { Pool } = require('pg');

const URL = process.env.DATABASE_URL || '';
const HAY_BD = !!URL;

// La interna de Render (sin dominio público) no lleva TLS; la externa sí.
const esExterna = /\.render\.com|amazonaws|\.rds\./i.test(URL);

let _pool = null;

function pool() {
  if (!HAY_BD) throw new Error('DATABASE_URL no está definida: no hay base de datos configurada');
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: URL,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // Render usa certificado propio: se cifra igual, pero no se valida la cadena.
    ssl: esExterna ? { rejectUnauthorized: false } : false,
  });
  _pool.on('error', e => console.error('❌ [BD] Error en conexión inactiva:', e.message));
  console.log(`🐘 [BD] Pool listo (máx ${_pool.options.max} conexiones, ${esExterna ? 'externa con TLS' : 'interna'})`);
  return _pool;
}

/** Una consulta suelta. Devuelve el resultado de pg tal cual. */
const consulta = (sql, params) => pool().query(sql, params);

/**
 * Varias consultas en una transacción. Si el callback lanza, se deshace todo.
 * Se usa siempre que haya más de una escritura relacionada: sin esto, un fallo
 * a mitad deja la base a medias.
 */
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

/** Estado de la conexión, para diagnóstico. No lanza. */
async function estado() {
  if (!HAY_BD) return { configurada: false };
  try {
    const t0 = Date.now();
    const r = await consulta('SELECT version(), current_database() AS bd, now() AS ahora');
    const p = _pool;
    return {
      configurada: true, conecta: true,
      latenciaMs: Date.now() - t0,
      bd: r.rows[0].bd,
      version: String(r.rows[0].version).split(' ').slice(0, 2).join(' '),
      pool: { total: p.totalCount, libres: p.idleCount, esperando: p.waitingCount, max: p.options.max },
    };
  } catch (e) {
    return { configurada: true, conecta: false, error: e.message };
  }
}

async function cerrar() { if (_pool) { await _pool.end(); _pool = null; } }

module.exports = { HAY_BD, pool, consulta, transaccion, estado, cerrar };
