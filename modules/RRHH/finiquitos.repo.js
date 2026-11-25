// ============================================================
// LOS FINIQUITOS — el SQL (módulo 7, db/291)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.finiquito') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

/**
 * La persona y su contrato terminado: el de esa fecha de baja o, sin fecha, el
 * último que ya terminó (hasta hoy). → null si no tiene ninguno.
 */
async function bajaDe(conductorId, fechaBaja = null, cli = null) {
  const r = await q(cli,
    `SELECT c.id::text AS conductor_id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre,
            c.nombre_ss, c.dni_nie, c.legajo, c.empleo_vigente,
            e.id::text AS periodo_id, e.tipo, e.ett_nombre, e.motivo_baja,
            to_char(e.alta, 'YYYY-MM-DD') AS alta, to_char(e.baja, 'YYYY-MM-DD') AS baja,
            to_char(e.fecha_antiguedad, 'YYYY-MM-DD') AS antiguedad, e.jornada_horas
       FROM conductor c
       JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NOT NULL
      WHERE c.id = $1 AND ($2::date IS NULL AND e.baja <= (now() AT TIME ZONE 'Europe/Madrid')::date OR e.baja = $2::date)
      ORDER BY e.baja DESC LIMIT 1`, [conductorId, fechaBaja]);
  return r.rows[0] || null;
}

/** Las bajas desde `desde` hasta hoy que aún no tienen finiquito (sin fichas de pruebas). */
async function bajasSinFiniquito(desde) {
  const r = await db.consulta(
    `SELECT DISTINCT e.conductor_id::text AS conductor_id, to_char(e.baja, 'YYYY-MM-DD') AS baja
       FROM conductor_periodo_empleo e
       JOIN conductor c ON c.id = e.conductor_id AND NOT c.es_centinela${await pruebas.fuera('c')}
      WHERE e.baja IS NOT NULL AND e.baja >= $1::date AND e.baja <= (now() AT TIME ZONE 'Europe/Madrid')::date
        AND NOT EXISTS (SELECT 1 FROM finiquito f WHERE f.conductor_id = e.conductor_id AND f.fecha_baja = e.baja)
      ORDER BY 2`, [desde]);
  return r.rows;
}

async function deBaja(cli, conductorId, fechaBaja) {
  const r = await q(cli, `SELECT id::text AS id, estado FROM finiquito WHERE conductor_id = $1 AND fecha_baja = $2::date FOR UPDATE`,
    [conductorId, fechaBaja]);
  return r.rows[0] || null;
}

async function insertar(cli, { conductorId, periodoId, fechaBaja, tipo, ettNombre, resumen }) {
  const r = await q(cli,
    `INSERT INTO finiquito (conductor_id, periodo_id, fecha_baja, tipo, ett_nombre, resumen)
     VALUES ($1, $2, $3::date, $4, $5, $6::jsonb) RETURNING id::text AS id`,
    [conductorId, periodoId, fechaBaja, tipo, ettNombre || null, JSON.stringify(resumen)]);
  return r.rows[0].id;
}

/** Recalcular: el resumen nuevo, y vuelve a borrador (lo revisado era otra cosa). */
async function recalcular(cli, id, resumen) {
  await q(cli,
    `UPDATE finiquito SET resumen = $2::jsonb, calculado_at = now(), estado = 'borrador', revisado_at = NULL, revisado_por = NULL
      WHERE id = $1`, [id, JSON.stringify(resumen)]);
}

const CAMPOS = new Set(['estado', 'revisado_at', 'revisado_por', 'aprobado_at', 'aprobado_por', 'enviado_at', 'enviado_por',
  'enviado_a', 'envio_nota', 'firmado_at', 'firmado_por', 'documento_id', 'nota']);
/** Cambia lo que se diga (`now` para las fechas que son ahora). */
async function cambiar(cli, id, cambios) {
  const claves = Object.keys(cambios).filter(k => CAMPOS.has(k));
  if (!claves.length) return;
  const valores = [];
  const sets = claves.map(k => {
    if (cambios[k] === 'now') return `${k} = now()`;
    valores.push(cambios[k]);
    return `${k} = $${valores.length + 1}`;
  });
  await q(cli, `UPDATE finiquito SET ${sets.join(', ')} WHERE id = $1`, [id, ...valores]);
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;
const SELECT = `
  SELECT f.id::text AS id, f.conductor_id::text AS conductor_id, to_char(f.fecha_baja, 'YYYY-MM-DD') AS fecha_baja,
         f.tipo, f.ett_nombre, f.estado, f.resumen, f.nota, f.enviado_a, f.envio_nota, f.documento_id::text AS documento_id,
         to_char(f.calculado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS calculado,
         to_char(f.revisado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS revisado,
         to_char(f.aprobado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS aprobado,
         to_char(f.enviado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS enviado,
         to_char(f.firmado_at AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS firmado,
         ${nombreDe('ur')} AS revisado_por_nombre, ${nombreDe('ua')} AS aprobado_por_nombre,
         ${nombreDe('ue')} AS enviado_por_nombre, ${nombreDe('uf')} AS firmado_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo, c.dni_nie
    FROM finiquito f
    JOIN conductor c ON c.id = f.conductor_id
    LEFT JOIN usuario ur ON ur.id = f.revisado_por
    LEFT JOIN usuario ua ON ua.id = f.aprobado_por
    LEFT JOIN usuario ue ON ue.id = f.enviado_por
    LEFT JOIN usuario uf ON uf.id = f.firmado_por`;

async function lista() {
  return (await db.consulta(`${SELECT} ORDER BY f.fecha_baja DESC, nombre`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE f.id = $1`, [id])).rows[0] || null;
}

/** Los de una persona (para su ficha). */
async function deConductor(conductorId) {
  return (await db.consulta(`${SELECT} WHERE f.conductor_id = $1 ORDER BY f.fecha_baja DESC`, [conductorId])).rows;
}

/** Quienes tienen una llave (para darles la tarjeta). */
async function conLlave(clave) {
  const r = await db.consulta(
    `SELECT u.id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = $1 AND u.estado <> 'bloqueado' ORDER BY u.id`, [clave]);
  return r.rows.map(x => Number(x.id));
}

async function porHacer() {
  const r = await db.consulta(
    `SELECT count(*) FILTER (WHERE estado = 'borrador')::int AS revisar,
            count(*) FILTER (WHERE estado = 'revisado')::int AS aprobar,
            count(*) FILTER (WHERE estado = 'aprobado')::int AS enviar
       FROM finiquito`);
  return r.rows[0];
}

module.exports = {
  hayTabla, bajaDe, bajasSinFiniquito, deBaja, insertar, recalcular, cambiar, lista, porId, deConductor, conLlave, porHacer,
};
