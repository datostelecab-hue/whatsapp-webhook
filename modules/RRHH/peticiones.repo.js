// ============================================================
// PETICIONES — SQL. Quién pidió qué, y cómo acabó
// ============================================================
// Solo lectura y escritura de la tabla `peticion`. El efecto de aprobar una
// —abrir la ausencia, dar de baja— NO está aquí: eso es de Conductores, y se
// pide por su puerta desde el servicio.

const db = require('../../services/db');

// Las etiquetas que ve la gente. La base guarda el código; la pantalla enseña
// esto. Se traduce en un solo sitio para que no haya dos listas que se
// desincronicen — que es exactamente lo que pasaba entre la hoja y el catálogo.
const ETIQUETA = {
  vacaciones: 'Vacaciones',
  baja_medica: 'Baja Médica',
  permiso: 'Permiso Retribuido',
  baja_empresa: 'Baja Empresa',
  reingreso: 'Reingreso',
};
const CODIGO = Object.fromEntries(Object.entries(ETIQUETA).map(([k, v]) => [v, k]));

const ESTADO_ETIQUETA = { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' };

/**
 * Las peticiones, con el nombre de la persona y las fechas ya en dd/mm/aaaa.
 *
 * Las fechas salen de la base con `to_char` y NO como Date: una columna DATE
 * leída con toISOString desde Madrid devuelve el día anterior, y aquí eso serían
 * vacaciones que empiezan un día antes de lo que se aprobó.
 */
async function listar() {
  const r = await db.consulta(
    `SELECT p.id, p.tipo, p.conductor_id, p.estado, p.motivo, p.motivo_rechazo,
            p.solicitante, p.resuelto_por,
            to_char(p.desde, 'DD/MM/YYYY')                    AS desde,
            to_char(p.hasta, 'DD/MM/YYYY')                    AS hasta,
            to_char(p.creado_at  AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS fecha_solicitud,
            to_char(p.resuelto_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS fecha_resolucion,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     NULLIF(btrim(COALESCE(c.apellidos || ', ', '') || c.nombre), ''),
                     'Conductor ' || c.id)                    AS conductor
       FROM peticion p
       JOIN conductor c ON c.id = p.conductor_id
      ORDER BY p.creado_at DESC`);

  return r.rows.map(x => ({
    id: String(x.id),
    tipo: ETIQUETA[x.tipo] || x.tipo,
    // `id_conductor` se llamaba así cuando era el ID_BOLT de una hoja. Sigue
    // llamándose igual porque es lo que manda la pantalla, pero ahora es el id
    // de PostgreSQL: un número que identifica a una persona y solo a una.
    id_conductor: String(x.conductor_id),
    conductor: x.conductor,
    desde: x.desde || '',
    hasta: x.hasta || '',
    motivo: x.motivo || '',
    estado: ESTADO_ETIQUETA[x.estado] || x.estado,
    motivo_rechazo: x.motivo_rechazo || '',
    solicitante: x.solicitante || '',
    resuelto_por: x.resuelto_por || '',
    fecha_solicitud: x.fecha_solicitud || '',
    fecha_resolucion: x.fecha_resolucion || '',
  }));
}

/** Una petición en crudo (códigos, fechas ISO), para trabajar con ella. */
async function una(id) {
  const r = await db.consulta(
    `SELECT p.*,
            to_char(p.desde, 'YYYY-MM-DD') AS desde_iso,
            to_char(p.hasta, 'YYYY-MM-DD') AS hasta_iso,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                     NULLIF(btrim(COALESCE(c.apellidos || ', ', '') || c.nombre), ''),
                     'Conductor ' || c.id) AS conductor
       FROM peticion p
       JOIN conductor c ON c.id = p.conductor_id
      WHERE p.id = $1`, [Number(id)]);
  return r.rows[0] || null;
}

/** Guarda una petición nueva. Devuelve su id. */
async function crear({ tipo, conductorId, desde, hasta, motivo, estado,
                       solicitante, solicitanteId, resueltoPor, resueltoPorId }) {
  const resuelta = estado && estado !== 'pendiente';
  const r = await db.consulta(
    `INSERT INTO peticion
       (tipo, conductor_id, desde, hasta, motivo, estado,
        solicitante, solicitante_id, resuelto_por, resuelto_por_id, resuelto_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6::varchar, $7, $8, $9, $10,
             -- El mismo $6 se usa como valor y dentro del CASE, y sin el cast
             -- PostgreSQL no sabe de qué tipo es: "inconsistent types deduced".
             CASE WHEN $6::varchar <> 'pendiente' THEN now() END)
     RETURNING id`,
    [tipo, Number(conductorId), desde || null, hasta || null, motivo || null,
     estado || 'pendiente', solicitante || '', solicitanteId || null,
     resuelta ? (resueltoPor || '') : '', resuelta ? (resueltoPorId || null) : null]);
  return Number(r.rows[0].id);
}

/**
 * Cierra una petición pendiente. Devuelve `false` si ya no estaba pendiente —
 * que es la forma de que dos personas resolviéndola a la vez no la resuelvan dos
 * veces: el `WHERE estado = 'pendiente'` lo decide la base, no una lectura
 * previa que puede quedarse vieja entre el SELECT y el UPDATE.
 */
async function resolver(id, { estado, resueltoPor, resueltoPorId, motivoRechazo, desde, hasta }) {
  const r = await db.consulta(
    `UPDATE peticion
        SET estado = $2,
            resuelto_por = $3, resuelto_por_id = $4, resuelto_at = now(),
            motivo_rechazo = $5,
            -- RRHH puede AJUSTAR las fechas al aprobar (el formulario las trae
            -- como las pidió Tráfico). Lo que no manda se queda como estaba.
            desde = COALESCE($6::date, desde),
            hasta = COALESCE($7::date, hasta)
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING id`,
    [Number(id), estado, resueltoPor || '', resueltoPorId || null,
     motivoRechazo || null, desde || null, hasta || null]);
  return r.rowCount > 0;
}

/** Cuántas hay sin resolver. Lo pregunta la campana de notificaciones. */
async function pendientes() {
  const r = await db.consulta(`SELECT count(*)::int n FROM peticion WHERE estado = 'pendiente'`);
  return r.rows[0].n;
}

module.exports = { listar, una, crear, resolver, pendientes, ETIQUETA, CODIGO };
