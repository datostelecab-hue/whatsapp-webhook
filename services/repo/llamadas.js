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

/**
 * LA CASUÍSTICA, EN DOS NIVELES: primero POR DÓNDE VIENE y luego QUÉ PASA.
 *
 * Con una lista plana de siete resultados, todo lo que no fuera "no se conecta"
 * acababa en "Incidencia que lo impide" + una nota escrita a mano: el motivo
 * real —que el taller no le ha soltado el coche, que el relevo no ha llegado,
 * que dice estar de baja— se perdía en texto libre y no se podía contar. Con el
 * tipo delante, la misma llamada queda clasificada y se puede preguntar cuántas
 * veces al mes Tráfico no entrega un coche a tiempo.
 *
 * Los siete de siempre viven bajo 'seguimiento' y NO cambian de nombre: son los
 * que alimentan las colas de las campañas (services/callCenter) y renombrarlos
 * rompería el histórico.
 *
 * 'alerta' va con los casos VACÍOS a propósito: sus casos son las alertas que
 * ese conductor tiene abiertas en ese momento, y eso lo rellena la pantalla.
 */
const CATALOGO = [
  { codigo: 'seguimiento', etiqueta: 'Seguimiento', icono: 'fa-phone', casos: RESULTADOS },
  { codigo: 'taller', etiqueta: 'Taller', icono: 'fa-screwdriver-wrench', casos: [
    'El coche está en revisión',
    'Avería: no puede salir',
    'Avería en ruta',
    'Pinchazo o neumáticos',
    'Golpe o siniestro',
    'Va camino del taller',
    'Esperando recambio',
    'Sin luz de puerta / mampara / taxímetro',
    'Limpieza o ITV',
  ] },
  { codigo: 'rrhh', etiqueta: 'RRHH', icono: 'fa-id-card', casos: [
    'Presunta baja médica',
    'Presuntas vacaciones',
    'Presunta libranza',
    'Presunto permiso retribuido',
    'Dice que está de baja en la empresa',
    'Asunto propio sin avisar',
    'No ha entregado el justificante',
    'Problema con su nómina o contrato',
  ] },
  { codigo: 'trafico', etiqueta: 'Tráfico', icono: 'fa-satellite-dish', casos: [
    'No le han entregado el coche',
    'El relevo no ha llegado',
    'No tiene coche asignado',
    'Su coche lo lleva otro',
    'Problema con las llaves',
    'No sabe qué coche le toca',
    'Cambió el turno sin avisar',
    'Se ha quedado sin combustible o carga',
    'Problema con la app de BOLT',
  ] },
  { codigo: 'alerta', etiqueta: 'Alerta', icono: 'fa-triangle-exclamation', casos: [] },
];
const TIPOS = CATALOGO.map(c => c.codigo);

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
async function registrar({ conductorId, turno, resultado, nota, usuarioId, origen = 'control',
                           dia, tipo, alertas }) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const jornada = diaValido(dia);
  // Las respuestas por alerta: sin comentario no entran (lo repite el CHECK de
  // la base, pero aquí se descartan sin dar un error feo).
  const porAlerta = (Array.isArray(alertas) ? alertas : [])
    .map(a => ({
      codigo: String((a || {}).codigo || '').trim().slice(0, 40),
      etiqueta: String((a || {}).etiqueta || '').trim().slice(0, 160) || null,
      comentario: String((a || {}).comentario || '').trim().slice(0, 300),
    }))
    .filter(a => a.codigo && a.comentario);

  return db.transaccion(async cli => {
    const r = await cli.query(
      `INSERT INTO llamada_seguimiento (conductor_id, usuario_id, origen, dia_operativo, turno, resultado, nota, tipo)
       VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8)
       RETURNING id, creado_at`,
      [cid, usuarioId || null, origen, jornada,
       String(turno || '').slice(0, 10) || null,
       String(resultado || '').trim().slice(0, 60) || null,
       String(nota || '').trim().slice(0, 300) || null,
       TIPOS.includes(tipo) ? tipo : null]);
    const id = r.rows[0].id;

    for (const a of porAlerta) {
      // La MISMA alerta preguntada dos veces el mismo día se apunta las dos: la
      // segunda respuesta puede ser distinta ("ya viene" a las 9, "se ha vuelto
      // a caer" a las 11) y perderla sería perder la historia de la jornada.
      await cli.query(
        `INSERT INTO llamada_alerta (llamada_id, conductor_id, dia_operativo, alerta, etiqueta, comentario)
         VALUES ($1, $2, $3::date, $4, $5, $6)`,
        [id, cid, jornada, a.codigo, a.etiqueta, a.comentario]);
    }
    return { id: String(id), creadoAt: r.rows[0].creado_at, dia: jornada, alertas: porAlerta.length };
  });
}

/**
 * LAS LLAMADAS DE UN CONDUCTOR EN UN DÍA, con lo que contestó de cada alerta.
 * Es el "y por qué" de la casilla de la bitácora: la marca dice qué pasó y esto
 * dice qué contó él cuando se le llamó.
 */
async function delDia(conductorId, dia) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const jornada = diaValido(dia);
  const r = await db.consulta(
    `SELECT l.id, l.tipo, l.resultado, l.nota, l.origen,
            to_char(l.creado_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
            COALESCE(u.nombre, '') AS quien,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'alerta', a.alerta, 'etiqueta', a.etiqueta, 'comentario', a.comentario)
                      ORDER BY a.id)
                 FROM llamada_alerta a WHERE a.llamada_id = l.id), '[]'::json) AS alertas
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.conductor_id = $1 AND l.dia_operativo = $2::date
      ORDER BY l.creado_at`, [cid, jornada]);
  return {
    dia: jornada,
    llamadas: r.rows.map(x => ({
      id: String(x.id), hora: x.hora, tipo: x.tipo || '', resultado: x.resultado || '',
      nota: x.nota || '', quien: x.quien || '', origen: x.origen || '',
      alertas: x.alertas || [],
    })),
  };
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
  // QUÉ ALERTAS YA TIENEN RESPUESTA HOY, por conductor. Es lo que apaga el
  // parpadeo de su fila en Control: mientras le quede una sin contestar, late.
  const a = await db.consulta(
    `SELECT conductor_id, alerta,
            (array_agg(comentario ORDER BY creado_at DESC))[1] AS comentario,
            (array_agg(creado_at  ORDER BY creado_at DESC))[1] AS at
       FROM llamada_alerta
      WHERE dia_operativo = $1::date
      GROUP BY conductor_id, alerta`, [diaValido(dia)]);
  const porCond = {};
  a.rows.forEach(x => {
    const k = String(x.conductor_id);
    (porCond[k] = porCond[k] || {})[x.alerta] = { comentario: x.comentario, at: x.at };
  });

  const m = {};
  r.rows.forEach(x => {
    const k = String(x.conductor_id);
    m[k] = {
      n: x.n,
      ultima: {
        at: x.ultima_at, quien: x.ultima_quien || '',
        resultado: x.ultima_resultado || '', nota: x.ultima_nota || '',
      },
      alertas: porCond[k] || {},
    };
  });
  // Una llamada SIEMPRE deja fila en `llamada_seguimiento`, así que `porCond`
  // no puede traer a nadie que no esté ya en `m`; se comprueba por si acaso,
  // que perder la traza de una alerta contestada haría latir la fila para
  // siempre.
  Object.keys(porCond).forEach(k => {
    if (!m[k]) m[k] = { n: 0, ultima: {}, alertas: porCond[k] };
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
/**
 * Los justificantes de una jornada, CON SU ESTADO — que es lo que cambia todo:
 *
 *   · pendiente → horas PRESUNTAS. Valen para no llamar otra vez a quien ya
 *                 dijo "estuve en el taller", pero todavía no son horas: si se
 *                 rechaza, el agujero vuelve.
 *   · aprobada  → horas EFECTIVAS. Son las únicas que cuentan en la bitácora.
 *   · rechazada → no cuenta Y ADEMÁS hay que volver a llamar: alguien miró el
 *                 caso y dijo que no. Por eso las rechazadas se devuelven en
 *                 lista aparte, con su motivo, quién y cuándo.
 *
 * Antes esto devolvía `anulado_at IS NULL` sin más, así que una J pendiente se
 * contaba igual que una aprobada y una rechazada desaparecía sin dejar rastro:
 * el conductor se quedaba sin sus horas y nadie se enteraba.
 */
async function justificadosHoy(dia) {
  const jornada = diaValido(dia);
  const r = await db.consulta(
    `SELECT j.conductor_id, j.id, j.horas_seg_momento, j.observacion, j.tipo,
            j.aprobado_at, j.anulado_at, j.anulado_motivo, j.creado_at,
            COALESCE(u.nombre, '')  AS quien,
            COALESCE(ua.nombre, '') AS aprobada_por,
            COALESCE(un.nombre, '') AS rechazada_por
       FROM justificante j
       LEFT JOIN usuario u  ON u.id  = j.usuario_id
       LEFT JOIN usuario ua ON ua.id = j.aprobado_por
       LEFT JOIN usuario un ON un.id = j.anulado_por
      WHERE j.dia_operativo = $1::date
      ORDER BY j.creado_at`, [jornada]);

  const m = {};
  r.rows.forEach(x => {
    const k = String(x.conductor_id);
    const horas = x.horas_seg_momento != null ? Math.round(x.horas_seg_momento / 360) / 10 : null;
    const base = {
      id: String(x.id), horas, obs: x.observacion || '',
      quien: x.quien || '', tipo: x.tipo || 'personal', creadoAt: x.creado_at,
    };
    const c = m[k] || (m[k] = { horas: null, estado: null, rechazadas: [] });
    if (x.anulado_at) {
      c.rechazadas.push({ ...base, motivo: x.anulado_motivo || '',
        porQuien: x.rechazada_por || '', at: x.anulado_at });
      return;
    }
    // La viva (solo puede haber una por conductor y día: lo impide uq_just_vivo).
    Object.assign(c, base, {
      estado: x.aprobado_at ? 'aprobada' : 'pendiente',
      aprobadaPor: x.aprobada_por || '', aprobadoAt: x.aprobado_at || null,
    });
  });
  return m;
}

module.exports = { registrar, resumenHoy, listar, justificadosHoy, delDia, diaOperativoHoy, RESULTADOS, CATALOGO, TIPOS, estadisticasHoy, CONTACTADO };
