// ============================================================
// BITÁCORA — el día a día de cada persona, sobre PostgreSQL
// ============================================================
// Ensambla, por conductor y día, la MARCA del día y las HORAS trabajadas, leyendo
// TODO de PostgreSQL. La clave es SIEMPRE `conductor_id` (nunca el nombre).
//
//   · Horas          → núcleo fv_tramo (la ingesta de BOLT): tiempo EFECTIVO (viaje +
//                       espera, s.efectivo) por día natural, fundiendo solapes. Puente
//                       por id: fv_conductor.uuid = driver_uuid = conductor_externo.externo_id.
//   · Ausencias V/B/P → conductor_estado_hist + cat_estado_conductor.marca_bitacora.
//   · Justificado J   → justificante vivo (anulado_at IS NULL), con sus horas y su nota.
//   · Libranza L      → asignado a plaza pero sin cubrir ese día (f_cobertura).
//
// QUIÉN SALE: TODA la plantilla, vigentes y de baja. Antes el listado salía de
// v_agenda, que solo tiene a los vigentes, y a las 74 personas que trabajaron y
// luego se fueron se les inventaba el nombre "#id". Ahora el listado es la dimensión
// de conductores (bi_dim_conductor): nombre de BOLT primero —la regla de la casa—,
// teléfono, contrato, zona, alta y baja. Quien tenga cuenta de BOLT pero ninguna
// ficha (huérfano) NO se pinta como persona: se cuenta y se avisa.
//
// Forma que devuelve (la vista depende de ella):
//   { conductores: [{ conductorId, id (nombre a mostrar), nombre, nombreBolt, telefono,
//                     tipo, zona, turno, vigente, alta, baja, altaIdx, bajaIdx, estado,
//                     ausente, dias: [ <horas|'V'|'B'|'P'|'J'|'L'|null> ],
//                     justif: { 'YYYY-MM-DD': { horas, obs } },
//                     ausencias: [{ marca, etiqueta, desde, hasta }] }],
//     hoyIdx, inicio, avisos: { sinFicha } }

const db = require('../db');

// El origen de la rejilla: 1 jun 2026 (mes 0-based: 5 = junio). 365 días.
const INICIO = { y: 2026, m: 5, d: 1 };
const MS_DIA = 86400000;
const INICIO_MS = Date.UTC(INICIO.y, INICIO.m, INICIO.d);
const INICIO_ISO = `${INICIO.y}-${String(INICIO.m + 1).padStart(2, '0')}-${String(INICIO.d).padStart(2, '0')}`;

// 'AAAA-MM-DD' → índice de día desde INICIO. En UTC a propósito: no depende de la
// zona de quien ejecuta.
function idxDe(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - INICIO_MS) / MS_DIA);
}

function hoyMadridIso() {
  return new Intl.DateTimeFormat('en-CA',
    { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function leerBitacora() {
  const hoyIso = hoyMadridIso();
  const hoyIdx = idxDe(hoyIso);
  const nDias = Math.max(0, hoyIdx + 1);

  // Las fechas se piden como TEXTO ('YYYY-MM-DD'): node-postgres devuelve DATE como
  // Date en zona local y eso desplaza un día según el reloj.
  const [roster, ausencias, justis, horas, libranzas] = await Promise.all([
    // TODA la plantilla, con el nombre de BOLT primero. La dimensión ya excluye a
    // los centinelas y resuelve contrato, zona, turno, teléfono y estado de hoy.
    db.consulta(
      `SELECT conductor_id,
              COALESCE(NULLIF(btrim(bolt_nombre), ''),
                       NULLIF(btrim(nombre), '') || ' (sin nombre de BOLT)',
                       'Conductor ' || conductor_id) AS mostrar,
              nombre, bolt_nombre, telefono, tipo_contrato, zona, turno,
              empleo_vigente, alta::text AS alta, baja::text AS baja,
              estado_etiqueta, ausente
         FROM bi_dim_conductor`),
    db.consulta(
      `SELECT h.conductor_id, ce.marca_bitacora AS marca, ce.etiqueta,
              to_char(GREATEST(h.desde, $1::date), 'YYYY-MM-DD')                    AS desde,
              to_char(LEAST(COALESCE(h.hasta, $2::date), $2::date), 'YYYY-MM-DD')   AS hasta,
              (h.hasta IS NULL)                                                    AS abierta
         FROM conductor_estado_hist h
         JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE ce.es_ausencia AND ce.marca_bitacora IS NOT NULL
          AND h.desde <= $2::date AND COALESCE(h.hasta, $2::date) >= $1::date`,
      [INICIO_ISO, hoyIso]),
    db.consulta(
      `SELECT conductor_id, to_char(dia_operativo, 'YYYY-MM-DD') AS dia,
              horas_seg_momento, observacion
         FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date`,
      [INICIO_ISO, hoyIso]),
    // Horas EFECTIVAS del núcleo: viaje + espera (s.efectivo). El descanso no es
    // trabajo. Se funden los solapes en JS. El día es el de la hora de inicio, Madrid.
    db.consulta(
      `SELECT ce.conductor_id,
              to_char((t.desde AT TIME ZONE 'Europe/Madrid')::date, 'YYYY-MM-DD') AS dia,
              t.desde, COALESCE(t.hasta, now()) AS hasta
         FROM fv_tramo t
         JOIN fv_cat_situacion s   ON s.codigo = t.situacion AND s.efectivo
         JOIN fv_conductor fc      ON fc.uuid = t.conductor_uuid
         JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = fc.uuid
        WHERE t.desde >= $1::date AND t.desde < ($2::date + 1)
        ORDER BY ce.conductor_id, t.desde`,
      [INICIO_ISO, hoyIso]),
    // Libranza 'L': asignado a una plaza ese día pero NO lo cubre (su coche descansa,
    // o es CT y no le toca) — la MISMA regla del planificador, f_cobertura.
    db.consulta(
      `WITH asignados AS (
         SELECT DISTINCT a.conductor_id, g.dia::date AS dia
           FROM generate_series($1::date, $2::date, interval '1 day') g(dia)
           JOIN asignacion a ON a.desde <= g.dia::date AND (a.hasta IS NULL OR a.hasta >= g.dia::date)
           JOIN plaza p ON p.id = a.plaza_id AND p.baja_at IS NULL
       ),
       cubren AS (SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date))
       SELECT a.conductor_id, to_char(a.dia, 'YYYY-MM-DD') AS dia
         FROM asignados a
        WHERE NOT EXISTS (SELECT 1 FROM cubren c WHERE c.conductor_id = a.conductor_id AND c.dia = a.dia)
          AND NOT EXISTS (
            SELECT 1 FROM conductor_estado_hist h
              JOIN cat_estado_conductor ce ON ce.codigo = h.estado
             WHERE h.conductor_id = a.conductor_id AND ce.es_ausencia
               AND h.desde <= a.dia AND (h.hasta IS NULL OR h.hasta >= a.dia))`,
      [INICIO_ISO, hoyIso]),
  ]);

  const nuevos = () => new Array(nDias).fill(null);
  const clamp = i => (i == null ? null : Math.max(0, Math.min(nDias - 1, i)));
  const porId = new Map();
  roster.rows.forEach(c => {
    const cid = Number(c.conductor_id);
    porId.set(cid, {
      conductorId: cid,
      id: c.mostrar,                                   // el nombre a mostrar (BOLT primero)
      nombre: c.nombre || '', nombreBolt: c.bolt_nombre || '',
      telefono: c.telefono || '', tipo: c.tipo_contrato || '', zona: c.zona || '', turno: c.turno || '',
      vigente: !!c.empleo_vigente, alta: c.alta || null, baja: c.baja || null,
      // Índices para que la pantalla no acuse "no salió" antes del alta ni tras la baja.
      altaIdx: c.alta ? Math.max(0, idxDe(c.alta)) : null,
      bajaIdx: c.baja ? clamp(idxDe(c.baja)) : null,
      estado: c.estado_etiqueta || '', ausente: !!c.ausente,
      dias: nuevos(), justif: {}, ausencias: [],
    });
  });

  // Quien trae datos pero no tiene ficha (cuenta de BOLT enlazada a un id que no
  // existe): no es una persona que se pueda pintar. Se cuenta y se avisa.
  const huerfanos = new Set();
  const basura = nuevos();
  const de = id => {
    const c = porId.get(Number(id));
    if (c) return c;
    huerfanos.add(Number(id));
    return { dias: basura, justif: {}, ausencias: [] };
  };

  // Orden de aplicación = prioridad de la celda (de menor a mayor): 'L' de base, luego
  // las horas (si trabajó su libranza, manda la hora), luego 'J' (pisa las horas), y al
  // final la ausencia V/B/P (pisa a todo: si está de vacaciones la celda es 'V' aunque
  // ese día fichara un rato).
  libranzas.rows.forEach(r => {
    const i = idxDe(r.dia);
    if (i >= 0 && i < nDias) de(r.conductor_id).dias[i] = 'L';
  });
  const porCondDia = new Map();
  horas.rows.forEach(r => {
    const cid = Number(r.conductor_id);
    if (!porCondDia.has(cid)) porCondDia.set(cid, new Map());
    const m = porCondDia.get(cid);
    if (!m.has(r.dia)) m.set(r.dia, []);
    m.get(r.dia).push([new Date(r.desde).getTime(), new Date(r.hasta).getTime()]);
  });
  porCondDia.forEach((diasMap, cid) => {
    const arr = de(cid).dias;
    diasMap.forEach((ivs, diaKey) => {
      const i = idxDe(diaKey);
      if (i < 0 || i >= nDias) return;
      ivs.sort((a, b) => a[0] - b[0]);
      let total = 0, ci = null, cf = null;
      for (const [s, e] of ivs) {
        if (e <= s) continue;
        if (cf === null || s > cf) { if (cf !== null) total += cf - ci; ci = s; cf = e; }
        else if (e > cf) cf = e;
      }
      if (cf !== null) total += cf - ci;
      arr[i] = Math.round((total / 60000) / 6) / 10;   // ms → h con 1 decimal
    });
  });
  justis.rows.forEach(r => {
    const c = de(r.conductor_id);
    const i = idxDe(r.dia);
    if (i >= 0 && i < nDias) c.dias[i] = 'J';
    c.justif[r.dia] = {
      horas: r.horas_seg_momento != null ? Math.round(r.horas_seg_momento / 360) / 10 : null,
      obs: r.observacion || '',
    };
  });
  ausencias.rows.forEach(r => {
    const c = de(r.conductor_id);
    const a = Math.max(0, idxDe(r.desde)), b = Math.min(nDias - 1, idxDe(r.hasta));
    for (let i = a; i <= b; i++) c.dias[i] = r.marca;
    c.ausencias.push({ marca: r.marca, etiqueta: r.etiqueta, desde: r.desde, hasta: r.hasta, abierta: !!r.abierta });
  });

  // Vigentes primero, por nombre; los de baja al final, la más reciente antes.
  const conductores = [...porId.values()].sort((a, b) =>
    (Number(b.vigente) - Number(a.vigente)) ||
    (a.vigente ? a.id.localeCompare(b.id, 'es') : String(b.baja || '').localeCompare(String(a.baja || ''))));

  return { conductores, hoyIdx, inicio: INICIO, avisos: { sinFicha: huerfanos.size } };
}

module.exports = { leerBitacora, INICIO };
