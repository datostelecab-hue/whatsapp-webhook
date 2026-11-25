// ============================================================
// FALTAS Y SANCIONES — el SQL (módulo 3, db/295)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.sancion') IS NOT NULL AS hay`);
  return r.rows[0].hay;
}

/** El catálogo del art. 39 del convenio (disciplinary_rule, db/31). */
async function reglas() {
  const r = await db.consulta(
    `SELECT rule_code AS codigo, severity AS gravedad, article_ref AS articulo, trigger_metric AS metrica, operator AS operador,
            threshold::float AS umbral, threshold_max::float AS umbral_max, window_unit AS ventana,
            sanction_min AS minimo, sanction_max AS maximo, sanction_unit AS unidad, auto_detect, notes AS nota
       FROM disciplinary_rule ORDER BY CASE severity WHEN 'LEVE' THEN 1 WHEN 'GRAVE' THEN 2 ELSE 3 END, rule_code`);
  return r.rows;
}

/** Para elegir a quién: quien está de alta y quien se fue en 120 días. */
async function personas() {
  const r = await db.consulta(
    `SELECT c.id::text AS id, btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.empleo_vigente AS alta
       FROM conductor c
      WHERE NOT c.es_centinela${await pruebas.fuera('c')} AND (c.empleo_vigente OR EXISTS (
              SELECT 1 FROM conductor_periodo_empleo e WHERE e.conductor_id = c.id AND e.baja >= CURRENT_DATE - 120))
      ORDER BY 2`);
  return r.rows;
}

async function insertar(cli, x) {
  const r = await q(cli,
    `INSERT INTO sancion (conductor_id, regla, gravedad, articulo, falta, fecha_hechos, hechos, origen, origen_id, detalle, estado,
                          abierta_por, abierta_at, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10::jsonb, $11, $12, CASE WHEN $12::int IS NULL THEN NULL ELSE now() END, $13)
     RETURNING id::text AS id`,
    [x.conductorId, x.regla || null, x.gravedad, x.articulo || null, x.falta, x.fechaHechos, x.hechos || null,
     x.origen || 'manual', x.origenId || null, x.detalle ? JSON.stringify(x.detalle) : null, x.estado || 'abierta',
     x.abiertaPor || null, x.creadoPor || null]);
  return r.rows[0].id;
}

const CAMPOS = new Set(['estado', 'hechos', 'falta', 'regla', 'gravedad', 'articulo', 'fecha_hechos', 'detalle', 'medida', 'dias',
  'decision_nota', 'aprobada_at', 'aprobada_por', 'comunicar_antes', 'suspension_desde', 'suspension_hasta', 'firma_envio_id',
  'situacion_id', 'comunicada_at', 'nota', 'cerrada_at', 'cerrada_por', 'abierta_por', 'abierta_at']);
/** Cambia lo que se diga (`now` = ahora). */
async function cambiar(cli, id, cambios) {
  const claves = Object.keys(cambios).filter(k => CAMPOS.has(k));
  if (!claves.length) return;
  const valores = [];
  const sets = claves.map(k => {
    if (cambios[k] === 'now') return `${k} = now()`;
    valores.push(k === 'detalle' && cambios[k] != null ? JSON.stringify(cambios[k]) : cambios[k]);
    return `${k} = $${valores.length + 1}${k === 'detalle' ? '::jsonb' : ''}`;
  });
  await q(cli, `UPDATE sancion SET ${sets.join(', ')} WHERE id = $1`, [id, ...valores]);
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;
const fecha = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;
const dia = c => `to_char(${c}, 'YYYY-MM-DD')`;
const SELECT = `
  SELECT s.id::text AS id, s.conductor_id::text AS conductor_id, s.regla, s.gravedad, s.articulo, s.falta,
         ${dia('s.fecha_hechos')} AS fecha_hechos, s.hechos, s.origen, s.origen_id, s.detalle, s.estado,
         s.medida, s.dias, s.decision_nota, ${dia('s.comunicar_antes')} AS comunicar_antes,
         ${dia('s.suspension_desde')} AS suspension_desde, ${dia('s.suspension_hasta')} AS suspension_hasta,
         s.firma_envio_id::text AS firma_envio_id, s.situacion_id::text AS situacion_id, s.nota,
         f.estado AS firma_estado,
         ${fecha('s.creado_at')} AS creado, ${fecha('s.abierta_at')} AS abierta, ${fecha('s.aprobada_at')} AS aprobada,
         ${fecha('s.comunicada_at')} AS comunicada, ${fecha('s.cerrada_at')} AS cerrada,
         ${nombreDe('ucr')} AS creado_por_nombre, ${nombreDe('uab')} AS abierta_por_nombre,
         ${nombreDe('uap')} AS aprobada_por_nombre, ${nombreDe('uce')} AS cerrada_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo,
         (SELECT count(*)::int FROM adjunto a WHERE a.dueno_tipo = 'sancion' AND a.dueno_id = s.id::text AND a.anulado_at IS NULL) AS pruebas
    FROM sancion s
    JOIN conductor c ON c.id = s.conductor_id
    LEFT JOIN firma_envio f ON f.id = s.firma_envio_id
    LEFT JOIN usuario ucr ON ucr.id = s.creado_por
    LEFT JOIN usuario uab ON uab.id = s.abierta_por
    LEFT JOIN usuario uap ON uap.id = s.aprobada_por
    LEFT JOIN usuario uce ON uce.id = s.cerrada_por`;

async function lista() {
  return (await db.consulta(`${SELECT} ORDER BY s.fecha_hechos DESC, s.id DESC`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE s.id = $1`, [id])).rows[0] || null;
}

async function porOrigen(cli, origenId) {
  return (await q(cli, `SELECT id::text AS id, estado, regla FROM sancion WHERE origen = 'propuesta' AND origen_id = $1`, [origenId])).rows[0] || null;
}

/** Las otras sanciones de la persona (su historial disciplinario). */
async function deConductor(conductorId, sinId = null) {
  return (await db.consulta(`${SELECT} WHERE s.conductor_id = $1 AND ($2::bigint IS NULL OR s.id <> $2::bigint)
    ORDER BY s.fecha_hechos DESC`, [conductorId, sinId])).rows;
}

async function cuantos() {
  const r = await db.consulta(`SELECT count(*) FILTER (WHERE estado = 'propuesta')::int AS propuestas,
    count(*) FILTER (WHERE estado = 'abierta')::int AS por_aprobar, count(*) FILTER (WHERE estado = 'aprobada')::int AS por_comunicar
    FROM sancion`);
  return r.rows[0];
}

// ── Lo que mira el ERP para proponer ────────────────────────────────────────
/**
 * Las ausencias que RR. HH. dio por INJUSTIFICADAS (db/289), por persona y mes
 * natural, desde `desde`. → [{ conductor_id, mes: 'AAAA-MM', dias: ['AAAA-MM-DD'…] }]
 */
async function injustificadasPorMes(desde) {
  const r = await db.consulta(
    `SELECT a.conductor_id::text AS conductor_id, to_char(a.dia, 'YYYY-MM') AS mes,
            array_agg(to_char(a.dia, 'YYYY-MM-DD') ORDER BY a.dia) AS dias
       FROM ausencia_rrhh a
      WHERE a.estado = 'injustificada' AND a.dia >= $1::date
      GROUP BY 1, 2`, [desde]);
  return r.rows;
}

/** Las sanciones COMUNICADAS de cada persona, con su gravedad y la fecha de los hechos (para la reincidencia). */
async function comunicadas() {
  const r = await db.consulta(
    `SELECT id::text AS id, conductor_id::text AS conductor_id, gravedad, ${dia('fecha_hechos')} AS fecha_hechos, regla
       FROM sancion WHERE estado = 'comunicada' ORDER BY conductor_id, fecha_hechos`);
  return r.rows;
}

module.exports = { hayTabla, reglas, personas, insertar, cambiar, lista, porId, porOrigen, deConductor, cuantos, injustificadasPorMes, comunicadas };
