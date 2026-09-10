// ============================================================
// RENDIMIENTO — el promedio de horas de cada persona y su letra
// ============================================================
// "Juan Manuel Akieme (9,4 h · A)": lo que Tráfico ve al lado del nombre en el
// planificador y en el cockpit, para saber a quién está colocando o llamando.
//
// EL PROMEDIO ES DEL MES CORRIDO (día 1 → última jornada cerrada) y cuentan:
//   · los días que TRABAJÓ, con sus horas de BOLT MÁS LAS JUSTIFICADAS. Las dos
//     cosas SE SUMAN: 2 h justificadas en el taller + 6 h en BOLT son 8 h ese
//     día, que es la misma regla que usan el reporte y la nómina.
//   · los días que DEBÍA SALIR y no salió SIN NADA que lo justifique, como un 0.
//     Esos son los que bajan la media, y ese es el sentido.
// No cuentan las libranzas, las vacaciones, las bajas, los permisos, los días
// fuera de alta, ni un día justificado sin horas ni trabajo: librar no penaliza
// y una J protege el día.
//
// Las horas salen del histórico SELLADO de la bitácora (`bitacora_horas`), así
// que el promedio no se mueve por recalcular nada: se apoya en lo ya cerrado.
// "Debía salir" es f_cobertura, la misma definición que el resto del ERP.

const db = require('../db');

const TZ = 'Europe/Madrid';

// La escala que pidió el usuario, hecha continua (sin hueco entre 7 y 8).
const ESCALA = [
  { letra: 'S', desde: 9,   texto: '9 h o más' },
  { letra: 'A', desde: 8,   texto: 'entre 8 y 9 h' },
  { letra: 'B', desde: 6,   texto: 'entre 6 y 8 h' },
  { letra: 'C', desde: -1,  texto: 'menos de 6 h' },
];
// Los primeros días de alta NO se promedian: con dos días trabajados no se sabe
// nada de nadie, y salía "0 h · C" como si fuera el peor de la flota. Se dice
// "Nuevo conductor" (letra N) y a partir del cuarto día ya se promedia.
const DIAS_NUEVO = 3;
const letraDe = h => (ESCALA.find(e => h >= e.desde) || ESCALA[ESCALA.length - 1]).letra;

/** Hoy en Madrid, 'YYYY-MM-DD'. */
const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** El día 1 del mes de una fecha. */
const primeroDe = iso => String(iso).slice(0, 8) + '01';

/**
 * Calcula el promedio de todo el mundo para el mes de `hastaIso`, contando
 * desde el día 1 hasta `hastaIso` (incluido). Devuelve las filas, sin escribir.
 *
 * `hastaIso` debe ser una jornada YA CERRADA: la de hoy va a medias y hundiría
 * la media de todo el que esté trabajando ahora mismo.
 */
async function calcular(hastaIso) {
  const hasta = String(hastaIso).slice(0, 10);
  const desde = primeroDe(hasta);
  const r = await db.consulta(
    `WITH dias AS (
       SELECT g.dia::date AS dia FROM generate_series($1::date, $2::date, interval '1 day') g(dia)
     ),
     -- LO QUE VALE UN DÍA = horas de BOLT + horas JUSTIFICADAS. Se suman: 2 h de
     -- taller justificadas y 6 h rodando son 8 h, no 6 ni 2.
     horas AS (
       SELECT conductor_id, dia, sum(seg)::bigint AS seg FROM (
         SELECT conductor_id, dia_operativo AS dia, horas_seg AS seg
           FROM bitacora_horas
          WHERE dia_operativo BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT conductor_id, dia_operativo, COALESCE(horas_seg_momento, 0)
           FROM justificante
          WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
       ) x GROUP BY conductor_id, dia
     ),
     -- Quién DEBÍA salir cada día (la misma regla que todo el ERP).
     debia AS (
       SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date)
        WHERE conductor_id IS NOT NULL
     ),
     -- Días con justificante vivo: aunque no sumen horas, NO cuentan como 0.
     justificado AS (
       SELECT conductor_id, dia_operativo AS dia FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
     ),
     -- Días de ausencia (vacaciones, baja, permiso): tampoco cuentan.
     ausente AS (
       SELECT h.conductor_id, d.dia
         FROM conductor_estado_hist h
         JOIN cat_estado_conductor ce ON ce.codigo = h.estado AND ce.es_ausencia
         JOIN dias d ON d.dia >= h.desde AND (h.hasta IS NULL OR d.dia <= h.hasta)
     ),
     -- Un día cuenta si sumó horas (trabajo + justificado), o si debía salir y no
     -- hay nada que lo explique: entonces es un 0. El resto ni aparece.
     cuenta AS (
       SELECT h.conductor_id, h.dia, h.seg AS horas_seg, FALSE AS es_cero
         FROM horas h
        WHERE h.seg > 0
       UNION ALL
       SELECT d.conductor_id, d.dia, 0, TRUE
         FROM debia d
        WHERE NOT EXISTS (SELECT 1 FROM horas h WHERE h.conductor_id = d.conductor_id AND h.dia = d.dia AND h.seg > 0)
          AND NOT EXISTS (SELECT 1 FROM justificado j WHERE j.conductor_id = d.conductor_id AND j.dia = d.dia)
          AND NOT EXISTS (SELECT 1 FROM ausente a WHERE a.conductor_id = d.conductor_id AND a.dia = d.dia)
     )
     SELECT conductor_id,
            count(*)::int                                   AS dias,
            count(*) FILTER (WHERE es_cero)::int             AS dias_cero,
            round(sum(horas_seg) / 3600.0, 1)               AS horas_total,
            round(sum(horas_seg) / 3600.0 / count(*), 1)    AS horas_prom
       FROM cuenta
      GROUP BY conductor_id`, [desde, hasta]);

  // Los recién incorporados: menos de DIAS_NUEVO desde su alta vigente. Salen
  // con letra 'N' y sin promedio, aunque tengan días con horas.
  const nuevos = new Set((await db.consulta(
    `SELECT DISTINCT e.conductor_id
       FROM conductor_periodo_empleo e
      WHERE e.baja IS NULL AND e.alta IS NOT NULL
        AND e.alta > ($1::date - ($2 || ' days')::interval)`,
    [hasta, String(DIAS_NUEVO)])).rows.map(x => Number(x.conductor_id)));

  const filas = r.rows.map(x => {
    const cid = Number(x.conductor_id);
    const prom = Number(x.horas_prom) || 0;
    const nuevo = nuevos.has(cid);
    return {
      conductorId: cid,
      mes: desde,
      nuevo,
      dias: nuevo ? 0 : x.dias,
      diasCero: nuevo ? 0 : x.dias_cero,
      horasTotal: nuevo ? 0 : (Number(x.horas_total) || 0),
      horasProm: nuevo ? 0 : prom,
      letra: nuevo ? 'N' : letraDe(prom),
    };
  });

  // Un recién incorporado que todavía no ha rodado ni un día no aparece en la
  // consulta de arriba, y aun así hay que poder decir que es nuevo.
  const yaEstan = new Set(filas.map(f => f.conductorId));
  nuevos.forEach(cid => {
    if (!yaEstan.has(cid)) {
      filas.push({ conductorId: cid, mes: desde, nuevo: true, dias: 0, diasCero: 0, horasTotal: 0, horasProm: 0, letra: 'N' });
    }
  });
  return filas;
}

/**
 * Recalcula y GUARDA. `soloIds` limita a unas personas (el cron del mediodía,
 * que solo toca a los TodoTurno). Devuelve cuántas filas quedaron.
 */
async function recalcular({ hasta, soloIds } = {}) {
  // Hasta la última jornada CERRADA: la de hoy va a medias.
  const cierre = require('./llamadas').diaOperativoHoy();
  const ayer = new Date(Date.parse(cierre + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const hastaIso = hasta || ayer;
  const mes = primeroDe(hastaIso);

  let filas = await calcular(hastaIso);
  const limite = soloIds && soloIds.length ? new Set(soloIds.map(Number)) : null;
  if (limite) filas = filas.filter(f => limite.has(f.conductorId));
  if (!filas.length) return { mes, hasta: hastaIso, filas: 0 };

  await db.transaccion(async cli => {
    // Al cambiar de mes se limpia lo del mes anterior: el promedio es del corrido.
    if (!limite) await cli.query('DELETE FROM conductor_rendimiento WHERE mes <> $1::date', [mes]);
    const TAM = 500;
    for (let i = 0; i < filas.length; i += TAM) {
      const t = filas.slice(i, i + TAM);
      const vals = t.map((_, k) => `($${k * 7 + 1},$${k * 7 + 2}::date,$${k * 7 + 3},$${k * 7 + 4},$${k * 7 + 5},$${k * 7 + 6},$${k * 7 + 7})`).join(',');
      await cli.query(
        `INSERT INTO conductor_rendimiento (conductor_id, mes, horas_prom, letra, dias, dias_cero, horas_total)
         VALUES ${vals}
         ON CONFLICT (conductor_id) DO UPDATE SET
           mes = EXCLUDED.mes, horas_prom = EXCLUDED.horas_prom, letra = EXCLUDED.letra,
           dias = EXCLUDED.dias, dias_cero = EXCLUDED.dias_cero, horas_total = EXCLUDED.horas_total,
           calculado_at = now()`,
        t.flatMap(f => [f.conductorId, f.mes, f.horasProm, f.letra, f.dias, f.diasCero, f.horasTotal]));
    }
  });
  return { mes, hasta: hastaIso, filas: filas.length };
}

/**
 * LA LETRA QUE SE PINTA AL LADO DEL NOMBRE.
 *
 * Desde el modelo ABCD, esto ya NO es el promedio de horas del mes con su letra
 * S/A/B/C: es la CALIFICACIÓN A–D de `conductor_calificacion`, que pesa horas
 * (50 %), utilización (30 %) y excesos de velocidad (20 %) sobre 14 días.
 *
 * El cambio se hace AQUÍ y no en las cuatro pantallas que la pintan: el
 * planificador, el cockpit, las campañas y el reporte de horas piden "el
 * rendimiento de esta persona" y siguen pidiendo lo mismo. Lo que ha cambiado es
 * la respuesta, y cambia en los cuatro sitios a la vez o no cambia bien.
 *
 * Se conserva la forma { horas, letra, dias } porque es la que consumen los
 * chips, y se añade el desglose: un chip que dice "B" tiene que poder explicar
 * por qué, y ahora la explicación son tres números y puede que un tope.
 *
 * `conductor_rendimiento` sigue viva y se sigue calculando: la usa el reporte de
 * asistencia, que compara contra el promedio del mes corrido y no contra esto.
 */
async function leer() {
  const m = new Map();
  try {
    const cal = await require('./calificacion').leer();
    cal.forEach((c, cid) => m.set(cid, {
      horas: c.horasProm == null ? 0 : c.horasProm,
      letra: c.letra,
      // "N/E" es lo que antes era "N": todavía no se puede decir nada de esta
      // persona. Los chips ya sabían pintar ese caso.
      nuevo: c.letra === 'N/E',
      dias: c.diasTrabajados || 0,
      diasCero: 0,
      // El desglose, para el tooltip y para la ficha.
      total: c.total, utilProm: c.utilProm, excesos: c.excesosTotal,
      ptsHoras: c.ptsHoras, ptsUtilizacion: c.ptsUtilizacion, ptsVelocidad: c.ptsVelocidad,
      topeAplicado: c.topeAplicado, letraPorPuntos: c.letraPorPuntos,
      diasTelemetria: c.diasTelemetria, motivo: c.motivo,
      desde: c.desde, hasta: c.hasta, version: c.version,
    }));
  } catch (e) {
    // Sin la tabla (o sin migrar todavía) las pantallas van igual, sin la letra.
    console.error('⚠️  [RENDIMIENTO] no se pudo leer la calificación:', e.message);
  }
  return m;
}

/** Quién hace TODOTURNO hoy: cubre día Y noche el mismo día. Para el cron de las 12. */
async function todoTurnoHoy() {
  const dia = require('./llamadas').diaOperativoHoy();
  const r = await db.consulta(
    `SELECT conductor_id FROM f_cobertura($1::date, $1::date)
      WHERE conductor_id IS NOT NULL
      GROUP BY conductor_id HAVING count(DISTINCT turno_id) > 1`, [dia]);
  return r.rows.map(x => Number(x.conductor_id));
}

module.exports = { calcular, recalcular, leer, todoTurnoHoy, letraDe, ESCALA, hoyMadrid };
