// ============================================================
// LLAMADAS DE SEGUIMIENTO — el "telefonito" de Control
// ============================================================
// Cada pulsación deja constancia de la llamada a un conductor: quién llamó,
// cuándo, en qué turno y con qué resultado. De aquí salen tres cosas:
//   · la traza en la carta de En directo (para que dos operadores no se pisen),
//   · la lista "Llamadas de seguimiento" del Histórico, y
//   · el reporte de "sí lo llamé".
// El espejo en la hoja CALL_CENTER lo hace la ruta (best-effort); la verdad es
// esta tabla.

const db = require('../db');

const TZ = 'Europe/Madrid';

/**
 * El día OPERATIVO de ahora mismo: la jornada va de 05:00 a 05:00, así que antes
 * de las cinco de la mañana seguimos en la jornada de AYER (la noche en curso
 * empezó la víspera).
 */
function diaOperativoHoy() {
  const parts = new Intl.DateTimeFormat('en-CA',
    { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false })
    .formatToParts(new Date());
  const de = t => parts.find(p => p.type === t).value;
  const iso = `${de('year')}-${de('month')}-${de('day')}`;
  if (Number(de('hour')) >= 5) return iso;
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) - 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Apunta una llamada. Devuelve la fila con su hora, para pintarla al momento. */
async function registrar({ conductorId, turno, resultado, nota, usuarioId, origen = 'control' }) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const r = await db.consulta(
    `INSERT INTO llamada_seguimiento (conductor_id, usuario_id, origen, dia_operativo, turno, resultado, nota)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7)
     RETURNING id, creado_at`,
    [cid, usuarioId || null, origen, diaOperativoHoy(),
     String(turno || '').slice(0, 10) || null,
     String(resultado || '').trim().slice(0, 60) || null,
     String(nota || '').trim().slice(0, 300) || null]);
  return { id: String(r.rows[0].id), creadoAt: r.rows[0].creado_at, dia: diaOperativoHoy() };
}

/**
 * Las llamadas de la jornada operativa EN CURSO, por conductor:
 * { conductorId: { n, ultima: { at, quien, resultado } } }. Es lo que pinta la
 * carta de En directo para que el segundo operador vea que ya se llamó.
 */
async function resumenHoy() {
  const r = await db.consulta(
    `SELECT l.conductor_id, count(*)::int AS n,
            (array_agg(l.creado_at ORDER BY l.creado_at DESC))[1]  AS ultima_at,
            (array_agg(l.resultado ORDER BY l.creado_at DESC))[1]  AS ultima_resultado,
            (array_agg(COALESCE(u.nombre, '') ORDER BY l.creado_at DESC))[1] AS ultima_quien
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.dia_operativo = $1::date
      GROUP BY l.conductor_id`, [diaOperativoHoy()]);
  const m = {};
  r.rows.forEach(x => {
    m[String(x.conductor_id)] = {
      n: x.n,
      ultima: { at: x.ultima_at, quien: x.ultima_quien || '', resultado: x.ultima_resultado || '' },
    };
  });
  return m;
}

/** Todas las llamadas de un rango de días (para el Histórico), la última primero. */
async function listar({ desde, hasta } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : diaOperativoHoy();
  const h = /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : diaOperativoHoy();
  const r = await db.consulta(
    `SELECT l.id, l.conductor_id, to_char(l.dia_operativo, 'YYYY-MM-DD') AS dia,
            l.turno, l.resultado, l.nota, l.creado_at, l.origen,
            COALESCE(u.nombre, '') AS quien,
            COALESCE(ext.externo_nombre,
                     NULLIF(btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')), ''),
                     '#' || c.id::text) AS conductor,
            tel.e164 AS telefono
       FROM llamada_seguimiento l
       JOIN conductor c ON c.id = l.conductor_id
       LEFT JOIN usuario u ON u.id = l.usuario_id
       LEFT JOIN LATERAL (
         SELECT externo_nombre FROM conductor_externo
          WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
          ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = c.id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE l.dia_operativo BETWEEN $1::date AND $2::date
      ORDER BY l.creado_at DESC
      LIMIT 1000`, [d, h]);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), conductor: x.conductor,
    telefono: x.telefono || '', dia: x.dia, turno: x.turno || '', resultado: x.resultado || '',
    nota: x.nota || '', quien: x.quien || '', at: x.creado_at, origen: x.origen,
  }));
}

/**
 * Los justificantes VIVOS de la jornada operativa en curso, por conductor:
 * { conductorId: { horas, obs, quien } }. La carta de En directo lo pinta para
 * que el segundo operador vea que ese día ya está justificado.
 */
async function justificadosHoy() {
  const r = await db.consulta(
    `SELECT j.conductor_id, j.horas_seg_momento, j.observacion, COALESCE(u.nombre, '') AS quien
       FROM justificante j
       LEFT JOIN usuario u ON u.id = j.usuario_id
      WHERE j.anulado_at IS NULL AND j.dia_operativo = $1::date`, [diaOperativoHoy()]);
  const m = {};
  r.rows.forEach(x => {
    m[String(x.conductor_id)] = {
      horas: x.horas_seg_momento != null ? Math.round(x.horas_seg_momento / 360) / 10 : null,
      obs: x.observacion || '', quien: x.quien || '',
    };
  });
  return m;
}

module.exports = { registrar, resumenHoy, listar, justificadosHoy, diaOperativoHoy };
