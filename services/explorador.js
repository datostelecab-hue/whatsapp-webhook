// ============================================================
// EXPLORADOR DE LA BASE DE DATOS
// ============================================================
// Un phpMyAdmin de andar por casa, porque Render no trae ninguno.
//
// SEGURIDAD — cómo se impide escribir:
//
//   Toda consulta libre corre dentro de una transacción marcada READ ONLY por
//   la propia base. Un DELETE, un UPDATE o un DROP no fallan "porque el filtro
//   los pilló": fallan porque PostgreSQL se niega a ejecutarlos. Filtrar SQL
//   con expresiones regulares es una carrera que siempre se pierde; esto no.
//
//   Además hay un `statement_timeout`, así que una consulta mal pensada no
//   puede dejar la base bloqueada, y un límite de filas para no traerse un
//   millón de registros a la pantalla.
//
//   Los nombres de tabla y de columna que llegan por parámetro se comprueban
//   SIEMPRE contra el catálogo real antes de interpolarlos. Nunca se confía.

const db = require('./db');

const LIMITE_FILAS = 500;
const TIEMPO_MAX = process.env.EXPLORADOR_TIMEOUT || '10s';

/** Ejecuta en una transacción de SOLO LECTURA. Es la única puerta de entrada. */
async function soloLectura(sql, params = []) {
  const cli = await db.pool().connect();
  try {
    await cli.query('BEGIN');
    await cli.query('SET TRANSACTION READ ONLY');
    await cli.query(`SET LOCAL statement_timeout = '${TIEMPO_MAX}'`);
    const t0 = Date.now();
    const r = await cli.query(sql, params);
    return { filas: r.rows, columnas: (r.fields || []).map(f => f.name), ms: Date.now() - t0 };
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    cli.release();
  }
}

/** Las tablas y vistas del esquema, con su tamaño y cuántas filas tienen. */
async function tablas() {
  const r = await soloLectura(`
    SELECT c.relname AS nombre,
           c.relkind AS clase,
           CASE WHEN c.relkind = 'r' THEN pg_total_relation_size(c.oid) ELSE 0 END AS bytes,
           pg_size_pretty(CASE WHEN c.relkind='r' THEN pg_total_relation_size(c.oid) ELSE 0 END) AS tamano,
           GREATEST(c.reltuples::bigint, 0) AS filas_aprox,
           obj_description(c.oid) AS comentario
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v')
    ORDER BY c.relkind, c.relname`);
  return r.filas.map(t => ({ ...t, esVista: t.clase === 'v' }));
}

/** ¿Existe esa tabla? Devuelve su nombre real o lanza. Es la validación. */
async function validarTabla(nombre) {
  const r = await soloLectura(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','v') AND c.relname = $1`,
    [String(nombre || '')]);
  if (!r.filas.length) throw new Error(`No existe la tabla "${nombre}"`);
  return r.filas[0].relname;
}

/** Estructura: columnas, claves, índices y a dónde apuntan las foráneas. */
async function estructura(tabla) {
  const t = await validarTabla(tabla);

  const cols = await soloLectura(`
    SELECT a.attname AS nombre,
           format_type(a.atttypid, a.atttypmod) AS tipo,
           a.attnotnull AS obligatorio,
           pg_get_expr(d.adbin, d.adrelid) AS predeterminado,
           a.attgenerated <> '' AS generada,
           col_description(a.attrelid, a.attnum) AS comentario
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum`, [t]);

  const claves = await soloLectura(`
    SELECT con.conname AS nombre, con.contype AS tipo,
           pg_get_constraintdef(con.oid) AS definicion
    FROM pg_constraint con
    WHERE con.conrelid = $1::regclass
    ORDER BY CASE con.contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'f' THEN 3 ELSE 4 END, con.conname`, [t]);

  const indices = await soloLectura(
    `SELECT indexname AS nombre, indexdef AS definicion FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = $1 ORDER BY indexname`, [t]);

  // A qué tabla apunta cada columna: sirve para poder navegar de una a otra.
  const fks = await soloLectura(`
    SELECT a.attname AS columna, cl.relname AS destino, af.attname AS destino_col
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.confrelid
    JOIN unnest(con.conkey)  WITH ORDINALITY AS k(att, ord)  ON TRUE
    JOIN unnest(con.confkey) WITH ORDINALITY AS fk(att, ord) ON fk.ord = k.ord
    JOIN pg_attribute a  ON a.attrelid = con.conrelid  AND a.attnum = k.att
    JOIN pg_attribute af ON af.attrelid = con.confrelid AND af.attnum = fk.att
    WHERE con.conrelid = $1::regclass AND con.contype = 'f'`, [t]);

  return {
    tabla: t,
    columnas: cols.filas,
    restricciones: claves.filas,
    indices: indices.filas,
    foraneas: fks.filas,
  };
}

/**
 * Filas de una tabla, con búsqueda y orden. El orden se valida contra las
 * columnas reales; el texto va siempre como parámetro.
 */
async function datos(tabla, { pagina = 0, porPagina = 50, orden, desc, busca, filtroCol, filtroVal } = {}) {
  const t = await validarTabla(tabla);
  const est = await estructura(t);
  const nombres = est.columnas.map(c => c.nombre);
  const limite = Math.min(Number(porPagina) || 50, LIMITE_FILAS);
  const salto = Math.max(0, Number(pagina) || 0) * limite;

  const params = [];
  const donde = [];

  // Filtro por una columna concreta (el que se usa al pinchar una foránea).
  if (filtroCol && nombres.includes(filtroCol) && filtroVal !== undefined && filtroVal !== '') {
    params.push(String(filtroVal));
    donde.push(`"${filtroCol}"::text = $${params.length}`);
  }

  // Búsqueda libre: sobre las columnas que se pueden leer como texto.
  if (busca && String(busca).trim()) {
    params.push('%' + String(busca).trim() + '%');
    const i = params.length;
    const buscables = est.columnas
      .filter(c => !/^(bytea|json|jsonb)$/i.test(c.tipo))
      .map(c => `COALESCE("${c.nombre}"::text,'') ILIKE $${i}`);
    if (buscables.length) donde.push('(' + buscables.join(' OR ') + ')');
  }

  const filtro = donde.length ? 'WHERE ' + donde.join(' AND ') : '';
  const ordenCol = nombres.includes(orden) ? orden : nombres[0];
  const sentido = desc ? 'DESC' : 'ASC';

  const total = await soloLectura(`SELECT count(*)::int n FROM "${t}" ${filtro}`, params);
  const r = await soloLectura(
    `SELECT * FROM "${t}" ${filtro} ORDER BY "${ordenCol}" ${sentido} NULLS LAST
      LIMIT ${limite} OFFSET ${salto}`, params);

  return {
    tabla: t,
    columnas: est.columnas,
    foraneas: est.foraneas,
    filas: r.filas,
    total: total.filas[0].n,
    pagina: Math.floor(salto / limite),
    porPagina: limite,
    paginas: Math.ceil(total.filas[0].n / limite),
    orden: ordenCol, desc: !!desc,
    ms: r.ms,
  };
}

/**
 * Consulta libre. Se ejecuta en transacción de SOLO LECTURA: si es un UPDATE o
 * un DROP, lo rechaza PostgreSQL, no un filtro nuestro.
 */
async function consultaLibre(sql) {
  const texto = String(sql || '').trim();
  if (!texto) throw new Error('Escribe una consulta');
  // No se pone LIMIT automático: cambiar el SQL de alguien es peor que traer
  // muchas filas. Se avisa si vienen más de las que caben.
  const r = await soloLectura(texto);
  const recortado = r.filas.length > LIMITE_FILAS;
  return {
    columnas: r.columnas,
    filas: recortado ? r.filas.slice(0, LIMITE_FILAS) : r.filas,
    total: r.filas.length,
    recortado,
    ms: r.ms,
  };
}

/** Resumen para la cabecera del explorador. */
async function resumen() {
  const r = await soloLectura(`
    SELECT current_database() AS bd,
           pg_size_pretty(pg_database_size(current_database())) AS tamano,
           version() AS version,
           (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind='r') AS tablas,
           (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind='v') AS vistas`);
  const x = r.filas[0];
  return { ...x, version: String(x.version).split(' ').slice(0, 2).join(' ') };
}

module.exports = { tablas, estructura, datos, consultaLibre, resumen, LIMITE_FILAS };
