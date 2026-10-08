// ============================================================
// CITAS DEL TALLER — la capa de datos
// ============================================================
// Una cita es una fila de `taller_cita` (db/187): un coche, un día y una hora.
// Lo que pasa con ella —el aviso, lo que contestó el conductor, cada llamada
// de Control— va en `taller_cita_seguimiento`.
//
// QUIÉN LLEVA EL COCHE NO SE GUARDA: lo dice el planificador (`f_cobertura`)
// cada vez que se pregunta, porque puede cambiar hasta el último momento. Lo
// que sí se guarda es a quién se avisó, para poder decir «avisaste a Pedro y
// ahora lo lleva Juan».
//
// Las fechas salen ya escritas de la base: un DATE pasado por JS se va al día
// anterior en Madrid.

const db = require('../../services/db');

// El nombre que se enseña: el de BOLT primero, que es como lo conoce Control.
const NOMBRE = (c) => `COALESCE(NULLIF(btrim(${c}.nombre_bolt), ''),
                    NULLIF(btrim(${c}.nombre || ' ' || COALESCE(${c}.apellidos, '')), ''))`;
const HORA_MADRID = col => `to_char(${col} AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI')`;

/**
 * Los coches de esas matrículas (normalizadas). Si una matrícula tiene un coche
 * vivo y otro dado de baja, vale el vivo.
 */
async function vehiculosPorMatricula(mats) {
  if (!mats.length) return new Map();
  const r = await db.consulta(
    `SELECT id, matricula, matricula_norm, sede, marca_modelo, (baja_at IS NOT NULL) AS de_baja
       FROM vehiculo
      WHERE matricula_norm = ANY($1::text[])
      ORDER BY (baja_at IS NULL) DESC, id DESC`, [mats]);
  const m = new Map();
  r.rows.forEach(v => { if (!m.has(v.matricula_norm)) m.set(v.matricula_norm, v); });
  return m;
}

/** Las citas que ya hay entre dos fechas: para saber qué es nuevo, qué cambia y qué ya no viene. */
async function entreFechas(desde, hasta) {
  const r = await db.consulta(
    `SELECT c.id, c.vehiculo_id, c.matricula, to_char(c.fecha, 'YYYY-MM-DD') AS fecha,
            to_char(c.hora, 'HH24:MI') AS hora, c.marca, c.estado,
            (c.aviso_at IS NOT NULL) AS avisada, c.confirmacion
       FROM taller_cita c
      WHERE c.fecha BETWEEN $1::date AND $2::date`, [desde, hasta]);
  return r.rows;
}

/**
 * Guarda lo leído del Excel en UNA transacción: o entra todo o nada.
 *
 *   nuevas    [{ vehiculoId, matricula, fecha, hora, marca }]
 *   cambios   [{ id, hora, horaAntes, marca, reiniciar }] — `reiniciar` borra
 *             el aviso y la confirmación: se avisó de otra hora.
 */
async function guardarImportacion({ nuevas, cambios, fichero }, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    for (const c of nuevas) {
      await cli.query(
        `INSERT INTO taller_cita (vehiculo_id, matricula, fecha, hora, marca, fichero, creado_por)
         VALUES ($1, $2, $3::date, $4::time, $5, $6, $7)`,
        [c.vehiculoId, c.matricula, c.fecha, c.hora, c.marca || null, fichero || null, usuarioId || null]);
    }
    for (const c of cambios) {
      await cli.query(
        `UPDATE taller_cita
            SET hora = $2::time, marca = COALESCE($3, marca), fichero = $4, actualizado_at = now()
                ${c.reiniciar ? `, aviso_via = NULL, aviso_conductor_id = NULL, aviso_telefono = NULL,
                  aviso_at = NULL, aviso_wamid = NULL, aviso_error = NULL, aviso_intento_at = NULL,
                  aviso_por = NULL, confirmacion = NULL, confirmacion_via = NULL,
                  confirmacion_at = NULL, confirmacion_por = NULL` : ''}
          WHERE id = $1`,
        [c.id, c.hora, c.marca || null, fichero || null]);
      await cli.query(
        `INSERT INTO taller_cita_seguimiento (cita_id, tipo, resultado, nota, usuario_id)
         VALUES ($1, 'estado', 'Cambia la hora', $2, $3)`,
        [c.id, `De las ${c.horaAntes} a las ${c.hora} (Excel «${fichero || '—'}»)` +
          (c.reiniciar ? '. Ya se había avisado de la otra hora: hay que volver a avisar.' : ''),
         usuarioId || null]);
    }
    return { nuevas: nuevas.length, cambios: cambios.length };
  });
}

/**
 * LAS CITAS entre dos fechas, con a quién se avisó, qué contestó y su última
 * llamada. El responsable de hoy lo añade el servicio con `cobertura`.
 */
async function lista({ desde, hasta, id, vehiculoId } = {}) {
  const r = await db.consulta(
    `SELECT c.id, c.vehiculo_id, c.matricula, COALESCE(v.marca_modelo, c.marca) AS vehiculo, c.marca,
            v.sede, (v.baja_at IS NOT NULL) AS de_baja,
            to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(c.hora, 'HH24:MI') AS hora, c.estado,
            c.aviso_via, c.aviso_conductor_id, c.aviso_telefono, c.aviso_error,
            ${HORA_MADRID('c.aviso_at')} AS aviso_at, ${HORA_MADRID('c.aviso_intento_at')} AS aviso_intento_at,
            ${NOMBRE('ca')} AS aviso_conductor, ua.nombre AS aviso_por,
            c.confirmacion, c.confirmacion_via, ${HORA_MADRID('c.confirmacion_at')} AS confirmacion_at,
            uc.nombre AS confirmacion_por,
            c.fichero, ${HORA_MADRID('c.creado_at')} AS creado_at,
            (SELECT count(*) FROM taller_cita_seguimiento s
              WHERE s.cita_id = c.id AND s.tipo = 'llamada')::int AS llamadas,
            ul.ultima AS ultima_llamada
       FROM taller_cita c
       JOIN vehiculo v ON v.id = c.vehiculo_id
       LEFT JOIN conductor ca ON ca.id = c.aviso_conductor_id
       LEFT JOIN usuario ua ON ua.id = c.aviso_por
       LEFT JOIN usuario uc ON uc.id = c.confirmacion_por
       LEFT JOIN LATERAL (
         SELECT json_build_object('resultado', s.resultado, 'nota', s.nota,
                                  'cuando', ${HORA_MADRID('s.creado_at')}, 'quien', u.nombre) AS ultima
           FROM taller_cita_seguimiento s
           LEFT JOIN usuario u ON u.id = s.usuario_id
          WHERE s.cita_id = c.id AND s.tipo = 'llamada'
          ORDER BY s.creado_at DESC LIMIT 1) ul ON TRUE
      WHERE ${id ? 'c.id = $1' : 'c.fecha BETWEEN $1::date AND $2::date'}
            ${!id && vehiculoId ? 'AND c.vehiculo_id = $3' : ''}
      ORDER BY c.fecha, c.hora, c.matricula`, id ? [id] : vehiculoId ? [desde, hasta, vehiculoId] : [desde, hasta]);
  return r.rows;
}

const una = async id => (await lista({ id: Number(id) }))[0] || null;

/**
 * QUIÉN LLEVA CADA COCHE, según el planificador: una fila por coche, día, turno
 * y persona, con su nombre, su nombre de pila y su teléfono. La misma regla que
 * el cuadrante (`f_cobertura` con el interruptor de los eventos).
 */
async function cobertura(vehiculoIds, desde, hasta) {
  if (!vehiculoIds.length) return [];
  const r = await db.consulta(
    `SELECT to_char(f.dia, 'YYYY-MM-DD') AS dia, f.vehiculo_id, t.codigo AS turno, f.rol, f.orden_ct,
            f.conductor_id, ${NOMBRE('c')} AS nombre, c.nombre AS nombre_ficha, c.apellidos, c.nombre_bolt,
            tel.e164 AS telefono
       FROM f_cobertura($2::date, $3::date, TRUE) f
       JOIN turno t     ON t.id = f.turno_id
       JOIN conductor c ON c.id = f.conductor_id
       LEFT JOIN LATERAL (SELECT e164 FROM conductor_telefono
                           WHERE conductor_id = c.id AND vigente_hasta IS NULL
                           ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE f.vehiculo_id = ANY($1::bigint[]) AND f.conductor_id IS NOT NULL
      ORDER BY f.dia, f.vehiculo_id, t.codigo, (f.rol = 'FIJO') DESC, f.orden_ct NULLS FIRST`,
    [vehiculoIds, desde, hasta]);
  return r.rows;
}

/** El nombre y el teléfono de una persona, para el aviso a mano. */
async function conductor(id) {
  const r = await db.consulta(
    `SELECT c.id, ${NOMBRE('c')} AS nombre, c.nombre AS nombre_ficha, c.apellidos, c.nombre_bolt,
            (SELECT e164 FROM conductor_telefono WHERE conductor_id = c.id AND vigente_hasta IS NULL
              ORDER BY principal DESC, id LIMIT 1) AS telefono
       FROM conductor c WHERE c.id = $1`, [id]);
  return r.rows[0] || null;
}

/**
 * Las que toca avisar ese día: pendientes, sin aviso y sin un intento en la
 * última hora (si falló, se vuelve a probar a la hora siguiente, no a cada rato).
 */
async function paraAvisar(fecha) {
  const r = await db.consulta(
    `SELECT id FROM taller_cita
      WHERE fecha = $1::date AND estado = 'pendiente' AND aviso_at IS NULL
        AND (aviso_intento_at IS NULL OR aviso_intento_at < now() - INTERVAL '50 minutes')
      ORDER BY hora, matricula`, [fecha]);
  return r.rows.map(x => Number(x.id));
}

/** Apunta el aviso hecho (por el sistema o a mano) y lo deja en el seguimiento. */
async function marcarAviso(id, { via, conductorId, telefono, wamid, nota }, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    await cli.query(
      `UPDATE taller_cita
          SET aviso_via = $2, aviso_conductor_id = $3, aviso_telefono = $4, aviso_at = now(),
              aviso_wamid = $5, aviso_error = NULL, aviso_intento_at = now(), aviso_por = $6,
              actualizado_at = now()
        WHERE id = $1`,
      [id, via, conductorId || null, telefono || null, wamid || null, usuarioId || null]);
    await cli.query(
      `INSERT INTO taller_cita_seguimiento (cita_id, tipo, resultado, nota, conductor_id, usuario_id)
       VALUES ($1, 'aviso', $2, $3, $4, $5)`,
      [id, via === 'whatsapp' ? 'Aviso por WhatsApp' : 'Avisado a mano', nota || null,
       conductorId || null, usuarioId || null]);
  });
}

/** Un intento de aviso que no salió: se guarda el porqué y la hora, sin seguimiento. */
async function marcarIntento(id, error) {
  await db.consulta(
    `UPDATE taller_cita SET aviso_error = $2, aviso_intento_at = now(), actualizado_at = now() WHERE id = $1`,
    [id, String(error || '').slice(0, 500)]);
}

/**
 * Lo que contestó (por el botón o en la llamada). Si es una llamada, deja la
 * llamada en el seguimiento aunque no cambie la confirmación (no contesta).
 */
async function apuntarRespuesta(id, { tipo, resultado, nota, confirmacion, via, conductorId }, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    if (confirmacion) {
      await cli.query(
        `UPDATE taller_cita
            SET confirmacion = $2, confirmacion_via = $3, confirmacion_at = now(), confirmacion_por = $4,
                actualizado_at = now()
          WHERE id = $1`,
        [id, confirmacion, via, usuarioId || null]);
    }
    const r = await cli.query(
      `INSERT INTO taller_cita_seguimiento (cita_id, tipo, resultado, nota, conductor_id, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [id, tipo, resultado || null, nota || null, conductorId || null, usuarioId || null]);
    return { id: String(r.rows[0].id) };
  });
}

/** Hecha, no se presentó, anulada o vuelta a pendiente. Queda en el seguimiento con su motivo. */
async function cambiarEstado(id, { estado, etiqueta, nota }, { usuarioId } = {}) {
  return db.transaccion(async cli => {
    const r = await cli.query(
      `UPDATE taller_cita SET estado = $2, actualizado_at = now() WHERE id = $1 RETURNING id`, [id, estado]);
    if (!r.rowCount) throw new Error('No existe esa cita');
    await cli.query(
      `INSERT INTO taller_cita_seguimiento (cita_id, tipo, resultado, nota, usuario_id)
       VALUES ($1, 'estado', $2, $3, $4)`, [id, etiqueta, nota || null, usuarioId || null]);
  });
}

/** Todo lo que ha pasado con una cita, lo último primero. */
async function seguimiento(id) {
  const r = await db.consulta(
    `SELECT s.id, s.tipo, s.resultado, s.nota, ${HORA_MADRID('s.creado_at')} AS cuando,
            u.nombre AS quien, ${NOMBRE('c')} AS conductor
       FROM taller_cita_seguimiento s
       LEFT JOIN usuario u   ON u.id = s.usuario_id
       LEFT JOIN conductor c ON c.id = s.conductor_id
      WHERE s.cita_id = $1
      ORDER BY s.creado_at DESC, s.id DESC`, [id]);
  return r.rows;
}

/**
 * LA CITA A LA QUE CONTESTA un botón del WhatsApp. Primero por el mensaje al
 * que responde (el botón trae su id); si no, la próxima pendiente que se avisó
 * a ese teléfono. Los teléfonos se comparan por sus nueve últimas cifras.
 */
async function deRespuesta({ telefono, wamid, hoy }) {
  if (wamid) {
    const r = await db.consulta(`SELECT id FROM taller_cita WHERE aviso_wamid = $1`, [wamid]);
    if (r.rows[0]) return Number(r.rows[0].id);
  }
  const nueve = String(telefono || '').replace(/\D/g, '').slice(-9);
  if (nueve.length < 9) return null;
  const r = await db.consulta(
    `SELECT id FROM taller_cita
      WHERE right(aviso_telefono, 9) = $1 AND estado = 'pendiente' AND fecha >= $2::date
      ORDER BY fecha, hora LIMIT 1`, [nueve, hoy]);
  return r.rows[0] ? Number(r.rows[0].id) : null;
}

module.exports = {
  vehiculosPorMatricula, entreFechas, guardarImportacion, lista, una, cobertura, conductor,
  paraAvisar, marcarAviso, marcarIntento, apuntarRespuesta, cambiarEstado, seguimiento, deRespuesta,
};
