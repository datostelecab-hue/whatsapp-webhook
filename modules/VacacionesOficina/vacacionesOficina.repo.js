// ============================================================
// LAS VACACIONES DE LA OFICINA — el SQL (db/263)
// ============================================================
// Solo consultas. Las reglas, en vacacionesOficina.service.js. Lo que escribe
// recibe el `cli` de la transacción firmada (libro.conFirma).
'use strict';

const db = require('../../services/db');

const q = (cli, sql, vals) => (cli || { query: (s, v) => db.consulta(s, v) }).query(sql, vals);
const NOMBRE = a => `btrim(${a}.nombre || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), ''))`;
// La gente de la oficina: ni conductores ni bloqueados.
const OFICINA = a => `${a}.estado <> 'bloqueado' AND NOT EXISTS (SELECT 1 FROM rol r WHERE r.id = ${a}.rol_id AND r.codigo = 'conductor')`;

/** ¿Falta la migración db/263? (la columna o la tabla aún no existen) */
const faltaMigracion = e => !!e && (e.code === '42703' || e.code === '42P01') && /fecha_alta|oficina_vacacion/.test(e.message || '');

const COLUMNAS_V = `v.id, v.usuario_id, to_char(v.desde, 'YYYY-MM-DD') AS desde, to_char(v.hasta, 'YYYY-MM-DD') AS hasta,
  v.libra_dias, v.nota, v.estado, v.pedida_at, v.resuelta_at, v.resuelta_nota,
  (SELECT ${NOMBRE('r')} FROM usuario r WHERE r.id = v.resuelta_por) AS resuelta_por_nombre`;
const aVacacion = x => ({ ...x, id: Number(x.id), usuario_id: Number(x.usuario_id), libra_dias: (x.libra_dias || []).map(Number) });

/** Una persona de la oficina, con su fecha de alta (o null). Null si no es de la oficina. */
async function persona(id) {
  const r = await db.consulta(
    `SELECT u.id, ${NOMBRE('u')} AS nombre, to_char(u.fecha_alta, 'YYYY-MM-DD') AS alta
       FROM usuario u WHERE u.id = $1 AND ${OFICINA('u')}`, [id]);
  return r.rows[0] ? { ...r.rows[0], id: Number(r.rows[0].id) } : null;
}

/** Toda la oficina, con su fecha de alta. */
async function oficina() {
  const r = await db.consulta(
    `SELECT u.id, ${NOMBRE('u')} AS nombre, to_char(u.fecha_alta, 'YYYY-MM-DD') AS alta, p.nombre AS puesto
       FROM usuario u LEFT JOIN puesto p ON p.codigo = u.puesto_codigo
      WHERE ${OFICINA('u')} ORDER BY u.nombre, u.apellidos`);
  return r.rows.map(x => ({ ...x, id: Number(x.id) }));
}

/** Las vacaciones de esas personas (todas, con su estado): Map(id → [...]). */
async function vacacionesDe(ids) {
  const out = new Map(ids.map(id => [Number(id), []]));
  if (!ids.length) return out;
  const r = await db.consulta(
    `SELECT ${COLUMNAS_V} FROM oficina_vacacion v WHERE v.usuario_id = ANY($1::int[]) ORDER BY v.desde, v.id`, [ids.map(Number)]);
  r.rows.map(aVacacion).forEach(v => { if (out.has(v.usuario_id)) out.get(v.usuario_id).push(v); });
  return out;
}

async function vacacion(cli, id) {
  const r = await q(cli, `SELECT ${COLUMNAS_V} FROM oficina_vacacion v WHERE v.id = $1`, [id]);
  return r.rows[0] ? aVacacion(r.rows[0]) : null;
}

/** Las pedidas o aprobadas de una persona que pisan a…b (para no pedir dos veces lo mismo). */
async function solapadas(cli, usuarioId, desde, hasta) {
  const r = await q(cli,
    `SELECT ${COLUMNAS_V} FROM oficina_vacacion v
      WHERE v.usuario_id = $1 AND v.estado IN ('pedida', 'aprobada') AND v.desde <= $3::date AND v.hasta >= $2::date`,
    [usuarioId, desde, hasta]);
  return r.rows.map(aVacacion);
}

async function insertar(cli, { usuarioId, desde, hasta, libra, nota, por }) {
  const r = await q(cli,
    `INSERT INTO oficina_vacacion (usuario_id, desde, hasta, libra_dias, nota, pedida_por)
     VALUES ($1, $2::date, $3::date, $4::smallint[], $5, $6) RETURNING id`,
    [usuarioId, desde, hasta, libra, nota || null, por]);
  return Number(r.rows[0].id);
}

/** Aprobar, rechazar o anular. Solo cambia si estaba como se espera (`desde`). → true si cambió. */
async function resolver(cli, id, { estado, por, nota, desdeEstados }) {
  const r = await q(cli,
    `UPDATE oficina_vacacion SET estado = $2, resuelta_at = now(), resuelta_por = $3, resuelta_nota = $4
      WHERE id = $1 AND estado = ANY($5::text[]) RETURNING id`,
    [id, estado, por, nota || null, desdeEstados]);
  return r.rows.length > 0;
}

/** Cuántas esperan aprobación. */
async function cuantasPedidas() {
  const r = await db.consulta(`SELECT count(*)::int AS n FROM oficina_vacacion WHERE estado = 'pedida'`);
  return r.rows[0].n;
}

/** Quienes tienen la llave de Usuarios y permisos, activos: los que aprueban. */
async function aprobadores() {
  const r = await db.consulta(
    `SELECT DISTINCT u.id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = '/usuarios' AND u.estado <> 'bloqueado'`);
  return r.rows.map(x => Number(x.id));
}

module.exports = {
  faltaMigracion, persona, oficina, vacacionesDe, vacacion, solapadas, insertar, resolver, cuantasPedidas, aprobadores,
};
