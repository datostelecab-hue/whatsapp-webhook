// ============================================================
// CALIFICACIÓN DE CONDUCTORES A–D — modelo "ABCD" 2.0
// ============================================================
// Una letra por conductor y periodo, de tres métricas ponderadas:
//
//   HORAS         50 %   promedio diario sobre TODOS los días del periodo
//   UTILIZACIÓN   30 %   promedio diario del % de tiempo con pasajero
//   VELOCIDAD     20 %   SUMA ACUMULADA de excesos del periodo
//
// La trampa del modelo, y está avisada en la especificación: las dos primeras
// son promedios diarios y la tercera es un total. Un conductor con 3 excesos en
// el mes tiene 3, no 0,10.
//
// ── De dónde sale cada cosa, y por qué ──────────────────────────────────────
//
// HORAS = horas efectivas de Bolt (viaje + espera, sin descanso) MÁS las horas
// justificadas del día. Es la misma cuenta que ya hace el promedio del
// planificador y la que entiende un conductor: dos horas en el taller con su J
// más seis rodando son ocho horas, no seis. Se apoya en `bitacora_horas`, el
// histórico SELLADO, así que la letra de un periodo cerrado no se mueve porque
// alguien recalcule algo.
//
// UTILIZACIÓN = tiempo en viaje / tiempo efectivo, de `fv_tramo`. Es la
// definición que ya usan el BI y la nómina variable, así que no aparece un
// tercer número distinto en la casa.
//
// Y AQUÍ VAN SEPARADAS A PROPÓSITO: las J suman a las horas pero NO entran en la
// utilización. Una J no genera viaje ni espera; meterla en el denominador
// hundiría el porcentaje de quien pasó la mañana en el taller, castigándolo dos
// veces por algo que no decidió él. Un día sin horas de Bolt no tiene
// utilización que medir y se excluye de ese promedio (§9.2), no del de horas.
//
// EXCESOS = `velocidad_exceso`, que ya solo cuenta los atribuidos con certeza.
//
// ── Los umbrales viven aquí y en un solo sitio ──────────────────────────────
// Todo el modelo es MODELO, la constante de abajo. Recalibrar es cambiarla y
// subir `version_modelo`; no hay ni un número suelto por el código. La
// especificación ya avisa (§13) de que habrá que hacerlo tras el primer mes.

const db = require('../db');

// ── EL MODELO ───────────────────────────────────────────────────────────────
const MODELO = {
  // 2.0 — EL PERIODO ES EL MES Y CUENTAN TODOS LOS DÍAS DESDE EL ALTA.
  //
  // En 1.0 la ventana eran 14 días y solo contaban los días con horas: quien
  // libraba, estaba de vacaciones o simplemente no salía, no existía para el
  // cálculo. Eso tenía dos efectos malos a la vez. A quien acababa de entrar no
  // se le podía puntuar (Elena, de alta el 8, tenía 4 días con horas de los 9
  // que llevaba, y salía N/E), y a quien faltaba no se le notaba: sus ausencias
  // no bajaban nada porque ni se miraban.
  //
  // Ahora el periodo es el MES CORRIDO, desde su alta si entró a mitad, y cada
  // día del periodo vale algo:
  //   · trabajó            → sus horas de Bolt MÁS las justificadas
  //   · libró, vacaciones,
  //     baja o permiso     → 8 h, para que no le baje la media por descansar
  //   · no salió, sin nada
  //     que lo justifique  → 0, y eso sí baja
  version: '2.0',
  periodo: 'mes',              // del día 1 (o su alta) al último día cerrado
  minDiasTrabajados: 5,        // por debajo → N/E, nunca D
  minHorasDiaTrabajado: 1,     // qué cuenta como día CON HORAS de Bolt (§9.1)
  // Lo que vale un día cubierto (libranza, vacaciones, baja, permiso). Es el
  // objetivo de jornada: ni premia ni castiga descansar cuando toca.
  horasDiaCubierto: 8,
  pesos: { horas: 0.50, utilizacion: 0.30, velocidad: 0.20 },
  // LOS RECHAZOS NO PUNTÚAN, y el hueco de `pts_rechazos` en la tabla es para un
  // modelo futuro, no un olvido (§15). Decisión de Tráfico del 11/09/2026 sobre
  // los DOS tipos, que no son lo mismo:
  //   · NO RESPONDER no puede bajar la calificación: detrás hay cobertura mala,
  //     móviles colgados y soportes flojos, y castigar eso sería castigar al que
  //     peor equipo tiene. Levanta un aviso para ir a AYUDARLE (/alertas).
  //   · RECHAZAR es otra cosa —aquí no se rechaza ningún viaje— pero también se
  //     atiende por teléfono, porque un viaje larguísimo sí puede justificarse.
  // Si algún día entran al modelo, entran con su propia versión y recalibrando.
  // Cada tabla, de mayor a menor. Se lee "el primero cuyo `desde` se alcanza".
  horas: [
    { desde: 9, pts: 100 }, { desde: 8, pts: 90 }, { desde: 7, pts: 70 },
    { desde: 6, pts: 50 }, { desde: 5, pts: 30 }, { desde: 0, pts: 0 },
  ],
  utilizacion: [
    { desde: 80, pts: 100 }, { desde: 75, pts: 90 }, { desde: 70, pts: 85 },
    { desde: 60, pts: 50 }, { desde: 50, pts: 45 }, { desde: 0, pts: 0 },
  ],
  // Aquí el orden es al revés: cuantos MENOS excesos, más puntos.
  velocidad: [
    { hasta: 0, pts: 100 }, { hasta: 2, pts: 90 }, { hasta: 3, pts: 70 },
    { hasta: 5, pts: 30 }, { hasta: Infinity, pts: 0 },
  ],
  bandas: [
    { desde: 85, letra: 'A' }, { desde: 70, letra: 'B' },
    { desde: 55, letra: 'C' }, { desde: -Infinity, letra: 'D' },
  ],
  // Topes de seguridad: SOLO BAJAN. Impiden que un volumen alto de horas
  // compense una conducción peligrosa.
  topes: [
    { ptsVelocidadHasta: 30, maxima: 'C' },
    { ptsVelocidadHasta: 70, maxima: 'B' },
  ],
};

const ORDEN_LETRA = { A: 4, B: 3, C: 2, D: 1 };
const peorDe = (a, b) => (ORDEN_LETRA[a] <= ORDEN_LETRA[b] ? a : b);

const ptsHoras = h => (MODELO.horas.find(t => h >= t.desde) || { pts: 0 }).pts;
const ptsUtilizacion = u => (MODELO.utilizacion.find(t => u >= t.desde) || { pts: 0 }).pts;
const ptsVelocidad = e => (MODELO.velocidad.find(t => e <= t.hasta) || { pts: 0 }).pts;

/**
 * Redondeo a 2 decimales, media hacia arriba.
 *
 * Va explícito porque la especificación lo pide explícito: la letra se decide
 * comparando el total con las bandas, así que el redondeo es parte de la regla,
 * no una cuestión de presentación. Un 84,995 tiene que ser 85,00 y ser A.
 */
function redondear2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * EL CÁLCULO, sobre números ya resueltos. Sin base de datos: es lo que hace que
 * los casos de prueba de la especificación se puedan correr tal cual.
 */
function calificar({ horasProm, utilProm, excesosTotal, diasTrabajados, diasUtilizacion }) {
  if (!(diasTrabajados >= MODELO.minDiasTrabajados)) {
    return {
      letra: 'N/E',
      motivo: `lleva menos de ${MODELO.minDiasTrabajados} días en el periodo (${diasTrabajados || 0})`,
      diasTrabajados: diasTrabajados || 0,
      versionModelo: MODELO.version,
    };
  }
  // SIN UN SOLO DÍA CONDUCIENDO NO HAY UTILIZACIÓN QUE MEDIR.
  //
  // Quien pasó el mes entero de baja tiene sus días a 8 h —así lo quiere la
  // regla, y con razón— pero cero días con actividad. Metiendo su utilización
  // como 0 % se lleva 0 de los 30 puntos de esa mitad y sale con una C por estar
  // enfermo. Es el mismo principio que ya aplica el modelo a las J (§9.2): un
  // día sin horas de Bolt no tiene utilización, y no se puede puntuar lo que no
  // se ha podido medir. Nada que medir es N/E, no una nota mediocre.
  if (!(diasUtilizacion >= 1)) {
    return {
      letra: 'N/E', motivo: 'ningún día con actividad que medir en el periodo',
      diasTrabajados, horasProm: redondear2(horasProm), versionModelo: MODELO.version,
    };
  }
  // Sin telemetría no se asume cero: asumirlo premiaría un fallo del sistema (§9.3).
  if (excesosTotal == null) {
    return {
      letra: 'N/E', motivo: 'sin datos de telemetría en el periodo',
      diasTrabajados, versionModelo: MODELO.version,
    };
  }

  const pH = ptsHoras(Number(horasProm) || 0);
  const pU = ptsUtilizacion(Number(utilProm) || 0);
  const pV = ptsVelocidad(Number(excesosTotal));

  const total = redondear2(
    MODELO.pesos.horas * pH + MODELO.pesos.utilizacion * pU + MODELO.pesos.velocidad * pV);

  const porPuntos = (MODELO.bandas.find(b => total >= b.desde) || { letra: 'D' }).letra;

  // Los topes, de más duro a menos: el primero que aplique manda.
  let letra = porPuntos;
  for (const t of MODELO.topes) {
    if (pV <= t.ptsVelocidadHasta) { letra = peorDe(letra, t.maxima); break; }
  }

  return {
    letra, letraPorPuntos: porPuntos, topeAplicado: letra !== porPuntos,
    total,
    ptsHoras: pH, ptsUtilizacion: pU, ptsVelocidad: pV,
    horasProm: redondear2(horasProm), utilProm: redondear2(utilProm),
    excesosTotal, diasTrabajados,
    versionModelo: MODELO.version,
  };
}

// ── Los datos del periodo ───────────────────────────────────────────────────

/**
 * El primer día del periodo: el 1 del mes en que cae `hasta`.
 *
 * El mes CORRIDO, no los últimos 30 días: es como se mira todo lo demás en la
 * casa (el promedio del planificador, la asistencia) y es lo que entiende quien
 * la lee — «la letra de septiembre», no «la de los últimos catorce días».
 * A quien entró a mitad de mes se le recorta a su alta, pero eso se hace por
 * persona dentro de la consulta, no aquí.
 */
function inicioDe(hasta) {
  return String(hasta).slice(0, 8) + '01';
}

/** Días naturales del periodo, para saber si la telemetría lo cubre entero. */
function largoDe(desde, hasta) {
  const a = new Date(String(desde).slice(0, 10) + 'T12:00:00Z');
  const b = new Date(String(hasta).slice(0, 10) + 'T12:00:00Z');
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/**
 * Las tres métricas de todo el mundo para un periodo.
 *
 * CUENTAN TODOS LOS DÍAS DEL PERIODO, no solo aquellos en los que rodó. Cada
 * día vale sus horas (Bolt + justificadas), u 8 h si estaba cubierto —libranza,
 * vacaciones, baja o permiso—, o 0 si debía salir y no salió sin nada que lo
 * explique. Así el que descansa cuando toca no pierde media y el que falta sí.
 *
 * La UTILIZACIÓN va por otro camino y no cambia: promedia solo los días con
 * tiempo efectivo de Bolt, porque un día de libranza o de taller no tiene
 * utilización que medir y meterlo como 0 hundiría a quien no condujo.
 */
async function metricas(desde, hasta) {
  const r = await db.consulta(
    `WITH
     -- EL PERIODO DE CADA UNO. El mes, pero nunca antes de su alta: a quien
     -- entró el día 8 se le cuentan sus días, no el mes entero con ceros
     -- delante. Es justo lo que hacía que a los recién llegados no se les
     -- pudiera puntuar.
     periodo AS (
       SELECT e.conductor_id,
              GREATEST($1::date, e.alta)                  AS desde,
              LEAST($2::date, COALESCE(e.baja, $2::date)) AS hasta
         FROM conductor_periodo_empleo e
         JOIN conductor c ON c.id = e.conductor_id AND NOT c.es_centinela
        WHERE e.baja IS NULL
     ),
     dias AS (
       SELECT p.conductor_id, g.dia::date AS dia
         FROM periodo p
         CROSS JOIN LATERAL generate_series(p.desde, p.hasta, interval '1 day') g(dia)
        WHERE p.hasta >= p.desde
     ),
     -- Horas del día: las selladas de Bolt MÁS las justificadas. Se suman.
     horas AS (
       SELECT conductor_id, dia, sum(bolt)::bigint AS seg_bolt, sum(seg)::bigint AS seg_total
         FROM (
           SELECT conductor_id, dia_operativo AS dia, horas_seg AS seg, horas_seg AS bolt
             FROM bitacora_horas
            WHERE dia_operativo BETWEEN $1::date AND $2::date
           UNION ALL
           SELECT conductor_id, dia_operativo, COALESCE(horas_seg_momento, 0), 0
             FROM justificante
            WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
         ) x GROUP BY conductor_id, dia
     ),
     -- Utilización del día: viaje / efectivo, de los tramos de Bolt. La jornada
     -- operativa empieza a las 05:00, igual que las horas, para que los dos
     -- promedios hablen del mismo día.
     util AS (
       SELECT ce.conductor_id,
              ((t.desde AT TIME ZONE 'Europe/Madrid') - interval '5 hours')::date AS dia,
              sum(EXTRACT(EPOCH FROM (COALESCE(t.hasta, t.senal_at, t.desde) - t.desde)))
                FILTER (WHERE s.codigo = 'viaje')                                   AS seg_viaje,
              sum(EXTRACT(EPOCH FROM (COALESCE(t.hasta, t.senal_at, t.desde) - t.desde)))
                FILTER (WHERE s.efectivo)                                           AS seg_efectivo
         FROM fv_tramo t
         JOIN fv_cat_situacion s   ON s.codigo = t.situacion
         JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.conductor_uuid
        WHERE t.conductor_uuid IS NOT NULL AND ce.conductor_id IS NOT NULL
          AND t.desde >= ($1::date - 1) AND t.desde < ($2::date + 2)
        GROUP BY 1, 2
     ),
     -- A quién le TOCABA salir cada día. Lo que no está aquí es libranza.
     tocaba AS (
       SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date)
        WHERE conductor_id IS NOT NULL
     ),
     -- SIN CUADRANTE NO HAY LIBRANZA QUE VALGA.
     --
     -- "No le tocaba" solo significa "libró" si el cuadrante le da trabajo algún
     -- día del periodo. A quien no le toca NINGÚN día no está librando: no se le
     -- ha dado coche. Mirar solo si tiene plaza no basta —se probó— y salían diez
     -- personas con 16 días a 8 h y cero horas rodadas, con letra C sin haber
     -- salido una sola vez. Antes de esto eran N/E, que es lo honesto.
     en_cuadrante AS (
       SELECT DISTINCT conductor_id FROM tocaba
     ),
     -- Vacaciones, bajas y permisos: los estados que la bitácora marca.
     aus AS (
       SELECT DISTINCT h.conductor_id, g.dia::date AS dia
         FROM conductor_estado_hist h
         JOIN cat_estado_conductor e ON e.codigo = h.estado AND e.marca_bitacora IS NOT NULL
         CROSS JOIN LATERAL generate_series(
           GREATEST(h.desde, $1::date),
           LEAST(COALESCE(h.hasta, $2::date), $2::date),
           interval '1 day') g(dia)
     ),
     -- LO QUE VALE CADA DÍA. El orden de los CASE es la regla entera:
     --   1. Trabajó            → sus horas (Bolt + justificadas). Manda sobre todo.
     --   2. Vacaciones/baja/permiso → 8 h: descansar cuando toca no puede bajar la media.
     --   3. Le tocaba y no salió   → 0. Este es el que baja, y para eso está.
     --   4. No le tocaba, pero el cuadrante le da trabajo otros días → 8 h (libró).
     --   5. Ni trabajo ni plan  → NULL: ese día no se cuenta ni para bien ni para
     --      mal. No es una libranza, es que no se le dio coche.
     valor AS (
       SELECT d.conductor_id, d.dia,
              CASE
                WHEN COALESCE(h.seg_total, 0) > 0   THEN h.seg_total
                WHEN a.conductor_id IS NOT NULL     THEN $3::bigint
                WHEN t.conductor_id IS NOT NULL     THEN 0
                WHEN q.conductor_id IS NOT NULL     THEN $3::bigint
                ELSE NULL
              END                       AS seg,
              COALESCE(h.seg_total, 0)  AS seg_real,
              u.seg_viaje, u.seg_efectivo
         FROM dias d
         LEFT JOIN horas h        ON h.conductor_id = d.conductor_id AND h.dia = d.dia
         LEFT JOIN aus a          ON a.conductor_id = d.conductor_id AND a.dia = d.dia
         LEFT JOIN tocaba t       ON t.conductor_id = d.conductor_id AND t.dia = d.dia
         LEFT JOIN en_cuadrante q ON q.conductor_id = d.conductor_id
         LEFT JOIN util u         ON u.conductor_id = d.conductor_id AND u.dia = d.dia
     )
     SELECT conductor_id,
            count(seg)::int                                                 AS dias_trabajados,
            round((sum(seg) / 3600.0) / NULLIF(count(seg), 0), 2)           AS horas_prom,
            count(*) FILTER (WHERE seg_efectivo >= $4)::int                 AS dias_utilizacion,
            round(avg(100.0 * seg_viaje / NULLIF(seg_efectivo, 0))
                  FILTER (WHERE seg_efectivo >= $4), 2)                     AS util_prom,
            -- El desglose, para poder explicar el número sin abrir la base.
            count(*) FILTER (WHERE seg_real >= $4)::int                     AS dias_con_horas,
            count(*) FILTER (WHERE seg_real = 0 AND seg > 0)::int           AS dias_cubiertos,
            count(*) FILTER (WHERE seg = 0)::int                            AS dias_cero
       FROM valor
      GROUP BY conductor_id`,
    [desde, hasta, MODELO.horasDiaCubierto * 3600, MODELO.minHorasDiaTrabajado * 3600]);
  return r.rows;
}

/** Los excesos ATRIBUIDOS de cada conductor en el periodo. Suma, no promedio. */
async function excesosDe(desde, hasta) {
  const r = await db.consulta(
    `SELECT conductor_id, count(*)::int AS n
       FROM velocidad_exceso
      WHERE conductor_id IS NOT NULL
        AND ocurrido_at >= $1::date
        AND ocurrido_at < ($2::date + 1)
      GROUP BY conductor_id`, [desde, hasta]);
  return new Map(r.rows.map(x => [Number(x.conductor_id), x.n]));
}

/**
 * ¿Hay telemetría del periodo? Si Mapon estuvo caído no se puede asumir que
 * nadie corrió: eso premiaría el fallo (§9.3). Se mira que la ingesta de
 * alertas haya traído ALGO de cada día del periodo.
 */
async function diasConTelemetria(desde, hasta) {
  const r = await db.consulta(
    `SELECT count(DISTINCT (ocurrido_at AT TIME ZONE 'Europe/Madrid')::date)::int AS dias,
            min((ocurrido_at AT TIME ZONE 'Europe/Madrid')::date)::text AS primero
       FROM mapon_alerta
      WHERE ocurrido_at >= $1::date AND ocurrido_at < ($2::date + 1)`, [desde, hasta]);
  return r.rows[0] || { dias: 0, primero: null };
}

/**
 * Calcula la calificación de toda la plantilla para el periodo que acaba en
 * `hasta`. No escribe: eso lo hace `recalcular`.
 */
async function calcular(hasta) {
  const fin = String(hasta).slice(0, 10);
  const ini = inicioDe(fin);

  const [filas, excesos, tele, plantilla] = await Promise.all([
    metricas(ini, fin),
    excesosDe(ini, fin),
    diasConTelemetria(ini, fin),
    db.consulta(
      `SELECT c.id,
              COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre,
              e.alta::text AS alta
         FROM conductor c
         JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
        WHERE NOT c.es_centinela`),
  ]);

  // Sin NADA de telemetría en el periodo no se califica a nadie por velocidad.
  const hayTelemetria = tele.dias > 0;
  const nombres = new Map(plantilla.rows.map(x => [Number(x.id), x.nombre]));
  const activos = new Set(plantilla.rows.map(x => Number(x.id)));

  const res = filas
    .filter(f => activos.has(Number(f.conductor_id)))
    .map(f => {
      const cid = Number(f.conductor_id);
      const r = calificar({
        horasProm: Number(f.horas_prom) || 0,
        utilProm: Number(f.util_prom) || 0,
        excesosTotal: hayTelemetria ? (excesos.get(cid) || 0) : null,
        diasTrabajados: f.dias_trabajados,
        diasUtilizacion: f.dias_utilizacion,
      });
      return {
        conductorId: cid, nombre: nombres.get(cid) || ('#' + cid),
        periodoInicio: ini, periodoFin: fin,
        diasUtilizacion: f.dias_utilizacion,
        // De qué está hecho el promedio: cuántos días rodó, cuántos estuvo
        // cubierto (a 8 h) y cuántos salieron a cero. Sin esto, «5,8 h» es un
        // número que nadie puede discutir porque nadie sabe de dónde sale.
        diasConHoras: f.dias_con_horas, diasCubiertos: f.dias_cubiertos, diasCero: f.dias_cero,
        // Con cuántos días de telemetría se calculó esta letra. Si son menos que
        // la ventana, los excesos están infravalorados y la letra sale mejor de
        // lo que es: hay que poder decirlo al mirar la fila, no al mirar el log.
        diasTelemetria: tele.dias,
        ...r,
      };
    });

  return {
    periodoInicio: ini, periodoFin: fin, version: MODELO.version,
    telemetria: { dias: tele.dias, desdeElPrimero: tele.primero,
      completa: tele.dias >= largoDe(ini, fin) },
    filas: res.sort((a, b) => (b.total || -1) - (a.total || -1) || a.nombre.localeCompare(b.nombre, 'es')),
  };
}

/** Calcula y GUARDA. Repetirlo sobre el mismo periodo reescribe, no duplica. */
async function recalcular({ hasta } = {}) {
  const cierre = require('./llamadas').diaOperativoHoy();
  // Hasta la última jornada CERRADA: la de hoy va a medias y hundiría a quien
  // esté trabajando ahora mismo.
  const ayer = new Date(Date.parse(cierre + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const r = await calcular(hasta || ayer);
  if (!r.filas.length) return { ...r, guardadas: 0 };

  await db.transaccion(async cli => {
    const TAM = 300;
    for (let i = 0; i < r.filas.length; i += TAM) {
      const t = r.filas.slice(i, i + TAM);
      const N = 18;
      const vals = t.map((_, k) =>
        '(' + Array.from({ length: N }, (_, j) => `$${k * N + j + 1}`).join(',') + ')').join(',');
      await cli.query(
        `INSERT INTO conductor_calificacion (
           conductor_id, periodo_inicio, periodo_fin, letra, letra_por_puntos, tope_aplicado,
           motivo, total, pts_horas, pts_utilizacion, pts_velocidad,
           horas_prom, util_prom, excesos_total, dias_trabajados, dias_utilizacion,
           dias_telemetria, version_modelo)
         VALUES ${vals}
         ON CONFLICT (conductor_id, periodo_inicio, periodo_fin, version_modelo) DO UPDATE SET
           letra = EXCLUDED.letra, letra_por_puntos = EXCLUDED.letra_por_puntos,
           tope_aplicado = EXCLUDED.tope_aplicado, motivo = EXCLUDED.motivo,
           total = EXCLUDED.total, pts_horas = EXCLUDED.pts_horas,
           pts_utilizacion = EXCLUDED.pts_utilizacion, pts_velocidad = EXCLUDED.pts_velocidad,
           horas_prom = EXCLUDED.horas_prom, util_prom = EXCLUDED.util_prom,
           excesos_total = EXCLUDED.excesos_total, dias_trabajados = EXCLUDED.dias_trabajados,
           dias_utilizacion = EXCLUDED.dias_utilizacion,
           dias_telemetria = EXCLUDED.dias_telemetria, calculado_en = now()`,
        t.flatMap(f => [
          f.conductorId, f.periodoInicio, f.periodoFin, f.letra, f.letraPorPuntos || null,
          !!f.topeAplicado, f.motivo || null, f.total == null ? null : f.total,
          f.ptsHoras == null ? null : f.ptsHoras,
          f.ptsUtilizacion == null ? null : f.ptsUtilizacion,
          f.ptsVelocidad == null ? null : f.ptsVelocidad,
          f.horasProm == null ? null : f.horasProm,
          f.utilProm == null ? null : f.utilProm,
          f.excesosTotal == null ? null : f.excesosTotal,
          f.diasTrabajados, f.diasUtilizacion, f.diasTelemetria == null ? null : f.diasTelemetria,
          f.versionModelo,
        ]));
    }
  });
  return { ...r, guardadas: r.filas.length };
}

/** La última calificación de cada uno: Map(conductor_id -> {...}). Lo que pintan las pantallas. */
async function leer() {
  const m = new Map();
  try {
    const r = await db.consulta(
      `SELECT conductor_id, letra, letra_por_puntos, tope_aplicado, total,
              pts_horas, pts_utilizacion, pts_velocidad,
              horas_prom, util_prom, excesos_total, dias_trabajados, dias_utilizacion,
              dias_telemetria, motivo, version_modelo,
              periodo_inicio::text AS desde, periodo_fin::text AS hasta
         FROM v_conductor_calificacion`);
    r.rows.forEach(x => m.set(Number(x.conductor_id), {
      letra: x.letra, letraPorPuntos: x.letra_por_puntos, topeAplicado: !!x.tope_aplicado,
      total: x.total == null ? null : Number(x.total),
      ptsHoras: x.pts_horas, ptsUtilizacion: x.pts_utilizacion, ptsVelocidad: x.pts_velocidad,
      horasProm: x.horas_prom == null ? null : Number(x.horas_prom),
      utilProm: x.util_prom == null ? null : Number(x.util_prom),
      excesosTotal: x.excesos_total, diasTrabajados: x.dias_trabajados,
      diasUtilizacion: x.dias_utilizacion, diasTelemetria: x.dias_telemetria,
      motivo: x.motivo || '',
      version: x.version_modelo, desde: x.desde, hasta: x.hasta,
    }));
  } catch (e) {
    // Sin la tabla (o sin migrar) las pantallas van igual, sin la letra.
    console.error('⚠️  [CALIFICACIÓN] no se pudo leer:', e.message);
  }
  return m;
}

/** El histórico de una persona: para contestar "llevo tres periodos bajando". */
async function historico(conductorId, limite = 12) {
  const r = await db.consulta(
    `SELECT periodo_inicio::text AS desde, periodo_fin::text AS hasta, letra, letra_por_puntos,
            tope_aplicado, total, pts_horas, pts_utilizacion, pts_velocidad,
            horas_prom, util_prom, excesos_total, dias_trabajados, dias_utilizacion,
            dias_telemetria, motivo, version_modelo, calculado_en
       FROM conductor_calificacion
      WHERE conductor_id = $1
      ORDER BY periodo_fin DESC, calculado_en DESC
      LIMIT $2`, [Number(conductorId), Math.min(Number(limite) || 12, 60)]);
  return r.rows;
}

/** El reparto de letras de un periodo: es lo que se mira para recalibrar (§13). */
async function reparto(hasta) {
  const r = await db.consulta(
    `SELECT letra, count(*)::int AS n
       FROM conductor_calificacion
      WHERE periodo_fin = $1::date AND version_modelo = $2
      GROUP BY letra`, [String(hasta).slice(0, 10), MODELO.version]);
  const c = Object.fromEntries(r.rows.map(x => [x.letra, x.n]));
  const evaluados = ['A', 'B', 'C', 'D'].reduce((a, l) => a + (c[l] || 0), 0);
  return {
    ...Object.fromEntries(['A', 'B', 'C', 'D', 'N/E'].map(l => [l, c[l] || 0])),
    evaluados,
    pctA: evaluados ? Math.round((c.A || 0) / evaluados * 100) : 0,
  };
}

module.exports = {
  MODELO, calificar, calcular, recalcular, leer, historico, reparto,
  inicioDe, redondear2, ptsHoras, ptsUtilizacion, ptsVelocidad, peorDe,
};
