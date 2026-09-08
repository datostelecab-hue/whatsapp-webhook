// ============================================================
// INICIO — el panel donde cae todo el mundo al entrar
// ============================================================
// Antes se entraba a /pendientes, tuviera uno permiso o no. Quien no lo tenía
// se comía un "Sin permiso" nada más hacer login y creía que la web se había
// caído. Ahora se entra AQUÍ, que no se bloquea nunca: sin el permiso `/inicio`
// se ve la bienvenida, y con él, las cifras.
//
// Las cifras son las MISMAS de Visibilidad (mismas ventanas, mismas horas
// efectivas) para que no haya dos verdades, pero sin gráficas: esto se mira de
// pasada. Y añade dos cosas que Visibilidad no cuenta:
//
//   · HORAS NO EFECTIVAS — lo que falta para completar la jornada. No es el
//     descanso: es la resta. Quien tiene 2 h justificadas de taller y 3 h
//     conectado en viaje/espera lleva 5 de 8, así que deja 3 h no efectivas.
//
//   · KILÓMETROS — cuánto se rueda CON pasajero y cuánto sin él. Los da el GPS
//     de Mapon, que es lo que hay en PostgreSQL.

const db = require('../db');
const visibilidad = require('../visibilidad');

// La jornada de referencia, en horas. Sale de la config de Visibilidad para no
// tener dos sitios donde tocar los mismos números; 8 h si nadie la ha puesto.
const JORNADA_DEFECTO = 8;

/** El día operativo (jornada 05→05) al que pertenece una hora de un día. */
function jornadaDe(iso, hora) {
  const H0 = require('../flotaViva/rutas').TURNOS.dia[0];
  if (hora >= H0) return iso;
  return diaMenos(iso, 1);
}

/** N días antes de una fecha ISO, sin líos de zona horaria. */
function diaMenos(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Las horas que se quedaron sin hacer, por jornada.
 *
 * Solo cuenta a QUIEN DEBÍA SALIR (`f_cobertura`, la misma regla de todo el
 * ERP), así que las vacaciones y las bajas no ensucian el número: quien está
 * ausente no aparece en la cobertura y no deja horas a deber.
 *
 * Y suma lo JUSTIFICADO con lo trabajado antes de restar, que es justo lo que
 * significa un justificante: esas 2 h de taller no son culpa suya.
 */
async function noEfectivas(desdeIso, hastaIso, jornadaH) {
  const r = await db.consulta(
    `WITH debia AS (
       SELECT DISTINCT conductor_id, dia FROM f_cobertura($1::date, $2::date)
        WHERE conductor_id IS NOT NULL
     ),
     hecho AS (
       SELECT conductor_id, dia, sum(seg)::bigint AS seg FROM (
         SELECT conductor_id, dia_operativo AS dia, horas_seg AS seg
           FROM bitacora_horas WHERE dia_operativo BETWEEN $1::date AND $2::date
         UNION ALL
         SELECT conductor_id, dia_operativo, COALESCE(horas_seg_momento, 0)
           FROM justificante
          WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
       ) x GROUP BY conductor_id, dia
     ),
     -- Lo justificado aparte, solo para poder decir cuánto de lo que falta ya
     -- tiene explicación y cuánto no la tiene.
     just AS (
       SELECT conductor_id, dia_operativo AS dia,
              sum(COALESCE(horas_seg_momento, 0))::bigint AS seg
         FROM justificante
        WHERE anulado_at IS NULL AND dia_operativo BETWEEN $1::date AND $2::date
        GROUP BY 1, 2
     )
     SELECT count(*)::int                                                AS personas_dia,
            count(*) FILTER (WHERE COALESCE(h.seg, 0) = 0)::int          AS sin_salir,
            round(sum(GREATEST(0, $3::numeric * 3600 - COALESCE(h.seg, 0)))
                  / 3600.0, 1)                                          AS no_efectivas_h,
            round(sum(COALESCE(h.seg, 0)) / 3600.0, 1)                   AS hechas_h,
            round(sum(COALESCE(j.seg, 0)) / 3600.0, 1)                   AS justificadas_h,
            round($3::numeric * count(*), 1)                             AS debidas_h
       FROM debia d
       LEFT JOIN hecho h ON h.conductor_id = d.conductor_id AND h.dia = d.dia
       LEFT JOIN just  j ON j.conductor_id = d.conductor_id AND j.dia = d.dia`,
    [desdeIso, hastaIso, jornadaH]);

  const num = v => (v == null ? 0 : Number(v));
  const x = r.rows[0] || {};
  const debidas = num(x.debidas_h);
  const noEfec = num(x.no_efectivas_h);
  return {
    personasDia: num(x.personas_dia),
    sinSalir: num(x.sin_salir),
    horas: noEfec,
    hechas: num(x.hechas_h),
    justificadas: num(x.justificadas_h),
    debidas,
    // Qué parte de lo que se debía se quedó sin hacer.
    porcentaje: debidas > 0 ? Math.round((noEfec / debidas) * 1000) / 10 : null,
  };
}

/**
 * Kilómetros: BOLT contra MAPON. La diferencia es lo que interesa.
 *
 * Mapon (el GPS) ve TODO lo que anda el coche. BOLT solo sabe de él mientras el
 * conductor está conectado. Lo que sobra —Mapon menos BOLT— son kilómetros con
 * el coche rodando y NADIE conectado: el coche se movió y la empresa no se
 * enteró. Eso es lo que hay que mirar cada mañana.
 *
 * Los dos números salen del MISMO sitio, `fv_tramo`, que es lo que ya alimenta
 * la Flota viva: cada tramo lleva su situación, y el catálogo dice cuáles
 * cuentan como conectado. Así no se comparan dos fuentes con dos criterios
 * distintos; se compara la misma traza partida en dos.
 *
 * Los tramos marcados `km_dudoso` quedan fuera: son saltos de señal y meterían
 * kilómetros que no ha hecho nadie —y encima caerían del lado de "fuera de
 * BOLT", que es justo el número que no se puede inflar—.
 */
async function kilometros(desdeIso, hastaIso) {
  const r = await db.consulta(
    `WITH v AS (
       SELECT t.situacion, t.km_m, t.km_dudoso AS dudoso,
              COALESCE(cs.conectado, FALSE) AS conectado
         FROM fv_tramo t
         LEFT JOIN fv_cat_situacion cs ON cs.codigo = t.situacion
        WHERE t.km_m IS NOT NULL
          AND t.desde >= (($1::date + time '05:00') AT TIME ZONE 'Europe/Madrid')
          AND t.desde <  ((($2::date + 1) + time '05:00') AT TIME ZONE 'Europe/Madrid')
     )
     SELECT round(sum(km_m) FILTER (WHERE NOT dudoso) / 1000.0, 1)              AS km_mapon,
            round(sum(km_m) FILTER (WHERE NOT dudoso AND conectado)              / 1000.0, 1) AS km_bolt,
            round(sum(km_m) FILTER (WHERE NOT dudoso AND situacion = 'viaje')    / 1000.0, 1) AS km_viaje,
            round(sum(km_m) FILTER (WHERE NOT dudoso AND situacion = 'espera')   / 1000.0, 1) AS km_espera,
            round(sum(km_m) FILTER (WHERE NOT dudoso AND situacion = 'descanso') / 1000.0, 1) AS km_descanso,
            -- Lo que se tira por salto de señal, para poder DECIRLO: si no, la
            -- cifra de "fuera de BOLT" parece exacta y no lo es.
            round(sum(km_m) FILTER (WHERE dudoso) / 1000.0, 1)                                AS km_descartados
       FROM v`,
    [desdeIso, hastaIso]);

  const num = v => (v == null ? 0 : Number(v));
  const r1 = n => Math.round(n * 10) / 10;
  const x = r.rows[0] || {};
  const mapon = num(x.km_mapon);
  const bolt = num(x.km_bolt);
  const fuera = r1(mapon - bolt);
  return {
    mapon, bolt,
    // LA CIFRA: kilómetros que el GPS vio y BOLT no. Coche andando, nadie
    // conectado.
    fuera,
    porcentajeFuera: mapon > 0 ? Math.round((fuera / mapon) * 1000) / 10 : null,
    // El desglose de lo que SÍ estaba en BOLT, por si hace falta mirar dentro.
    viaje: num(x.km_viaje),
    espera: num(x.km_espera),
    descanso: num(x.km_descanso),
    descartados: num(x.km_descartados),
    conPasajero: num(x.km_viaje),
    aprovechamiento: mapon > 0 ? Math.round((num(x.km_viaje) / mapon) * 1000) / 10 : null,
  };
}

/**
 * El panel entero, de una vez.
 *
 * Las cifras de Visibilidad se piden tal cual: si algún día cambia cómo se
 * cuentan las horas, cambian aquí solas y las dos pantallas siguen diciendo lo
 * mismo. Lo que se añade va por JORNADA (05→05), que es la ventana con la que
 * cuadran la Bitácora y el Reporte de horas.
 */
async function panel() {
  const cfg = await visibilidad.leerConfig();
  const jornadaH = Number(cfg.jornada_h) > 0 ? Number(cfg.jornada_h) : JORNADA_DEFECTO;

  const ahora = new Date();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora);
  const hora = Number(new Intl.DateTimeFormat('en-GB',
    { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(ahora));

  // La jornada EN CURSO y la última CERRADA. La que se mira es la cerrada: la de
  // hoy va por la mitad y las horas que le faltan aún se pueden hacer.
  const enCurso = jornadaDe(hoy, hora);
  const cerrada = diaMenos(enCurso, 1);
  const primeroMes = enCurso.slice(0, 8) + '01';

  // LAS NO EFECTIVAS SOLO DE JORNADAS CERRADAS. Salen de `bitacora_horas`, que
  // es el histórico SELLADO: del día en curso no hay nada ahí todavía y saldría
  // que nadie ha hecho nada. Y aunque lo hubiera, no significaría gran cosa: a
  // media jornada las horas que faltan aún se pueden hacer.
  const [visib, neCerrada, neMes, kmCerrada, kmCurso] = await Promise.all([
    visibilidad.resumen(),
    noEfectivas(cerrada, cerrada, jornadaH),
    noEfectivas(primeroMes, cerrada, jornadaH),
    kilometros(cerrada, cerrada),
    kilometros(enCurso, enCurso),
  ]);

  return {
    hoy, jornadaEnCurso: enCurso, jornadaCerrada: cerrada, jornadaH,
    visibilidad: visib,
    noEfectivas: { cerrada: neCerrada, mes: neMes },
    km: { cerrada: kmCerrada, enCurso: kmCurso },
  };
}

// ── Caché corta ─────────────────────────────────────────────────────────────
// Este panel lo abre TODO EL MUNDO al entrar, y son casi veinte consultas
// pesadas. Sin caché, diez personas entrando a la vez son doscientas consultas
// para pintar los mismos números. Un minuto es de sobra: las horas del mes no
// cambian de un vistazo a otro.
const TTL = 60 * 1000;
let cache = null;

async function panelCacheado() {
  if (cache && Date.now() - cache.ts < TTL) return { ...cache.datos, deCache: true };
  // La promesa se guarda ANTES de esperarla: si entran cinco a la vez mientras
  // se calcula, las cinco esperan al MISMO cálculo en vez de lanzar cinco.
  if (!cache || !cache.enVuelo) {
    const enVuelo = panel().then(datos => {
      cache = { datos, ts: Date.now(), enVuelo: null };
      return datos;
    }).catch(e => { cache = null; throw e; });
    cache = { ...(cache || {}), enVuelo };
  }
  return cache.enVuelo;
}

module.exports = {
  panel: panelCacheado, panelSinCache: panel,
  noEfectivas, kilometros, jornadaDe, diaMenos, JORNADA_DEFECTO,
};
