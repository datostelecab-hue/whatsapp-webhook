// ============================================================
// LAS ALTAS NUEVAS ANTE LA GESTORÍA — el SQL (módulo 8, db/304)
// ============================================================
'use strict';

const db = require('../../services/db');
const pruebas = require('../../services/repo/fichaDePruebas');

const q = (cli, sql, p) => (cli ? cli.query(sql, p) : db.consulta(sql, p));

async function hayTabla(cli = null) {
  return (await q(cli, `SELECT to_regclass('public.alta_gestoria') IS NOT NULL AS hay`)).rows[0].hay;
}
async function hayTablaDe(cli, t) {
  return (await q(cli, `SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${t}`])).rows[0].hay;
}

const nombre = a => `btrim(COALESCE(${a}.apellidos || ', ', '') || ${a}.nombre)`;
const fecha = c => `to_char(${c}, 'YYYY-MM-DD')`;
const hora = c => `to_char(${c} AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')`;

/**
 * Los contratos de plantilla propia desde `desde` que aún no tienen su fila:
 * se crean como pendientes. → las filas nuevas ({ id, conductor_id, fecha_alta }).
 */
async function sincronizar(cli, desde) {
  const r = await q(cli,
    `INSERT INTO alta_gestoria (periodo_id, conductor_id, fecha_alta)
     SELECT p.id, p.conductor_id, p.alta
       FROM conductor_periodo_empleo p
       JOIN conductor c ON c.id = p.conductor_id AND NOT c.es_centinela${await pruebas.fuera('c')}
      WHERE p.tipo = 'propia' AND p.alta >= $1::date
        AND NOT EXISTS (SELECT 1 FROM alta_gestoria a WHERE a.periodo_id = p.id)
     ON CONFLICT (periodo_id) DO NOTHING
     RETURNING id::text AS id, conductor_id::text AS conductor_id, ${fecha('fecha_alta')} AS fecha_alta`, [desde]);
  // La fecha del alta sigue a la del contrato (si se corrige en Plantilla).
  await q(cli,
    `UPDATE alta_gestoria a SET fecha_alta = p.alta, actualizado_at = now()
       FROM conductor_periodo_empleo p
      WHERE p.id = a.periodo_id AND p.alta <> a.fecha_alta`);
  return r.rows;
}

const FILA = `
  SELECT a.id::text AS id, a.conductor_id::text AS conductor_id, ${nombre('c')} AS nombre, c.legajo, c.dni_nie AS dni,
         a.estado, ${fecha('a.fecha_alta')} AS fecha_alta, ${fecha('p.baja')} AS baja,
         (p.baja IS NULL) AS de_alta, a.periodo_id::text AS periodo_id,
         ${hora('a.solicitada_at')} AS solicitada, us.nombre AS solicitada_por_nombre,
         ${hora('a.confirmada_at')} AS confirmada, uc.nombre AS confirmada_por_nombre,
         ${hora('a.anulada_at')} AS anulada, ua.nombre AS anulada_por_nombre, a.nota,
         ${fecha('a.primer_dia')} AS primer_dia, a.primer_turno,
         ${hora('a.no_presentado_at')} AS no_presentado, (a.no_presentado_at IS NOT NULL) AS no_presentado_hay,
         ${hora('a.escalada_at')} AS escalada, ${hora('a.presentado_at')} AS presentado, (a.presentado_at IS NOT NULL) AS presentado_hay,
         ${hora('a.creado_at')} AS creado,
         f.id::text AS firma_id, f.estado AS firma_estado
    FROM alta_gestoria a
    JOIN conductor c ON c.id = a.conductor_id
    JOIN conductor_periodo_empleo p ON p.id = a.periodo_id
    LEFT JOIN usuario us ON us.id = a.solicitada_por
    LEFT JOIN usuario uc ON uc.id = a.confirmada_por
    LEFT JOIN usuario ua ON ua.id = a.anulada_por
    LEFT JOIN LATERAL (SELECT x.id, x.estado FROM firma_envio x
                        WHERE x.origen = 'alta' AND x.origen_id = a.id::text AND x.estado <> 'descartado'
                        ORDER BY x.id DESC LIMIT 1) f ON true`;

/** Las de los últimos `dias` (por su fecha de alta) y todas las que siguen abiertas. */
async function lista(dias = 120) {
  return (await db.consulta(
    `${FILA} WHERE a.fecha_alta >= CURRENT_DATE - $1::int OR a.estado IN ('pendiente', 'solicitada')
              OR (a.no_presentado_at IS NOT NULL AND a.estado <> 'anulada' AND a.presentado_at IS NULL)
      ORDER BY a.fecha_alta DESC, a.id DESC`, [dias])).rows;
}

async function porId(cli, id) {
  return (await q(cli, `${FILA} WHERE a.id = $1`, [id])).rows[0] || null;
}

/** Las que hay que vigilar: sin confirmar o sin presentarse, de contratos vivos o recién cerrados. */
async function vigilar(cli) {
  return (await q(cli,
    `${FILA} WHERE a.estado <> 'anulada' AND (a.estado <> 'confirmada' OR a.presentado_at IS NULL)
              AND a.fecha_alta >= CURRENT_DATE - 60
      ORDER BY a.fecha_alta, a.id`)).rows;
}

async function cambiar(cli, id, cambios) {
  const vals = [id];
  const sets = Object.entries(cambios).map(([k, v]) => {
    if (!/^[a-z_]+$/.test(k)) throw new Error(`Columna no válida: ${k}`);
    if (v === 'now') return `${k} = now()`;
    vals.push(v);
    return `${k} = $${vals.length}`;
  });
  if (!sets.length) return false;
  const r = await q(cli, `UPDATE alta_gestoria SET ${sets.join(', ')}, actualizado_at = now() WHERE id = $1`, vals);
  return r.rowCount > 0;
}

/** Su primer día con turno desde el alta (f_cobertura, como el planificador) y de qué turno. */
async function primerTurno(cli, conductorId, desde, dias = 45) {
  const r = await q(cli,
    `SELECT ${fecha('f.dia')} AS dia, t.codigo AS turno
       FROM f_cobertura($2::date, $2::date + $3::int) f
       LEFT JOIN turno t ON t.id = f.turno_id
      WHERE f.conductor_id = $1
      ORDER BY f.dia, t.codigo LIMIT 1`, [conductorId, desde, dias]);
  return r.rows[0] || null;
}

/**
 * ¿Se ha presentado desde ese instante? Vinculó un coche (el libro de turnos del
 * bot y del portal) o BOLT le vio conectado con cualquiera de sus cuentas.
 */
async function sePresento(cli, conductorId, desdeMs) {
  const desde = new Date(desdeMs).toISOString();
  const ficho = await q(cli,
    `SELECT 1 FROM fichaje_turno WHERE conductor_id = $1 AND COALESCE(fin, GREATEST(inicio, now())) >= $2::timestamptz LIMIT 1`, [conductorId, desde])
    .then(r => r.rows.length > 0).catch(() => false);
  if (ficho) return 'coche';
  if (!await hayTablaDe(cli, 'fv_tramo')) return null;
  const bolt = await q(cli,
    `SELECT 1 FROM fv_tramo t
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
       JOIN conductor_externo e ON e.sistema = 'bolt' AND e.externo_id = t.conductor_uuid
      WHERE e.conductor_id = $1 AND COALESCE(t.hasta, now()) >= $2::timestamptz LIMIT 1`, [conductorId, desde])
    .then(r => r.rows.length > 0).catch(() => false);
  return bolt ? 'bolt' : null;
}

/** El contrato abierto de plantilla propia desde `desde` cuya alta no está confirmada (o null). */
async function sinConfirmarDe(conductorId, desde) {
  const r = await db.consulta(
    `SELECT ${fecha('p.alta')} AS fecha_alta, COALESCE(a.estado, 'pendiente') AS estado
       FROM conductor_periodo_empleo p
       JOIN conductor c ON c.id = p.conductor_id${await pruebas.fuera('c')}
       LEFT JOIN alta_gestoria a ON a.periodo_id = p.id
      WHERE p.conductor_id = $1 AND p.baja IS NULL AND p.tipo = 'propia' AND p.alta >= $2::date
        AND COALESCE(a.estado, 'pendiente') <> 'confirmada'
      LIMIT 1`, [conductorId, desde]);
  return r.rows[0] || null;
}

/** Los ids de quien tiene un contrato abierto sin el alta confirmada (para el planificador). */
async function idsSinConfirmar(desde) {
  const r = await db.consulta(
    `SELECT p.conductor_id::text AS id, COALESCE(a.estado, 'pendiente') AS estado
       FROM conductor_periodo_empleo p
       JOIN conductor c ON c.id = p.conductor_id${await pruebas.fuera('c')}
       LEFT JOIN alta_gestoria a ON a.periodo_id = p.id
      WHERE p.baja IS NULL AND p.tipo = 'propia' AND p.alta >= $1::date
        AND COALESCE(a.estado, 'pendiente') <> 'confirmada'`, [desde]);
  return new Map(r.rows.map(x => [x.id, x.estado]));
}

/** Quien tiene una llave (activo). */
async function conLlave(cli, clave) {
  const r = await q(cli,
    `SELECT p.usuario_id AS id FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
      WHERE p.clave = $1 AND u.estado = 'activo'`, [clave]);
  return r.rows.map(x => Number(x.id));
}

module.exports = { hayTabla, sincronizar, lista, porId, vigilar, cambiar, primerTurno, sePresento, sinConfirmarDe, idsSinConfirmar, conLlave };
