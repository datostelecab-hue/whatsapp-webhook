// ============================================================
// LA −J — constancia de un perjuicio a la empresa (db/227)
// ============================================================
// Camilo, 30/10/2026: «Alex no le da el coche temprano a Carlos, Carlos sale
// tarde por culpa de Alex: le dejamos una −J a Alex por perjuicio a la empresa».
//
//   · SOLO CONSTANCIA. No toca horas, ni nómina, ni la letra. Quitar sueldo
//     como castigo sería una multa de haber (Estatuto de los Trabajadores,
//     art. 58.3), y eso no lo hace el sistema.
//   · NACE PENDIENTE y la aprueba un área en /justificantes, como una J. Hasta
//     entonces no cuenta; rechazada, se queda con quién y por qué.
//   · Motivo obligatorio. El compañero perjudicado y el tiempo, opcionales.
//   · Se pone desde la Bitácora, desde Control y desde la J «Por compañero» del
//     perjudicado (`justificanteId`): todas pasan por `poner`.
//
// Vive en services/repo por lo mismo que las J: la leen la Bitácora, Control y
// /justificantes, y un repositorio de módulo no puede entrar en otro.

const db = require('../db');
// Todo lo que escribe una −J se FIRMA en su transacción y la base lo apunta en
// el libro de auditoría (db/228), como las J.
const { firmar } = require('./auditoriaJ');

// LAS CASUÍSTICAS (clusters). Por ahora una. Un cluster nuevo es una línea aquí
// y su valor en el CHECK de la tabla (ck_menosj_casuistica).
const CASUISTICAS = [
  { codigo: 'perjuicio_empresa', etiqueta: 'Perjuicios a la empresa' },
];
const ES_CASUISTICA = new Set(CASUISTICAS.map(c => c.codigo));
const ORIGENES = new Set(['bitacora', 'control', 'justificante']);

// Quien guarda copia (la rejilla de la Bitácora) se entera de que cambian.
const alCambiar = new Set();
const avisarCambios = fn => { alCambiar.add(fn); };
function cambiaron() {
  alCambiar.forEach(fn => {
    try { fn(); } catch (e) { console.error('⚠️ [−J] aviso de cambio:', e.message); }
  });
}

const entero = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
// Lo que llega de un <select> de la casa puede ser el objeto de `opciones`.
const valorDe = x => (x && typeof x === 'object' ? x.valor : x);

/**
 * Pone una −J. Devuelve { ok, id }.
 *   conductorId    quien la recibe (el que causó el perjuicio)
 *   dia            'AAAA-MM-DD'
 *   casuistica     de CASUISTICAS (por defecto, la única)
 *   motivo         obligatorio
 *   companeroId    el perjudicado, opcional
 *   horas          lo que costó, en horas decimales ('1.5'), opcional
 *   justificanteId la J del perjudicado de la que nace, opcional
 */
async function poner({ conductorId, dia, casuistica, motivo, companeroId, horas, justificanteId, origen, pantalla, usuarioId }) {
  const cid = entero(conductorId);
  if (!cid) throw new Error('Falta a quién se le pone la −J');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia || ''))) throw new Error('Falta el día (AAAA-MM-DD)');
  casuistica = String(valorDe(casuistica) || CASUISTICAS[0].codigo).trim();
  if (!ES_CASUISTICA.has(casuistica)) throw new Error('Esa casuística no existe');
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('El motivo es obligatorio: es lo que leerá quien la apruebe');
  const comp = entero(valorDe(companeroId));
  if (comp && comp === cid) throw new Error('El perjudicado no puede ser la misma persona que recibe la −J');
  let minutos = null;
  if (horas != null && String(horas).trim() !== '') {
    const h = Number(String(horas).trim().replace(',', '.'));
    if (!Number.isFinite(h) || h < 0 || h > 24) throw new Error('El tiempo va de 0 a 24 h');
    minutos = Math.round(h * 60) || null;
  }
  origen = ORIGENES.has(origen) ? origen : 'bitacora';

  const r = await db.transaccion(async cli => {
    // `origen` es de dónde nace (de una J o no); la pantalla es desde dónde se puso.
    await firmar(cli, { usuarioId, origen: pantalla || origen, accion: 'poner' });
    return cli.query(
      `INSERT INTO menos_j (conductor_id, dia_operativo, casuistica, motivo, companero_id,
                            minutos, justificante_id, origen, usuario_id)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [cid, dia, casuistica, motivo.slice(0, 500), comp, minutos, entero(justificanteId), origen, entero(usuarioId)]);
  });
  cambiaron();
  return { ok: true, id: String(r.rows[0].id) };
}

const NOMBRE = alias => `COALESCE(NULLIF(btrim(${alias}.nombre_bolt), ''), btrim(${alias}.nombre || ' ' || COALESCE(${alias}.apellidos, '')))`;
const ESTADO = `CASE WHEN m.anulado_at IS NOT NULL THEN 'rechazada'
                     WHEN m.aprobado_at IS NOT NULL THEN 'aprobada' ELSE 'pendiente' END`;

function fila(x) {
  return {
    id: String(x.id), conductorId: String(x.conductor_id), conductor: x.conductor || '',
    dia: x.dia, casuistica: x.casuistica,
    etiqueta: (CASUISTICAS.find(c => c.codigo === x.casuistica) || {}).etiqueta || x.casuistica,
    motivo: x.motivo || '',
    companeroId: x.companero_id ? String(x.companero_id) : null, companero: x.companero || '',
    minutos: x.minutos != null ? Number(x.minutos) : null,
    justificanteId: x.justificante_id ? String(x.justificante_id) : null,
    origen: x.origen, estado: x.estado,
    puestaPor: x.puesta_por || '', creadoAt: x.creado_at,
    aprobadaPor: x.aprobada_por || '', aprobadoAt: x.aprobado_at,
    rechazadaPor: x.rechazada_por || '', anuladoAt: x.anulado_at, anuladoMotivo: x.anulado_motivo || '',
  };
}

const SELECT = `
  SELECT m.id, m.conductor_id, to_char(m.dia_operativo, 'YYYY-MM-DD') AS dia, m.casuistica,
         m.motivo, m.companero_id, m.minutos, m.justificante_id, m.origen, m.creado_at,
         m.aprobado_at, m.anulado_at, m.anulado_motivo,
         ${ESTADO} AS estado,
         ${NOMBRE('c')} AS conductor, ${NOMBRE('cp')} AS companero,
         COALESCE(uc.nombre, '') AS puesta_por,
         COALESCE(ua.nombre, '') AS aprobada_por,
         COALESCE(un.nombre, '') AS rechazada_por
    FROM menos_j m
    JOIN conductor c        ON c.id  = m.conductor_id
    LEFT JOIN conductor cp  ON cp.id = m.companero_id
    LEFT JOIN usuario uc    ON uc.id = m.usuario_id
    LEFT JOIN usuario ua    ON ua.id = m.aprobado_por
    LEFT JOIN usuario un    ON un.id = m.anulado_por`;

/** La cola de /justificantes: por estado y fechas. Pendientes, la más vieja primero. */
async function listar({ estado = 'pendiente', desde, hasta, limite = 300 } = {}) {
  const cond = ['1=1'];
  const args = [];
  const p = v => { args.push(v); return '$' + args.length; };
  if (estado === 'pendiente') cond.push('m.aprobado_at IS NULL AND m.anulado_at IS NULL');
  else if (estado === 'aprobada') cond.push('m.aprobado_at IS NOT NULL AND m.anulado_at IS NULL');
  else if (estado === 'rechazada') cond.push('m.anulado_at IS NOT NULL');
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) cond.push(`m.dia_operativo >= ${p(desde)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) cond.push(`m.dia_operativo <= ${p(hasta)}::date`);
  const orden = estado === 'pendiente' ? 'ASC' : 'DESC';
  const r = await db.consulta(
    `${SELECT} WHERE ${cond.join(' AND ')}
      ORDER BY m.dia_operativo ${orden}, m.creado_at ${orden}
      LIMIT ${Math.min(Number(limite) || 300, 1000)}`, args);
  return r.rows.map(fila);
}

/** Las cuentas de las tres pestañas, como las de las J. */
async function cuentas({ desde, hasta } = {}) {
  const cond = ['1=1'];
  const args = [];
  const p = v => { args.push(v); return '$' + args.length; };
  if (/^\d{4}-\d{2}-\d{2}$/.test(desde || '')) cond.push(`dia_operativo >= ${p(desde)}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) cond.push(`dia_operativo <= ${p(hasta)}::date`);
  const r = await db.consulta(
    `SELECT count(*) FILTER (WHERE aprobado_at IS NULL AND anulado_at IS NULL)::int     AS pendiente,
            count(*) FILTER (WHERE aprobado_at IS NOT NULL AND anulado_at IS NULL)::int AS aprobada,
            count(*) FILTER (WHERE anulado_at IS NOT NULL)::int                         AS rechazada,
            COALESCE(sum(minutos) FILTER (WHERE aprobado_at IS NOT NULL AND anulado_at IS NULL), 0)::int AS min_aprobados,
            COALESCE(sum(minutos) FILTER (WHERE aprobado_at IS NULL AND anulado_at IS NULL), 0)::int     AS min_pendientes
       FROM menos_j WHERE ${cond.join(' AND ')}`, args);
  const x = r.rows[0];
  return { pendiente: x.pendiente, aprobada: x.aprobada, rechazada: x.rechazada, abiertas: 0,
    minutosAprobados: x.min_aprobados, minutosPendientes: x.min_pendientes };
}

/** Cuántas pendientes hay: el contador de su pestaña. */
async function pendientes() {
  const r = await db.consulta(
    'SELECT count(*)::int n FROM menos_j WHERE aprobado_at IS NULL AND anulado_at IS NULL');
  return r.rows[0].n;
}

async function aprobar(id, { usuarioId } = {}) {
  const r = await db.transaccion(async cli => {
    await firmar(cli, { usuarioId, origen: 'justificantes', accion: 'aprobar' });
    return cli.query(
      `UPDATE menos_j SET aprobado_at = now(), aprobado_por = $2
        WHERE id = $1 AND aprobado_at IS NULL AND anulado_at IS NULL RETURNING id`,
      [Number(id), entero(usuarioId)]);
  });
  if (!r.rows.length) throw new Error('Esa −J no está pendiente (ya se aprobó, se rechazó, o no existe)');
  cambiaron();
  return { ok: true, id: String(id) };
}

/** Rechazarla: se queda en el libro, con quién y por qué. No cuenta. */
async function rechazar(id, { usuarioId, motivo } = {}) {
  motivo = String(motivo || '').trim();
  if (!motivo) throw new Error('El motivo del rechazo es obligatorio: el que la puso tiene que saber por qué');
  const r = await db.transaccion(async cli => {
    await firmar(cli, { usuarioId, origen: 'justificantes', accion: 'rechazar' });
    return cli.query(
      `UPDATE menos_j SET anulado_at = now(), anulado_por = $2, anulado_motivo = $3
        WHERE id = $1 AND anulado_at IS NULL RETURNING id`,
      [Number(id), entero(usuarioId), motivo.slice(0, 500)]);
  });
  if (!r.rows.length) throw new Error('Esa −J ya está rechazada o no existe');
  cambiaron();
  return { ok: true, id: String(id) };
}

/**
 * Las −J de un rango, por conductor y día, para la rejilla de la Bitácora:
 * { conductorId: { 'AAAA-MM-DD': [fila…] } }. Van las tres —aprobadas,
 * pendientes y rechazadas— y la pantalla decide qué pinta.
 */
async function porConductorYDia(desde, hasta) {
  const r = await db.consulta(
    `${SELECT} WHERE m.dia_operativo BETWEEN $1::date AND $2::date ORDER BY m.creado_at`, [desde, hasta]);
  const out = {};
  r.rows.forEach(x => {
    const f = fila(x);
    ((out[f.conductorId] = out[f.conductorId] || {})[f.dia] = out[f.conductorId][f.dia] || []).push(f);
  });
  return out;
}

/** Las J que ya llevan su −J viva: para no ofrecerla dos veces. */
async function deJustificantes(ids) {
  const lista = (ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (!lista.length) return new Set();
  const r = await db.consulta(
    `SELECT DISTINCT justificante_id FROM menos_j
      WHERE justificante_id = ANY($1::bigint[]) AND anulado_at IS NULL`, [lista]);
  return new Set(r.rows.map(x => String(x.justificante_id)));
}

/**
 * A quién se le puede poner o quién puede ser el perjudicado: la plantilla con
 * contrato abierto, por nombre. Para el selector de las pantallas que no tienen
 * ya la lista (Control y /justificantes; la Bitácora usa la suya).
 */
async function personas() {
  const r = await db.consulta(
    `SELECT c.id, ${NOMBRE('c')} AS nombre
       FROM conductor c
      WHERE EXISTS (SELECT 1 FROM conductor_periodo_empleo p
                     WHERE p.conductor_id = c.id AND p.alta <= CURRENT_DATE
                       AND (p.baja IS NULL OR p.baja >= CURRENT_DATE))
      ORDER BY 2`);
  return r.rows.map(x => ({ id: String(x.id), nombre: x.nombre }));
}

module.exports = {
  CASUISTICAS, avisarCambios,
  poner, listar, cuentas, pendientes, aprobar, rechazar,
  porConductorYDia, deJustificantes, personas,
};
