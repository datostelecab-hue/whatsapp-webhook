// ============================================================
// LLAMADAS DE SEGUIMIENTO — el "telefonito" de Control
// ============================================================
// EL BUZÓN DE RESULTADOS de una llamada de asistencia. Es el catálogo de las
// campañas: lo que se marca aquí decide a qué cola va el conductor en la
// campaña siguiente. Una sola lista para el cockpit y para las campañas; dos
// listas se separan solas con el tiempo.
//
// 'Confirma que sale ya' es el "ya se conecta": en la campaña de las 11 se
// VERIFICA contra la actividad real, no contra la palabra.
const RESULTADOS = [
  'Buzón',
  'No contesta',
  'Confirma que sale ya',
  'Incidencia que lo impide',
  'Número erróneo',
  'No contactado',
  'No asistirá',
];

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

/** 'YYYY-MM-DD' válido, o la jornada operativa de ahora. */
const diaValido = d => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : diaOperativoHoy());

/**
 * Apunta una llamada. Devuelve la fila con su hora, para pintarla al momento.
 * `dia` es la jornada que está mirando quien llama (la del cockpit): así la
 * llamada cae en la misma jornada que la carta donde se apuntó.
 */
async function registrar({ conductorId, turno, resultado, nota, usuarioId, origen = 'control', dia }) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const jornada = diaValido(dia);
  const r = await db.consulta(
    `INSERT INTO llamada_seguimiento (conductor_id, usuario_id, origen, dia_operativo, turno, resultado, nota)
     VALUES ($1, $2, $3, $4::date, $5, $6, $7)
     RETURNING id, creado_at`,
    [cid, usuarioId || null, origen, jornada,
     String(turno || '').slice(0, 10) || null,
     String(resultado || '').trim().slice(0, 60) || null,
     String(nota || '').trim().slice(0, 300) || null]);
  return { id: String(r.rows[0].id), creadoAt: r.rows[0].creado_at, dia: jornada };
}

/**
 * ¿El resultado significa que HABLASTE con él? Contactado = confirma, tiene una
 * incidencia o dice que no asistirá. Lo demás (buzón, no contesta, número
 * erróneo, no contactado) es no localizado. Lo usa el informe de campañas.
 */
const CONTACTADO = r => /confirma|incidencia|no asistir/i.test(String(r || ''));

/**
 * LAS CUENTAS DEL DÍA para el informe de dirección: cuántas llamadas y a
 * cuántos conductores, por campaña (el `origen` de cada llamada), con el
 * desglose por resultado y por agente. No devuelve nombres de conductores:
 * el informe es de números; la gente está en la vista de gestor.
 *
 * Con `turno` mira solo las llamadas de ese turno (las de día arrastran a los
 * TodoTurno y a lo viejo sin turno apuntado; 'noche' es solo noche), que cada
 * turno tiene sus campañas y sus cuentas. `total` va aparte y con DISTINCT DE
 * VERDAD: sumar los conductores de cada campaña contaría dos veces al que
 * recibió llamadas en dos.
 */
async function estadisticasHoy(dia, turno) {
  // El filtro es un literal fijo elegido aquí mismo, nunca texto del cliente.
  const filtro = turno === 'noche' ? "AND l.turno = 'noche'"
    : turno === 'dia' ? "AND l.turno IS DISTINCT FROM 'noche'" : '';

  const r = await db.consulta(
    `SELECT COALESCE(l.origen, 'control') AS origen, l.resultado,
            COALESCE(u.nombre, '¿?')      AS agente,
            count(*)::int                  AS n
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.dia_operativo = $1::date ${filtro}
      GROUP BY 1, 2, 3`, [diaValido(dia)]);

  const vacio = () => ({ llamadas: 0, conductores: 0, contactados: 0,
    noLocalizados: 0, porResultado: {}, porAgente: {} });
  const origenes = {};
  r.rows.forEach(x => {
    const c = origenes[x.origen] || (origenes[x.origen] = vacio());
    c.llamadas += x.n;
    c.porResultado[x.resultado || '(sin resultado)'] = (c.porResultado[x.resultado || '(sin resultado)'] || 0) + x.n;
    c.porAgente[x.agente] = (c.porAgente[x.agente] || 0) + x.n;
  });

  // Los DISTINTOS conductores, por campaña Y el total del día: agregarlos
  // desde el GROUP BY de arriba contaría dos veces al que tiene dos
  // resultados, y sumar campañas contaría dos veces al llamado desde dos.
  // ROLLUP añade la fila del total (origen NULL con grouping=1).
  const d = await db.consulta(
    `SELECT COALESCE(l.origen, 'control') AS origen,
            GROUPING(COALESCE(l.origen, 'control')) AS es_total,
            count(*)::int AS llamadas,
            count(DISTINCT l.conductor_id)::int AS conductores,
            count(DISTINCT l.conductor_id) FILTER (WHERE l.resultado ~* 'confirma|incidencia|no asistir')::int AS contactados
       FROM (SELECT origen, conductor_id, resultado FROM llamada_seguimiento l
              WHERE l.dia_operativo = $1::date ${filtro}) l
      GROUP BY ROLLUP(COALESCE(l.origen, 'control'))`, [diaValido(dia)]);
  let total = { llamadas: 0, conductores: 0, contactados: 0, noLocalizados: 0 };
  d.rows.forEach(x => {
    const fila = { llamadas: x.llamadas, conductores: x.conductores,
      contactados: x.contactados, noLocalizados: x.conductores - x.contactados };
    if (Number(x.es_total)) { total = fila; return; }
    Object.assign(origenes[x.origen] || (origenes[x.origen] = vacio()), fila);
  });
  return { origenes, total };
}

/**
 * Las llamadas de la jornada operativa EN CURSO, por conductor:
 * { conductorId: { n, ultima: { at, quien, resultado, nota } } }. Es lo que pinta la
 * carta de En directo para que el segundo operador vea que ya se llamó.
 */
async function resumenHoy(dia) {
  const r = await db.consulta(
    `SELECT l.conductor_id, count(*)::int AS n,
            (array_agg(l.creado_at ORDER BY l.creado_at DESC))[1]  AS ultima_at,
            (array_agg(l.resultado ORDER BY l.creado_at DESC))[1]  AS ultima_resultado,
            -- LA NOTA TAMBIÉN. Es lo que escribió quien llamó ("dice que llega a
            -- las 10, se le averió el coche"), y sin ella el segundo controlador
            -- vuelve a llamar para preguntar lo mismo.
            (array_agg(l.nota ORDER BY l.creado_at DESC))[1]       AS ultima_nota,
            (array_agg(COALESCE(u.nombre, '') ORDER BY l.creado_at DESC))[1] AS ultima_quien
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.dia_operativo = $1::date
      GROUP BY l.conductor_id`, [diaValido(dia)]);
  const m = {};
  r.rows.forEach(x => {
    m[String(x.conductor_id)] = {
      n: x.n,
      ultima: {
        at: x.ultima_at, quien: x.ultima_quien || '',
        resultado: x.ultima_resultado || '', nota: x.ultima_nota || '',
      },
    };
  });
  return m;
}

/**
 * Todas las llamadas de un rango de días (para el Histórico), la última primero.
 * Devuelve { llamadas, truncado }: si el rango tiene más de 1000, se dice.
 */
async function listar({ desde, hasta } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(desde || '') ? desde : diaOperativoHoy();
  const h = /^\d{4}-\d{2}-\d{2}$/.test(hasta || '') ? hasta : diaOperativoHoy();
  const r = await db.consulta(
    `SELECT l.id, l.conductor_id, to_char(l.dia_operativo, 'YYYY-MM-DD') AS dia,
            l.turno, l.resultado, l.nota, l.creado_at, l.origen,
            COALESCE(u.nombre, '') AS quien,
            COALESCE(ext.externo_nombre,
                     NULLIF(COALESCE(NULLIF(btrim(c.nombre_bolt), ''), btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))), ''),
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
      LIMIT 1001`, [d, h]);
  const truncado = r.rows.length > 1000;
  return {
    truncado,
    llamadas: r.rows.slice(0, 1000).map(x => ({
      id: String(x.id), conductorId: String(x.conductor_id), conductor: x.conductor,
      telefono: x.telefono || '', dia: x.dia, turno: x.turno || '', resultado: x.resultado || '',
      nota: x.nota || '', quien: x.quien || '', at: x.creado_at, origen: x.origen,
    })),
  };
}

/**
 * Los justificantes VIVOS de la jornada operativa en curso, por conductor:
 * { conductorId: { horas, obs, quien } }. La carta de En directo lo pinta para
 * que el segundo operador vea que ese día ya está justificado.
 */
async function justificadosHoy(dia) {
  const r = await db.consulta(
    `SELECT j.conductor_id, j.horas_seg_momento, j.observacion, j.tipo, COALESCE(u.nombre, '') AS quien
       FROM justificante j
       LEFT JOIN usuario u ON u.id = j.usuario_id
      WHERE j.anulado_at IS NULL AND j.dia_operativo = $1::date`, [diaValido(dia)]);
  const m = {};
  r.rows.forEach(x => {
    m[String(x.conductor_id)] = {
      horas: x.horas_seg_momento != null ? Math.round(x.horas_seg_momento / 360) / 10 : null,
      obs: x.observacion || '', quien: x.quien || '', tipo: x.tipo || 'personal',
    };
  });
  return m;
}

module.exports = { registrar, resumenHoy, listar, justificadosHoy, diaOperativoHoy, RESULTADOS, estadisticasHoy, CONTACTADO };
