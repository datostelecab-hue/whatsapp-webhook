// ============================================================
// CUENTAS FANTASMA — la tabla, y nada más
// ============================================================
// Periodos en los que una persona trabajó con una cuenta de BOLT que no es
// suya. El porqué está en db/134-cuenta-fantasma.sql; aquí solo se lee y se
// escribe.
//
// El no-solape NO se comprueba aquí: lo hace la base con un EXCLUDE. Si se
// comprobara antes de insertar, dos pestañas abiertas a la vez colarían dos
// dueños para el mismo día y las horas se contarían dos veces. Lo que sí hace
// este fichero es traducir ese error de PostgreSQL a algo que se pueda leer en
// pantalla.

const db = require('../../services/db');

// Las fechas se piden ya formateadas a PostgreSQL (to_char) y NO se convierten
// aquí. Un DATE llega como objeto Date y `String(fecha).slice(0,10)` devuelve
// «Fri Sep 11»: se cuela sin romper nada, y luego los rangos se comparan como
// texto y dejan de tener sentido. Es la misma trampa que ya costó un rato con
// toISOString, que además resta un día en Madrid.
const iso = s => (s ? String(s).slice(0, 10) : null);

/** Un enlace, tal como lo quiere la pantalla. */
const aFila = r => ({
  id: String(r.id),
  conductorId: String(r.conductor_id),
  conductor: r.conductor || '',
  cuentaId: String(r.cuenta_id),
  cuenta: r.cuenta_nombre || '(sin nombre en BOLT)',
  cuentaUuid: r.cuenta_uuid || '',
  desde: iso(r.desde),
  hasta: iso(r.hasta),
  abierto: r.hasta == null,
  motivo: r.motivo || '',
  creadoAt: r.creado_at,
  creadoPor: r.creado_por_nombre || '',
  anulado: r.anulado_at != null,
  anuladoAt: r.anulado_at,
  anuladoPor: r.anulado_por_nombre || '',
  anuladoMotivo: r.anulado_motivo || '',
});

const SELECT = `
  SELECT f.id, f.conductor_id, f.cuenta_id, f.motivo,
         to_char(f.desde, 'YYYY-MM-DD') AS desde,
         to_char(f.hasta, 'YYYY-MM-DD') AS hasta,
         f.creado_at, f.creado_por, f.anulado_at, f.anulado_por, f.anulado_motivo,
         ce.externo_nombre AS cuenta_nombre, ce.externo_id AS cuenta_uuid,
         COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                  btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS conductor,
         uc.nombre AS creado_por_nombre, ua.nombre AS anulado_por_nombre
    FROM cuenta_fantasma f
    JOIN conductor_externo ce ON ce.id = f.cuenta_id
    JOIN conductor c          ON c.id = f.conductor_id
    LEFT JOIN usuario uc      ON uc.id = f.creado_por
    LEFT JOIN usuario ua      ON ua.id = f.anulado_por`;

/** Los enlaces de una persona. Los anulados van al final, no se esconden. */
async function deConductor(conductorId) {
  const r = await db.consulta(
    `${SELECT} WHERE f.conductor_id = $1
      ORDER BY (f.anulado_at IS NOT NULL), f.desde DESC`, [Number(conductorId)]);
  return r.rows.map(aFila);
}

/** Todos los enlaces vivos, para las pantallas que pintan a mucha gente. */
async function vivos() {
  const r = await db.consulta(`${SELECT} WHERE f.anulado_at IS NULL ORDER BY f.desde DESC`);
  return r.rows.map(aFila);
}

/**
 * Los enlaces vivos que tocan un rango de días. Es lo que necesita la bitácora
 * para pintar «horas de cuenta fantasma» en las celdas que toca.
 */
async function enRango(desdeIso, hastaIso) {
  const r = await db.consulta(
    `${SELECT}
      WHERE f.anulado_at IS NULL
        AND f.desde <= $2::date
        AND (f.hasta IS NULL OR f.hasta >= $1::date)
      ORDER BY f.conductor_id, f.desde`, [desdeIso, hastaIso]);
  return r.rows.map(aFila);
}

/**
 * Quién usaba cada cuenta HOY, por uuid de BOLT. Lo mira Control para avisar de
 * que quien va en ese coche no es el titular de la cuenta.
 */
async function vigentesHoy() {
  const r = await db.consulta(
    `${SELECT}
      WHERE f.anulado_at IS NULL
        AND f.desde <= CURRENT_DATE
        AND (f.hasta IS NULL OR f.hasta >= CURRENT_DATE)`);
  return r.rows.map(aFila);
}

/**
 * Las cuentas de BOLT que se pueden prestar: las que NO son de nadie.
 *
 * Una cuenta con dueño no entra en la lista a propósito. Si tiene dueño, sus
 * horas ya son de alguien, y prestarla sería quitárselas a esa persona sin que
 * nadie se entere.
 */
// Se mandan TODAS, no las primeras. El filtro va en la pantalla, que enseña diez
// y busca al teclear: cortar aquí a sesenta hacía que la cuenta que buscabas
// sencillamente no estuviera, sin decir por qué. Son filas pequeñas y no llegan
// a dos mil.
async function prestables(q, limite = 3000) {
  const busca = String(q || '').trim();
  const filtro = busca
    ? `AND (unaccent(lower(COALESCE(ce.externo_nombre, ''))) LIKE unaccent(lower($2))
           OR regexp_replace(COALESCE(ce.externo_telefono, ''), '[^0-9]', '', 'g') LIKE $3)`
    : '';
  const params = busca
    ? [limite, '%' + busca + '%', '%' + busca.replace(/\D/g, '') + '%']
    : [limite];
  const r = await db.consulta(
    `SELECT ce.id, ce.externo_nombre AS nombre,
            ce.externo_telefono AS telefono, ce.estado_externo AS estado,
            -- Si ya está prestada y sin cerrar, la pantalla tiene que decirlo
            -- ANTES de que alguien intente enlazarla y se coma el rechazo.
            (SELECT count(*) FROM cuenta_fantasma f
              WHERE f.cuenta_id = ce.id AND f.anulado_at IS NULL)::int AS prestamos,
            (SELECT to_char(max(COALESCE(f.hasta, DATE '9999-12-31')), 'YYYY-MM-DD')
               FROM cuenta_fantasma f
              WHERE f.cuenta_id = ce.id AND f.anulado_at IS NULL)      AS ocupada_hasta
       FROM conductor_externo ce
      WHERE ce.sistema = 'bolt' AND ce.conductor_id IS NULL ${filtro}
      ORDER BY ce.externo_nombre
      LIMIT $1`, params);
  // SIN el uuid: son 36 caracteres por fila que la pantalla no usa para nada y
  // que en mil doscientas cuentas son 60 KB de los 219 que viajan al abrir.
  return r.rows.map(x => ({
    id: String(x.id), nombre: x.nombre || '(sin nombre en BOLT)',
    telefono: x.telefono || '', estado: x.estado || '',
    prestamos: x.prestamos,
    ocupadaHasta: x.ocupada_hasta && String(x.ocupada_hasta).startsWith('9999')
      ? 'abierta' : iso(x.ocupada_hasta),
  }));
}

/** Con quién choca un periodo, para poder decirlo con nombre y fechas. */
async function choquesDe({ cuentaId, desde, hasta, excluirId = null }) {
  const r = await db.consulta(
    `${SELECT}
      WHERE f.anulado_at IS NULL
        AND f.cuenta_id = $1
        AND ($4::bigint IS NULL OR f.id <> $4)
        AND daterange(f.desde, f.hasta, '[]') && daterange($2::date, $3::date, '[]')`,
    [Number(cuentaId), desde, hasta || null, excluirId == null ? null : Number(excluirId)]);
  return r.rows.map(aFila);
}

/** Una cuenta suelta, para poder nombrarla en los mensajes. */
async function cuenta(cuentaId) {
  const r = await db.consulta(
    `SELECT ce.id, ce.externo_id AS uuid, ce.externo_nombre AS nombre, ce.conductor_id
       FROM conductor_externo ce WHERE ce.id = $1 AND ce.sistema = 'bolt'`, [Number(cuentaId)]);
  const x = r.rows[0];
  return x ? { id: String(x.id), uuid: x.uuid, nombre: x.nombre || '(sin nombre en BOLT)',
    conductorId: x.conductor_id == null ? null : String(x.conductor_id) } : null;
}

const uno = async id => (await db.consulta(`${SELECT} WHERE f.id = $1`, [Number(id)])).rows.map(aFila)[0] || null;

/** El error del EXCLUDE, en cristiano. Se reconoce por el nombre de la restricción. */
const esSolape = e => /ex_fantasma_sin_solape|exclusion constraint/i.test(String(e && e.message));

async function crear({ conductorId, cuentaId, desde, hasta, motivo, usuarioId }) {
  const r = await db.consulta(
    `INSERT INTO cuenta_fantasma (conductor_id, cuenta_id, desde, hasta, motivo, creado_por)
     VALUES ($1, $2, $3::date, $4::date, $5, $6) RETURNING id`,
    [Number(conductorId), Number(cuentaId), desde, hasta || null,
     String(motivo || '').trim() || null, usuarioId || null]);
  return uno(r.rows[0].id);
}

/**
 * Cambiar las fechas de un enlace vivo. Devuelve también las fechas VIEJAS: el
 * servicio necesita saberlas para volver a sellar los días que deja de tocar,
 * no solo los nuevos.
 */
async function cambiarFechas({ id, desde, hasta }) {
  const antes = await uno(id);
  if (!antes) throw new Error('Ese enlace no existe');
  if (antes.anulado) throw new Error('Ese enlace está anulado: no se puede cambiar');
  await db.consulta(
    `UPDATE cuenta_fantasma SET desde = $2::date, hasta = $3::date WHERE id = $1`,
    [Number(id), desde, hasta || null]);
  return { antes, despues: await uno(id) };
}

async function anular({ id, motivo, usuarioId }) {
  const antes = await uno(id);
  if (!antes) throw new Error('Ese enlace no existe');
  if (antes.anulado) return antes;
  await db.consulta(
    `UPDATE cuenta_fantasma SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1`, [Number(id), usuarioId || null, String(motivo || '').trim() || null]);
  return uno(id);
}

/**
 * EL LIBRO: cada acción sobre una cuenta fantasma, con quién y desde dónde.
 *
 * Se apunta SIEMPRE, también al cambiar las fechas —que es la acción con la que
 * se estiran unas horas sin que se note— y también al anular. Va en tabla
 * aparte y no en columnas de `cuenta_fantasma` porque un enlace se toca varias
 * veces y lo que hace falta es la serie entera, no la última vez.
 *
 * Si el apunte fallara NO se tumba la operación: el enlace ya está hecho y
 * negarlo a posteriori sería peor. Se deja dicho en consola.
 */
async function apuntar({ fantasmaId, accion, quien = {}, detalle = null }) {
  try {
    await db.consulta(
      `INSERT INTO cuenta_fantasma_log
         (fantasma_id, accion, usuario_id, usuario, ip, agente, detalle, cadena, ip_cliente)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [Number(fantasmaId), accion, quien.usuarioId || null,
       (quien.nombre || '').slice(0, 160) || null,
       (quien.ip || '').slice(0, 64) || null, quien.agente || null,
       detalle ? JSON.stringify(detalle) : null,
       quien.cadena || null, (quien.ipCliente || '').slice(0, 64) || null]);
  } catch (e) {
    console.error(`⚠️  [FANTASMA] no se pudo apuntar «${accion}» del enlace ${fantasmaId}: ${e.message}`);
  }
}

/** El libro de un enlace, de lo más reciente a lo más antiguo. */
async function libroDe(fantasmaId) {
  const r = await db.consulta(
    `SELECT accion, usuario, ip, agente, detalle, ocurrido_at
       FROM cuenta_fantasma_log WHERE fantasma_id = $1
      ORDER BY ocurrido_at DESC, id DESC`, [Number(fantasmaId)]);
  return r.rows.map(x => ({
    accion: x.accion, usuario: x.usuario || '', ip: x.ip || '',
    agente: x.agente || '', detalle: x.detalle || null, cuando: x.ocurrido_at,
    cadena: x.cadena || '', ipCliente: x.ip_cliente || '',
  }));
}

/** El libro de TODOS los enlaces de una persona, para pintarlo en su ficha. */
async function libroDeConductor(conductorId) {
  const r = await db.consulta(
    `SELECT l.fantasma_id, l.accion, l.usuario, l.ip, l.agente, l.detalle, l.ocurrido_at,
            l.cadena, l.ip_cliente,
            COALESCE(ce.externo_nombre, '(sin nombre en BOLT)') AS cuenta
       FROM cuenta_fantasma_log l
       JOIN cuenta_fantasma f     ON f.id = l.fantasma_id
       JOIN conductor_externo ce  ON ce.id = f.cuenta_id
      WHERE f.conductor_id = $1
      ORDER BY l.ocurrido_at DESC, l.id DESC
      LIMIT 100`, [Number(conductorId)]);
  return r.rows.map(x => ({
    enlaceId: String(x.fantasma_id), accion: x.accion, cuenta: x.cuenta,
    usuario: x.usuario || '', ip: x.ip || '', agente: x.agente || '',
    detalle: x.detalle || null, cuando: x.ocurrido_at,
    cadena: x.cadena || '', ipCliente: x.ip_cliente || '',
  }));
}

module.exports = {
  deConductor, vivos, enRango, vigentesHoy, prestables, choquesDe, cuenta, uno,
  crear, cambiarFechas, anular, esSolape,
  apuntar, libroDe, libroDeConductor,
};
