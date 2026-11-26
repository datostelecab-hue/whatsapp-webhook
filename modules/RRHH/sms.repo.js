// ============================================================
// EL SMS CERTIFICADO — el SQL (módulo 9, db/306)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));
const nombre = a => `btrim(COALESCE(${a}.apellidos || ', ', '') || ${a}.nombre)`;
const hora = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;

async function hayTabla(cli = null) {
  return (await q(cli, `SELECT to_regclass('public.sms_envio') IS NOT NULL AS hay`)).rows[0].hay;
}

const FILA = `
  SELECT e.id::text AS id, e.asunto, e.mensaje, e.plantilla, e.alcance, e.personas::text[] AS personas, e.origen, e.origen_id,
         e.aceptacion, e.estado, e.error, e.creditos::float AS creditos, e.creado_por,
         ${hora('e.creado_at')} AS creado, uc.nombre AS creado_por_nombre,
         ${hora('e.enviado_at')} AS enviado, ue.nombre AS enviado_por_nombre,
         to_char(e.enviado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS enviado_dia,
         COALESCE(d.total, 0) AS total, COALESCE(d.entregados, 0) AS entregados, COALESCE(d.certificados, 0) AS certificados,
         COALESCE(d.abiertos, 0) AS abiertos, COALESCE(d.fallidos, 0) AS fallidos
    FROM sms_envio e
    LEFT JOIN usuario uc ON uc.id = e.creado_por
    LEFT JOIN usuario ue ON ue.id = e.enviado_por
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE x.entregado_at IS NOT NULL)::int AS entregados,
             count(*) FILTER (WHERE x.certificado_at IS NOT NULL)::int AS certificados,
             count(*) FILTER (WHERE x.abierto_at IS NOT NULL)::int AS abiertos,
             count(*) FILTER (WHERE x.error IS NOT NULL)::int AS fallidos
        FROM sms_destinatario x WHERE x.envio_id = e.id) d ON true`;

async function lista() {
  return (await db.consulta(`${FILA} WHERE e.estado <> 'anulado' OR e.anulado_at > now() - interval '30 days' ORDER BY e.creado_at DESC LIMIT 500`)).rows;
}
async function porId(cli, id) {
  return (await q(cli, `${FILA} WHERE e.id = $1`, [id])).rows[0] || null;
}

async function insertar(cli, x) {
  return (await q(cli,
    `INSERT INTO sms_envio (asunto, mensaje, plantilla, alcance, personas, origen, origen_id, aceptacion, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
    [x.asunto, x.mensaje, x.plantilla, x.alcance, x.personas, x.origen || 'manual', x.origenId || null, x.aceptacion || 0, x.creadoPor])).rows[0].id;
}

function sets(cambios, vals) {
  return Object.entries(cambios).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Columna no válida: ${k}`);
    if (v === 'now') return `${k} = now()`;
    vals.push(v);
    return `${k} = $${vals.length}`;
  });
}
async function cambiar(cli, id, cambios) {
  const vals = [id];
  const s = sets(cambios, vals);
  return (await q(cli, `UPDATE sms_envio SET ${s.join(', ')}, actualizado_at = now() WHERE id = $1`, vals)).rowCount > 0;
}
async function cambiarDestinatario(cli, id, cambios) {
  const vals = [id];
  const s = sets(cambios, vals);
  if (!s.length) return false;
  return (await q(cli, `UPDATE sms_destinatario SET ${s.join(', ')} WHERE id = $1`, vals)).rowCount > 0;
}

/** A quién va: la plantilla de alta por su alcance; con «personas», también quien ya se fue (un finiquito). */
async function destinatariosDe(cli, { alcance, personas }) {
  const filtro = {
    todos: 'AND c.empleo_vigente',
    propia: `AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id AND p.baja IS NULL AND p.tipo = 'propia')`,
    ett: `AND EXISTS (SELECT 1 FROM conductor_periodo_empleo p WHERE p.conductor_id = c.id AND p.baja IS NULL AND p.tipo = 'ett')`,
    personas: 'AND c.id = ANY($1::bigint[])',
  }[alcance];
  if (filtro == null) throw new Error(`Alcance no válido: ${alcance}`);
  const r = await q(cli,
    `SELECT c.id::text AS id, ${nombre('c')} AS nombre, c.nombre AS pila, NULLIF(btrim(c.dni_nie), '') AS dni,
            (SELECT e164 FROM conductor_telefono t WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
              ORDER BY t.principal DESC, t.id LIMIT 1) AS movil
       FROM conductor c
      WHERE NOT c.es_centinela${await pruebas.fuera('c')} ${filtro}
      ORDER BY 2`, alcance === 'personas' ? [personas || []] : []);
  return r.rows;
}

/** Para elegir personas: quien está de alta y quien se fue en 120 días. */
async function personas() {
  return (await db.consulta(
    `SELECT c.id::text AS id, ${nombre('c')} AS nombre, c.empleo_vigente AS alta,
            NULLIF(btrim(c.dni_nie), '') IS NOT NULL AS con_dni,
            EXISTS (SELECT 1 FROM conductor_telefono t WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL) AS con_movil
       FROM conductor c
      WHERE NOT c.es_centinela${await pruebas.fuera('c')} AND (c.empleo_vigente OR EXISTS (
              SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja >= CURRENT_DATE - 120))
      ORDER BY 2`)).rows;
}

async function guardarDestinatario(cli, envioId, x) {
  return (await q(cli,
    `INSERT INTO sms_destinatario (envio_id, conductor_id, movil, identificar, error)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (envio_id, conductor_id) DO NOTHING RETURNING id::text AS id`,
    [envioId, x.conductorId, x.movil, x.identificar, x.error || null])).rows[0] || null;
}

async function destinatariosDelEnvio(id) {
  return (await db.consulta(
    `SELECT d.id::text AS id, d.conductor_id::text AS conductor_id, ${nombre('c')} AS nombre, c.nombre AS pila, c.legajo,
            NULLIF(btrim(c.dni_nie), '') AS dni, d.movil, d.identificar, d.id_mensaje::text AS id_mensaje,
            d.resultado, d.estado_texto, ${hora('d.estado_at')} AS estado_en,
            ${hora('d.entregado_at')} AS entregado, ${hora('d.certificado_at')} AS certificado, ${hora('d.abierto_at')} AS abierto,
            ${hora('d.aceptado_at')} AS aceptado, ${hora('d.rechazado_at')} AS rechazado,
            d.certificado_adjunto_id::text AS certificado_adjunto_id, d.error
       FROM sms_destinatario d JOIN conductor c ON c.id = d.conductor_id
      WHERE d.envio_id = $1 ORDER BY 3`, [id])).rows;
}

/** Los que esperan su estado final o su certificado (para la vuelta de comprobación). */
async function porComprobar(cli, dias = 10) {
  return (await q(cli,
    `SELECT d.id::text AS id, d.id_mensaje::text AS id_mensaje, d.movil, d.resultado, d.conductor_id::text AS conductor_id,
            (d.certificado_at IS NOT NULL) AS certificado, d.certificado_adjunto_id
       FROM sms_destinatario d JOIN sms_envio e ON e.id = d.envio_id
      WHERE d.id_mensaje IS NOT NULL AND e.enviado_at > now() - ($1::int || ' days')::interval
        AND (d.certificado_adjunto_id IS NULL OR d.resultado IS NULL)
      ORDER BY d.id`, [dias])).rows;
}

async function porMensaje(cli, idMensaje, movil = null) {
  return (await q(cli,
    `SELECT d.id::text AS id, d.envio_id::text AS envio_id, d.conductor_id::text AS conductor_id, d.movil,
            d.certificado_adjunto_id, d.certificado_at, d.entregado_at, d.abierto_at
       FROM sms_destinatario d
      WHERE d.id_mensaje = $1 AND ($2::text IS NULL OR regexp_replace(d.movil, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g'))
      ORDER BY d.id LIMIT 1`, [idMensaje, movil])).rows[0] || null;
}

async function apuntarReport(cli, { servicio, idMensaje, movil, resultado, cuerpo }) {
  await q(cli, `INSERT INTO sms_report (servicio, id_mensaje, movil, resultado, cuerpo) VALUES ($1, $2, $3, $4, $5)`,
    [servicio || null, Number.isFinite(idMensaje) ? idMensaje : null, movil || null, Number.isFinite(resultado) ? resultado : null, JSON.stringify(cuerpo || {})]);
}

/** Para el expediente: los SMS certificados que se le mandaron. */
async function expediente(conductorId) {
  return (await db.consulta(
    `SELECT e.id::text AS id, e.asunto, to_char(e.enviado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            d.estado_texto, to_char(d.certificado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS certificado,
            to_char(d.abierto_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS abierto,
            d.certificado_adjunto_id::text AS certificado_adjunto_id, d.error
       FROM sms_destinatario d JOIN sms_envio e ON e.id = d.envio_id AND e.estado IN ('enviando', 'enviado', 'error')
      WHERE d.conductor_id = $1 ORDER BY e.enviado_at DESC NULLS LAST LIMIT 20`, [conductorId])).rows;
}

module.exports = {
  hayTabla, lista, porId, insertar, cambiar, cambiarDestinatario, destinatariosDe, personas, guardarDestinatario,
  destinatariosDelEnvio, porComprobar, porMensaje, apuntarReport, expediente,
};
