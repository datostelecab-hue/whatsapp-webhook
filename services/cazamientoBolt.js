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
  if (!Array.isArray(cuentas) || !cuentas.length) return { vistas: 0, nuevas: 0, cambiadas: 0 };
  let nuevas = 0, cambiadas = 0;

  await db.transaccion(async cli => {
    for (const c of cuentas) {
      const uuid = String(c.driver_uuid || '').trim();
      if (!uuid) continue;
      const r = await cli.query(
        `INSERT INTO conductor_externo
           (sistema, externo_id, externo_nombre, externo_telefono, externo_email, estado_externo)
         VALUES ('bolt', $1, $2, $3, $4, $5)
         ON CONFLICT (sistema, externo_id) DO UPDATE SET
           externo_nombre   = EXCLUDED.externo_nombre,
           externo_telefono = EXCLUDED.externo_telefono,
           externo_email    = EXCLUDED.externo_email,
           estado_externo   = EXCLUDED.estado_externo,
           visto_at         = now()
         RETURNING (xmax = 0) AS es_nueva,
                   (conductor_externo.estado_externo IS DISTINCT FROM EXCLUDED.estado_externo) AS cambio`,
        [uuid, (c.nombre || '').slice(0, 200), (c.phone || '').slice(0, 20),
         (c.email || '').slice(0, 160), (c.state || '').toLowerCase()]);
      if (r.rows[0].es_nueva) nuevas++;
      else if (r.rows[0].cambio) cambiadas++;
    }
  });

  // Las que hoy no ha devuelto BOLT y siguen marcadas como activas: han
  // desaparecido sin pasar por 'deactivated'. Se marcan para que no ensucien
  // el desplegable de libres.
  const uuids = cuentas.map(c => String(c.driver_uuid || '').trim()).filter(Boolean);
  const desaparecidas = await db.consulta(
    `UPDATE conductor_externo SET estado_externo = 'no_vista'
      WHERE sistema = 'bolt' AND estado_externo = 'active' AND NOT (externo_id = ANY($1))
      RETURNING id`, [uuids]);

  return { vistas: cuentas.length, nuevas, cambiadas, desaparecidas: desaparecidas.rowCount };
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
async function enlazar({ cuentaId, conductorId, usuarioId }) {
  if (!cuentaId || !conductorId) throw new Error('Faltan la cuenta o el conductor');
  const r = await db.consulta(
    `UPDATE conductor_externo
        SET conductor_id = $2, enlazado_at = now(), enlazado_por = $3, origen_enlace = 'manual'
      WHERE id = $1 AND sistema = 'bolt' AND conductor_id IS NULL
      RETURNING externo_id, externo_nombre`,
    [cuentaId, conductorId, usuarioId || null]);
  if (!r.rowCount) throw new Error('Esa cuenta no existe o ya está enlazada con alguien');
  return r.rows[0];
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
  sincronizar, sincronizarDesdeBolt, libres, pendientes, sugerencias, altaEnBolt,
  enlazar, desenlazar, estado,
};
