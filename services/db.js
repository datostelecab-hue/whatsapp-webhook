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

// SIN JIT (03/11/2026). PostgreSQL compila al vuelo (JIT) toda consulta que
// estima cara (jit_above_cost, 100.000), y las listas de este ERP lo son por sus
// LATERAL: la de Plantilla tardaba 220 ms, de los que 131 eran compilar, y la
// compilación no se reaprovecha entre peticiones. Sin JIT, 78 ms. El JIT sirve
// para análisis largos sobre millones de filas, no para pantallas. Va al abrir
// cada conexión (opción de arranque: Render no pone PgBouncer delante).
// DB_JIT=on lo devuelve a como estaba.
const OPCIONES_PG = process.env.DB_JIT === 'on' ? undefined : '-c jit=off';

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
    options: OPCIONES_PG,
  });
  _pool.on('error', e => console.error('❌ [BD] Error en conexión inactiva:', e.message));
  console.log(`🐘 [BD] Pool listo (máx ${_pool.options.max} conexiones, ${esExterna ? 'externa con TLS' : 'interna'})`);
  return _pool;
}

// ── QUIÉN ESCRIBE, PARA EL LIBRO DE AUDITORÍA (23/11/2026, db/278) ─────────
// El disparador del libro lee telecab.usuario_id y telecab.origen. Se ponen
// aquí, con lo que sabe el contexto de la petición (services/contexto.js),
// para que cada escritura diga quién la hizo sin que cada función lo pase a
// mano. Lo que firme el código después (libro.conFirma) manda sobre esto.
const contexto = require('./contexto');
const ES_ESCRITURA = /\b(INSERT\s+INTO|UPDATE\s+[\w."]+\s+SET|DELETE\s+FROM)\b/i;
const MANEJA_TRANSACCION = /\b(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\b/i;

async function firmarDelContexto(cli) {
  const c = contexto.actual();
  if (!c || (!c.usuarioId && !c.origen)) return;
  // El motivo, solo si el contexto lo trae (contexto.conMotivo, 24/11/2026). El
  // disparador del libro (db/247) lo lee de telecab.libro_motivo, en cambios y borrados.
  if (c.motivo) {
    await cli.query(
      `SELECT set_config('telecab.usuario_id', $1, true), set_config('telecab.origen', $2, true),
              set_config('telecab.libro_motivo', $3, true)`,
      [c.usuarioId ? String(c.usuarioId) : '', String(c.origen || '').slice(0, 60), String(c.motivo).slice(0, 2000)]);
    return;
  }
  await cli.query(
    `SELECT set_config('telecab.usuario_id', $1, true), set_config('telecab.origen', $2, true)`,
    [c.usuarioId ? String(c.usuarioId) : '', String(c.origen || '').slice(0, 60)]);
}

/**
 * Una consulta suelta. Devuelve el resultado de pg tal cual.
 *
 * Si ESCRIBE y hay una persona detrás (una petición con sesión), va en una
 * transacción corta firmada con quién es: así el libro sabe quién lo hizo. Lo
 * demás (leer, las tareas sin persona, un SQL que lleva su propia
 * transacción) va como siempre, sin coste.
 */
async function consulta(sql, params) {
  const c = contexto.actual();
  if (c && c.usuarioId && ES_ESCRITURA.test(String(sql)) && !MANEJA_TRANSACCION.test(String(sql))) {
    return transaccion(cli => cli.query(sql, params));
  }
  return pool().query(sql, params);
}

/**
 * Varias consultas en una transacción. Si el callback lanza, se deshace todo.
 * Se usa siempre que haya más de una escritura relacionada: sin esto, un fallo
 * a mitad deja la base a medias.
 */
async function transaccion(fn) {
  const cli = await pool().connect();
  try {
    await cli.query('BEGIN');
    await firmarDelContexto(cli);
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
