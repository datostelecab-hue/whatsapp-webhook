// ============================================================
// CAZAMIENTO CON BOLT — enlazar cuentas de BOLT con conductores nuestros
// ============================================================
// El nombre NO decide nada. La consulta periódica solo mantiene al día el
// inventario de cuentas de BOLT; quién es quién lo dice una persona.
//
//   · Cuenta de BOLT sin conductor  →  "ID de BOLT libre"
//   · Conductor sin cuenta de BOLT  →  "pendiente de asignar ID de BOLT"
//
// Es a propósito que no haya nada automático: los homónimos existen (hay tres
// en el padrón real) y una cuenta enlazada con la persona equivocada le imputa
// las horas a otro. Más vale una lista de pendientes que un dato falso.

const db = require('./db');

/**
 * Sincroniza el inventario con lo que devuelve BOLT. NO enlaza a nadie.
 * `cuentas` = [{ driver_uuid, nombre, phone, email, state }]
 */
async function sincronizar(cuentas) {
  if (!Array.isArray(cuentas) || !cuentas.length) return { vistas: 0, nuevas: 0, cambiadas: 0, desaparecidas: 0 };

  // Una sola fila por cuenta. Si BOLT devolviera la misma dos veces, el
  // ON CONFLICT fallaría con "cannot affect row a second time".
  const porUuid = new Map();
  for (const c of cuentas) {
    const uuid = String(c.driver_uuid || '').trim();
    if (uuid) porUuid.set(uuid, c);
  }
  const filas = [...porUuid.entries()];
  if (!filas.length) return { vistas: 0, nuevas: 0, cambiadas: 0, desaparecidas: 0 };

  const uuids = filas.map(([u]) => u);
  const nombres = filas.map(([, c]) => (c.nombre || '').slice(0, 200));
  const tels = filas.map(([, c]) => (c.phone || '').slice(0, 20) || null);
  const emails = filas.map(([, c]) => (c.email || '').slice(0, 160) || null);
  const estados = filas.map(([, c]) => (c.state || '').toLowerCase() || null);

  // El estado ANTERIOR se guarda en un CTE aparte porque `EXCLUDED` no se puede
  // mirar desde el RETURNING: allí solo existe la fila tal como queda.
  const r = await db.consulta(`
    WITH antes AS (
      SELECT externo_id, estado_externo
        FROM conductor_externo
       WHERE sistema = 'bolt' AND externo_id = ANY($1::text[])
    ),
    guardadas AS (
      INSERT INTO conductor_externo
        (sistema, externo_id, externo_nombre, externo_telefono, externo_email, estado_externo)
      SELECT 'bolt', u, n, t, e, s
        FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS x(u, n, t, e, s)
      ON CONFLICT (sistema, externo_id) DO UPDATE SET
        externo_nombre   = EXCLUDED.externo_nombre,
        externo_telefono = EXCLUDED.externo_telefono,
        externo_email    = EXCLUDED.externo_email,
        estado_externo   = EXCLUDED.estado_externo,
        visto_at         = now()
      RETURNING externo_id, (xmax = 0) AS es_nueva, estado_externo
    )
    SELECT count(*) FILTER (WHERE g.es_nueva)::int AS nuevas,
           count(*) FILTER (
             WHERE NOT g.es_nueva
               AND a.estado_externo IS DISTINCT FROM g.estado_externo)::int AS cambiadas
      FROM guardadas g
      LEFT JOIN antes a ON a.externo_id = g.externo_id`,
    [uuids, nombres, tels, emails, estados]);

  // Las que hoy no ha devuelto BOLT y seguían activas: han desaparecido sin
  // pasar por 'deactivated'. Se marcan para que no ensucien el desplegable.
  const desaparecidas = await db.consulta(
    `UPDATE conductor_externo SET estado_externo = 'no_vista'
      WHERE sistema = 'bolt' AND estado_externo = 'active' AND NOT (externo_id = ANY($1::text[]))
      RETURNING id`, [uuids]);

  return {
    vistas: filas.length,
    nuevas: r.rows[0].nuevas,
    cambiadas: r.rows[0].cambiadas,
    desaparecidas: desaparecidas.rowCount,
  };
}

/** IDs de BOLT libres. `q` filtra por nombre o teléfono para el desplegable. */
async function libres(q, limite = 50) {
  const busca = String(q || '').trim();
  if (!busca) {
    return (await db.consulta(
      `SELECT * FROM v_bolt_libres ORDER BY nombre_en_bolt LIMIT $1`, [limite])).rows;
  }
  // Búsqueda simple por trozo de nombre o de teléfono: el nombre aquí solo
  // sirve para ENCONTRAR la cuenta, no para decidir de quién es.
  return (await db.consulta(
    `SELECT * FROM v_bolt_libres
      WHERE unaccent(lower(nombre_en_bolt)) LIKE unaccent(lower($1))
         OR regexp_replace(externo_telefono, '[^0-9]', '', 'g') LIKE $2
      ORDER BY nombre_en_bolt LIMIT $3`,
    ['%' + busca + '%', '%' + busca.replace(/\D/g, '') + '%', limite])).rows;
}

/** Conductores pendientes de que se les asigne un ID de BOLT. */
async function pendientes({ soloEmpleados = true } = {}) {
  return (await db.consulta(
    `SELECT * FROM v_conductor_sin_bolt
      WHERE ($1 = FALSE OR empleo_vigente)
      ORDER BY es_ett DESC, quien`, [soloEmpleados])).rows;
}

/**
 * Enlaza una cuenta con un conductor. Lo hace una persona, con su nombre.
 * Falla si la cuenta ya está enlazada: deshacer es un paso aparte y consciente.
 *
 * `cuentaId` es el id de la FILA de conductor_externo (el que trae la vista
 * v_bolt_libres), no el driver_uuid de BOLT. Antes se llamaba `externoId` y
 * eso invitaba a pasarle el uuid, que no habría encontrado nada.
 */
async function enlazar({ cuentaId, conductorId, usuarioId, origen = 'manual' }) {
  if (!cuentaId || !conductorId) throw new Error('Faltan la cuenta o el conductor');
  const r = await db.consulta(
    `UPDATE conductor_externo
        SET conductor_id = $2, enlazado_at = now(), enlazado_por = $3, origen_enlace = $4
      WHERE id = $1 AND sistema = 'bolt' AND conductor_id IS NULL
      RETURNING externo_id, externo_nombre`,
    [cuentaId, conductorId, usuarioId || null, origen]);
  if (!r.rowCount) throw new Error('Esa cuenta no existe o ya está enlazada con alguien');
  return r.rows[0];
}

/**
 * Enlaza AUTOMÁTICAMENTE todas las cuentas de BOLT libres cuyo teléfono casa con una
 * persona (v_bolt_sugerencia). El teléfono es la clave fiable -único por conductor
 * vigente-, así que el cruce es 1:1: no hace falta ir de uno en uno. Lo que NO casa
 * (sin teléfono, teléfono que no está en BOLT…) se devuelve como `pendientes` para
 * resolver a mano. Devuelve { enlazadas, errores, pendientes }.
 */
async function autoEnlazar({ soloEmpleados = true, usuarioId } = {}) {
  const sug = await sugerencias({ soloEmpleados });
  const usados = new Set();
  let enlazadas = 0;
  const errores = [];
  for (const s of sug) {
    // Una persona podría casar con DOS cuentas (dos BOLT con su teléfono): en
    // automático se enlaza solo la primera; el resto se decide a mano.
    if (usados.has(String(s.conductor_id))) continue;
    try {
      await enlazar({ cuentaId: s.cuenta_id, conductorId: s.conductor_id, usuarioId, origen: 'automatico' });
      usados.add(String(s.conductor_id));
      enlazadas++;
    } catch (e) { errores.push({ quien: s.quien, motivo: e.message }); }
  }

  // ── SEGUNDA PASADA: cuentas HERMANAS ──────────────────────────────────────
  // Cuentas libres cuyo teléfono es el de alguien que YA tiene cuenta de BOLT.
  // `v_bolt_sugerencia` las excluye a propósito, así que el automático nunca
  // las cogía: son las cuentas VIEJAS de la misma persona (recontrataciones,
  // altas duplicadas) y sus horas quedaban huérfanas — en la bitácora parecía
  // que esos días no trabajó. Al colgarlas del mismo conductor, las horas se
  // suman solas (la bitácora agrega por conductor_id).
  //
  // Solo se enlaza en automático si el NOMBRE también coincide, con una cuenta
  // ya enlazada o con la ficha: hay teléfonos REUTILIZADOS por otra persona
  // (pasa de verdad) y esos se devuelven como `dudosas` para decidir a mano.
  // Va DESPUÉS del bucle de sugerencias adrede: si a alguien se le acaba de
  // enlazar su primera cuenta, esta pasada ya le ve las hermanas.
  const herm = await db.consulta(
    `SELECT ce.id AS cuenta_id, ce.externo_nombre AS nombre_en_bolt,
            ce.estado_externo, ct.conductor_id,
            btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
            (unaccent(lower(ce.externo_nombre)) IN (
               SELECT unaccent(lower(x.externo_nombre)) FROM conductor_externo x
                WHERE x.conductor_id = ct.conductor_id AND x.sistema = 'bolt'
                  AND x.externo_nombre IS NOT NULL)
             OR unaccent(lower(ce.externo_nombre)) = unaccent(lower(btrim(
                  c.nombre || ' ' || COALESCE(c.apellidos, ''))))
             OR unaccent(lower(ce.externo_nombre)) = unaccent(lower(btrim(
                  COALESCE(c.apellidos || ' ', '') || c.nombre)))) AS coincide_nombre
       FROM conductor_externo ce
       JOIN conductor_telefono ct
         ON ct.vigente_hasta IS NULL
        AND ct.sufijo9 = right(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g'), 9)
       JOIN conductor c ON c.id = ct.conductor_id AND NOT c.es_centinela
      WHERE ce.sistema = 'bolt' AND ce.conductor_id IS NULL
        AND ce.externo_telefono IS NOT NULL
        AND length(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g')) >= 9
        AND EXISTS (SELECT 1 FROM conductor_externo x
                     WHERE x.conductor_id = ct.conductor_id AND x.sistema = 'bolt')
      ORDER BY quien`);
  let hermanas = 0;
  const dudosas = [];
  for (const h of herm.rows) {
    if (!h.coincide_nombre) { dudosas.push({ quien: h.quien, nombre_en_bolt: h.nombre_en_bolt, estado: h.estado_externo }); continue; }
    try {
      await enlazar({ cuentaId: h.cuenta_id, conductorId: h.conductor_id, usuarioId, origen: 'automatico' });
      hermanas++;
    } catch (e) { errores.push({ quien: h.quien, motivo: e.message }); }
  }

  const pendientes = (await db.consulta(
    `SELECT conductor_id, quien, telefono, es_ett FROM v_conductor_sin_bolt
      WHERE ($1 = FALSE OR empleo_vigente) ORDER BY quien`, [soloEmpleados])).rows;
  return { enlazadas, hermanas, dudosas, errores, pendientes };
}

/** Deshace un enlace equivocado. La cuenta vuelve a la lista de libres. */
async function desenlazar({ cuentaId, usuarioId }) {
  const r = await db.consulta(
    `UPDATE conductor_externo
        SET conductor_id = NULL, enlazado_at = NULL, enlazado_por = $2
      WHERE id = $1 AND sistema = 'bolt' AND conductor_id IS NOT NULL
      RETURNING externo_id`,
    [cuentaId, usuarioId || null]);
  if (!r.rowCount) throw new Error('Esa cuenta no está enlazada');
  return r.rows[0];
}

/**
 * Cuentas libres con dueño PROPUESTO por el teléfono.
 *
 * El teléfono sí identifica: es obligatorio en la ficha de contratación y la
 * cuenta de BOLT se da de alta con ese mismo número. Sigue enlazando una
 * persona — esto solo evita tener que buscar a mano entre cientos de nombres.
 */
async function sugerencias({ soloEmpleados = true } = {}) {
  return (await db.consulta(
    `SELECT * FROM v_bolt_sugerencia
      WHERE ($1 = FALSE OR empleo_vigente)
      ORDER BY coincide_nombre DESC, quien`, [soloEmpleados])).rows;
}

/**
 * Cómo está cada persona respecto a BOLT. Distingue lo que hasta ahora se veía
 * igual: "no tiene cuenta enlazada" (papeleo) de "no está dada de alta en BOLT"
 * (no puede trabajar).
 */
async function altaEnBolt({ soloEmpleados = true, situacion } = {}) {
  return (await db.consulta(
    `SELECT * FROM v_conductor_alta_bolt
      WHERE ($1 = FALSE OR empleo_vigente)
        AND ($2::text IS NULL OR situacion_bolt = $2)
      ORDER BY situacion_bolt, quien`, [soloEmpleados, situacion || null])).rows;
}

/** Resumen para el panel. */
async function estado() {
  const q = await db.consulta(`SELECT
    (SELECT count(*) FROM v_bolt_libres)                                        libres,
    (SELECT count(*) FROM v_bolt_sugerencia WHERE empleo_vigente)                sugeridas,
    (SELECT count(*) FROM v_conductor_alta_bolt
      WHERE empleo_vigente AND situacion_bolt = 'no_esta_en_bolt')               sin_alta_bolt,
    (SELECT count(*) FROM v_conductor_alta_bolt
      WHERE empleo_vigente AND situacion_bolt = 'sin_telefono')                  sin_telefono,
    (SELECT count(*) FROM v_conductor_sin_bolt WHERE empleo_vigente)            pendientes,
    (SELECT count(*) FROM v_conductor_sin_bolt WHERE empleo_vigente AND es_ett) pendientes_ett,
    (SELECT count(*) FROM conductor_externo
      WHERE sistema='bolt' AND conductor_id IS NOT NULL)                        enlazadas,
    (SELECT max(visto_at) FROM conductor_externo WHERE sistema='bolt')          ultima_consulta`);
  return q.rows[0];
}

/**
 * Pregunta a BOLT quién hay y actualiza el inventario.
 *
 * Es lo que hace que existan "IDs de BOLT libres": la carga inicial creó cada
 * cuenta ya pegada a una persona, así que sin esta pasada la lista de libres
 * está vacía y no hay nada que enlazar.
 *
 * NO enlaza a nadie. Solo actualiza qué cuentas existen y en qué estado.
 */
async function sincronizarDesdeBolt() {
  const { traerDriversBolt } = require('./conductoresBolt');
  const porUuid = await traerDriversBolt();
  const cuentas = [...porUuid.values()];
  const r = await sincronizar(cuentas);
  console.log(`🔗 [BOLT] Inventario: ${r.vistas} cuentas · ${r.nuevas} nuevas · ` +
              `${r.cambiadas} con otro estado · ${r.desaparecidas} ya no están`);
  return r;
}

module.exports = {
  sincronizar, sincronizarDesdeBolt, libres, pendientes, sugerencias, autoEnlazar, altaEnBolt,
  enlazar, desenlazar, estado,
};
