// ============================================================
// LAS JUSTIFICACIONES DE KM — los km fuera de BOLT que no cuentan (db/268)
// ============================================================
// Camilo, 18/11/2026: «Hay que implementar en las justificaciones de horas,
// también justificaciones de KM, para que se le agreguen al banco de KM… si
// tengo 50 km por fuera pero con 28 justificados desde Control y justificados
// por William o Ángel, que serán los que tengan la llave, entonces hice 22 km
// por fuera».
//
//   · NACE PENDIENTE: la apunta Control (desde la ficha del banco de KM o desde
//     /justificantes) y no resta nada hasta que la aprueba quien tiene la llave
//     «/justificantes/km». Como una J (Camilo: «Control la apunta, ellos la
//     aprueban»).
//   · APROBADA: resta de los km fuera de BOLT de ese conductor ese día (nunca
//     por debajo de cero). No toca el límite: va «por fuera del límite y de los
//     km generados».
//   · RECHAZADA (o anulada después de aprobarla): se queda con quién y por qué.
//   · Motivo obligatorio.
//
// Vive en services/repo, como la −J, porque la leen dos módulos: el banco de
// KM (Operaciones) y /justificantes (Control).
'use strict';

const db = require('../db');
// La firma del libro de auditoría, a nivel de repositorio (como la −J con la
// suya): un repositorio no llama a un servicio.
const { firmar } = require('./libro');

/** Abre una transacción firmada y ejecuta `fn(cli)` dentro. */
const conFirma = ({ usuarioId, origen, accion, motivo }, fn) => db.transaccion(async cli => {
  const n = entero(usuarioId);
  await firmar(cli, { usuarioId: n ? String(n) : '', origen: String(origen || '').slice(0, 60), accion: accion || '', motivo: String(motivo || '').slice(0, 2000) });
  return fn(cli);
});

const CLAVE_APROBAR = '/justificantes/km';
const ORIGEN = 'justificantes';
const entero = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const n1 = v => Math.round((Number(v) || 0) * 10) / 10;
function error(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// Quien guarda copia (el banco de KM) se entera de que cambian.
const alCambiar = new Set();
const avisarCambios = fn => { alCambiar.add(fn); };
const cambiaron = () => alCambiar.forEach(fn => { try { fn(); } catch (e) { console.error('⚠️ [KM justificados] aviso:', e.message); } });

const SELECT = `
  SELECT k.id, k.conductor_id, to_char(k.dia, 'YYYY-MM-DD') AS dia, k.km, k.matricula, k.motivo, k.origen,
         k.creado_at, k.aprobado_at, k.anulado_at, k.anulado_motivo,
         COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || COALESCE(' ' || c.apellidos, ''))) AS conductor,
         btrim(uc.nombre || COALESCE(' ' || uc.apellidos, '')) AS puesta_por,
         btrim(ua.nombre || COALESCE(' ' || ua.apellidos, '')) AS aprobada_por,
         btrim(un.nombre || COALESCE(' ' || un.apellidos, '')) AS anulada_por
    FROM km_justificacion k
    JOIN conductor c ON c.id = k.conductor_id
    LEFT JOIN usuario uc ON uc.id = k.creado_por
    LEFT JOIN usuario ua ON ua.id = k.aprobado_por
    LEFT JOIN usuario un ON un.id = k.anulado_por`;

const estadoDe = x => (x.anulado_at ? 'rechazada' : x.aprobado_at ? 'aprobada' : 'pendiente');
const fila = x => ({
  id: String(x.id), conductorId: Number(x.conductor_id), conductor: x.conductor, dia: x.dia, km: n1(x.km),
  matricula: x.matricula || null, motivo: x.motivo, origen: x.origen, estado: estadoDe(x),
  creadoAt: x.creado_at, puestaPor: x.puesta_por || null,
  aprobadoAt: x.aprobado_at, aprobadaPor: x.aprobada_por || null,
  anuladoAt: x.anulado_at, rechazadaPor: x.anulada_por || null, anuladoMotivo: x.anulado_motivo || null,
});

/**
 * Apunta una justificación de KM. Devuelve { ok, id }.
 *   conductorId, dia ('AAAA-MM-DD'), km (> 0), motivo; matricula opcional.
 */
async function poner({ conductorId, dia, km, matricula, motivo, origen = 'banco_km', usuarioId }) {
  const cid = entero(conductorId);
  if (!cid) throw error('Falta de qué conductor son los km');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) || Number.isNaN(Date.parse(dia))) throw error('Falta el día (AAAA-MM-DD)');
  const k = Number(String(km == null ? '' : km).replace(/\s|km/gi, '').replace(',', '.'));
  if (!(k > 0)) throw error('Los km justificados tienen que ser más que cero');
  if (k > 1000) throw error('¿Más de 1.000 km en un día? Revisa la cifra');
  const m = String(motivo || '').trim();
  if (m.length < 3) throw error('Di por qué se justifican: el que lo aprueba tiene que saberlo');
  const mat = String(matricula || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || null;
  const id = await conFirma({ usuarioId, origen: origen === 'justificantes' ? 'justificantes' : 'banco_km', accion: 'alta', motivo: 'Justificación de KM' }, async cli => {
    const r = await cli.query(
      `INSERT INTO km_justificacion (conductor_id, dia, km, matricula, motivo, origen, creado_por)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7) RETURNING id`,
      [cid, dia, Math.round(k * 10) / 10, mat, m.slice(0, 1000), origen === 'justificantes' ? 'justificantes' : 'banco_km', entero(usuarioId)]);
    return String(r.rows[0].id);
  });
  cambiaron();
  return { ok: true, id };
}

/** La cola, por estado y rango de días. */
async function listar({ estado = 'pendiente', desde, hasta, limite = 300 } = {}) {
  const cond = [], params = [];
  if (estado === 'pendiente') cond.push('k.aprobado_at IS NULL AND k.anulado_at IS NULL');
  else if (estado === 'aprobada') cond.push('k.aprobado_at IS NOT NULL AND k.anulado_at IS NULL');
  else if (estado === 'rechazada') cond.push('k.anulado_at IS NOT NULL');
  if (desde) { params.push(desde); cond.push(`k.dia >= $${params.length}::date`); }
  if (hasta) { params.push(hasta); cond.push(`k.dia <= $${params.length}::date`); }
  params.push(Math.min(1000, Number(limite) || 300));
  const r = await db.consulta(`${SELECT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
    ORDER BY k.dia DESC, k.creado_at DESC LIMIT $${params.length}`, params);
  return r.rows.map(fila);
}

/** Cuántas por estado y cuántos km, en un rango (las pestañas de /justificantes). */
async function cuentas({ desde, hasta } = {}) {
  const r = await db.consulta(
    `SELECT count(*) FILTER (WHERE aprobado_at IS NULL AND anulado_at IS NULL)::int AS pendiente,
            count(*) FILTER (WHERE aprobado_at IS NOT NULL AND anulado_at IS NULL)::int AS aprobada,
            count(*) FILTER (WHERE anulado_at IS NOT NULL)::int AS rechazada,
            COALESCE(sum(km) FILTER (WHERE aprobado_at IS NOT NULL AND anulado_at IS NULL), 0) AS km_aprobados,
            COALESCE(sum(km) FILTER (WHERE aprobado_at IS NULL AND anulado_at IS NULL), 0) AS km_pendientes
       FROM km_justificacion
      WHERE ($1::date IS NULL OR dia >= $1::date) AND ($2::date IS NULL OR dia <= $2::date)`, [desde || null, hasta || null]);
  const x = r.rows[0];
  return { pendiente: x.pendiente, aprobada: x.aprobada, rechazada: x.rechazada, kmAprobados: n1(x.km_aprobados), kmPendientes: n1(x.km_pendientes) };
}

/** Cuántas esperan aprobación. */
async function pendientes() {
  const r = await db.consulta('SELECT count(*)::int AS n FROM km_justificacion WHERE aprobado_at IS NULL AND anulado_at IS NULL');
  return r.rows[0].n;
}

/** Las de unos días (no rechazadas), por conductor y día: Map('id|dia' → { aprobados, pendientes, lista }). */
async function porConductorYDia(desde, hasta) {
  const r = await db.consulta(`${SELECT} WHERE k.dia BETWEEN $1::date AND $2::date AND k.anulado_at IS NULL ORDER BY k.creado_at`, [desde, hasta]);
  const m = new Map();
  r.rows.map(fila).forEach(f => {
    const k = `${f.conductorId}|${f.dia}`;
    const x = m.get(k) || { aprobados: 0, pendientes: 0, lista: [] };
    if (f.estado === 'aprobada') x.aprobados = n1(x.aprobados + f.km); else x.pendientes = n1(x.pendientes + f.km);
    x.lista.push(f);
    m.set(k, x);
  });
  return m;
}

/** Aprobarla: desde ahora resta. Lo comprueba quien llama (la llave). */
async function aprobar(id, { usuarioId } = {}) {
  const r = await conFirma({ usuarioId, origen: ORIGEN, accion: 'aprobar', motivo: 'Justificación de KM aprobada' }, cli => cli.query(
    `UPDATE km_justificacion SET aprobado_at = now(), aprobado_por = $2
      WHERE id = $1 AND aprobado_at IS NULL AND anulado_at IS NULL RETURNING id`, [Number(id), entero(usuarioId)]));
  if (!r.rows.length) throw error('Esa justificación no está pendiente (ya se aprobó, se rechazó, o no existe)', 409);
  cambiaron();
  return { ok: true, id: String(id) };
}

/** Rechazarla (o anularla después de aprobarla): con quién y por qué. Deja de restar. */
async function rechazar(id, { usuarioId, motivo } = {}) {
  const m = String(motivo || '').trim();
  if (!m) throw error('El motivo del rechazo es obligatorio: el que la puso tiene que saber por qué');
  const r = await conFirma({ usuarioId, origen: ORIGEN, accion: 'rechazar', motivo: m.slice(0, 300) }, cli => cli.query(
    `UPDATE km_justificacion SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
      WHERE id = $1 AND anulado_at IS NULL RETURNING id`, [Number(id), entero(usuarioId), m.slice(0, 500)]));
  if (!r.rows.length) throw error('Esa justificación ya está rechazada o no existe', 409);
  cambiaron();
  return { ok: true, id: String(id) };
}

const faltaMigracion = e => e && (e.code === '42P01' || /km_justificacion/.test(String(e.message || '')));

module.exports = {
  CLAVE_APROBAR, poner, listar, cuentas, pendientes, porConductorYDia, aprobar, rechazar, avisarCambios, faltaMigracion,
};
