// ============================================================
// PORTAL DE CONDUCTORES — repositorio (db/211)
// ============================================================
// Las consultas del acceso (códigos y sesiones) y de quién es cada conductor.
// Lo que se le enseña (turnos y puntuación) viene de otros módulos, por el
// servicio.

const db = require('../../services/db');

// QUIÉN PUEDE ENTRAR: quien tiene un contrato abierto hoy o que empieza más
// adelante (el que entra el lunes ya quiere ver sus turnos). Quien tiene la
// baja puesta con fecha de hoy entra hasta que acabe el día.
const PUEDE_ENTRAR = `
  NOT c.es_centinela AND EXISTS (
    SELECT 1 FROM conductor_periodo_empleo e
     WHERE e.conductor_id = c.id
       AND (e.baja IS NULL OR e.baja >= (now() AT TIME ZONE 'Europe/Madrid')::date))`;

const COLUMNAS = `
  c.id::text AS id, btrim(c.nombre) AS nombre,
  btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')) AS nombre_completo,
  NULLIF(btrim(c.email), '') AS email,
  -- El teléfono vigente de su ficha (el principal): con él el portal hace lo del
  -- coche, como el bot, que reconoce al conductor por su teléfono (20/11/2026).
  (SELECT t.e164 FROM conductor_telefono t
    WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
    ORDER BY t.principal DESC, t.id LIMIT 1) AS telefono`;

/**
 * La persona de un DNI o NIE ya normalizado (sin espacios ni guiones, en
 * mayúsculas), si puede entrar. Si hay dos fichas con el mismo documento, la
 * más reciente.
 */
async function porDni(dni) {
  const r = await db.consulta(
    `SELECT ${COLUMNAS}
       FROM conductor c
      WHERE upper(regexp_replace(COALESCE(c.dni_nie, ''), '[^0-9A-Za-z]', '', 'g')) = $1
        AND ${PUEDE_ENTRAR}
      ORDER BY c.id DESC LIMIT 1`, [dni]);
  return r.rows[0] || null;
}

/** La persona de una sesión, si todavía puede entrar. */
async function porId(id) {
  const r = await db.consulta(`SELECT ${COLUMNAS} FROM conductor c WHERE c.id = $1 AND ${PUEDE_ENTRAR}`, [id]);
  return r.rows[0] || null;
}

/**
 * Su contrato de hoy (o, si aún no ha empezado, el que viene): de qué tipo es
 * (propia o ett) y de cuántas horas. Decide si ve la barra de facturación.
 */
async function contrato(conductorId) {
  const r = await db.consulta(
    `SELECT e.tipo, e.jornada_horas
       FROM conductor_periodo_empleo e
      WHERE e.conductor_id = $1
        AND (e.baja IS NULL OR e.baja >= (now() AT TIME ZONE 'Europe/Madrid')::date)
      ORDER BY (e.alta <= (now() AT TIME ZONE 'Europe/Madrid')::date) DESC, e.alta DESC
      LIMIT 1`, [conductorId]);
  return r.rows[0] ? { tipo: r.rows[0].tipo, jornada: r.rows[0].jornada_horas } : null;
}

// ── Códigos ─────────────────────────────────────────────────────────────────

/** Cuántos códigos se han pedido para esta persona, o desde esta IP, en los últimos `minutos`. */
async function codigosRecientes({ conductorId, ip, minutos }) {
  const r = await db.consulta(
    `SELECT count(*) FILTER (WHERE conductor_id = $1)::int AS persona,
            count(*) FILTER (WHERE ip = $2)::int AS ip
       FROM portal_codigo
      WHERE creado_at > now() - make_interval(mins => $3)
        AND (conductor_id = $1 OR ip = $2)`, [conductorId, ip || '', minutos]);
  return r.rows[0];
}

/** Guarda un código nuevo y anula los que esa persona tuviera vivos. Devuelve su id. */
async function nuevoCodigo({ conductorId, huella, email, minutos, ip }) {
  return db.transaccion(async cli => {
    await cli.query(
      `UPDATE portal_codigo SET anulado_at = now()
        WHERE conductor_id = $1 AND usado_at IS NULL AND anulado_at IS NULL`, [conductorId]);
    const r = await cli.query(
      `INSERT INTO portal_codigo (conductor_id, huella, email, caduca_at, ip)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5) RETURNING id::text`,
      [conductorId, huella, email, minutos, ip || null]);
    return r.rows[0].id;
  });
}

async function marcarEnviado(id) {
  await db.consulta(`UPDATE portal_codigo SET enviado = TRUE WHERE id = $1`, [id]);
}

/** El código vivo de una persona: sin usar, sin anular y sin caducar. */
async function codigoVivo(conductorId) {
  const r = await db.consulta(
    `SELECT id::text, huella, intentos FROM portal_codigo
      WHERE conductor_id = $1 AND usado_at IS NULL AND anulado_at IS NULL AND caduca_at > now()
      ORDER BY creado_at DESC LIMIT 1`, [conductorId]);
  return r.rows[0] || null;
}

/**
 * Un intento sobre ese código. Si acierta, lo da por usado; si falla y llega a
 * `maxIntentos`, lo anula. Todo en una sentencia, para que dos intentos a la
 * vez no se salten la cuenta. Devuelve { usado, intentos, anulado }.
 */
async function intentar(id, acierta, maxIntentos) {
  const r = await db.consulta(
    `UPDATE portal_codigo
        SET intentos = intentos + 1,
            usado_at = CASE WHEN $2 THEN now() ELSE usado_at END,
            anulado_at = CASE WHEN NOT $2 AND intentos + 1 >= $3 THEN now() ELSE anulado_at END
      WHERE id = $1 AND usado_at IS NULL AND anulado_at IS NULL AND caduca_at > now()
      RETURNING intentos, usado_at IS NOT NULL AS usado, anulado_at IS NOT NULL AS anulado`,
    [id, !!acierta, maxIntentos]);
  return r.rows[0] || null;
}

// ── Sesiones ────────────────────────────────────────────────────────────────

async function nuevaSesion({ conductorId, huella, dias, ip, agente }) {
  await db.consulta(
    `INSERT INTO portal_sesion (conductor_id, huella, caduca_at, ip, agente)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)`,
    [conductorId, huella, dias, ip || null, agente ? String(agente).slice(0, 300) : null]);
}

/** La sesión viva de esa huella, con su conductor (si todavía puede entrar). */
async function sesion(huella) {
  const r = await db.consulta(
    `SELECT s.id::text AS sesion_id, s.ultima_at < now() - interval '1 day' AS renovar, ${COLUMNAS}
       FROM portal_sesion s
       JOIN conductor c ON c.id = s.conductor_id
      WHERE s.huella = $1 AND s.cerrada_at IS NULL AND s.caduca_at > now()
        AND ${PUEDE_ENTRAR}`, [huella]);
  return r.rows[0] || null;
}

/** Alarga la sesión: 30 días desde el último uso (una vez al día como mucho). */
async function renovar(sesionId, dias) {
  await db.consulta(
    `UPDATE portal_sesion SET ultima_at = now(), caduca_at = now() + make_interval(days => $2)
      WHERE id = $1 AND cerrada_at IS NULL`, [sesionId, dias]);
}

async function cerrar(huella) {
  await db.consulta(`UPDATE portal_sesion SET cerrada_at = now() WHERE huella = $1 AND cerrada_at IS NULL`, [huella]);
}

/**
 * LAS FOTOS DE UN COCHE (24/11/2026), para su ficha en el ERP: las de cada vez
 * que alguien lo desvinculó desde el portal, desde `desdeDia` (fecha de
 * Madrid). El turno es del coche por su equipo de la base o por su matrícula.
 * Una fila por foto, de la más nueva a la más vieja.
 */
async function fotosDeVehiculo(vehiculoId, desdeDia) {
  const r = await db.consulta(
    `SELECT a.id::text AS adjunto, a.nombre AS fichero, f.id::text AS turno, f.tipo,
            COALESCE(NULLIF(btrim(f.nombre), ''), 'Sin nombre') AS quien,
            to_char(a.creado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia,
            to_char(f.inicio AT TIME ZONE 'Europe/Madrid', 'DD/MM HH24:MI') AS desde,
            to_char(COALESCE(f.fin, a.creado_at) AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hasta
       FROM adjunto a
       JOIN fichaje_turno f ON f.id::text = a.dueno_id
       JOIN vehiculo v ON v.id = $1
      WHERE a.dueno_tipo = 'turno_fotos' AND a.anulado_at IS NULL
        AND (f.vehiculo_id = v.id OR f.matricula = v.matricula_norm)
        AND (a.creado_at AT TIME ZONE 'Europe/Madrid')::date >= $2::date
      ORDER BY a.creado_at DESC, f.id DESC, a.nombre`, [Number(vehiculoId), desdeDia]);
  return r.rows;
}

/** Sus cuentas de BOLT (el uuid de cada una): lo que le une a los tramos de BOLT. */
async function cuentasBolt(conductorId) {
  const r = await db.consulta(
    `SELECT externo_id FROM conductor_externo WHERE sistema = 'bolt' AND conductor_id = $1::bigint`, [conductorId]);
  return r.rows.map(x => String(x.externo_id));
}

/**
 * LOS TRAMOS DE BOLT DEL CRONÓMETRO (24/11/2026): los que tocan [desde, hasta)
 * y son suyos (de sus cuentas, con cualquier coche) o de su coche vinculado
 * (con quien sea en BOLT). Cada uno con la parte que cae dentro y su odómetro.
 * De Flota Viva (fv_tramo). El final de cada tramo, con la regla de la casa
 * (rutas.FIN_KM): un tramo abierto que nadie cierra (el motor atascado, el
 * coche que se va) no cuenta horas ni km sin fin.
 */
async function tramosDelCronometro({ uuids, matricula, desdeMs, hastaMs }) {
  const fv = require('../../services/flotaViva/db');
  const { FIN_KM } = require('../../services/flotaViva/rutas');
  if (!fv.HAY_BD) return [];
  await fv.preparar();
  const r = await fv.consulta(
    `SELECT t.situacion, s.efectivo,
            (t.conductor_uuid = ANY($3::text[])) AS suyo,
            (upper(regexp_replace(COALESCE(v.matricula, ''), '[^0-9A-Za-z]', '', 'g')) = $4) AS del_coche,
            extract(epoch FROM t.desde) * 1000 AS desde_ms,
            extract(epoch FROM ${FIN_KM}) * 1000 AS hasta_ms,
            t.odometro_ini_m, t.odometro_fin_m
       FROM fv_tramo t
       JOIN fv_vehiculo v ON v.uuid = t.vehiculo_uuid
       JOIN fv_cat_situacion s ON s.codigo = t.situacion
      WHERE t.desde < $2::timestamptz
        AND (t.hasta IS NULL OR t.hasta > $1::timestamptz)
        AND t.desde >= $1::timestamptz - interval '2 days'
        AND (t.conductor_uuid = ANY($3::text[])
             OR upper(regexp_replace(COALESCE(v.matricula, ''), '[^0-9A-Za-z]', '', 'g')) = $4)`,
    [new Date(desdeMs).toISOString(), new Date(hastaMs).toISOString(), uuids, String(matricula || '')]);
  return r.rows.map(x => ({
    situacion: x.situacion, efectivo: !!x.efectivo, suyo: !!x.suyo, delCoche: !!x.del_coche,
    desdeMs: Number(x.desde_ms), hastaMs: Number(x.hasta_ms),
    odoIni: x.odometro_ini_m == null ? null : Number(x.odometro_ini_m),
    odoFin: x.odometro_fin_m == null ? null : Number(x.odometro_fin_m),
  }));
}

module.exports = {
  porDni, porId, contrato, codigosRecientes, nuevoCodigo, marcarEnviado, codigoVivo, intentar,
  nuevaSesion, sesion, renovar, cerrar, fotosDeVehiculo, cuentasBolt, tramosDelCronometro,
};
