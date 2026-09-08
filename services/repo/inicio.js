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
 * Kilómetros de una ventana de turno: los que se ruedan DENTRO de BOLT y los que
 * se ruedan fuera.
 *
 * · EN BOLT  = viaje + espera. Es trabajo.
 * · FUERA    = descanso (el "busy" de BOLT) + desconectado. El coche anda y no
 *              está produciendo, o directamente nadie ha fichado.
 *
 * LOS KM SALEN DE `fv_ruta`, NO DE `fv_tramo.km_m`. Esto se aprendió por las
 * malas y está escrito en flotaViva/rutas.js: `km_m` es el salto de odómetro
 * dentro del tramo, y el odómetro solo llega a ratos —de 3.551 tramos de un día,
 * 188 traían km y el 43 % ni lectura—, así que los kilómetros caían en el tramo
 * que estuviera abierto cuando Mapon habló. Con esa fuente este panel daba 1.570
 * km para sesenta coches, que es imposible. `fv_ruta` son los TRAYECTOS de Mapon
 * y es la fuente que cuadró con el informe de BOLT al 0,03 %.
 *
 * Se reparte cada trayecto entre las situaciones que pisa, en proporción al
 * tiempo: un trayecto de 10 km que cae mitad en viaje y mitad en descanso son 5
 * y 5, no 10 para el que estuviera abierto al final.
 *
 * No se calcula aquí: se pide a `rutas.kmConectadoDesconectado`, que es la misma
 * función que usan el cockpit y los reportes. Dos formas de contar kilómetros
 * darían dos verdades.
 */
async function kilometros(dia, turno) {
  const r = await require('../flotaViva/rutas').kmConectadoDesconectado(dia, turno);
  const t = r.total || { enBolt: 0, desconectado: 0, total: 0 };
  const r1 = n => Math.round(n * 10) / 10;
  return {
    dia: r.dia,
    turno,
    enBolt: r1(t.enBolt),
    fuera: r1(t.desconectado),
    total: r1(t.total),
    // Qué parte de lo que rodó la flota se rodó sin estar produciendo. Es LA
    // cifra: el total sube con la actividad, esto no.
    porcentajeFuera: t.total > 0 ? Math.round((t.desconectado / t.total) * 1000) / 10 : null,
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

  // LOS KM, POR TURNO Y EN LAS MISMAS VENTANAS QUE LAS HORAS. Se piden a
  // `visibilidad.ventanaTurnos()` en vez de elegirlas aquí: si cada pantalla
  // escogiera su turno, las horas y los kilómetros no se podrían comparar.
  const vt = visibilidad.ventanaTurnos();

  // LAS NO EFECTIVAS SOLO DE JORNADAS CERRADAS. Salen de `bitacora_horas`, que
  // es el histórico SELLADO: del día en curso no hay nada ahí todavía y saldría
  // que nadie ha hecho nada. Y aunque lo hubiera, no significaría gran cosa: a
  // media jornada las horas que faltan aún se pueden hacer.
  const [visib, neCerrada, neMes, kmDia, kmNoche, kmAyer] = await Promise.all([
    visibilidad.resumen(),
    noEfectivas(cerrada, cerrada, jornadaH),
    noEfectivas(primeroMes, cerrada, jornadaH),
    kilometros(vt.dia.v[0], 'dia'),
    kilometros(vt.noche.v[0], 'noche'),
    // La jornada de ayer entera (05→05), que es la que se compara con las horas
    // de "Ayer · jornada".
    kilometros(cerrada, 'operativo'),
  ]);

  return {
    hoy, jornadaEnCurso: enCurso, jornadaCerrada: cerrada, jornadaH,
    visibilidad: visib,
    noEfectivas: { cerrada: neCerrada, mes: neMes },
    km: {
      dia: { ...kmDia, etq: vt.dia.etq },
      noche: { ...kmNoche, etq: vt.noche.etq },
      ayer: { ...kmAyer, etq: 'Ayer · jornada' },
    },
  };
}

// ── Caché: se sirve lo que hay y se refresca por detrás ─────────────────────
// Este panel lo abre TODO EL MUNDO al entrar y son unas veinte consultas
// pesadas: tarda unos nueve segundos en frío. Una pantalla de entrada no puede
// tardar nueve segundos.
//
// Así que se sirve SIEMPRE lo último que se calculó, aunque esté pasado, y el
// recálculo se lanza por detrás para el siguiente. Solo espera de verdad quien
// entra el primero tras arrancar. Los datos de fondo se refrescan cada cinco
// minutos (la ingesta), así que enseñar algo de hace tres no engaña a nadie —y
// para saberlo está `calculadoAt`, que la pantalla enseña—.
const FRESCO = 5 * 60 * 1000;    // más nuevo que esto, no se toca
const VIEJO_TOPE = 30 * 60 * 1000;   // más viejo que esto, mejor esperar al nuevo
let cache = null;      // { datos, ts }
let enVuelo = null;    // el recálculo en curso, si lo hay

function recalcular() {
  if (enVuelo) return enVuelo;
  enVuelo = panel()
    .then(datos => { cache = { datos, ts: Date.now() }; return datos; })
    .finally(() => { enVuelo = null; });
  return enVuelo;
}

async function panelCacheado({ forzar = false } = {}) {
  // Pedir refresco a mano recalcula de verdad. Es lo único que salta la caché:
  // entrar a la pantalla NO recalcula, sirve lo último que hay.
  if (forzar) {
    const datos = await recalcular();
    return { ...datos, calculadoAt: Date.now(), edadMs: 0 };
  }
  const edad = cache ? Date.now() - cache.ts : Infinity;
  if (edad < FRESCO) return { ...cache.datos, calculadoAt: cache.ts, edadMs: edad };

  // Hay algo y no es una antigualla: se devuelve YA y se refresca por detrás.
  if (cache && edad < VIEJO_TOPE) {
    recalcular().catch(e => console.error('❌ [INICIO] refresco en segundo plano:', e.message));
    return { ...cache.datos, calculadoAt: cache.ts, edadMs: edad };
  }

  // Nada en caché (o demasiado viejo): toca esperar. Si entran cinco a la vez,
  // las cinco esperan al MISMO cálculo, no lanzan cinco.
  const datos = await recalcular();
  return { ...datos, calculadoAt: Date.now(), edadMs: 0 };
}

module.exports = {
  panel: panelCacheado, panelSinCache: panel,
  noEfectivas, kilometros, jornadaDe, diaMenos, JORNADA_DEFECTO,
};
