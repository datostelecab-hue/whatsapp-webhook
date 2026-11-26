// ============================================================
// EL ENVÍO A FIRMA — el SQL (módulo 6, db/293)
// ============================================================
'use strict';

const db = require('../../services/db');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.firma_envio') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

/**
 * El usuario «Bot telecab» (db/293): con él firma en el libro lo que hace
 * Claude. Bloqueado (no entra en el ERP) y sin contraseña. Se crea la primera
 * vez que hace falta.
 */
async function bot() {
  const ya = await db.consulta(`SELECT id FROM usuario WHERE email = 'bot@telecab.invalid'`);
  if (ya.rows[0]) return Number(ya.rows[0].id);
  const r = await db.consulta(
    `INSERT INTO usuario (email, nombre, apellidos, rol_id, pass_hash, estado, debe_cambiar)
     VALUES ('bot@telecab.invalid', 'Bot', 'telecab', (SELECT id FROM rol WHERE codigo = 'oficina'), 'sin-contrasena', 'bloqueado', FALSE)
     RETURNING id`);
  return Number(r.rows[0].id);
}

/** El firmante de hoy: el nombre de la Seguridad Social (o el de la ficha), su email y su móvil principal. */
async function firmanteDe(conductorId, cli = null) {
  const r = await q(cli,
    `SELECT c.id::text AS id, COALESCE(NULLIF(btrim(c.nombre_ss), ''), btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)) AS nombre,
            NULLIF(btrim(c.email), '') AS email, NULLIF(btrim(c.dni_nie), '') AS dni,
            (SELECT e164 FROM conductor_telefono t WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
              ORDER BY t.principal DESC, t.id LIMIT 1) AS movil
       FROM conductor c WHERE c.id = $1`, [conductorId]);
  return r.rows[0] || null;
}

/** Para elegir a quién se le manda uno a mano: quien está de alta y quien se fue en 120 días. */
async function personas() {
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.empleo_vigente AS alta
       FROM conductor c
      WHERE NOT c.es_centinela AND (c.empleo_vigente OR EXISTS (
              SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja >= CURRENT_DATE - 120))
      ORDER BY 2`);
  return r.rows;
}

async function insertar(cli, x) {
  const r = await q(cli,
    `INSERT INTO firma_envio (tipo, titulo, origen, origen_id, conductor_id, firmante_nombre, firmante_email, firmante_movil, nota, creado_por${x.detalle ? ', detalle' : ''})
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10${x.detalle ? ', $11::jsonb' : ''}) RETURNING id::text AS id`,
    [x.tipo, x.titulo, x.origen || 'manual', x.origenId || null, x.conductorId, x.firmante.nombre, x.firmante.email,
     x.firmante.movil, x.nota || null, x.creadoPor || null, ...(x.detalle ? [JSON.stringify(x.detalle)] : [])]);
  return r.rows[0].id;
}

async function deOrigen(cli, origen, origenId) {
  const r = await q(cli, `SELECT id::text AS id, estado FROM firma_envio
    WHERE origen = $1 AND origen_id = $2 AND estado NOT IN ('descartado', 'error') LIMIT 1`, [origen, String(origenId)]);
  return r.rows[0] || null;
}

const CAMPOS = new Set(['estado', 'nota', 'firmante_nombre', 'firmante_email', 'firmante_movil', 'aprobado_at', 'aprobado_por',
  'enviado_at', 'enviado_por', 'en_nombre_de', 'proveedor_ref', 'proveedor_url', 'cerrado_at', 'cerrado_por']);
/** Cambia lo que se diga (`now` = ahora). */
async function cambiar(cli, id, cambios) {
  const claves = Object.keys(cambios).filter(k => CAMPOS.has(k));
  if (!claves.length) return;
  const valores = [];
  const sets = claves.map(k => {
    if (cambios[k] === 'now') return `${k} = now()`;
    valores.push(cambios[k]);
    return `${k} = $${valores.length + 1}`;
  });
  await q(cli, `UPDATE firma_envio SET ${sets.join(', ')} WHERE id = $1`, [id, ...valores]);
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;
const fecha = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;
const SELECT = `
  SELECT f.id::text AS id, f.tipo, f.titulo, f.origen, f.origen_id, f.conductor_id::text AS conductor_id, f.estado, f.nota, f.detalle,
         f.firmante_nombre, f.firmante_email, f.firmante_movil, f.proveedor_ref, f.proveedor_url,
         ${fecha('f.creado_at')} AS creado, ${fecha('f.aprobado_at')} AS aprobado, ${fecha('f.enviado_at')} AS enviado,
         ${fecha('f.cerrado_at')} AS cerrado,
         ${nombreDe('ua')} AS aprobado_por_nombre, ${nombreDe('ue')} AS enviado_por_nombre,
         ${nombreDe('un')} AS en_nombre_de_nombre, ${nombreDe('uc')} AS cerrado_por_nombre, ${nombreDe('ucr')} AS creado_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo,
         btrim(c.nombre) AS nombre_pila, NULLIF(btrim(c.apellidos), '') AS apellidos,
         (SELECT count(*)::int FROM adjunto a WHERE a.dueno_tipo = 'firma_envio' AND a.dueno_id = f.id::text AND a.anulado_at IS NULL) AS documentos,
         (SELECT count(*)::int FROM adjunto a WHERE a.dueno_tipo = 'firma_firmada' AND a.dueno_id = f.id::text AND a.anulado_at IS NULL) AS firmados
    FROM firma_envio f
    JOIN conductor c ON c.id = f.conductor_id
    LEFT JOIN usuario ua ON ua.id = f.aprobado_por
    LEFT JOIN usuario ue ON ue.id = f.enviado_por
    LEFT JOIN usuario un ON un.id = f.en_nombre_de
    LEFT JOIN usuario uc ON uc.id = f.cerrado_por
    LEFT JOIN usuario ucr ON ucr.id = f.creado_por`;

async function lista() {
  return (await db.consulta(`${SELECT} ORDER BY f.creado_at DESC`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE f.id = $1`, [id])).rows[0] || null;
}

async function porEstado(estado) {
  return (await db.consulta(`${SELECT} WHERE f.estado = $1 ORDER BY f.aprobado_at NULLS LAST, f.id`, [estado])).rows;
}

async function cuantos() {
  const r = await db.consulta(`SELECT count(*) FILTER (WHERE estado = 'borrador')::int AS borradores,
    count(*) FILTER (WHERE estado = 'aprobado')::int AS aprobados FROM firma_envio`);
  return r.rows[0];
}

async function variasPorId(cli, ids) {
  return (await q(cli, `${SELECT} WHERE f.id = ANY($1::bigint[]) ORDER BY f.id`, [ids])).rows;
}

module.exports = { variasPorId, hayTabla, bot, firmanteDe, personas, insertar, deOrigen, cambiar, lista, porId, porEstado, cuantos };
