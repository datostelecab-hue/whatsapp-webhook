// ============================================================
// JUSTIFICANTES — sobre PostgreSQL (sustituye a la hoja JUSTIFICANTES)
// ============================================================
// Tráfico justifica el día a un conductor que no llegó a horas. Aquí eso:
//   · guarda (o actualiza) el justificante VIVO del día en la tabla `justificante`, y
//   · escribe la marca 'J' en `bitacora_dia` (con enlace al justificante).
// Todo por `conductor_id`: el nombre que llega (el "ID_BOLT" de las pantallas) se
// resuelve a id por `conductor_alias` (alias_norm = el mismo normClave de siempre).
// Cero hojas.

const db = require('../db');
const { normClave } = require('../conductores');

/** Nombre (como lo escribe BOLT/las pantallas) → conductor_id, por alias no ambiguo. */
async function resolverConductor(nombre) {
  const clave = normClave(nombre);
  if (!clave) return null;
  const r = await db.consulta(
    `SELECT conductor_id FROM conductor_alias
      WHERE alias_norm = $1 AND NOT ambiguo AND vigente
      ORDER BY (tipo = 'bolt_nombre') DESC
      LIMIT 1`, [clave]);
  return r.rows.length ? Number(r.rows[0].conductor_id) : null;
}

/**
 * Guarda/actualiza el justificante del día y pone la 'J' en la bitácora, por
 * conductor_id ya resuelto. `diaIso` = 'AAAA-MM-DD'. `horas` = horas EXACTAS
 * justificadas (número) o vacío (sin horas concretas).
 */
async function guardarPorId({ conductorId, diaIso, horas, observacion, usuarioId }) {
  observacion = (observacion || '').toString().trim();
  if (!observacion) throw new Error('La observación es obligatoria para justificar');
  conductorId = Number(conductorId);
  if (!Number.isInteger(conductorId) || conductorId <= 0) throw new Error('Falta el conductor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaIso || '')) throw new Error('Falta la fecha (AAAA-MM-DD)');
  const horasSeg = (horas == null || horas === '') ? null : Math.round(Number(horas) * 3600);

  return db.transaccion(async cli => {
    // Un solo justificante vivo por conductor/día (índice parcial uq_just_vivo).
    const j = await cli.query(
      `INSERT INTO justificante (conductor_id, dia_operativo, horas_seg_momento, observacion, usuario_id, escrito_en_bitacora)
       VALUES ($1, $2::date, $3, $4, $5, TRUE)
       ON CONFLICT (conductor_id, dia_operativo) WHERE anulado_at IS NULL
       DO UPDATE SET observacion = EXCLUDED.observacion,
                     horas_seg_momento = EXCLUDED.horas_seg_momento,
                     usuario_id = EXCLUDED.usuario_id
       RETURNING id`, [conductorId, diaIso, horasSeg, observacion, usuarioId || null]);
    const justId = j.rows[0].id;
    // La 'J' en la bitácora: marca_manual porque la pone una persona.
    await cli.query(
      `INSERT INTO bitacora_dia (conductor_id, dia_operativo, marca, marca_manual, justificante_id)
       VALUES ($1, $2::date, 'J', TRUE, $3)
       ON CONFLICT (conductor_id, dia_operativo)
       DO UPDATE SET marca = 'J', marca_manual = TRUE, justificante_id = EXCLUDED.justificante_id`,
      [conductorId, diaIso, justId]);
    return { ok: true, conductorId, justificanteId: justId, enBitacora: true };
  });
}

/** Como guardarPorId, pero resolviendo el conductor por su nombre de BOLT (alias). */
async function guardar({ diaIso, nombre, horas, observacion, usuarioId }) {
  if (!nombre) throw new Error('Falta el conductor');
  const conductorId = await resolverConductor(nombre);
  if (!conductorId) {
    throw new Error(`No se pudo identificar a "${nombre}" en PostgreSQL (sin alias resoluble). ` +
      `Hay que darle de alta el alias de BOLT antes de justificarlo.`);
  }
  return guardarPorId({ conductorId, diaIso, horas, observacion, usuarioId });
}

/**
 * Justificantes vivos de un día → Map(clave(nombre) -> {nombre, observacion, conductorId}).
 * La clave es normClave del nombre de BOLT (o del canónico), para que quien busque por
 * nombre —el reporte, el listado— lo encuentre igual que antes.
 */
async function leerPorFecha(diaIso) {
  const r = await db.consulta(
    `SELECT j.conductor_id, j.observacion,
            COALESCE(a.id_bolt, a.nombre_apellidos) AS nombre_bolt,
            a.nombre_apellidos                       AS nombre_canonico
       FROM justificante j
       LEFT JOIN v_agenda a ON a.conductor_id = j.conductor_id
      WHERE j.anulado_at IS NULL AND j.dia_operativo = $1::date`, [diaIso]);
  const m = new Map();
  r.rows.forEach(x => {
    const nombre = x.nombre_bolt || x.nombre_canonico || `#${x.conductor_id}`;
    const entry = { nombre, observacion: x.observacion || '', conductorId: Number(x.conductor_id) };
    for (const n of [x.nombre_bolt, x.nombre_canonico]) {
      const k = normClave(n || '');
      if (k) m.set(k, entry);
    }
  });
  return m;
}

module.exports = { resolverConductor, guardar, guardarPorId, leerPorFecha };
