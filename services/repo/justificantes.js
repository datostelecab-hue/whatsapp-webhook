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

// LOS CINCO TIPOS DE J, por QUIÉN RESPONDE de ella (los puso Tráfico, db/73):
// una J de tráfico la aprueba Tráfico, una de RRHH la aprueba RRHH. El texto
// libre de la observación se queda: el tipo agrupa y enruta, la observación
// explica.
const TIPOS_J = [
  { codigo: 'trafico',   etiqueta: 'Tráfico' },
  { codigo: 'rrhh',      etiqueta: 'RRHH' },
  { codigo: 'bolt',      etiqueta: 'BOLT' },
  { codigo: 'taller',    etiqueta: 'Taller' },
  { codigo: 'companero', etiqueta: 'Por compañero' },
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
  // Sin tipo válido cae en 'trafico' (quien justifica desde el cockpit ES
  // Tráfico): una J de otra pantalla no puede reventar por no traerlo.
  tipo = ES_TIPO_J.has(String(tipo || '').trim()) ? String(tipo).trim() : 'trafico';
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
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')))  AS nombre_ficha
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

// ── LA APROBACIÓN (el módulo /justificantes) ────────────────────────────────
// La J nace PENDIENTE y el área responsable la aprueba o la rechaza. Estados
// sin columna de estado: pendiente (ni aprobado ni anulado), aprobada
// (aprobado_at) y rechazada (anulado_at, el circuito de anular de siempre,
// ahora con quién y por qué).

/** La cola del módulo: por estado y tipo, la más antigua primero. */
async function listar({ estado = 'pendiente', tipo, desde, hasta, limite = 300 } = {}) {
  const cond = ['1=1'];
  const args = [];
  const p = v => { args.push(v); return '$' + args.length; };
  if (estado === 'pendiente') cond.push('j.aprobado_at IS NULL AND j.anulado_at IS NULL');
  else if (estado === 'aprobada') cond.push('j.aprobado_at IS NOT NULL AND j.anulado_at IS NULL');
  else if (estado === 'rechazada') cond.push('j.anulado_at IS NOT NULL');
  if (tipo && ES_TIPO_J.has(tipo)) cond.push(`j.tipo = ${p(tipo)}`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) cond.push(`j.dia_operativo >= ${p(desde)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) cond.push(`j.dia_operativo <= ${p(hasta)}::date`);

  const r = await db.consulta(
    `SELECT j.id, j.conductor_id, j.dia_operativo::text AS dia, j.tipo,
            j.horas_seg_momento, j.observacion, j.creado_at,
            j.aprobado_at, j.anulado_at, j.anulado_motivo,
            COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS conductor,
            COALESCE(uc.nombre, '')  AS puesta_por,
            COALESCE(ua.nombre, '')  AS aprobada_por,
            COALESCE(un.nombre, '')  AS rechazada_por
       FROM justificante j
       JOIN conductor c ON c.id = j.conductor_id
       LEFT JOIN usuario uc ON uc.id = j.usuario_id
       LEFT JOIN usuario ua ON ua.id = j.aprobado_por
       LEFT JOIN usuario un ON un.id = j.anulado_por
      WHERE ${cond.join(' AND ')}
      ORDER BY j.dia_operativo, j.creado_at
      LIMIT ${Math.min(Number(limite) || 300, 1000)}`, args);

  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), conductor: x.conductor,
    dia: x.dia, tipo: x.tipo,
    horas: x.horas_seg_momento != null ? Math.round(x.horas_seg_momento / 360) / 10 : null,
    observacion: x.observacion || '',
    puestaPor: x.puesta_por, creadoAt: x.creado_at,
    aprobadaPor: x.aprobada_por, aprobadoAt: x.aprobado_at,
    rechazadaPor: x.rechazada_por, anuladoAt: x.anulado_at, anuladoMotivo: x.anulado_motivo || '',
    estado: x.anulado_at ? 'rechazada' : (x.aprobado_at ? 'aprobada' : 'pendiente'),
  }));
}

/** Cuántas pendientes hay de cada tipo, para las pestañas del módulo. */
async function pendientesPorTipo() {
  const r = await db.consulta(
    `SELECT tipo, count(*)::int n FROM justificante
      WHERE aprobado_at IS NULL AND anulado_at IS NULL GROUP BY 1`);
  const m = {};
  TIPOS_J.forEach(t => { m[t.codigo] = 0; });
  r.rows.forEach(x => { m[x.tipo] = x.n; });
  return m;
}

/** Aprueba una J pendiente. Idempotente no: dos aprobaciones son un error. */
async function aprobar(id, { usuarioId } = {}) {
  const r = await db.consulta(
    `UPDATE justificante SET aprobado_at = now(), aprobado_por = $2
      WHERE id = $1 AND aprobado_at IS NULL AND anulado_at IS NULL
      RETURNING id`, [Number(id), usuarioId || null]);
  if (!r.rows.length) throw new Error('Esa J no está pendiente (ya se aprobó, se rechazó, o no existe)');
  return { ok: true, id: String(id) };
}

/**
 * Rechaza una J: la ANULA con quién y por qué. Reusa el circuito de anular de
 * siempre (quita la marca de la bitácora), así que rechazar deja el día como
 * si la J no hubiera existido — que es lo que significa rechazarla.
 */
async function rechazar(id, { usuarioId, motivo } = {}) {
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('El motivo del rechazo es obligatorio: el que la puso tiene que saber por qué');
  return db.transaccion(async cli => {
    const r = await cli.query(
      `UPDATE justificante SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
        WHERE id = $1 AND anulado_at IS NULL
        RETURNING id, conductor_id, dia_operativo`, [Number(id), usuarioId || null, motivo]);
    if (!r.rows.length) throw new Error('Esa J ya está anulada o no existe');
    const j = r.rows[0];
    await cli.query(
      `DELETE FROM bitacora_dia
        WHERE conductor_id = $1 AND dia_operativo = $2 AND justificante_id = $3 AND marca = 'J'`,
      [j.conductor_id, j.dia_operativo, j.id]);
    return { ok: true, id: String(j.id) };
  });
}

module.exports = {
  guardarPorId, anularPorId, leerPorFecha, TIPOS_J,
  listar, pendientesPorTipo, aprobar, rechazar,
};
