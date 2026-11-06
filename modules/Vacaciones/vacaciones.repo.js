// ============================================================
// VACACIONES — repositorio: lo que el saldo necesita leer de la base
// ============================================================
// No calcula nada: trae las piezas (contratos, ausencias, festivos y las horas
// de cada festivo) y el servicio hace la cuenta. Las fechas salen ya como
// 'AAAA-MM-DD' con to_char: un DATE leído como Date en Madrid da el día anterior.

const db = require('../../services/db');

// 'asuntos_propios' (db/225): su banco va aparte del saldo de vacaciones.
// 'baja_medica' (06/11/2026): sus días generan vacaciones, como uno trabajado
// (si no se sabe qué libraría, 5/7 de día: vacaciones.service BAJA_SIN_PLAZA).
const ESTADOS = ['vacaciones', 'permiso', 'asuntos_propios', 'suspendido', 'suspension_permiso', 'baja_medica'];

/**
 * Quien tiene el contrato abierto (o una persona, con `id`). Solo plantilla
 * PROPIA (16/10/2026, Camilo: «quita a la gente de la ETT, a ellos no les damos
 * vacaciones»); con `conEtt`, también los de ETT, para poder decirle a quien
 * abre la ficha de uno por qué no tiene saldo.
 *
 * Con `conBajas` (21/10/2026), también quien ya se fue: Camilo, «quiero ver las
 * vacaciones generadas de la gente que fue dada de baja también». De cada
 * persona, su ÚLTIMO contrato (el abierto, si lo hay), con su baja; los que se
 * fueron, solo si su baja es de `desde` en adelante (el histórico empieza ahí).
 */
async function personas({ id = null, conEtt = false, conBajas = false, desde = '2026-01-01' } = {}) {
  const r = await db.consulta(
    `SELECT * FROM (
       SELECT DISTINCT ON (c.id) c.id::text AS id,
              btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre,
              c.dni_nie,
              to_char(e.alta, 'YYYY-MM-DD') AS alta,
              to_char(e.baja, 'YYYY-MM-DD') AS baja, e.motivo_baja,
              e.tipo, e.ett_nombre
         FROM conductor_periodo_empleo e
         JOIN conductor c ON c.id = e.conductor_id
        WHERE NOT c.es_centinela
          AND ($1::bigint IS NULL OR c.id = $1::bigint)
        ORDER BY c.id, (e.baja IS NULL) DESC, e.alta DESC) x
      WHERE ($2::boolean OR x.tipo = 'propia')
        AND (x.baja IS NULL OR ($3::boolean AND x.baja::date >= $4::date))
      ORDER BY lower(x.nombre)`, [id, !!conEtt, !!conBajas, desde]);
  return r.rows;
}

/**
 * Vacaciones, permisos y suspensiones de esas personas que tocan el periodo.
 * Con quién lo puso y qué día: si el tramo no trae motivo, eso es lo único que
 * dice de dónde sale.
 */
// LOS DOS DÍAS QUE LIBRA EN UNAS VACACIONES (db/233). Hasta que la migración
// esté aplicada la columna no existe: se lee sin ella y las vacaciones cuentan
// con el planificador, como antes, en vez de tirar la pantalla. Se vuelve a
// probar CADA vez: si se recordara el fallo, tras aplicar la migración seguiría
// leyendo sin la columna hasta reiniciar el servidor.
let avisadoSinLibra = false;
async function conLibra(sql, args) {
  try { return await db.consulta(sql(true), args); } catch (e) {
    if (!(e && e.code === '42703' && /libra_dias/.test(e.message || ''))) throw e;
    if (!avisadoSinLibra) {
      avisadoSinLibra = true;
      console.warn('⚠️ [Vacaciones] Falta la migración db/233: las vacaciones cuentan con las libranzas del planificador.');
    }
  }
  return db.consulta(sql(false), args);
}
const colLibra = con => (con ? 'h.libra_dias,' : 'NULL::smallint[] AS libra_dias,');

async function tramos(ids, desde) {
  if (!ids.length) return [];
  const r = await conLibra(con =>
    `SELECT h.id::text AS fila, h.conductor_id::text AS id, h.estado, ${colLibra(con)}
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta,
            h.motivo, h.leave_type_code, lt.name AS tipo_permiso,
            NULLIF(TRIM(CONCAT_WS(' ', u.nombre, u.apellidos)), '') AS quien,
            to_char(h.creado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS puesto,
            h.ticket_id::text AS ticket_id, t.codigo AS ticket_codigo
       FROM conductor_estado_hist h
       LEFT JOIN leave_type lt ON lt.leave_type_code = h.leave_type_code
       LEFT JOIN usuario u ON u.id = h.usuario_id
       LEFT JOIN ticket t ON t.id = h.ticket_id
      WHERE h.conductor_id = ANY($1::bigint[])
        AND h.estado = ANY($2::text[])
        AND (h.hasta IS NULL OR h.hasta >= $3::date)
      ORDER BY h.conductor_id, h.desde`, [ids, ESTADOS, desde]);
  return r.rows;
}

/** UN tramo de una persona, con su ticket. Null si no existe o no es suyo. */
async function tramo(conductorId, filaId) {
  const r = await conLibra(con =>
    `SELECT h.id::text AS fila, h.conductor_id::text AS id, h.estado, ${colLibra(con)}
            to_char(h.desde, 'YYYY-MM-DD') AS desde, to_char(h.hasta, 'YYYY-MM-DD') AS hasta,
            h.motivo, h.ticket_id::text AS ticket_id, t.codigo AS ticket_codigo
       FROM conductor_estado_hist h
       LEFT JOIN ticket t ON t.id = h.ticket_id
      WHERE h.id = $1 AND h.conductor_id = $2`, [Number(filaId), Number(conductorId)]);
  return r.rows[0] || null;
}

/** El calendario entero, con si sus horas están calculadas. */
async function festivos() {
  const r = await db.consulta(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, nombre, ambito, norma,
            horas_at, horas_fuente
       FROM festivo ORDER BY fecha`);
  return r.rows;
}

/** Las horas de esas personas en los festivos. */
async function horasFestivos(ids) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT conductor_id::text AS id, to_char(fecha, 'YYYY-MM-DD') AS fecha, segundos
       FROM festivo_horas WHERE conductor_id = ANY($1::bigint[])`, [ids]);
  return r.rows;
}

/**
 * Los festivos cuyas horas hay que (re)calcular desde `fv_tramo`: los que ya
 * pasaron desde `desde`, sin calcular o calculados antes de que BOLT terminara
 * de mandar ese día (menos de `margen` días después del festivo).
 */
async function festivosPorSellar(desde, hoy, margen) {
  const r = await db.consulta(
    `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha FROM festivo
      WHERE fecha >= $1::date AND fecha < $2::date
        AND (horas_at IS NULL
             OR horas_at < ((fecha + $3::int)::timestamp AT TIME ZONE 'Europe/Madrid'))
      ORDER BY fecha`, [desde, hoy, margen]);
  return r.rows.map(x => x.fecha);
}

/** Guarda las horas de un festivo (Map conductor → segundos), de una vez. */
async function guardarHorasFestivo(fecha, horas, fuente) {
  const ids = [], segs = [];
  horas.forEach((s, cid) => { if (s > 0) { ids.push(Number(cid)); segs.push(Math.round(s)); } });
  return db.transaccion(async cli => {
    await cli.query('DELETE FROM festivo_horas WHERE fecha = $1::date', [fecha]);
    const r = await cli.query(
      `INSERT INTO festivo_horas (conductor_id, fecha, segundos)
       SELECT v.cid, $1::date, v.seg
         FROM unnest($2::bigint[], $3::int[]) AS v (cid, seg)
         JOIN conductor c ON c.id = v.cid`, [fecha, ids, segs]);
    await cli.query(
      `UPDATE festivo SET horas_at = now(), horas_fuente = $2 WHERE fecha = $1::date`, [fecha, fuente]);
    return r.rowCount;
  });
}

/**
 * LOS DÍAS DE CADA PERSONA CON SUS HORAS, para los días laborados (06/11/2026):
 * { filas: [{ id, dia, segundos }], sinHistorico }.
 *
 *   · Desde el 01/07/2026, los de la bitácora: `bitacora_horas` (de fv_tramo,
 *     viaje + espera; su día es la jornada 05→05 hasta el 05/10 y el turno de
 *     cada uno desde el 06/10). Lo de hoy y ayer entra cuando la bitácora lo
 *     sella.
 *   · Antes, `bolt_jornada_historico` (db/231): las jornadas de 05:00 a 05:00 de
 *     cada CUENTA de BOLT, del historial de estados. De quién es cada cuenta se
 *     decide aquí, día a día, como en la bitácora (bitacora.repo.horasPorJornada05):
 *     si ese día estaba prestada (cuenta_fantasma), de quien la llevaba; si no,
 *     de su dueño. Dos cuentas de una persona el mismo día se suman.
 *
 * Sin db/231, solo lo de la bitácora y `sinHistorico`: la pantalla lo dice.
 */
const NUCLEO = '2026-07-01';
async function diasLaborados(ids, desde) {
  if (!ids.length) return { filas: [], sinHistorico: false };
  const hay = (await db.consulta("SELECT to_regclass('bolt_jornada_historico') IS NOT NULL AS hay")).rows[0].hay;
  const nuevo = db.consulta(
    `SELECT conductor_id::text AS id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia, horas_seg AS segundos
       FROM bitacora_horas
      WHERE conductor_id = ANY($1::bigint[]) AND dia_operativo >= GREATEST($2::date, $3::date) AND horas_seg > 0`,
    [ids, desde, NUCLEO]);
  const viejo = hay ? db.consulta(
    `SELECT x.id, to_char(x.dia, 'YYYY-MM-DD') AS dia, sum(x.segundos)::int AS segundos
       FROM (SELECT COALESCE(f.conductor_id, ce.conductor_id)::text AS id, h.jornada AS dia, h.segundos
               FROM bolt_jornada_historico h
               JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = h.cuenta_uuid
               LEFT JOIN cuenta_fantasma f
                      ON f.cuenta_id = ce.id AND f.anulado_at IS NULL
                     AND h.jornada >= f.desde AND (f.hasta IS NULL OR h.jornada <= f.hasta)
              WHERE h.jornada >= $2::date AND h.jornada < $3::date) x
      WHERE x.id::bigint = ANY($1::bigint[])
      GROUP BY x.id, x.dia`, [ids, desde, NUCLEO]) : Promise.resolve({ rows: [] });
  const [n, v] = await Promise.all([nuevo, viejo]);
  return { filas: [...v.rows, ...n.rows], sinHistorico: !hay };
}

/**
 * LOS DÍAS JUSTIFICADOS (06/11/2026): las J APROBADAS de cada persona, una por
 * jornada (las pendientes son presuntas y las rechazadas no valen, como en la
 * bitácora). Generan vacaciones como un día trabajado. [{ id, dia }].
 */
async function justificados(ids, desde) {
  if (!ids.length) return [];
  const r = await db.consulta(
    `SELECT DISTINCT conductor_id::text AS id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia
       FROM justificante
      WHERE conductor_id = ANY($1::bigint[]) AND dia_operativo >= $2::date
        AND aprobado_at IS NOT NULL AND anulado_at IS NULL`, [ids, desde]);
  return r.rows;
}

/**
 * LO PLANIFICADO DE CADA PERSONA, para saber qué días libra (06/11/2026, ver
 * libranzas.js): sus plazas (con el coche, el rol, el turno y, si es
 * correturnos, sus días), el descanso de esos coches y sus libranzas
 * excepcionales. Y el primer día del planificador en la base: antes no hay
 * libranzas que saltar.
 *
 * Map(id → { asignaciones, descansos: Map(vehiculo → [...]), libra: Set, trabaja: Set }) + { inicio }.
 */
async function planes(ids) {
  const vacio = () => ({ asignaciones: [], descansos: new Map(), libra: new Set(), trabaja: new Set() });
  const out = new Map(ids.map(i => [String(i), vacio()]));
  if (!ids.length) return { porId: out, inicio: null };
  const [as, inicio, ex] = await Promise.all([
    db.consulta(
      `SELECT a.conductor_id::text AS id, to_char(a.desde, 'YYYY-MM-DD') AS desde, to_char(a.hasta, 'YYYY-MM-DD') AS hasta,
              p.vehiculo_id::text AS vehiculo_id, s.rol, s.turno_id,
              COALESCE((SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana) FROM asignacion_dia ad WHERE ad.asignacion_id = a.id), '{}') AS dias
         FROM asignacion a
         JOIN plaza p    ON p.id = a.plaza_id AND p.baja_at IS NULL
         JOIN cat_slot s ON s.slot = p.slot
        WHERE a.conductor_id = ANY($1::bigint[]) AND a.retirada_at IS NULL AND (a.hasta IS NULL OR a.hasta >= a.desde)
        ORDER BY a.conductor_id, a.desde`, [ids]),
    db.consulta(`SELECT to_char(min(desde), 'YYYY-MM-DD') AS inicio FROM asignacion`),
    db.consulta(
      `SELECT conductor_id::text AS id, to_char(dia_trabaja, 'YYYY-MM-DD') AS trabaja, to_char(dia_libra, 'YYYY-MM-DD') AS libra
         FROM libranza_excepcional WHERE conductor_id = ANY($1::bigint[])`, [ids]),
  ]);
  const coches = [...new Set(as.rows.map(r => r.vehiculo_id))];
  const de = coches.length ? (await db.consulta(
    `SELECT vd.vehiculo_id::text AS vehiculo_id, vd.turno_id, to_char(vd.desde, 'YYYY-MM-DD') AS desde, to_char(vd.hasta, 'YYYY-MM-DD') AS hasta,
            COALESCE((SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) FROM vehiculo_descanso_dia vdd WHERE vdd.descanso_id = vd.id), '{}') AS dias
       FROM vehiculo_descanso vd WHERE vd.vehiculo_id = ANY($1::bigint[])`, [coches])).rows : [];
  const descansos = new Map();
  de.forEach(d => { if (!descansos.has(d.vehiculo_id)) descansos.set(d.vehiculo_id, []); descansos.get(d.vehiculo_id).push({ ...d, dias: d.dias.map(Number) }); });
  as.rows.forEach(a => {
    const p = out.get(a.id);
    p.asignaciones.push({ ...a, dias: a.dias.map(Number) });
    if (!p.descansos.has(a.vehiculo_id)) p.descansos.set(a.vehiculo_id, descansos.get(a.vehiculo_id) || []);
  });
  ex.rows.forEach(x => { const p = out.get(x.id); if (!p) return; if (x.libra) p.libra.add(x.libra); if (x.trabaja) p.trabaja.add(x.trabaja); });
  return { porId: out, inicio: inicio.rows[0].inicio };
}

module.exports = { ESTADOS, personas, tramos, tramo, festivos, horasFestivos, festivosPorSellar, guardarHorasFestivo, diasLaborados, justificados, planes };
