// ============================================================
// REMESAS — el SQL (db/266, 18/11/2026)
// ============================================================
// Desde fuera se entra por remesas.service.js. Aquí solo se lee y se escribe; lo
// que vale y lo que no lo decide el servicio. Solo Madrid: las tablas van
// escritas (recaudacion_movimiento es la de Madrid).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, params) => (cli ? cli.query(sql, params) : db.consulta(sql, params));
const NOMBRE = a => `btrim(${a}.nombre || COALESCE(' ' || ${a}.apellidos, ''))`;
const NOMBRE_USUARIO = a => `btrim(${a}.nombre || COALESCE(' ' || ${a}.apellidos, ''))`;

const COLUMNAS = `
  r.id, r.conductor_id, r.beneficiario, to_char(r.fecha, 'YYYY-MM-DD') AS fecha,
  to_char(r.fecha_documento, 'YYYY-MM-DD') AS fecha_documento, r.concepto, r.cif, r.numero_documento,
  r.importe_cent, r.estado, r.iban_cifrado, r.movimiento_id, r.notas, r.origen_ref,
  r.creado_por, r.creado_at, r.aprobada_por, r.aprobada_at, r.actualizado_at, r.anulado_at, r.anulado_motivo,
  CASE WHEN c.id IS NOT NULL THEN COALESCE(NULLIF(btrim(c.nombre_bolt), ''), ${NOMBRE('c')}) END AS conductor,
  c.iban_cifrado AS iban_ficha,
  ${NOMBRE_USUARIO('uc')} AS creado_por_nombre, ${NOMBRE_USUARIO('ua')} AS aprobada_por_nombre`;
const DESDE = `
  FROM recaudacion_remesa r
  LEFT JOIN conductor c ON c.id = r.conductor_id
  LEFT JOIN usuario uc ON uc.id = r.creado_por
  LEFT JOIN usuario ua ON ua.id = r.aprobada_por`;

const aFila = x => x && ({ ...x, id: Number(x.id), conductor_id: x.conductor_id == null ? null : Number(x.conductor_id),
  movimiento_id: x.movimiento_id == null ? null : Number(x.movimiento_id), importe_cent: Number(x.importe_cent) });

/** Las vivas (sin anular), las más nuevas primero. */
async function lista(cli = null) {
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE} WHERE r.anulado_at IS NULL ORDER BY r.fecha DESC, r.id DESC`);
  return r.rows.map(aFila);
}

async function porId(cli, id, { bloquear = false } = {}) {
  const r = await q(cli, `SELECT ${COLUMNAS} ${DESDE} WHERE r.id = $1${bloquear ? ' FOR UPDATE OF r' : ''}`, [Number(id)]);
  return aFila(r.rows[0]) || null;
}

async function insertar(cli, d) {
  const r = await q(cli,
    `INSERT INTO recaudacion_remesa (conductor_id, beneficiario, fecha, fecha_documento, concepto, cif, numero_documento,
                                     importe_cent, estado, iban_cifrado, notas, origen_ref, creado_por, aprobada_por, aprobada_at)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CASE WHEN $14::int IS NULL THEN NULL ELSE now() END)
     RETURNING id`,
    [d.conductorId || null, d.beneficiario, d.fecha, d.fechaDocumento || null, d.concepto || null, d.cif || null,
      d.numeroDocumento || null, d.importeCent, d.estado, d.ibanCifrado || null, d.notas || null, d.origenRef || null,
      d.creadoPor || null, d.aprobadaPor || null]);
  return Number(r.rows[0].id);
}

/** Cambia los campos que vengan (nombres de columna). */
async function actualizar(cli, id, campos, usuarioId) {
  const claves = Object.keys(campos);
  const sets = claves.map((k, i) => `${k} = $${i + 2}`);
  sets.push(`actualizado_por = $${claves.length + 2}`, 'actualizado_at = now()');
  await q(cli, `UPDATE recaudacion_remesa SET ${sets.join(', ')} WHERE id = $1`,
    [Number(id), ...claves.map(k => campos[k]), usuarioId || null]);
}

/** El descuento en la recaudación: un movimiento 'remesa' (baja lo que debe, no toca el cajón). */
async function apuntarMovimiento(cli, { conductorId, fecha, importeCent, observacion, usuarioId }) {
  const r = await q(cli,
    `INSERT INTO recaudacion_movimiento (conductor_id, fecha, tipo, importe, observacion, usuario_id)
     VALUES ($1, $2::date, 'remesa', $3, $4, $5) RETURNING id`,
    [Number(conductorId), fecha, (importeCent / 100).toFixed(2), String(observacion || '').slice(0, 255), usuarioId || null]);
  return Number(r.rows[0].id);
}

async function anularMovimiento(cli, movimientoId, { motivo, usuarioId }) {
  await q(cli,
    `UPDATE recaudacion_movimiento SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL`, [Number(movimientoId), usuarioId || null, String(motivo).slice(0, 255)]);
}

/** Los conductores con ficha que pueden recibir una remesa: los de la casa (o que lo fueron). */
async function conductores(cli = null) {
  const r = await q(cli,
    `SELECT c.id, COALESCE(NULLIF(btrim(c.nombre_bolt), ''), ${NOMBRE('c')}) AS nombre,
            btrim(c.nombre || COALESCE(' ' || c.apellidos, '') || COALESCE(' ' || c.nombre_bolt, '')) AS para_casar,
            c.empleo_vigente, c.iban_cifrado IS NOT NULL AS con_iban
       FROM conductor c
      WHERE NOT c.es_centinela
        AND EXISTS (SELECT 1 FROM conductor_periodo_empleo pe WHERE pe.conductor_id = c.id)
      ORDER BY c.empleo_vigente DESC, 2`);
  return r.rows.map(x => ({ id: Number(x.id), nombre: x.nombre, paraCasar: x.para_casar, vigente: !!x.empleo_vigente, conIban: !!x.con_iban }));
}

async function ibanDeConductor(cli, conductorId) {
  const r = await q(cli, 'SELECT iban_cifrado FROM conductor WHERE id = $1', [Number(conductorId)]);
  return (r.rows[0] && r.rows[0].iban_cifrado) || null;
}

/** Las que ya entraron de un Excel: Set(origen_ref). */
async function origenesYa(cli, refs) {
  if (!refs.length) return new Set();
  const r = await q(cli, 'SELECT origen_ref FROM recaudacion_remesa WHERE origen_ref = ANY($1::text[])', [refs]);
  return new Set(r.rows.map(x => x.origen_ref));
}

/** Quién aprueba: los que tienen la llave (activos). */
async function aprobadores(cli = null) {
  const r = await q(cli,
    `SELECT DISTINCT p.usuario_id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = '/recaudacion/remesas/aprobar' AND u.estado = 'activo'`);
  return r.rows.map(x => Number(x.usuario_id));
}

async function cuantasPorAprobar() {
  const r = await db.consulta(`SELECT count(*)::int AS n FROM recaudacion_remesa WHERE estado = 'pendiente_aprobacion' AND anulado_at IS NULL`);
  return r.rows[0].n;
}

const faltaMigracion = e => e && (e.code === '42P01' || /recaudacion_remesa/.test(String(e.message || '')));

module.exports = {
  lista, porId, insertar, actualizar, apuntarMovimiento, anularMovimiento, conductores, ibanDeConductor,
  origenesYa, aprobadores, cuantasPorAprobar, faltaMigracion,
};
