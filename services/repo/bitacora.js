// ============================================================
// BITÁCORA — sobre PostgreSQL (sustituye a la hoja VISTA_FINAL)
// ============================================================
// Ensambla, por conductor y día, la MARCA del día y las HORAS trabajadas, leyendo
// TODO de PostgreSQL — cero hojas. La clave es SIEMPRE `conductor_id` (nunca el
// nombre), así que no hay cruce por texto que se rompa con una tilde.
//
//   · Horas          → registro_jornada.efectivo_total_min (el parte diario del art. 18.9).
//   · Ausencias V/B/P → conductor_estado_hist + cat_estado_conductor.marca_bitacora.
//   · Justificado J   → justificante vivo (anulado_at IS NULL).
//   · Libranza L      → PENDIENTE: sale de la cobertura del planificador (f_cobertura /
//                       vehiculo_descanso). Se añade en el siguiente paso.
//
// Devuelve EXACTAMENTE la misma forma que la versión de hoja (services/bitacora.js),
// para que la vista /bitacora no cambie ni una línea:
//   { conductores: [{ id, estado, turno, dias:[ <horas|'V'|'B'|'P'|'J'|null> ] }], hoyIdx, inicio }

const db = require('../db');

// El origen de la rejilla, igual que la hoja: 1 jun 2026 (mes 0-based: 5 = junio).
const INICIO = { y: 2026, m: 5, d: 1 };
const MS_DIA = 86400000;
const INICIO_MS = Date.UTC(INICIO.y, INICIO.m, INICIO.d);
const INICIO_ISO = `${INICIO.y}-${String(INICIO.m + 1).padStart(2, '0')}-${String(INICIO.d).padStart(2, '0')}`;

// 'AAAA-MM-DD' → índice de día desde INICIO (0 = 1 jun 2026). En UTC a propósito,
// para que no dependa de la zona de quien ejecuta.
function idxDe(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - INICIO_MS) / MS_DIA);
}

// Hoy en Madrid, 'AAAA-MM-DD'. Marca hasta dónde llega la rejilla (el futuro va vacío).
function hoyMadridIso() {
  return new Intl.DateTimeFormat('en-CA',
    { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function leerBitacora() {
  const hoyIso = hoyMadridIso();
  const hoyIdx = idxDe(hoyIso);
  const nDias = Math.max(0, hoyIdx + 1);

  // Las fechas se piden como TEXTO ('YYYY-MM-DD') a propósito: node-postgres
  // devuelve las columnas DATE como Date en zona local, y eso desplaza un día según
  // el reloj. Con to_char nos quitamos de encima toda la ambigüedad de zona.
  const [roster, ausencias, justis, horas] = await Promise.all([
    db.consulta(
      `SELECT conductor_id, nombre_apellidos AS nombre, turno, estado
         FROM v_agenda ORDER BY nombre_apellidos`),
    db.consulta(
      `SELECT h.conductor_id, ce.marca_bitacora AS marca,
              to_char(GREATEST(h.desde, $1::date), 'YYYY-MM-DD')             AS desde,
              to_char(LEAST(COALESCE(h.hasta, $2::date), $2::date), 'YYYY-MM-DD') AS hasta
         FROM conductor_estado_hist h
         JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE ce.es_ausencia AND ce.marca_bitacora IS NOT NULL
          AND h.desde <= $2::date AND COALESCE(h.hasta, $2::date) >= $1::date`,
      [INICIO_ISO, hoyIso]),
    db.consulta(
      `SELECT conductor_id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia
         FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date`,
      [INICIO_ISO, hoyIso]),
    db.consulta(
      `SELECT conductor_id, to_char(dia, 'YYYY-MM-DD') AS dia, efectivo_total_min AS min
         FROM registro_jornada
        WHERE dia BETWEEN $1::date AND $2::date AND efectivo_total_min > 0`,
      [INICIO_ISO, hoyIso]),
  ]);

  // Un array de días (todo a null) por conductor_id.
  const nuevos = () => new Array(nDias).fill(null);
  const porId = new Map();
  roster.rows.forEach(c => porId.set(Number(c.conductor_id), {
    id: c.nombre || `#${c.conductor_id}`, estado: c.estado || '', turno: c.turno || '', dias: nuevos(),
  }));
  // Alguien con horas/ausencia pero fuera del roster vigente (p.ej. baja reciente):
  // no se pierde, entra con lo mínimo.
  const diasDe = id => {
    id = Number(id);
    let c = porId.get(id);
    if (!c) { c = { id: `#${id}`, estado: '', turno: '', dias: nuevos() }; porId.set(id, c); }
    return c.dias;
  };

  // Orden de aplicación = prioridad de la celda: primero las horas (base), luego 'J'
  // (justificado pisa las horas), y por último la ausencia V/B/P (pisa a todo: si está
  // de vacaciones, la celda es 'V' aunque ese día fichara un rato).
  horas.rows.forEach(r => {
    const i = idxDe(r.dia);
    if (i >= 0 && i < nDias) diasDe(r.conductor_id)[i] = Math.round((Number(r.min) || 0) / 6) / 10;
  });
  justis.rows.forEach(r => {
    const i = idxDe(r.dia);
    if (i >= 0 && i < nDias) diasDe(r.conductor_id)[i] = 'J';
  });
  ausencias.rows.forEach(r => {
    const d = diasDe(r.conductor_id);
    const a = Math.max(0, idxDe(r.desde)), b = Math.min(nDias - 1, idxDe(r.hasta));
    for (let i = a; i <= b; i++) d[i] = r.marca;
  });

  const conductores = [...porId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id), 'es'));
  return { conductores, hoyIdx, inicio: INICIO };
}

module.exports = { leerBitacora, INICIO };
