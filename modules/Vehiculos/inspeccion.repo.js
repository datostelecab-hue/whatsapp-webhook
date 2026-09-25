// ============================================================
// INSPECCIÓN DE VEHÍCULOS — la capa de datos
// ============================================================
// Una inspección es una fila en `inspeccion_vehiculo` y lo que se revisó en
// ella, una fila por elemento en `inspeccion_elemento` (db/150). La inspección
// de un coche es la MÁS RECIENTE no anulada; las anteriores quedan de historial.
//
// «La más reciente» es por fecha y, si no la tiene —lo importado del Excel no la
// trae—, por el día en que se apuntó. A igualdad, la última apuntada.

const db = require('../../services/db');

/** Qué se revisa, cómo puede estar y cuál puede ser el resultado. */
async function catalogos() {
  const [el, es, re] = await Promise.all([
    db.consulta(`SELECT codigo, etiqueta, grupo, orden, cabecera_excel
                   FROM cat_elemento_inspeccion WHERE activo ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta, tono, es_fallo, orden
                   FROM cat_estado_elemento ORDER BY orden`),
    db.consulta(`SELECT codigo, etiqueta, tono, orden
                   FROM cat_resultado_inspeccion ORDER BY orden`),
  ]);
  return { elementos: el.rows, estados: es.rows, resultados: re.rows };
}

// Los campos de una inspección, como los quiere la pantalla. Las fechas salen
// ya escritas de la base: un DATE pasado por JS se va al día anterior en Madrid.
const CAMPOS = `
  i.id AS inspeccion_id, to_char(i.fecha, 'YYYY-MM-DD') AS fecha, i.creado_at, i.origen,
  i.marca, i.modelo,
  i.itv_mes, i.itv_anio, i.vtc_delantera_mes, i.vtc_delantera_anio,
  i.vtc_trasera_mes, i.vtc_trasera_anio,
  i.observaciones, i.resultado,
  r.etiqueta AS resultado_etiqueta, r.tono AS resultado_tono,
  COALESCE(el.elementos, '[]'::json) AS elementos`;

// Lo revisado en esa inspección, en el orden del catálogo: [{ elemento, estado }].
//
// SOLO LO ACTIVO. Un elemento que se deja de revisar (el botiquín, db/161) se
// apaga en el catálogo y desaparece también de las inspecciones de antes: si
// no, un «Falta» viejo seguiría contando como incidencia de un coche por algo
// que ya no se mira. La fila sigue en la base.
const ELEMENTOS = `
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('elemento', e.elemento, 'estado', e.estado) ORDER BY c.orden) AS elementos
      FROM inspeccion_elemento e
      JOIN cat_elemento_inspeccion c ON c.codigo = e.elemento
     WHERE e.inspeccion_id = i.id AND c.activo) el ON TRUE`;

const ORDEN_RECIENTE = 'COALESCE(i.fecha, (i.creado_at AT TIME ZONE \'Europe/Madrid\')::date) DESC, i.creado_at DESC';

/**
 * Un coche por fila, con su última inspección.
 *
 * Salen los coches VIVOS de la flota que se vigila (`sede`) y, además, los de
 * cualquier sede que tengan alguna inspección: el Excel del taller trae también
 * coches de Barcelona, y Camilo pidió que lo que traiga se apunte y se vea.
 */
async function lista({ sede } = {}) {
  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.marca_modelo, v.sede,
           ev.etiqueta AS estado_vehiculo,
           ${CAMPOS},
           (SELECT count(*) FROM inspeccion_vehiculo x
             WHERE x.vehiculo_id = v.id AND x.anulado_at IS NULL)::int AS n_inspecciones
      FROM vehiculo v
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
      LEFT JOIN LATERAL (
        SELECT i.* FROM inspeccion_vehiculo i
         WHERE i.vehiculo_id = v.id AND i.anulado_at IS NULL
         ORDER BY ${ORDEN_RECIENTE} LIMIT 1) i ON TRUE
      LEFT JOIN cat_resultado_inspeccion r ON r.codigo = i.resultado
      ${ELEMENTOS}
     WHERE v.baja_at IS NULL
       AND (v.sede = $1 OR i.id IS NOT NULL)
     ORDER BY v.matricula`, [sede]);
  return r.rows;
}

/** Un coche con TODAS sus inspecciones, la más reciente primero. Las anuladas al final. */
async function ficha(vehiculoId) {
  const v = (await db.consulta(`
    SELECT v.id, v.matricula, v.marca_modelo, v.sede, ev.etiqueta AS estado_vehiculo
      FROM vehiculo v
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
     WHERE v.id = $1`, [Number(vehiculoId)])).rows[0];
  if (!v) return null;
  const r = await db.consulta(`
    SELECT ${CAMPOS},
           btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS apuntado_nombre,
           i.anulado_at, i.anulado_motivo,
           btrim(COALESCE(ua.nombre, '') || ' ' || COALESCE(ua.apellidos, '')) AS anulado_nombre
      FROM inspeccion_vehiculo i
      LEFT JOIN cat_resultado_inspeccion r ON r.codigo = i.resultado
      LEFT JOIN usuario u  ON u.id  = i.apuntado_por
      LEFT JOIN usuario ua ON ua.id = i.anulado_por
      ${ELEMENTOS}
     WHERE i.vehiculo_id = $1
     ORDER BY (i.anulado_at IS NOT NULL), ${ORDEN_RECIENTE}`, [Number(vehiculoId)]);
  return { ...v, inspecciones: r.rows };
}

/** Los coches VIVOS de esas matrículas, por su matrícula normalizada. */
async function vehiculosPorMatricula(matriculas) {
  const r = await db.consulta(
    `SELECT id, matricula, matricula_norm, sede, marca_modelo FROM vehiculo
      WHERE baja_at IS NULL AND matricula_norm = ANY($1::varchar[])`, [matriculas]);
  return new Map(r.rows.map(x => [x.matricula_norm, x]));
}

/**
 * La última inspección de cada coche, para no duplicar al reimportar: su huella
 * guardada y lo que dice (con los elementos ACTIVOS), para poder rehacer la
 * huella con el catálogo de hoy.
 */
async function ultimasHuellas(vehiculoIds) {
  if (!vehiculoIds.length) return new Map();
  const r = await db.consulta(`
    SELECT DISTINCT ON (i.vehiculo_id) i.vehiculo_id, i.huella,
           i.marca, i.modelo, i.itv_mes, i.itv_anio, i.vtc_delantera_mes, i.vtc_delantera_anio,
           i.vtc_trasera_mes, i.vtc_trasera_anio, i.observaciones, i.resultado,
           COALESCE(el.elementos, '[]'::json) AS elementos
      FROM inspeccion_vehiculo i
      ${ELEMENTOS}
     WHERE i.vehiculo_id = ANY($1::bigint[]) AND i.anulado_at IS NULL
     ORDER BY i.vehiculo_id, ${ORDEN_RECIENTE}`, [vehiculoIds.map(Number)]);
  return new Map(r.rows.map(x => [String(x.vehiculo_id), x]));
}

/** Coches vivos, de cualquier sede, que no tienen NINGUNA inspección (ni anulada). */
async function sinNingunaInspeccion() {
  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.sede FROM vehiculo v
     WHERE v.baja_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM inspeccion_vehiculo i WHERE i.vehiculo_id = v.id)
     ORDER BY v.matricula`);
  return r.rows;
}

/**
 * Apunta una inspección con lo que se revisó, en una sola transacción: o queda
 * entera o no queda. `elementos` = { codigo: estado }; lo que no venga es que no
 * se revisó, y no lleva fila.
 */
async function crear(d, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    const r = await cli.query(`
      INSERT INTO inspeccion_vehiculo
        (vehiculo_id, fecha, marca, modelo, itv_mes, itv_anio,
         vtc_delantera_mes, vtc_delantera_anio, vtc_trasera_mes, vtc_trasera_anio,
         observaciones, resultado, origen, huella, apuntado_por)
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id`,
      [Number(d.vehiculoId), d.fecha || null, d.marca || null, d.modelo || null,
       d.itvMes || null, d.itvAnio || null, d.vtcDelanteraMes || null, d.vtcDelanteraAnio || null,
       d.vtcTraseraMes || null, d.vtcTraseraAnio || null,
       d.observaciones || null, d.resultado || null, d.origen || 'manual', d.huella || null,
       usuarioId || null]);
    const id = r.rows[0].id;
    const pares = Object.entries(d.elementos || {}).filter(([, e]) => e);
    if (pares.length) {
      await cli.query(`
        INSERT INTO inspeccion_elemento (inspeccion_id, elemento, estado)
        SELECT $1, x.elemento, x.estado
          FROM unnest($2::varchar[], $3::varchar[]) AS x(elemento, estado)`,
        [id, pares.map(p => p[0]), pares.map(p => p[1])]);
    }
    return { id: String(id) };
  });
}

/** Anula una inspección mal apuntada. No se borra: queda con quién, cuándo y por qué. */
async function anular(id, motivo, { usuarioId } = {}) {
  const r = await db.consulta(`
    UPDATE inspeccion_vehiculo
       SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
     WHERE id = $1 AND anulado_at IS NULL
     RETURNING id, vehiculo_id`, [Number(id), usuarioId || null, String(motivo || '').trim()]);
  if (!r.rowCount) throw new Error('Esa inspección no existe o ya estaba anulada');
  return { id: String(r.rows[0].id), vehiculoId: String(r.rows[0].vehiculo_id) };
}

module.exports = {
  catalogos, lista, ficha, vehiculosPorMatricula, ultimasHuellas, sinNingunaInspeccion,
  crear, anular,
};
