// ============================================================
// INCORPORACIONES — la alerta que no se va hasta aceptarla o rechazarla
// ============================================================
// Cuando alguien se da de alta CON UNA VACANTE elegida (alta rápida o
// contratación de la ETT), nace aquí una alerta 'pendiente' con la FOTO de la
// vacante (puesto, turno, matrículas y días). Tráfico la ve en el planificador
// y en Pendientes, y solo hay dos salidas:
//
//   · ACEPTAR  → auto-asignación a las plazas de la vacante en el planificador
//                de PostgreSQL (plan.guardar, todo o nada: si una matrícula no
//                tiene plaza libre, no se escribe nada y la alerta se queda).
//                La vacante de la hoja se CIERRA.
//   · RECHAZAR → el conductor queda en el banquillo para colocarlo a mano y la
//                vacante VUELVE a Abierta (nunca se colocó a nadie).
//
// Esto sustituye al módulo /incorporaciones, que escribía en el planificador de
// HOJAS (muerto desde la migración) y cuya alerta se podía perder de vista.

const db = require('../db');
const plan = require('./planificador');

const LETRAS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const norm = s => String(s == null ? '' : s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Crea la alerta al dar de alta con vacante. Toma la foto de la vacante de la
 * hoja y la marca "En proceso de alta" para que Selección deje de ofrecerla.
 * Sin vacanteId no hace nada (el alta sin vacante sigue siendo normal).
 */
async function crear({ conductorId, vacanteId, origen = 'ett', usuarioId } = {}) {
  const vId = String(vacanteId || '').trim();
  const cid = Number(conductorId);
  if (!vId || !Number.isInteger(cid) || cid <= 0) return null;

  const vacantes = require('../vacantes');
  const v = (await vacantes.leerVacantesGuardadas()).find(x => x.id === vId);
  if (!v) throw new Error(`No existe la vacante ${vId}`);
  if (!vacantes.vacanteDisponible(v)) throw new Error(`La vacante ${vId} ya está ${v.estado}`);

  const detalle = {
    puesto: v.puesto || '', turno: v.turno || 'Día', zonas: v.zonas || '',
    libranzas: v.libranzas || '', objetivo: v.objetivo || v.dias || '',
    matriculas: (v.matriculas || []).map(m => ({
      m: m.m, zona: m.zona || '', d: (m.d || []).slice(),
      letras: m.letras || (m.d || []).map(d => LETRAS[d]).join(''),
    })),
  };
  const r = await db.consulta(
    `INSERT INTO incorporacion (conductor_id, vacante_id, origen, detalle, usuario_alta)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [cid, vId, origen, JSON.stringify(detalle), usuarioId || null]);
  try { await vacantes.actualizarEstadoVacante(vId, 'En proceso de alta'); } catch (_) {}
  return { id: String(r.rows[0].id), vacanteId: vId };
}

/** Las alertas pendientes, con el conductor con nombre de BOLT y teléfono. */
async function pendientes() {
  const r = await db.consulta(
    `SELECT i.id, i.conductor_id, i.vacante_id, i.origen, i.detalle, i.creado_at,
            COALESCE(ext.externo_nombre,
                     NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), ''),
                     '#' || c.id::text) AS nombre,
            tel.e164 AS telefono,
            e.alta::text AS alta
       FROM incorporacion i
       JOIN conductor c ON c.id = i.conductor_id
       LEFT JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
       LEFT JOIN LATERAL (
         SELECT externo_nombre FROM conductor_externo
          WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
          ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE i.estado = 'pendiente'
      ORDER BY i.creado_at`);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), nombre: x.nombre,
    telefono: x.telefono || '', alta: x.alta || '', vacanteId: x.vacante_id || '',
    origen: x.origen, detalle: x.detalle || {}, creadoAt: x.creado_at,
  }));
}

async function viva(id) {
  const r = await db.consulta(
    `SELECT id, conductor_id, vacante_id, detalle FROM incorporacion
      WHERE id = $1 AND estado = 'pendiente'`, [Number(id)]);
  if (!r.rows.length) throw new Error('Esa incorporación ya no está pendiente');
  return r.rows[0];
}

/**
 * ACEPTAR: coloca al conductor en las plazas de la vacante, en el planificador
 * de PostgreSQL. Todo o nada: si una matrícula no está o no tiene plaza libre,
 * se lanza el motivo, no se escribe nada y la alerta SIGUE pendiente.
 */
async function aceptar(id, { usuarioId } = {}) {
  const inc = await viva(id);
  const det = inc.detalle || {};
  const rol = /^\s*CT/i.test(det.puesto || '') ? 'CT' : 'FIJO';
  const turno = det.turno === 'Noche' ? 'Noche' : 'Día';

  const tab = await plan.tablero({});
  const cambios = [];
  const usadas = new Set();
  for (const m of (det.matriculas || [])) {
    const coche = (tab.coches || []).find(c => norm(c.matricula) === norm(m.m));
    if (!coche) throw new Error(`La matrícula ${m.m} no está en el planificador`);
    const p = (coche.personas || []).find(x =>
      x.rol === rol && x.turno === turno && !x.id && x.plazaId && !usadas.has(x.plazaId));
    if (!p) throw new Error(`No hay plaza libre de ${rol === 'CT' ? 'correturno' : 'fijo'} ${turno} en ${m.m}`);
    usadas.add(p.plazaId);
    const slot = { plazaId: p.plazaId, id: String(inc.conductor_id) };
    if (rol === 'CT' && Array.isArray(m.d) && m.d.length) slot.dias = m.d.map(d => LETRAS[d]).join(' ');
    cambios.push({ vehiculoId: coche.vehiculoId, slots: [slot] });
  }
  if (!cambios.length) throw new Error('La vacante no trae matrículas');

  await plan.guardar(cambios, { usuarioId });
  await db.consulta(
    `UPDATE incorporacion SET estado = 'aceptada', usuario_res = $2, resuelto_at = now()
      WHERE id = $1 AND estado = 'pendiente'`, [inc.id, usuarioId || null]);
  if (inc.vacante_id) {
    try { await require('../vacantes').actualizarEstadoVacante(inc.vacante_id, 'Cerrada'); } catch (_) {}
  }
  return { ok: true, plazas: cambios.length };
}

/**
 * RECHAZAR: el conductor queda en el banquillo para colocarlo a mano y la
 * vacante vuelve a Abierta (a esa vacante no llegó a entrar nadie).
 */
async function rechazar(id, { usuarioId, motivo } = {}) {
  const inc = await viva(id);
  await db.consulta(
    `UPDATE incorporacion SET estado = 'rechazada', motivo_rechazo = $2,
            usuario_res = $3, resuelto_at = now()
      WHERE id = $1 AND estado = 'pendiente'`,
    [inc.id, String(motivo || '').trim().slice(0, 300) || null, usuarioId || null]);
  if (inc.vacante_id) {
    try { await require('../vacantes').actualizarEstadoVacante(inc.vacante_id, 'Abierta'); } catch (_) {}
  }
  return { ok: true };
}

module.exports = { crear, pendientes, aceptar, rechazar };
