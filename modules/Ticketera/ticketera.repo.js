// ============================================================
// TICKETERA — SQL
// ============================================================
// La bandeja de cada área, el alta desde el formulario y lo que le pasa a un
// ticket. Nada de reglas: el reparto está en `clasificar` y las decisiones en el
// servicio.

const db = require('../../services/db');

// Fechas como texto con `to_char` y NUNCA como Date: una columna DATE leída con
// toISOString desde Madrid devuelve el día anterior.
const CAMPOS = `
  t.id, t.codigo, t.origen, t.fila_form,
  t.conductor_id, t.dni, t.nombre, t.telefono,
  t.area_codigo, t.subtipo_codigo, t.tipo_gestion, t.prioridad,
  t.descripcion, t.matricula, t.observaciones, t.resolucion,
  t.estado, t.responsable, t.responsable_id, t.usuario_id, t.adjuntos, t.notas,
  to_char(t.fecha_ini, 'DD/MM/YYYY')  AS fecha_ini,
  to_char(t.fecha_fin, 'DD/MM/YYYY')  AS fecha_fin,
  to_char(t.fecha_ini, 'YYYY-MM-DD')  AS fecha_ini_iso,
  to_char(t.fecha_fin, 'YYYY-MM-DD')  AS fecha_fin_iso,
  to_char(t.creado_at   AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS creado,
  to_char(t.marca_form  AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS pedido,
  -- La MISMA fecha en ISO, para poder compararla. La de arriba se lee y esta
  -- se ordena: 'DD/MM/YYYY' comparado como texto pone el 02/01 antes que el
  -- 31/12 del ano anterior, y el filtro por fechas dejaria de valer.
  to_char(COALESCE(t.marca_form, t.creado_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS pedido_iso,
  to_char(t.asignado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS asignado,
  to_char(t.resuelto_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS resuelto,
  -- Cuánto lleva abierto (o cuánto tardó). En horas con un decimal, que es como
  -- se mira "¿cuánto tardamos en atender?".
  round(EXTRACT(EPOCH FROM (COALESCE(t.resuelto_at, now()) - t.creado_at)) / 3600.0, 1)::float8 AS horas,
  s.etiqueta   AS subtipo, s.afecta_planning, s.estado_abre,
  a.etiqueta   AS area,
  e.etiqueta   AS estado_etiqueta, e.cierra, e.color,
  -- El nombre de la persona SEGÚN LA BASE, que puede no ser el que escribió en
  -- el formulario. Se enseñan los dos: si no coinciden, eso es el dato.
  c.nombre_bolt AS conductor_bolt,
  btrim(COALESCE(c.apellidos || ', ', '') || COALESCE(c.nombre, '')) AS conductor_nombre,
  u.email AS usuario_email,
  btrim(COALESCE(u.nombre, '') || ' ' || COALESCE(u.apellidos, '')) AS usuario_nombre`;

const DE = `
  FROM ticket t
  JOIN cat_ticket_subtipo s ON s.codigo = t.subtipo_codigo
  JOIN cat_ticket_area    a ON a.codigo = t.area_codigo
  JOIN cat_ticket_estado  e ON e.codigo = t.estado
  LEFT JOIN conductor     c ON c.id     = t.conductor_id
  LEFT JOIN usuario       u ON u.id     = t.usuario_id`;

function aFila(x) {
  return {
    id: String(x.id), codigo: x.codigo, origen: x.origen, filaForm: x.fila_form,
    conductorId: x.conductor_id ? String(x.conductor_id) : null,
    // Quién lo pide: el de la base si está enlazado, y si no lo que escribió.
    // Quien lo pide: el usuario si lo abrio desde dentro, el conductor si
    // vino por el formulario, y lo que escribiera si no se identifica.
    quien: x.usuario_nombre || x.usuario_email
        || x.conductor_bolt || x.conductor_nombre || x.nombre || x.dni || '(sin identificar)',
    usuarioId: x.usuario_id ? String(x.usuario_id) : null,
    usuarioEmail: x.usuario_email || '',
    adjuntos: Array.isArray(x.adjuntos) ? x.adjuntos : [],
    notas: x.notas || '',
    escribio: x.nombre || '',
    dni: x.dni || '', telefono: x.telefono || '',
    area: x.area, areaCodigo: x.area_codigo,
    subtipo: x.subtipo, subtipoCodigo: x.subtipo_codigo,
    gestion: x.tipo_gestion || '', prioridad: x.prioridad || '',
    descripcion: x.descripcion || '', matricula: x.matricula || '',
    observaciones: x.observaciones || '', resolucion: x.resolucion || '',
    estado: x.estado, estadoEtiqueta: x.estado_etiqueta, cerrado: !!x.cierra, color: x.color,
    responsable: x.responsable || '',
    fechaIni: x.fecha_ini || '', fechaFin: x.fecha_fin || '',
    fechaIniIso: x.fecha_ini_iso || '', fechaFinIso: x.fecha_fin_iso || '',
    creado: x.creado || '', pedido: x.pedido || '', pedidoIso: x.pedido_iso || '', asignado: x.asignado || '', resuelto: x.resuelto || '',
    horas: x.horas,
    afectaPlanning: !!x.afecta_planning, estadoAbre: x.estado_abre || null,
  };
}

/** La bandeja de un área: abiertos primero, y los cerrados por detrás. */
async function bandeja(areaCodigo, { cerrados = false, limite = 400 } = {}) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} ${DE}
      WHERE t.area_codigo = $1 AND ($2::boolean OR NOT e.cierra)
      ORDER BY e.cierra, t.creado_at DESC
      LIMIT $3`, [areaCodigo, cerrados, limite]);
  return r.rows.map(aFila);
}

async function una(id) {
  const r = await db.consulta(`SELECT ${CAMPOS} ${DE} WHERE t.id = $1`, [Number(id)]);
  return r.rows.length ? aFila(r.rows[0]) : null;
}

/** Cuántos hay sin cerrar, por área. Lo pide la campana de notificaciones. */
async function abiertosPorArea() {
  const r = await db.consulta(
    `SELECT t.area_codigo, count(*)::int n
       FROM ticket t JOIN cat_ticket_estado e ON e.codigo = t.estado
      WHERE NOT e.cierra GROUP BY 1`);
  return Object.fromEntries(r.rows.map(x => [x.area_codigo, x.n]));
}

/**
 * Da de alta un ticket venido del formulario.
 *
 * `ON CONFLICT (fila_form) DO NOTHING` es lo que hace que esto se pueda repetir
 * sin miedo: si la pasada anterior se cortó a medias, la siguiente vuelve sobre
 * las mismas filas y no duplica ninguna. La garantía es del índice único, no de
 * que la aplicación lleve bien la cuenta.
 */
async function alta(t) {
  const r = await db.consulta(
    `INSERT INTO ticket
       (codigo, origen, fila_form, marca_form, conductor_id, dni, nombre, telefono,
        area_codigo, subtipo_codigo, tipo_gestion, prioridad, descripcion, matricula,
        fecha_ini, fecha_fin, responsable)
     SELECT a.prefijo || '-' ||
            to_char(COALESCE($4::timestamp AT TIME ZONE 'Europe/Madrid', now())
                      AT TIME ZONE 'Europe/Madrid', 'YYYYMMDD') || '-' ||
            -- OJO CON lpad: en PostgreSQL TRUNCA además de rellenar.
            -- lpad('10000', 4, '0') no es '10000', es '1000' — y
            -- lpad('10001', 4, '0') también, así que dos tickets seguidos
            -- saldrían con el MISMO código. Se rellena solo cuando falta.
            lpad(x.n, GREATEST(4, length(x.n)), '0'),
            $1, $2, $3::timestamp AT TIME ZONE 'Europe/Madrid', $5, $6, $7, $8,
            a.codigo, $10, $11, $12, $13, $14, $15::date, $16::date, $17
       FROM cat_ticket_area a
       CROSS JOIN LATERAL (SELECT nextval('ticket_codigo_seq')::text AS n) x
      WHERE a.codigo = $9
     ON CONFLICT (fila_form) WHERE fila_form IS NOT NULL DO NOTHING
     RETURNING id, codigo`,
    [t.origen || 'formulario', t.filaForm || null, t.marca || null, t.marca || null,
     t.conductorId || null, t.dni || null, t.nombre || null, t.telefono || null,
     t.area, t.subtipo, t.gestion || null, t.prioridad || null,
     t.descripcion || null, t.matricula || null,
     t.fechaIni || null, t.fechaFin || null, t.responsable || '']);
  return r.rows[0] || null;     // null = ya estaba
}

/**
 * Alta de un ticket abierto DESDE DENTRO (soporte técnico). No viene del
 * formulario, así que no tiene fila ni DNI: tiene un usuario con cuenta.
 */
async function altaInterna(t) {
  const r = await db.consulta(
    `INSERT INTO ticket
       (codigo, origen, usuario_id, nombre, area_codigo, subtipo_codigo,
        tipo_gestion, prioridad, descripcion, adjuntos)
     SELECT a.prefijo || '-' ||
            to_char(now() AT TIME ZONE 'Europe/Madrid', 'YYYYMMDD') || '-' ||
            lpad(x.n, GREATEST(4, length(x.n)), '0'),
            $1, $2, $3, a.codigo, $5, $6, $7, $8, $9::jsonb
       FROM cat_ticket_area a
       CROSS JOIN LATERAL (SELECT nextval('ticket_codigo_seq')::text AS n) x
      WHERE a.codigo = $4
     RETURNING id, codigo`,
    [t.origen || 'soporte', t.usuarioId || null, t.nombre || null, t.area, t.subtipo,
     t.titulo || null, t.prioridad || null, t.descripcion || null,
     JSON.stringify(t.adjuntos || [])]);
  return r.rows[0];
}

/** Los que ha abierto una persona. Es lo que ve quien pidió ayuda. */
async function mios(usuarioId, limite = 100) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} ${DE} WHERE t.usuario_id = $1 ORDER BY t.creado_at DESC LIMIT $2`,
    [Number(usuarioId), limite]);
  return r.rows.map(aFila);
}

async function guardarNotas(id, texto) {
  await db.consulta('UPDATE ticket SET notas = $2 WHERE id = $1', [Number(id), texto || null]);
}

async function guardarAdjuntos(id, adjuntos) {
  await db.consulta('UPDATE ticket SET adjuntos = $2::jsonb WHERE id = $1',
    [Number(id), JSON.stringify(adjuntos || [])]);
}

/** Cambia el estado. Devuelve false si otro llegó antes y ya lo había cerrado. */
async function cambiarEstado(id, { estado, resolucion, cierra }) {
  const r = await db.consulta(
    `UPDATE ticket
        SET estado = $2,
            resolucion  = COALESCE($3, resolucion),
            resuelto_at = CASE WHEN $4 THEN COALESCE(resuelto_at, now()) ELSE NULL END
      WHERE id = $1
      RETURNING id`, [Number(id), estado, resolucion || null, !!cierra]);
  return r.rowCount > 0;
}

async function asignar(id, { responsable, responsableId }) {
  const r = await db.consulta(
    `UPDATE ticket
        SET responsable = $2, responsable_id = $3,
            asignado_at = COALESCE(asignado_at, now()),
            -- Asignar un ticket que nadie había tocado lo pone en curso: que
            -- alguien se lo quede ES el cambio de estado.
            estado = CASE WHEN estado = 'pendiente' THEN 'en_curso' ELSE estado END
      WHERE id = $1 RETURNING id, estado`, [Number(id), responsable || '', responsableId || null]);
  return r.rows[0] || null;
}

async function guardarObservaciones(id, texto) {
  await db.consulta('UPDATE ticket SET observaciones = $2 WHERE id = $1',
    [Number(id), texto || null]);
}

/** Enlaza el ticket con una persona (o lo desenlaza con null). */
async function enlazar(id, conductorId) {
  await db.consulta('UPDATE ticket SET conductor_id = $2 WHERE id = $1',
    [Number(id), conductorId || null]);
}

/** Lo manda a otra bandeja. El subtipo decide el área: no se eligen por separado. */
async function reclasificar(id, subtipoCodigo) {
  const r = await db.consulta(
    `UPDATE ticket t SET subtipo_codigo = s.codigo, area_codigo = s.area_codigo
       FROM cat_ticket_subtipo s
      WHERE t.id = $1 AND s.codigo = $2
      RETURNING t.id, t.area_codigo`, [Number(id), subtipoCodigo]);
  return r.rows[0] || null;
}

async function apuntar(ticketId, { antes, despues, nota, usuarioId, quien }) {
  await db.consulta(
    `INSERT INTO ticket_evento (ticket_id, estado_antes, estado_despues, nota, usuario_id, quien)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [Number(ticketId), antes || null, despues || null, nota || null, usuarioId || null, quien || '']);
}

async function historia(ticketId) {
  const r = await db.consulta(
    `SELECT estado_antes, estado_despues, nota, quien,
            to_char(creado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS cuando
       FROM ticket_evento WHERE ticket_id = $1 ORDER BY creado_at, id`, [Number(ticketId)]);
  return r.rows;
}

/** Los catálogos que necesita la pantalla para pintar sus desplegables. */
async function catalogos() {
  const [areas, subtipos, estados, ausencias] = await Promise.all([
    db.consulta('SELECT codigo, etiqueta, prefijo FROM cat_ticket_area WHERE activa ORDER BY orden'),
    db.consulta(`SELECT codigo, etiqueta, area_codigo, afecta_planning
                   FROM cat_ticket_subtipo ORDER BY orden`),
    db.consulta('SELECT codigo, etiqueta, cierra, color FROM cat_ticket_estado ORDER BY orden'),
    // LAS AUSENCIAS QUE SE PUEDEN APLICAR. El subtipo del ticket ya propone una
    // —vacaciones abre vacaciones— pero la propuesta puede estar mal: el
    // formulario lo rellena el conductor, y "baja o ausencia" cabe en varias.
    // Quien aplica tiene que poder corregirlo sin salir de la pantalla.
    db.consulta(`SELECT codigo, etiqueta, fin_previsible, libera_plaza
                   FROM cat_estado_conductor WHERE es_ausencia ORDER BY orden, etiqueta`),
  ]);
  return { areas: areas.rows, subtipos: subtipos.rows, estados: estados.rows,
           ausencias: ausencias.rows };
}

module.exports = {
  bandeja, una, abiertosPorArea, alta, altaInterna, mios, cambiarEstado, asignar,
  guardarNotas, guardarAdjuntos,
  guardarObservaciones, enlazar, reclasificar, apuntar, historia, catalogos,
};
