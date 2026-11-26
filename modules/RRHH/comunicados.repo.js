// ============================================================
// LOS COMUNICADOS A LA PLANTILLA — el SQL (módulos 6 y 9, db/305)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));
const nombre = a => `btrim(COALESCE(${a}.apellidos || ', ', '') || ${a}.nombre)`;
const hora = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;

async function hayTabla(cli = null) {
  return (await q(cli, `SELECT to_regclass('public.comunicado') IS NOT NULL AS hay`)).rows[0].hay;
}

const FILA = `
  SELECT m.id::text AS id, m.titulo, m.cuerpo, m.alcance, m.personas::text[] AS personas, m.estado, m.nota,
         ${hora('m.creado_at')} AS creado, uc.nombre AS creado_por_nombre, m.creado_por,
         ${hora('m.pedido_at')} AS pedido, ${hora('m.aprobado_at')} AS aprobado, ua.nombre AS aprobado_por_nombre,
         ${hora('m.anulado_at')} AS anulado,
         to_char(m.aprobado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS enviado_dia,
         COALESCE(d.total, 0) AS total, COALESCE(d.leidos, 0) AS leidos, COALESCE(d.sin_correo, 0) AS sin_correo,
         COALESCE(d.correo_fallido, 0) AS correo_fallido
    FROM comunicado m
    LEFT JOIN usuario uc ON uc.id = m.creado_por
    LEFT JOIN usuario ua ON ua.id = m.aprobado_por
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total, count(*) FILTER (WHERE x.leido_at IS NOT NULL)::int AS leidos,
             count(*) FILTER (WHERE x.email IS NULL)::int AS sin_correo,
             count(*) FILTER (WHERE x.correo_error IS NOT NULL)::int AS correo_fallido
        FROM comunicado_destinatario x WHERE x.comunicado_id = m.id) d ON true`;

async function lista() {
  return (await db.consulta(`${FILA} WHERE m.estado <> 'anulado' OR m.anulado_at > now() - interval '30 days' ORDER BY m.creado_at DESC`)).rows;
}

async function porId(cli, id) {
  return (await q(cli, `${FILA} WHERE m.id = $1`, [id])).rows[0] || null;
}

async function insertar(cli, x) {
  return (await q(cli,
    `INSERT INTO comunicado (titulo, cuerpo, alcance, personas, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id`,
    [x.titulo, x.cuerpo, x.alcance, x.personas, x.creadoPor])).rows[0].id;
}

async function cambiar(cli, id, cambios) {
  const vals = [id];
  const sets = Object.entries(cambios).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Columna no válida: ${k}`);
    if (v === 'now') return `${k} = now()`;
    vals.push(v);
    return `${k} = $${vals.length}`;
  });
  return (await q(cli, `UPDATE comunicado SET ${sets.join(', ')}, actualizado_at = now() WHERE id = $1`, vals)).rowCount > 0;
}

/** A quién va: la plantilla de alta (sin la ficha de pruebas), filtrada por el alcance. */
async function destinatariosDe(cli, { alcance, personas }) {
  const filtro = {
    todos: '',
    propia: `AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id AND p.baja IS NULL AND p.tipo = 'propia')`,
    ett: `AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id AND p.baja IS NULL AND p.tipo = 'ett')`,
    personas: 'AND c.id = ANY($1::bigint[])',
  }[alcance];
  if (filtro == null) throw new Error(`Alcance no válido: ${alcance}`);
  const r = await q(cli,
    `SELECT c.id::text AS id, ${nombre('c')} AS nombre, NULLIF(btrim(c.email), '') AS email
       FROM conductor c
      WHERE NOT c.es_centinela AND c.empleo_vigente${await pruebas.fuera('c')} ${filtro}
      ORDER BY 2`, alcance === 'personas' ? [personas || []] : []);
  return r.rows;
}

async function guardarDestinatarios(cli, id, filas) {
  if (!filas.length) return 0;
  const r = await q(cli,
    `INSERT INTO comunicado_destinatario (comunicado_id, conductor_id, email)
     SELECT $1, x.id, x.email FROM json_to_recordset($2::json) AS x(id bigint, email text)
     ON CONFLICT (comunicado_id, conductor_id) DO NOTHING`, [id, JSON.stringify(filas.map(f => ({ id: Number(f.id), email: f.email })))]);
  return r.rowCount;
}

/** Cómo va cada persona de un comunicado. */
async function destinatarios(id) {
  return (await db.consulta(
    `SELECT d.conductor_id::text AS conductor_id, ${nombre('c')} AS nombre, c.legajo, d.email,
            ${hora('d.correo_at')} AS correo, d.correo_error, d.recordatorios, ${hora('d.recordado_at')} AS recordado,
            ${hora('d.visto_at')} AS visto, ${hora('d.leido_at')} AS leido, (d.leido_at IS NOT NULL) AS ha_leido
       FROM comunicado_destinatario d JOIN conductor c ON c.id = d.conductor_id
      WHERE d.comunicado_id = $1
      ORDER BY (d.leido_at IS NOT NULL), 2`, [id])).rows;
}

/** Los correos por mandar de un comunicado (los que tienen email y aún no salieron). */
async function correosPorMandar(id) {
  return (await db.consulta(
    `SELECT d.id::text AS id, d.conductor_id::text AS conductor_id, d.email, c.nombre AS pila
       FROM comunicado_destinatario d JOIN conductor c ON c.id = d.conductor_id
      WHERE d.comunicado_id = $1 AND d.email IS NOT NULL AND d.correo_at IS NULL AND d.correo_error IS NULL`, [id])).rows;
}

async function apuntarCorreo(destId, { error = null, recordatorio = false } = {}) {
  if (recordatorio) {
    await db.consulta(`UPDATE comunicado_destinatario SET recordatorios = recordatorios + 1, recordado_at = now() WHERE id = $1`, [destId]);
  } else {
    await db.consulta(`UPDATE comunicado_destinatario SET correo_at = CASE WHEN $2::text IS NULL THEN now() END, correo_error = $2 WHERE id = $1`, [destId, error]);
  }
}

/** Los que no lo han leído y tienen correo, de los comunicados enviados: candidatos a recordatorio. */
async function sinLeer(cli) {
  return (await q(cli,
    `SELECT d.id::text AS id, d.comunicado_id::text AS comunicado_id, m.titulo, d.email, c.nombre AS pila, d.recordatorios,
            to_char(COALESCE(d.recordado_at, d.correo_at, m.aprobado_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS ultimo
       FROM comunicado_destinatario d
       JOIN comunicado m ON m.id = d.comunicado_id AND m.estado = 'enviado'
       JOIN conductor c ON c.id = d.conductor_id AND c.empleo_vigente
      WHERE d.leido_at IS NULL AND d.email IS NOT NULL AND d.correo_at IS NOT NULL`)).rows;
}

// ── Lo del portal ──────────────────────────────────────────────────────────
async function deConductor(conductorId) {
  return (await db.consulta(
    `SELECT m.id::text AS id, m.titulo, to_char(m.aprobado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            (d.leido_at IS NOT NULL) AS leido, ${hora('d.leido_at')} AS leido_en
       FROM comunicado_destinatario d JOIN comunicado m ON m.id = d.comunicado_id AND m.estado = 'enviado'
      WHERE d.conductor_id = $1
      ORDER BY (d.leido_at IS NOT NULL), m.aprobado_at DESC LIMIT 50`, [conductorId])).rows;
}

async function unoDeConductor(conductorId, id) {
  return (await db.consulta(
    `SELECT m.id::text AS id, m.titulo, m.cuerpo, to_char(m.aprobado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            (d.leido_at IS NOT NULL) AS leido, ${hora('d.leido_at')} AS leido_en, d.id::text AS dest_id
       FROM comunicado_destinatario d JOIN comunicado m ON m.id = d.comunicado_id AND m.estado = 'enviado'
      WHERE d.conductor_id = $1 AND m.id = $2`, [conductorId, id])).rows[0] || null;
}

async function visto(destId) {
  await db.consulta(`UPDATE comunicado_destinatario SET visto_at = COALESCE(visto_at, now()) WHERE id = $1`, [destId]);
}

async function leido(destId, { ip, agente }) {
  return (await db.consulta(
    `UPDATE comunicado_destinatario SET leido_at = now(), visto_at = COALESCE(visto_at, now()), leido_ip = $2, leido_agente = $3
      WHERE id = $1 AND leido_at IS NULL`, [destId, ip || null, agente || null])).rowCount > 0;
}

/** Para el expediente: los comunicados que se le mandaron y si los leyó. */
async function expediente(conductorId) {
  return (await db.consulta(
    `SELECT m.id::text AS id, m.titulo, to_char(m.aprobado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            to_char(d.leido_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS leido
       FROM comunicado_destinatario d JOIN comunicado m ON m.id = d.comunicado_id AND m.estado = 'enviado'
      WHERE d.conductor_id = $1 ORDER BY m.aprobado_at DESC LIMIT 20`, [conductorId])).rows;
}

async function conLlave(cli, clave) {
  return (await q(cli,
    `SELECT p.usuario_id AS id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = $1 AND u.estado = 'activo' ORDER BY p.usuario_id`, [clave])).rows.map(x => Number(x.id));
}

module.exports = {
  hayTabla, lista, porId, insertar, cambiar, destinatariosDe, guardarDestinatarios, destinatarios, correosPorMandar, apuntarCorreo,
  sinLeer, deConductor, unoDeConductor, visto, leido, expediente, conLlave,
};
