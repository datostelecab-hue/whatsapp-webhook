// ============================================================
// FICHA DEL CONDUCTOR — la hoja de una persona, de un vistazo
// ============================================================
// Lo que hay que saber de alguien sin abrir cinco pantallas: su calificación,
// cómo va de horas y de dinero, qué papeles le faltan, cuántos excesos lleva y
// qué se ha hablado con él.
//
// ── Lo que este módulo NO hace ──────────────────────────────────────────────
// No calcula nada nuevo. Todo lo que sirve ya lo calcula otro: la letra la pone
// `calificacion`, las horas la bitácora, el dinero la capa BI, los papeles el
// almacén de documentos. Aquí solo se reúnen, y por eso cada bloque va con su
// propio `.catch()`: que falte el dinero de un mes no puede dejar sin ficha a
// una persona. Un bloque que no se puede leer sale vacío y se dice; no tumba la
// página.
//
// ── Lo que falta, falta a la vista ──────────────────────────────────────────
// La ficha está pensada sobre un modelo más grande del que hoy tenemos datos:
// siniestralidad, multas, pluses, finiquito. Esos bloques existen y salen
// marcados como pendientes en vez de desaparecer, porque un hueco visible es una
// lista de lo que queda por conectar y un bloque ausente no es nada.

const db = require('../db');

const TZ = 'Europe/Madrid';
const n1 = v => (v == null ? null : Math.round(Number(v) * 10) / 10);
const n2 = v => (v == null ? null : Math.round(Number(v) * 100) / 100);
const iso = d => (d ? String(d).slice(0, 10) : null);

/** 'AAAA-MM' de hoy y del mes anterior, en Madrid. */
function meses() {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
  const [y, m] = hoy.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return { actual: `${y}-${String(m).padStart(2, '0')}`, anterior: prev };
}

const NOMBRE_MES = am => {
  const [y, m] = String(am).split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, 1)));
};

/**
 * Todo lo de una persona para la ficha. Cada pieza por su lado y con red: la
 * ficha se pinta aunque falte la mitad.
 */
async function leer(conductorId) {
  const cid = Number(conductorId);
  if (!Number.isInteger(cid) || cid <= 0) throw new Error('Falta el conductor');
  const { actual, anterior } = meses();

  const vacio = () => null;
  const [calif, historico, bi, biPrev, docs, velocidad, avisos, llamadas, justis, coche] =
    await Promise.all([
      // ── La letra, con su desglose ───────────────────────────────────────
      db.consulta(
        `SELECT letra, letra_por_puntos, tope_aplicado, motivo, total,
                pts_horas, pts_utilizacion, pts_velocidad,
                horas_prom, util_prom, excesos_total, dias_trabajados, dias_utilizacion,
                dias_telemetria, version_modelo,
                periodo_inicio::text AS desde, periodo_fin::text AS hasta
           FROM v_conductor_calificacion WHERE conductor_id = $1`, [cid])
        .then(r => r.rows[0] || null).catch(vacio),

      // El histórico corto: "llevo tres periodos bajando" es la pregunta.
      db.consulta(
        `SELECT periodo_fin::text AS hasta, letra, total
           FROM conductor_calificacion WHERE conductor_id = $1
          ORDER BY periodo_fin DESC LIMIT 6`, [cid]).then(r => r.rows).catch(() => []),

      // ── El mes, de la capa BI ───────────────────────────────────────────
      db.consulta('SELECT * FROM bi_conductor_mes WHERE conductor_id = $1 AND anio_mes = $2',
        [cid, actual]).then(r => r.rows[0] || null).catch(vacio),
      db.consulta('SELECT * FROM bi_conductor_mes WHERE conductor_id = $1 AND anio_mes = $2',
        [cid, anterior]).then(r => r.rows[0] || null).catch(vacio),

      // ── Papeles ─────────────────────────────────────────────────────────
      // Los que tiene, con su caducidad, y los que le faltan. Los dos juntos:
      // la pregunta es "¿está en regla?", no "¿qué ha subido?".
      db.consulta(
        `SELECT ct.codigo, ct.etiqueta, ct.obligatorio,
                d.id AS documento_id, d.fecha_caduca::text AS caduca,
                d.fecha_emision::text AS emision,
                (d.fecha_caduca IS NOT NULL AND d.fecha_caduca < CURRENT_DATE) AS caducado,
                (d.fecha_caduca - CURRENT_DATE)                                AS dias_caduca
           FROM cat_tipo_documento ct
           LEFT JOIN LATERAL (
             SELECT id, fecha_caduca, fecha_emision FROM documento
              WHERE conductor_id = $1 AND tipo = ct.codigo AND vigente
              ORDER BY COALESCE(fecha_caduca, fecha_emision) DESC NULLS LAST, id DESC
              LIMIT 1) d ON TRUE
          -- Solo los papeles de la PERSONA: la ITV y la ficha técnica son del
          -- coche y no tienen nada que hacer en la ficha de alguien.
          WHERE ct.activo AND ct.ambito = 'conductor'
            AND (ct.obligatorio OR d.id IS NOT NULL)
          ORDER BY ct.obligatorio DESC, ct.orden, ct.etiqueta`, [cid]).then(r => r.rows).catch(() => []),

      // ── Conducción ──────────────────────────────────────────────────────
      db.consulta(
        `SELECT count(*)::int                                                    AS total,
                count(*) FILTER (WHERE ocurrido_at >= CURRENT_DATE - 14)::int    AS ult14,
                count(*) FILTER (WHERE ocurrido_at >= CURRENT_DATE - 30)::int    AS ult30,
                count(*) FILTER (WHERE estado = 'avisado')::int                  AS avisos,
                max(velocidad)::float8                                           AS punta,
                to_char(max(ocurrido_at) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS ultimo
           FROM velocidad_exceso WHERE conductor_id = $1`, [cid])
        .then(r => r.rows[0] || null).catch(vacio),

      // Los avisos que ha RECIBIDO: es el expediente, y es lo que deja traza.
      db.consulta(
        `SELECT to_char(ocurrido_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS cuando,
                placa, velocidad::float8, limite::float8, exceso::float8, estado, nota
           FROM velocidad_exceso
          WHERE conductor_id = $1 AND estado IN ('avisado', 'simulado', 'dudoso')
          ORDER BY ocurrido_at DESC LIMIT 12`, [cid]).then(r => r.rows).catch(() => []),

      // ── Lo que se ha hablado con él ─────────────────────────────────────
      db.consulta(
        `SELECT to_char(creado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS cuando,
                origen, turno, resultado, nota, dia_operativo::text AS dia
           FROM llamada_seguimiento WHERE conductor_id = $1
          ORDER BY creado_at DESC LIMIT 10`, [cid]).then(r => r.rows).catch(() => []),

      db.consulta(
        `SELECT dia_operativo::text AS dia, tipo, observacion,
                round(horas_seg_momento / 3600.0, 1)::float8 AS horas,
                (anulado_at IS NOT NULL) AS anulado
           FROM justificante WHERE conductor_id = $1
          ORDER BY dia_operativo DESC LIMIT 10`, [cid]).then(r => r.rows).catch(() => []),

      // ── Dónde está hoy ──────────────────────────────────────────────────
      db.consulta(
        `SELECT vp.matricula, vp.zona, vp.cuadrante, vp.rol, vp.turno,
                COALESCE(
                  (SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana)
                     FROM vehiculo_descanso vd
                     JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                    WHERE vd.vehiculo_id = vp.vehiculo_id
                      AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)),
                  ARRAY[]::smallint[]) AS descanso,
                COALESCE(
                  (SELECT array_agg(ad.dia_semana ORDER BY ad.dia_semana)
                     FROM asignacion_dia ad WHERE ad.asignacion_id = a.id),
                  ARRAY[]::smallint[]) AS dias_ct
           FROM asignacion a
           JOIN v_plaza vp ON vp.plaza_id = a.plaza_id
          WHERE a.conductor_id = $1 AND a.hasta IS NULL AND a.retirada_at IS NULL
          ORDER BY vp.rol, vp.matricula`, [cid]).then(r => r.rows).catch(() => []),
    ]);

  // ── La semana: qué días trabaja y cuáles libra ──────────────────────────
  // Un fijo trabaja todos menos el descanso de su coche; un correturnos, los
  // días que tenga marcados. Con dos plazas, se suman.
  const trabaja = new Set();
  coche.forEach(c => {
    const desc = (c.descanso || []).map(Number);
    if (c.rol === 'CT') (c.dias_ct || []).map(Number).forEach(d => trabaja.add(d));
    else [1, 2, 3, 4, 5, 6, 7].filter(d => !desc.includes(d)).forEach(d => trabaja.add(d));
  });
  const semana = [1, 2, 3, 4, 5, 6, 7].map(d => ({
    dia: d, letra: ['L', 'M', 'X', 'J', 'V', 'S', 'D'][d - 1], trabaja: trabaja.has(d),
  }));

  // ── Los cuatro números de arriba, con su comparación ────────────────────
  const delta = (hoy, antes) => (hoy == null || antes == null ? null : n2(hoy - antes));
  const kpis = [
    {
      id: 'calificacion', etiqueta: 'Calificación',
      valor: calif ? calif.letra : null,
      detalle: calif && calif.total != null ? `${n2(calif.total)} puntos` : (calif && calif.motivo) || 'sin calificar',
      nota: calif && calif.tope_aplicado ? `Por puntos sería ${calif.letra_por_puntos}` : null,
    },
    {
      id: 'utilizacion', etiqueta: 'Utilización',
      valor: bi && bi.utilizacion_pct != null ? n1(bi.utilizacion_pct) : null, sufijo: ' %',
      delta: delta(bi && bi.utilizacion_pct, biPrev && biPrev.utilizacion_pct), unidadDelta: ' pp',
    },
    {
      id: 'euros_hora', etiqueta: 'Ingreso €/hora',
      valor: bi && bi.euros_hora != null ? n2(bi.euros_hora) : null, sufijo: ' €',
      delta: delta(bi && bi.euros_hora, biPrev && biPrev.euros_hora), unidadDelta: ' €',
    },
    {
      id: 'horas_dia', etiqueta: 'Promedio h/día',
      valor: bi && bi.horas_por_dia != null ? n1(bi.horas_por_dia) : null, sufijo: ' h',
      delta: delta(bi && bi.horas_por_dia, biPrev && biPrev.horas_por_dia), unidadDelta: ' h',
    },
  ];

  // ── Papeles, en semáforo ────────────────────────────────────────────────
  const documentacion = docs.map(d => {
    let estado = 'ok', texto = d.etiqueta;
    if (!d.documento_id) { estado = d.obligatorio ? 'falta' : 'sin'; texto = `${d.etiqueta} · falta`; }
    else if (d.caducado) { estado = 'caducado'; texto = `${d.etiqueta} · caducado`; }
    else if (d.dias_caduca != null && d.dias_caduca <= 30) {
      estado = 'pronto'; texto = `${d.etiqueta} · caduca en ${d.dias_caduca} días`;
    }
    return { ...d, estado, texto };
  });

  return {
    mes: { actual, anterior, nombre: NOMBRE_MES(actual) },
    calificacion: calif && {
      ...calif,
      total: n2(calif.total), horas_prom: n2(calif.horas_prom), util_prom: n2(calif.util_prom),
    },
    historicoCalificacion: historico.map(h => ({ ...h, total: n2(h.total) })),
    kpis, semana,
    coches: coche.map(c => ({
      matricula: c.matricula, zona: c.zona || '', cuadrante: c.cuadrante || '',
      rol: c.rol, turno: c.turno,
      descanso: (c.descanso || []).map(Number), diasCt: (c.dias_ct || []).map(Number),
    })),
    documentacion,
    mesActual: bi && {
      horasEfectivas: n1(bi.horas_efectivas), horasViaje: n1(bi.horas_viaje),
      horasEspera: n1(bi.horas_espera), horasDescanso: n1(bi.horas_descanso),
      diasTrabajados: Number(bi.dias_trabajados) || 0,
      viajes: Number(bi.viajes) || 0, neto: n2(bi.neto), propina: n2(bi.propina),
      eurosHora: n2(bi.euros_hora), eurosViaje: n2(bi.euros_viaje),
      viajesHora: n2(bi.viajes_hora), utilizacion: n1(bi.utilizacion_pct),
      horasPorDia: n1(bi.horas_por_dia), cochesDistintos: Number(bi.coches_distintos) || 0,
      ofertas: Number(bi.ofertas) || 0, rechazados: Number(bi.rechazados) || 0,
      perdidas: Number(bi.perdidas_conductor) || 0, sinRespuesta: Number(bi.sin_respuesta) || 0,
      canceladas: Number(bi.canc_conductor) || 0, pctPerdidas: n1(bi.pct_perdidas_conductor),
    },
    mesAnterior: biPrev && {
      horasEfectivas: n1(biPrev.horas_efectivas), neto: n2(biPrev.neto),
      eurosHora: n2(biPrev.euros_hora), utilizacion: n1(biPrev.utilizacion_pct),
      horasPorDia: n1(biPrev.horas_por_dia), viajes: Number(biPrev.viajes) || 0,
    },
    velocidad: velocidad && {
      total: velocidad.total, ult14: velocidad.ult14, ult30: velocidad.ult30,
      avisos: velocidad.avisos, punta: velocidad.punta, ultimo: iso(velocidad.ultimo),
    },
    avisos, llamadas, justificantes: justis,
    // Lo que la ficha enseñará como pendiente de conectar. Está escrito aquí y
    // no en la vista para que se vea de un vistazo qué le falta al sistema.
    pendientes: [
      { bloque: 'Siniestralidad', que: 'partes, culpabilidad, coste de reparación y días de coche parado' },
      { bloque: 'Multas y sanciones de tráfico', que: 'expedientes y su repercusión' },
      { bloque: 'Condiciones económicas', que: 'pluses, uso a domicilio y saldo de vacaciones' },
      { bloque: 'Salida', que: 'preaviso, despido previsto y finiquito' },
      { bloque: 'Calidad de servicio', que: 'limpieza del coche, puntualidad y nivel de resolución' },
    ],
  };
}

module.exports = { leer };
