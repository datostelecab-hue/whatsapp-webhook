// ============================================================
// CONTRATOS Y OBJETIVOS — el SQL que pone el convenio en marcha
// ============================================================
// Las dos tablas que faltaban por llenar para que el módulo de convenio dejara
// de salir en blanco: `contrato` (bajo qué términos trabaja cada persona) y
// `objetivo_mensual` (cuántos minutos debe cada mes).
//
// Ni una regla de negocio aquí: qué contrato hay que abrir y de qué mes hay que
// publicar objetivos lo decide `convenio.motor`.

const db = require('../../services/db');

// El convenio VTC de Madrid es el único que hay cargado, y el grupo por defecto
// es el de conductores de aplicación (G3A), que es la inmensa mayoría de la
// plantilla. Se leen de la base en vez de escribirlos como constantes: el día
// que entre otro convenio, esto no miente.
const GRUPO_CONDUCTOR = 'G3A';

/** El convenio vigente hoy. Si hubiera más de uno, el que empezó más tarde. */
async function convenioVigente() {
  const r = await db.consulta(
    `SELECT agreement_id FROM collective_agreement
      WHERE valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
      ORDER BY valid_from DESC LIMIT 1`);
  return r.rows[0] ? r.rows[0].agreement_id : null;
}

/**
 * QUIÉN NECESITA UN CONTRATO Y NO LO TIENE.
 *
 * Los periodos de empleo ABIERTOS de plantilla propia sin un contrato que cubra
 * su fecha de alta. `jornada_horas` puede venir vacía —77 de 215 la tienen así—
 * y entonces la decide el motor, no esta consulta.
 */
async function sinContrato({ tipo = 'propia' } = {}) {
  const r = await db.consulta(
    `SELECT pe.id AS periodo_id, pe.conductor_id, pe.alta::text AS alta,
            pe.jornada_horas, c.nombre
       FROM conductor_periodo_empleo pe
       JOIN conductor c ON c.id = pe.conductor_id
      WHERE pe.baja IS NULL
        AND ($1::text IS NULL OR pe.tipo = $1)
        AND NOT EXISTS (
              SELECT 1 FROM contrato ct
               WHERE ct.conductor_id = pe.conductor_id AND ct.hasta IS NULL)
      ORDER BY pe.alta, c.nombre`,
    [tipo]);
  return r.rows;
}

/**
 * Abre un contrato. El solape lo impide la base (`ex_contrato_solape`), así que
 * si ya hubiera uno vivo esto revienta en vez de duplicar — que es lo que se
 * quiere.
 */
async function abrir({ conductorId, periodoId, agreementId, grupo, horasSemana, desde }) {
  const r = await db.consulta(
    `INSERT INTO contrato
       (conductor_id, periodo_empleo_id, agreement_id, grupo, horas_semana, desde)
     VALUES ($1, $2, $3, $4, $5, $6::date)
     RETURNING id`,
    [conductorId, periodoId || null, agreementId, grupo || GRUPO_CONDUCTOR, horasSemana, desde]);
  return r.rows[0].id;
}

/**
 * CIERRA los contratos de quien ya causó baja. El contrato termina el día de la
 * baja, no antes: ese día se trabajó.
 */
async function cerrarLosDeBaja() {
  const r = await db.consulta(
    `UPDATE contrato ct SET hasta = pe.baja
       FROM conductor_periodo_empleo pe
      WHERE pe.id = ct.periodo_empleo_id
        AND pe.baja IS NOT NULL
        AND ct.hasta IS NULL
      RETURNING ct.id`);
  return r.rowCount;
}

/** Los contratos vigentes en algún momento de un mes. */
async function vigentesEnMes(anio, mes) {
  const r = await db.consulta(
    `SELECT ct.id, ct.conductor_id, ct.horas_semana, ct.desde::text AS desde, ct.hasta::text AS hasta
       FROM contrato ct
      WHERE ct.desde <= (make_date($1, $2, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date
        AND (ct.hasta IS NULL OR ct.hasta >= make_date($1, $2, 1))
      ORDER BY ct.conductor_id`,
    [anio, mes]);
  return r.rows;
}

/**
 * PUBLICA LOS OBJETIVOS DE UN MES, todos de una vez.
 *
 * Lo hace la BASE (`f_generar_objetivos`), no este código: la fórmula del
 * convenio no puede vivir en dos sitios, y esa función ya existía desde el
 * Hito 3 sin que nadie la llamara nunca. Es idempotente y NO pisa lo que ya
 * haya —publicado, congelado o ajustado a mano—: rehacer uno es borrarlo antes,
 * a propósito.
 *
 * Devuelve cuántos ha creado; si ya estaban todos, cero.
 */
async function generarObjetivos(anio, mes) {
  const r = await db.consulta('SELECT f_generar_objetivos($1, $2) AS creados', [anio, mes]);
  return Number(r.rows[0].creados) || 0;
}

/** Los objetivos ya publicados de un mes, con su persona. Para poder mirarlos. */
async function objetivosDe(anio, mes) {
  const r = await db.consulta(
    `SELECT o.id, o.objetivo_min, o.dias_alta, o.base_horas_anuales,
            c.horas_semana, c.conductor_id, co.nombre,
            o.publicado_at, o.congelado_at
       FROM objetivo_mensual o
       JOIN contrato c  ON c.id = o.contrato_id
       JOIN conductor co ON co.id = c.conductor_id
      WHERE o.anio = $1 AND o.mes = $2
      ORDER BY co.nombre`,
    [anio, mes]);
  return r.rows;
}

// ── Lo que hace falta para saber si esto está vivo ─────────────────────────

/**
 * LA FOTO DEL MÓDULO: cuántos contratos, cuántos objetivos y hasta dónde llega
 * lo derivado. Es lo primero que hay que mirar cuando una pantalla sale vacía,
 * porque distingue "no hay datos" de "no se ha ejecutado".
 */
async function foto() {
  const una = async sql => (await db.consulta(sql)).rows[0];
  const [contratos, objetivos, asientos, registros, logs] = await Promise.all([
    una(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE hasta IS NULL)::int AS vigentes FROM contrato`),
    una(`SELECT count(*)::int AS total, min(anio * 100 + mes)::int AS primero,
                max(anio * 100 + mes)::int AS ultimo FROM objetivo_mensual`),
    una(`SELECT count(*)::int AS total, min(dia_operativo)::text AS desde,
                max(dia_operativo)::text AS hasta FROM asiento_jornada WHERE anulado_at IS NULL`),
    una(`SELECT count(*)::int AS total, min(dia)::text AS desde, max(dia)::text AS hasta,
                count(DISTINCT conductor_id)::int AS personas FROM registro_jornada`),
    una(`SELECT count(*)::int AS total,
                to_char(min(ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS desde,
                to_char(max(ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS hasta
           FROM bolt_state_log`),
  ]);
  return { contratos, objetivos, asientos, registros, logs };
}

/** Los días con logs de BOLT que todavía no tienen ningún registro derivado. */
async function diasSinDerivar() {
  const r = await db.consulta(
    `SELECT dia::text AS dia FROM (
       SELECT DISTINCT (b.ocurrido_at AT TIME ZONE 'Europe/Madrid')::date AS dia
         FROM bolt_state_log b
     ) d
      WHERE NOT EXISTS (SELECT 1 FROM registro_jornada r WHERE r.dia = d.dia)
      ORDER BY dia`);
  return r.rows.map(x => x.dia);
}

module.exports = {
  GRUPO_CONDUCTOR, convenioVigente,
  sinContrato, abrir, cerrarLosDeBaja,
  vigentesEnMes, generarObjetivos, objetivosDe,
  foto, diasSinDerivar,
};
