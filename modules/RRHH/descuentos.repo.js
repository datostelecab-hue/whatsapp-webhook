// ============================================================
// LOS DESCUENTOS EN NÓMINA — el SQL (módulo 4.2, db/298)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla() {
  const r = await db.consulta(`SELECT to_regclass('public.descuento_nomina') IS NOT NULL AS hay`);
  return r.rows[0].hay;
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
    `INSERT INTO descuento_nomina (conductor_id, origen, origen_id, concepto, importe, saldo, periodo, fecha, motivo, evidencia, estado,
                                  visto_legal, aprobado_at, aprobado_por, creado_por)
     VALUES ($1, $2, $3, $4, $5::numeric, $5::numeric, $6, $7::date, $8, $9::jsonb, $10::varchar, $11,
             CASE WHEN $10::varchar = 'aprobado' THEN now() END, CASE WHEN $10::varchar = 'aprobado' THEN $12::int END, $12::int)
     RETURNING id::text AS id`,
    [x.conductorId, x.origen, x.origenId || null, x.concepto, x.importe, x.periodo, x.fecha, x.motivo,
     x.evidencia ? JSON.stringify(x.evidencia) : null, x.estado || 'pendiente', x.vistoLegal || null, x.creadoPor || null]);
  return r.rows[0].id;
}

async function deOrigen(cli, origen, origenId) {
  const r = await q(cli, `SELECT id::text AS id, estado FROM descuento_nomina
    WHERE origen = $1 AND origen_id = $2 AND estado <> 'anulado' LIMIT 1`, [origen, String(origenId)]);
  return r.rows[0] || null;
}

const CAMPOS = new Set(['estado', 'importe', 'saldo', 'a_descontar', 'periodo', 'motivo', 'visto_legal', 'nota', 'concepto',
  'aprobado_at', 'aprobado_por', 'cerrado_at', 'cerrado_por']);
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
  await q(cli, `UPDATE descuento_nomina SET ${sets.join(', ')} WHERE id = $1`, [id, ...valores]);
}

async function aplicacion(cli, { descuentoId, periodo, importe, movimientoId = null, usuarioId = null }) {
  await q(cli, `INSERT INTO descuento_aplicacion (descuento_id, periodo, importe, movimiento_id, usuario_id) VALUES ($1, $2, $3, $4, $5)`,
    [descuentoId, periodo, importe, movimientoId, usuarioId]);
}

const nombreDe = a => `NULLIF(btrim(COALESCE(${a}.nombre, '') || ' ' || COALESCE(NULLIF(${a}.apellidos, '.'), '')), '')`;
const fecha = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;
const SELECT = `
  SELECT d.id::text AS id, d.conductor_id::text AS conductor_id, d.origen, d.origen_id, d.concepto,
         d.importe::float AS importe, d.saldo::float AS saldo, d.a_descontar::float AS a_descontar, d.periodo,
         to_char(d.fecha, 'YYYY-MM-DD') AS fecha, d.motivo, d.evidencia, d.estado, d.visto_legal, d.nota,
         ${fecha('d.creado_at')} AS creado, ${fecha('d.aprobado_at')} AS aprobado, ${fecha('d.cerrado_at')} AS cerrado,
         ${nombreDe('ucr')} AS creado_por_nombre, ${nombreDe('uap')} AS aprobado_por_nombre, ${nombreDe('uce')} AS cerrado_por_nombre,
         btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS nombre, c.legajo, c.empleo_vigente AS de_alta,
         COALESCE((SELECT sum(a.importe) FROM descuento_aplicacion a WHERE a.descuento_id = d.id), 0)::float AS descontado,
         (SELECT count(*)::int FROM adjunto x WHERE x.dueno_tipo = 'descuento' AND x.dueno_id = d.id::text AND x.anulado_at IS NULL) AS pruebas
    FROM descuento_nomina d
    JOIN conductor c ON c.id = d.conductor_id
    LEFT JOIN usuario ucr ON ucr.id = d.creado_por
    LEFT JOIN usuario uap ON uap.id = d.aprobado_por
    LEFT JOIN usuario uce ON uce.id = d.cerrado_por`;

/** Los de los últimos meses (y todo lo que siga abierto). */
async function lista() {
  return (await db.consulta(`${SELECT}
    WHERE d.estado IN ('pendiente', 'aprobado', 'aplazado') OR d.creado_at > now() - interval '120 days'
    ORDER BY d.periodo DESC, d.creado_at DESC`)).rows;
}

async function porId(id, cli = null) {
  return (await q(cli, `${SELECT} WHERE d.id = $1`, [id])).rows[0] || null;
}

/** Los que se descuentan en un mes (aprobados o aplazados a él). */
async function delPeriodo(cli, periodo) {
  return (await q(cli, `${SELECT} WHERE d.periodo = $1 AND d.estado IN ('aprobado', 'aplazado') ORDER BY nombre, d.id`, [periodo])).rows;
}

async function aplicaciones(id) {
  return (await db.consulta(
    `SELECT a.periodo, a.importe::float AS importe, a.movimiento_id::text AS movimiento_id, ${fecha('a.creado_at')} AS cuando, ${nombreDe('u')} AS por
       FROM descuento_aplicacion a LEFT JOIN usuario u ON u.id = a.usuario_id WHERE a.descuento_id = $1 ORDER BY a.id`, [id])).rows;
}

async function cuantos() {
  const r = await db.consulta(`SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes FROM descuento_nomina`);
  return r.rows[0];
}

module.exports = { hayTabla, personas, insertar, deOrigen, cambiar, aplicacion, lista, porId, delPeriodo, aplicaciones, cuantos };
