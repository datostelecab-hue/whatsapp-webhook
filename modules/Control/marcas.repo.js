// ============================================================
// LAS MARCAS DEL DÍA DE UN CONDUCTOR: «NO SALDRÁ» Y «TRAZA POR SLACK»
// ============================================================
// Dos cosas que Control apunta de una persona en una jornada y que no son una
// llamada (db/170):
//
//   · NO SALDRÁ — por qué no va a salir: uno de seis motivos y un comentario
//     obligatorio. Con eso ya se sabe lo que pasa, así que el cockpit le quita
//     las alertas de horas («No llegará») y las campañas dejan de llamarle.
//
//   · TRAZA POR SLACK — en qué canal de Slack de la empresa se dejó constancia.
//     Es solo la marca: el ERP no escribe en Slack.
//
// UNA vigente por conductor y jornada (lo vigila el índice). Marcar otra vez
// anula la anterior y escribe la nueva; quitar es anular. No se borra nada.

const db = require('../../services/db');

// Los motivos viven también en el CHECK de `control_no_sale`: si se añade uno
// aquí, hay que añadirlo allí. El orden es el de la pantalla.
const MOTIVOS_NO_SALE = [
  { codigo: 'error_planificacion',     etiqueta: 'Error de planificación' },
  { codigo: 'asuntos_propios',         etiqueta: 'Asuntos propios' },
  { codigo: 'baja_sin_justificar',     etiqueta: 'Baja médica sin justificar' },
  { codigo: 'baja_justificada',        etiqueta: 'Baja médica justificada' },
  { codigo: 'herramientas_auxiliares', etiqueta: 'Herramientas auxiliares' },
  { codigo: 'caso_especifico',         etiqueta: 'Caso específico' },
];
const ETQ_MOTIVO = Object.fromEntries(MOTIVOS_NO_SALE.map(m => [m.codigo, m.etiqueta]));

// LOS CANALES DE SLACK DE LA EMPRESA, con su nombre EXACTO (también el «13-
// insidencias», que se escribe así en Slack: corregirlo aquí sería apuntar a un
// canal que no existe). Fuera queda `datos`, que es privado de Camilo. Sin CHECK
// de lista en la base a propósito: un canal nuevo es una línea aquí.
const CANALES_SLACK = [
  '1-general-telecab',
  '2-altas-de-empresas',
  '3-bajas-de-empresa',
  '4-bajas-medicas',
  '5-cambios-turnos-contratos',
  '6-nominas',
  '7-vacaciones',
  '8-seleccion-vacantes',
  '9-rrhh',
  '10-planificacion-de-trafico',
  '12-gestion-de-flota',
  '13-insidencias-coches-conductores',
  '14-taller-soporte',
  'control-de-trafico',   // 01/10/2026, sin número delante
];

// Antes de aplicar db/170 las tablas no existen: el cockpit sigue saliendo,
// sin marcas, en vez de caerse.
const sinTabla = e => e && e.code === '42P01';

/**
 * Las marcas VIGENTES de una jornada: { noSale: Map(cid → {...}), slack: Map(cid → {...}) }.
 */
async function delDia(dia) {
  const vacio = { noSale: new Map(), slack: new Map() };
  try {
    const [n, s] = await Promise.all([
      db.consulta(
        `SELECT n.id, n.conductor_id, n.motivo, n.comentario, n.turno, n.creado_at,
                to_char(n.creado_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
                COALESCE(u.nombre, '') AS quien
           FROM control_no_sale n
           LEFT JOIN usuario u ON u.id = n.usuario_id
          WHERE n.dia_operativo = $1::date AND n.anulado_at IS NULL`, [dia]),
      db.consulta(
        `SELECT s.id, s.conductor_id, s.canal, s.creado_at,
                to_char(s.creado_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
                COALESCE(u.nombre, '') AS quien
           FROM control_traza_slack s
           LEFT JOIN usuario u ON u.id = s.usuario_id
          WHERE s.dia_operativo = $1::date AND s.quitado_at IS NULL`, [dia]),
    ]);
    return {
      noSale: new Map(n.rows.map(x => [String(x.conductor_id), {
        id: String(x.id), motivo: x.motivo, etiqueta: ETQ_MOTIVO[x.motivo] || x.motivo,
        comentario: x.comentario, turno: x.turno || '', at: x.creado_at, hora: x.hora, quien: x.quien,
      }])),
      slack: new Map(s.rows.map(x => [String(x.conductor_id), {
        id: String(x.id), canal: x.canal, at: x.creado_at, hora: x.hora, quien: x.quien,
      }])),
    };
  } catch (e) {
    if (sinTabla(e)) return vacio;
    throw e;
  }
}

/** Escribe un «No saldrá». Si ya había uno vigente esa jornada, lo anula y lo sustituye. */
async function marcarNoSale({ conductorId, dia, turno, motivo, comentario, matricula, usuarioId }) {
  return db.transaccion(async cli => {
    await cli.query(
      `UPDATE control_no_sale SET anulado_at = now(), anulado_por = $3
        WHERE conductor_id = $1 AND dia_operativo = $2::date AND anulado_at IS NULL`,
      [conductorId, dia, usuarioId || null]);
    const r = await cli.query(
      `INSERT INTO control_no_sale (conductor_id, dia_operativo, turno, motivo, comentario, matricula, usuario_id)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7)
       RETURNING id, creado_at`,
      [conductorId, dia, turno || null, motivo, comentario, matricula || null, usuarioId || null]);
    return { id: String(r.rows[0].id), at: r.rows[0].creado_at };
  });
}

/** Quita el «No saldrá» vigente. Devuelve cuántos anuló (0 si no había). */
async function anularNoSale({ conductorId, dia, usuarioId }) {
  const r = await db.consulta(
    `UPDATE control_no_sale SET anulado_at = now(), anulado_por = $3
      WHERE conductor_id = $1 AND dia_operativo = $2::date AND anulado_at IS NULL`,
    [conductorId, dia, usuarioId || null]);
  return r.rowCount;
}

/** Marca la traza por Slack. Si ya había una vigente esa jornada, la sustituye. */
async function marcarSlack({ conductorId, dia, canal, usuarioId }) {
  return db.transaccion(async cli => {
    await cli.query(
      `UPDATE control_traza_slack SET quitado_at = now(), quitado_por = $3
        WHERE conductor_id = $1 AND dia_operativo = $2::date AND quitado_at IS NULL`,
      [conductorId, dia, usuarioId || null]);
    const r = await cli.query(
      `INSERT INTO control_traza_slack (conductor_id, dia_operativo, canal, usuario_id)
       VALUES ($1, $2::date, $3, $4)
       RETURNING id, creado_at`,
      [conductorId, dia, canal, usuarioId || null]);
    return { id: String(r.rows[0].id), at: r.rows[0].creado_at };
  });
}

/** Quita la traza por Slack vigente. Devuelve cuántas quitó (0 si no había). */
async function quitarSlack({ conductorId, dia, usuarioId }) {
  const r = await db.consulta(
    `UPDATE control_traza_slack SET quitado_at = now(), quitado_por = $3
      WHERE conductor_id = $1 AND dia_operativo = $2::date AND quitado_at IS NULL`,
    [conductorId, dia, usuarioId || null]);
  return r.rowCount;
}

module.exports = {
  MOTIVOS_NO_SALE, CANALES_SLACK, ETQ_MOTIVO,
  delDia, marcarNoSale, anularNoSale, marcarSlack, quitarSlack,
};
