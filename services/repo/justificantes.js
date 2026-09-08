// ============================================================
// JUSTIFICANTES — sobre PostgreSQL (sustituye a la hoja JUSTIFICANTES)
// ============================================================
// Tráfico justifica el día a un conductor que no llegó a horas. Aquí eso:
//   · guarda (o actualiza) el justificante VIVO del día en la tabla `justificante`, y
//   · escribe la marca 'J' en `bitacora_dia` (con enlace al justificante).
// Todo por `conductor_id`, siempre: el cockpit y la bitácora lo tienen. La
// resolución por NOMBRE que hubo aquí se retiró con la ruta que la usaba: el
// nombre no identifica a nadie. Cero hojas.

const db = require('../db');
const { normClave } = require('../conductores');

// LOS CINCO TIPOS DE J. El código va a la base (hay CHECK en db/72); la
// etiqueta es lo que se enseña. El texto libre de la observación se queda:
// el tipo agrupa, la observación explica.
const TIPOS_J = [
  { codigo: 'taller',     etiqueta: 'Taller / ITV' },
  { codigo: 'suspension', etiqueta: 'Suspensión BOLT' },
  { codigo: 'medico',     etiqueta: 'Médico' },
  { codigo: 'gestion',    etiqueta: 'Gestión / papeleo' },
  { codigo: 'personal',   etiqueta: 'Personal / otro' },
];
const ES_TIPO_J = new Set(TIPOS_J.map(t => t.codigo));

/**
 * Guarda/actualiza el justificante del día y pone la 'J' en la bitácora, por
 * conductor_id ya resuelto. `diaIso` = 'AAAA-MM-DD'. `horas` = horas QUE SE
 * JUSTIFICAN (se SUMAN a las de BOLT), número o texto ("7,5" vale) o vacío.
 */
async function guardarPorId({ conductorId, diaIso, horas, observacion, tipo, usuarioId }) {
  observacion = (observacion || '').toString().trim();
  if (!observacion) throw new Error('La observación es obligatoria para justificar');
  // Sin tipo válido cae en 'personal': una J vieja o de otra pantalla no puede
  // reventar por no traerlo.
  tipo = ES_TIPO_J.has(String(tipo || '').trim()) ? String(tipo).trim() : 'personal';
  conductorId = Number(conductorId);
  if (!Number.isInteger(conductorId) || conductorId <= 0) throw new Error('Falta el conductor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaIso || '')) throw new Error('Falta la fecha (AAAA-MM-DD)');
  // "7,5" es lo que escribe una persona en España; sin esto acababa en NaN y
  // PostgreSQL contestaba con un error críptico. Y ni negativas ni más de 24.
  let horasSeg = null;
  if (horas != null && String(horas).trim() !== '') {
    const n = Number(String(horas).trim().replace(',', '.'));
    if (!Number.isFinite(n) || n < 0 || n > 24) throw new Error('Horas no válidas: entre 0 y 24, por ejemplo 7,5');
    horasSeg = Math.round(n * 3600);
  }

  return db.transaccion(async cli => {
    // Una libranza puesta A MANO por RRHH no se pisa con una J sin que nadie lo
    // vea: antes la J la machacaba y, al anularla, se borraba la fila entera y
    // la L manual desaparecía sin aviso.
    const previa = await cli.query(
      `SELECT marca, marca_manual FROM bitacora_dia
        WHERE conductor_id = $1 AND dia_operativo = $2::date`, [conductorId, diaIso]);
    if (previa.rows.length && previa.rows[0].marca === 'L' && previa.rows[0].marca_manual) {
      throw new Error('Ese día está marcado a mano como libranza (L). Quita la libranza antes de justificarlo.');
    }
    // Un solo justificante vivo por conductor/día (índice parcial uq_just_vivo).
    const j = await cli.query(
      `INSERT INTO justificante (conductor_id, dia_operativo, horas_seg_momento, observacion, tipo, usuario_id, escrito_en_bitacora)
       VALUES ($1, $2::date, $3, $4, $5, $6, TRUE)
       ON CONFLICT (conductor_id, dia_operativo) WHERE anulado_at IS NULL
       DO UPDATE SET observacion = EXCLUDED.observacion,
                     horas_seg_momento = EXCLUDED.horas_seg_momento,
                     tipo = EXCLUDED.tipo,
                     usuario_id = EXCLUDED.usuario_id
       RETURNING id`, [conductorId, diaIso, horasSeg, observacion, tipo, usuarioId || null]);
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

/**
 * Justificantes vivos de un día → Map con la MISMA entrada bajo varias claves:
 * 'id:<conductor_id>' (la que hay que usar) y, de cortesía, el nombre de BOLT y
 * el de la ficha normalizados. Cada entrada: { conductorId, nombre, observacion,
 * horasJ } — horasJ son las horas QUE SE JUSTIFICAN (se suman a las de BOLT).
 *
 * Los nombres salen de la tabla `conductor` y de su cuenta de BOLT, no de
 * v_agenda: v_agenda solo tiene a los vigentes, y la J de alguien ya de baja se
 * quedaba sin ninguna clave y desaparecía del reporte.
 */
async function leerPorFecha(diaIso) {
  const r = await db.consulta(
    `SELECT j.conductor_id, j.observacion, j.horas_seg_momento,
            ext.externo_nombre                                    AS nombre_bolt,
            btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))  AS nombre_ficha
       FROM justificante j
       LEFT JOIN conductor c ON c.id = j.conductor_id
       LEFT JOIN LATERAL (
         SELECT externo_nombre FROM conductor_externo
          WHERE conductor_id = j.conductor_id AND sistema = 'bolt'
          ORDER BY (estado_externo = 'active') DESC, visto_at DESC NULLS LAST LIMIT 1) ext ON TRUE
      WHERE j.anulado_at IS NULL AND j.dia_operativo = $1::date`, [diaIso]);
  const m = new Map();
  r.rows.forEach(x => {
    const cid = Number(x.conductor_id);
    const nombre = x.nombre_bolt || x.nombre_ficha || `#${cid}`;
    const entry = {
      nombre, observacion: x.observacion || '', conductorId: cid,
      horasJ: x.horas_seg_momento != null ? Math.round(x.horas_seg_momento / 360) / 10 : null,
    };
    m.set('id:' + cid, entry);
    for (const n of [x.nombre_bolt, x.nombre_ficha]) {
      const k = normClave(n || '');
      if (k && !m.has(k)) m.set(k, entry);
    }
  });
  return m;
}

/** Anula el justificante VIVO de un día (y quita su 'J' de la bitácora). */
async function anularPorId({ conductorId, diaIso }) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(diaIso || '')) throw new Error('Falta la fecha (AAAA-MM-DD)');
  return db.transaccion(async cli => {
    const r = await cli.query(
      `UPDATE justificante SET anulado_at = now()
        WHERE conductor_id = $1 AND dia_operativo = $2::date AND anulado_at IS NULL
        RETURNING id`, [cid, diaIso]);
    if (!r.rows.length) throw new Error('Ese día no tiene justificante vivo');
    // Se quita la J, y solo la J: la fila solo existe por ella (guardarPorId no
    // pisa una L manual), así que borrarla es lo correcto —pero se exige que
    // siga siendo una J por si algo la cambió entre medias.
    await cli.query(
      `DELETE FROM bitacora_dia
        WHERE conductor_id = $1 AND dia_operativo = $2::date AND justificante_id = $3 AND marca = 'J'`,
      [cid, diaIso, r.rows[0].id]);
    return { ok: true, justificanteId: r.rows[0].id };
  });
}

module.exports = { guardarPorId, anularPorId, leerPorFecha, TIPOS_J };
