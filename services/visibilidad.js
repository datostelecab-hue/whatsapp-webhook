// ============================================================
// VISIBILIDAD — el "VISOR EN VIVO AMBAS FLOTAS", pero sobre PostgreSQL
// ============================================================
// Reconstruye el visor de horas de la hoja SIN hoja y SIN pegarle a la API en cada
// pintado: todo sale del NÚCLEO que ya ingiere BOLT.
//   · Horas efectivas / espera / utilización → fv_tramo (services/flotaViva).
//   · Neto / viajes / €·hora / viajes·hora    → bolt_order.
//   · Ideal / crítico / brecha                → visibilidad_config (la pestaña Config).
//
// Dos fuentes de datos, dos pools (misma BD): el núcleo va por su propio pool
// (services/flotaViva/db) y bolt_order/config/snapshot por el principal (services/db).
// Cada consulta arma su ventana con AT TIME ZONE 'Europe/Madrid', igual que el resto
// del núcleo, así que día, semana, mes y turnos cuadran al segundo con el reporte.

const db = require('./db');              // bolt_order, visibilidad_config, visibilidad_dia
const fv = require('./flotaViva/db');    // fv_tramo (núcleo)
const serieRepo = require('./repo/visibilidadSerie');   // el histórico de BOLT de antes del núcleo (db/217)

// Config por defecto = la pestaña Config de la hoja. dias_del_mes null = días reales.
// `meta` es la del MES en horas. Las de turno son diarias y van aparte: la meta
// del día son 1.000 h repartidas entre los dos turnos, y lo que interesa mirar a
// media tarde es cómo va ESTE turno contra SU meta, no el mes contra la suya.
const CONFIG_DEFECTO = {
  capacidad_diaria_h: 16, meta: 28157, vehiculos: 73, dias_del_mes: null,
  meta_turno_dia_h: 500, meta_turno_noche_h: 500,
};

// ── Utilidades de fecha (todo en hora de Madrid, como el núcleo) ──────────────
const fmtFecha = (d) => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hoyISO = () => fmtFecha(new Date());
// "Hace n días" CAMINANDO EL CALENDARIO, no restando bloques de 24 h. Restar
// 24 h y formatear en Madrid fallaba las madrugadas del cambio de hora: el día
// después de adelantar el reloj, entre las 00:00 y la 01:00, "ayer" salía
// anteayer — y con ello la tarjeta de Ayer, el lunes de la semana, el gráfico
// de últimos días y qué días refresca el cron. El mediodía UTC es inmune.
const diaISOhace = (n) => {
  const [y, m, d] = hoyISO().split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) - n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
const horaMadrid = () => Number(new Intl.DateTimeFormat('en-GB',
  { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date())) % 24;
const diasEnMes = (anio, mes) => new Date(anio, mes, 0).getDate();   // mes 1-12

// ── Agregados de una VENTANA (dia ISO, hora inicio, offset días, hora fin) ────
// Devuelve segundos por situación de flota + nº de conductores. La ventana la clava
// el propio SQL en Madrid; los datos que aún no existen (futuro) no suman, así que
// una ventana "hasta las 24:00" con la mitad del día por venir da el parcial de hoy.
async function horasVentana(dia, hIni, offDias, hFin) {
  if (!fv.HAY_BD) return { viajeSeg: 0, esperaSeg: 0, descansoSeg: 0, conductores: 0 };
  await fv.preparar();
  const r = await fv.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
     tr AS (
       SELECT t.situacion, t.conductor_uuid,
              EXTRACT(EPOCH FROM (LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini))) AS seg
         FROM fv_tramo t CROSS JOIN v
        WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
          AND t.situacion IN ('viaje','espera','descanso')
     )
     SELECT COALESCE(sum(seg) FILTER (WHERE situacion = 'viaje'), 0)::bigint    AS viaje_seg,
            COALESCE(sum(seg) FILTER (WHERE situacion = 'espera'), 0)::bigint   AS espera_seg,
            COALESCE(sum(seg) FILTER (WHERE situacion = 'descanso'), 0)::bigint AS descanso_seg,
            count(DISTINCT conductor_uuid) FILTER (WHERE situacion IN ('viaje','espera')) AS conductores
       FROM tr`,
    [String(dia).slice(0, 10), String(hIni), offDias, String(hFin)]);
  const x = r.rows[0] || {};
  return {
    viajeSeg: Number(x.viaje_seg) || 0,
    esperaSeg: Number(x.espera_seg) || 0,
    descansoSeg: Number(x.descanso_seg) || 0,
    conductores: Number(x.conductores) || 0,
  };
}

// Dinero (neto) y viajes terminados de la MISMA ventana, desde bolt_order.
async function dineroVentana(dia, hIni, offDias, hFin) {
  if (!db.HAY_BD) return { neto: 0, viajes: 0 };
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT COALESCE(round(sum(o.neto) FILTER (WHERE o.estado = 'finished'), 2), 0)::float AS neto,
            count(*) FILTER (WHERE o.estado = 'finished')::int AS viajes
       FROM bolt_order o CROSS JOIN v
      WHERE o.creado_ts >= v.ini AND o.creado_ts < v.fin`,
    [String(dia).slice(0, 10), String(hIni), offDias, String(hFin)]);
  const x = r.rows[0] || {};
  return { neto: Number(x.neto) || 0, viajes: Number(x.viajes) || 0 };
}

// Slice completo de una ventana: horas + dinero + derivados (utilización, €·h, v·h).
async function slice(dia, hIni, offDias, hFin) {
  const [h, d] = await Promise.all([
    horasVentana(dia, hIni, offDias, hFin),
    dineroVentana(dia, hIni, offDias, hFin),
  ]);
  return metricas(h, d);
}

/**
 * LAS MÉTRICAS DE UNA VENTANA, de sus segundos y su dinero. Pura: la usa también
 * la Visibilidad de Barcelona (modules/Barcelona), para que las dos sedes se midan
 * con las mismas cuentas.
 *   h  { viajeSeg, esperaSeg, descansoSeg, conductores }
 *   d  { neto, viajes }
 */
function metricas(h, d) {
  const efectivasSeg = h.viajeSeg + h.esperaSeg;
  const horas = efectivasSeg / 3600;
  return {
    horasEfectivas: Math.round(horas * 10) / 10,
    viajeH: Math.round((h.viajeSeg / 3600) * 10) / 10,
    esperaH: Math.round((h.esperaSeg / 3600) * 10) / 10,
    descansoH: Math.round((h.descansoSeg / 3600) * 10) / 10,
    // Utilización = viaje / (viaje + espera). Null si no hubo horas efectivas.
    utilizacion: efectivasSeg > 0 ? Math.round((h.viajeSeg / efectivasSeg) * 1000) / 10 : null,
    conductores: h.conductores,
    neto: Math.round(d.neto * 100) / 100,
    viajes: d.viajes,
    eurosHora: horas > 0 ? Math.round((d.neto / horas) * 100) / 100 : null,
    viajesHora: horas > 0 ? Math.round((d.viajes / horas) * 10) / 10 : null,
  };
}

// ── Config editable (la pestaña Config) ──────────────────────────────────────
async function leerConfig() {
  if (!db.HAY_BD) return { ...CONFIG_DEFECTO };
  try {
    const r = await db.consulta(`SELECT valor FROM visibilidad_config WHERE clave = 'parametros'`);
    return { ...CONFIG_DEFECTO, ...(r.rows[0] ? r.rows[0].valor : {}) };
  } catch (e) {
    // Si la tabla aún no existe (migración sin aplicar), no romper la pantalla.
    return { ...CONFIG_DEFECTO };
  }
}

async function guardarConfig(patch) {
  const actual = await leerConfig();
  const limpio = {};
  for (const k of ['capacidad_diaria_h', 'meta', 'vehiculos', 'dias_del_mes',
                   'meta_turno_dia_h', 'meta_turno_noche_h']) {
    if (patch[k] === undefined) { limpio[k] = actual[k]; continue; }
    if (patch[k] === null || patch[k] === '') { limpio[k] = null; continue; }
    const n = Number(patch[k]);
    limpio[k] = Number.isFinite(n) ? n : actual[k];
  }
  await db.consulta(
    `INSERT INTO visibilidad_config (clave, valor, actualizado_at)
     VALUES ('parametros', $1::jsonb, now())
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_at = now()`,
    [JSON.stringify(limpio)]);
  return limpio;
}

// ── LAS HORAS DE UN TURNO, POR LA GENTE DE ESE TURNO ─────────────────────────
// Desde el 06/10/2026 (Camilo) un turno no es un reloj: son las horas de SU
// GENTE. El de día cuenta de 00:00 a 24:00 y el de noche de 12:00 a 12:00 del
// día siguiente, siempre según el turno de cada conductor en el cuadrante; los
// NN, por su hora de inicio (antes de las 12:00, día). Es la regla de Control
// (services/flotaViva/repartoTurnos.js): las dos pantallas cuentan igual.
//
// Antes era el reloj (05→17 y 17→05) y se perdía, por ejemplo, lo que hace
// quien es de día y entra a las 04:00, y lo que hace a las 16:00 el de noche
// se le daba al día.
function sliceDeTurno(x) {
  const efectivasSeg = x.viajeSeg + x.esperaSeg;
  const r1 = v => Math.round(v * 10) / 10;
  return {
    horasEfectivas: r1(efectivasSeg / 3600),
    viajeH: r1(x.viajeSeg / 3600),
    esperaH: r1(x.esperaSeg / 3600),
    utilizacion: efectivasSeg > 0 ? Math.round((x.viajeSeg / efectivasSeg) * 1000) / 10 : null,
    // Cada persona una vez por turno. Solo sale en los dos quien de verdad hizo
    // los dos: quien dobla, o un NN con un rato de mañana y otro de noche.
    conductores: x.personas.size,
    // Lo que va por la hora de inicio (sin turno en el cuadrante), aparte.
    horasNN: r1(x.nnSeg / 3600),
    conductoresNN: x.nnPersonas.size,
  };
}

// ── KPIs "en vivo" (mes, hoy, semana, turno actual, turno anterior) ──────────
// "Turno actual" es el que corre AHORA; "anterior", el inmediatamente previo.
// POR TURNO es OTRA COSA que por día: el turno de noche CRUZA MEDIANOCHE, así
// que no cuadra con ningún día natural. Aquí se devuelven los dos turnos
// relevantes "ahora": el día de hoy y la noche que toca. Se cambia de tarjeta a
// la hora estándar de entrar (05:00 y 17:00).
//
// `v` sigue siendo la ventana de RELOJ del turno (05→17, 17→05): la usa el panel
// de inicio para los km. Las HORAS de las tarjetas ya no salen de ahí, sino del
// reparto por conductor (sliceDeTurno).
function ventanaTurnos() {
  const H = horaMadrid();
  const hoy = hoyISO(), ayer = diaISOhace(1);
  // Las horas NO se escriben aquí: salen de rutas.TURNOS, que es donde viven para
  // todo el ERP (y de AUDITORIA_HORA_DIA / AUDITORIA_HORA_NOCHE). Tenerlas a mano
  // en este fichero era la forma segura de que el día que cambien los turnos esta
  // pantalla se quedara sola diciendo otra cosa.
  const T = require('./flotaViva/rutas').TURNOS;
  const dia = (d) => [d, T.dia[0], T.dia[1], T.dia[2]];
  const noche = (d) => [d, T.noche[0], T.noche[1], T.noche[2]];
  // Turno DÍA: el de hoy (en curso o cerrado)… salvo de MADRUGADA. Antes de las
  // 05:00 el turno de día de hoy AÚN NO HA EMPEZADO y la tarjeta salía a cero
  // sin decir nada: el último turno de día que existe es el de ayer.
  const turnoDia = H >= T.dia[0]
    ? { etq: 'Turno día · hoy', v: dia(hoy) }
    : { etq: 'Turno día · ayer', v: dia(ayer) };
  // Turno NOCHE: por la tarde/noche (>=17) la de ESTA noche (hoy 17→mañana 05); de
  // madrugada o de día, la que acaba de pasar (anoche 17→hoy 05).
  const turnoNoche = H >= T.noche[0]
    ? { etq: 'Turno noche · hoy', v: noche(hoy) }
    : { etq: 'Turno noche · anoche', v: noche(ayer) };
  return { dia: turnoDia, noche: turnoNoche };
}

/**
 * Con `{ gente: true }` (el inicio), las tarjetas de turno y la jornada llevan
 * además `gente`: lo de cada persona, [{ persona, seg, nn, cuentas }], de la
 * misma carga que sus totales; y las de turno, `planificados` (quien lo tenía en
 * el plan, haya salido o no). Visibilidad no la pide: no la pinta.
 */
async function resumen({ gente = false } = {}) {
  const hoy = hoyISO();
  const ayer = diaISOhace(1);
  const [Y, M] = hoy.split('-').map(Number);
  const primeroMes = `${Y}-${String(M).padStart(2, '0')}-01`;
  const dm = diasEnMes(Y, M);
  // Lunes de esta semana (getDay: 0=domingo). En Madrid da igual la hora: es la fecha.
  const dow = (new Date(hoy + 'T12:00:00').getDay() + 6) % 7;   // 0 = lunes
  const lunes = diaISOhace(dow);

  // DOS FORMAS DE MIRAR EL MISMO DÍA, Y LAS DOS VALEN. El DÍA NATURAL (00:00→24:00)
  // es lo que cuadra con el informe de BOLT y con el histórico del mes; la JORNADA
  // es la de los dos turnos de ese día y la que cuadra con el Reporte de horas.
  // No son el mismo número —la noche cruza la medianoche— y por eso se enseñan
  // las dos, cada una con su etiqueta.
  const T = require('./flotaViva/rutas').TURNOS;
  const H0 = T.dia[0];                                     // la hora de entrar del día: 05:00
  // Antes de las 05:00 la jornada que se mira es la de ANTEAYER.
  const ayerJornada = horaMadrid() < H0 ? diaISOhace(2) : ayer;
  const reparto = require('./flotaViva/repartoTurnos');
  const t = ventanaTurnos();
  // DOS FORMAS DE MIRAR EL MISMO DÍA, Y LAS DOS VALEN. Son la gracia de esta
  // pantalla, no un descuido:
  //   · DÍA NATURAL (00:00→24:00): lo que cuadra con los informes de BOLT y con
  //     el acumulado del mes. Es la fila de la izquierda.
  //   · JORNADA: el turno de día de ese día más su turno de noche, por la gente
  //     de cada uno (desde el 06/10/2026; antes, de 05:00 a 05:00). Cuadra con
  //     el Reporte de horas y con la Bitácora.
  // Se probó a poner las dos filas por jornada y fue peor: a media mañana "HOY"
  // y "TURNO DÍA" daban el mismo número (la jornada en curso ES el turno de día
  // hasta las 17:00) y la tarjeta no decía nada.
  const fechaDia = t.dia.v[0], fechaNoche = t.noche.v[0];
  const [mes, dia, ayerDia, semana, porTurno, config] = await Promise.all([
    slice(primeroMes, 0, dm, 0),           // todo el mes, días naturales (los futuros no suman)
    slice(hoy, 0, 1, 0),                   // HOY, día natural 00:00 → 24:00 (parcial)
    slice(ayer, 0, 1, 0),                  // AYER, día natural completo
    slice(lunes, 0, 7, 0),                 // lunes → lunes (parcial)
    // Los TURNOS de una vez, por la gente de cada uno (sliceDeTurno): el día y
    // la noche que tocan ahora, y los dos de la jornada de ayer.
    reparto.porTurno([fechaDia, fechaNoche, ayerJornada], { gente }),
    leerConfig(),
  ]);
  const turnoDia = sliceDeTurno(porTurno.get(fechaDia + '|dia'));
  const turnoNoche = sliceDeTurno(porTurno.get(fechaNoche + '|noche'));
  // LA JORNADA DE AYER = su turno de día + su turno de noche. La gente se cuenta
  // una vez aunque hiciera los dos.
  const jD = porTurno.get(ayerJornada + '|dia'), jN = porTurno.get(ayerJornada + '|noche');
  const ayerJor = sliceDeTurno({
    viajeSeg: jD.viajeSeg + jN.viajeSeg, esperaSeg: jD.esperaSeg + jN.esperaSeg,
    personas: new Set([...jD.personas, ...jN.personas]),
    nnSeg: jD.nnSeg + jN.nnSeg, nnPersonas: new Set([...jD.nnPersonas, ...jN.nnPersonas]),
  });
  // Su noche cuenta hasta las 12:00 de hoy: antes de eso, todavía crece.
  const jornadaAbierta = Date.now() < reparto.cierreDe(ayerJornada);
  // Lo que puso cada turno de esa jornada, para que el inicio la pinte partida en
  // día y noche. Son las mismas horas de arriba, separadas: suman ayerJor.
  const r1 = v => Math.round(v * 10) / 10;
  const partes = {
    dia: r1((jD.viajeSeg + jD.esperaSeg) / 3600),
    noche: r1((jN.viajeSeg + jN.esperaSeg) / 3600),
  };
  // La gente de cada tarjeta, si se pidió. En la jornada, cada persona una vez,
  // con lo de su día y lo de su noche sumado (quien dobla lleva las dos).
  const conGente = {};
  if (gente) {
    // Y quién lo tenía en el plan, haya salido o no (el inicio lo usa en el
    // turno en curso: «deben salir»).
    const de = k => ({ gente: porTurno.get(k).gente || [], planificados: porTurno.get(k).planificados || [] });
    conGente.dia = de(fechaDia + '|dia');
    conGente.noche = de(fechaNoche + '|noche');
    const junta = new Map();
    [...(jD.gente || []), ...(jN.gente || [])].forEach(g => {
      const x = junta.get(g.persona);
      if (!x) junta.set(g.persona, { ...g, cuentas: [...g.cuentas] });
      else {
        x.seg += g.seg;
        x.nn = x.nn && g.nn;
        g.cuentas.forEach(c => { if (!x.cuentas.includes(c)) x.cuentas.push(c); });
      }
    });
    conGente.jornada = { gente: [...junta.values()] };
  }
  return {
    hoyISO: hoy,
    // POR DÍA (día natural 00:00→24:00)
    mes: { ...mes, etq: 'Este mes' },
    dia: { ...dia, etq: 'Hoy' },
    ayer: { ...ayerDia, etq: 'Ayer' },
    semana: { ...semana, etq: 'Esta semana' },
    // POR TURNO: las horas y la gente de cada turno, por el turno de cada
    // conductor (día 00→24, noche 12→12; los NN por su hora de inicio).
    turnoDia: { ...turnoDia, ...conGente.dia, etq: t.dia.etq, dia: fechaDia },
    turnoNoche: { ...turnoNoche, ...conGente.noche, etq: t.noche.etq, dia: fechaNoche },
    ayerJornada: { ...ayerJor, ...conGente.jornada, dia: ayerJornada, parcial: jornadaAbierta, partes,
      etq: jornadaAbierta ? 'Ayer · jornada (se cierra a las 12:00)' : 'Ayer · jornada completa' },
    config,
  };
}

// ── A ESTA HORA: hoy contra los días de antes, a la misma hora ────────────────
// Camilo, 30/10/2026: «ayer a las 12:28 estábamos con este total de horas, hoy
// con estas. Así pero con dos días hacia atrás y también con el día de la semana
// pasada (el viernes de esta semana con el viernes de la semana pasada), con
// porcentajes reales, y que lo entienda una persona que no sabe de datos».
//
// Las horas efectivas (viaje + espera) de HOY desde las 00:00 hasta ahora, contra
// las de AYER, ANTEAYER y el MISMO DÍA DE LA SEMANA PASADA desde las 00:00 hasta
// la MISMA HORA. Día natural, como la tarjeta de Hoy: a las 12:28 se comparan doce
// horas y media con doce horas y media, no con el día entero. La ventana la clava
// el SQL en Madrid, así que un día con cambio de hora corta a la misma hora del
// reloj. `difPct` = cuánto va hoy por encima (+) o por debajo (−) de ese día.
//
// Y POR TURNO Y POR JORNADA (30/10/2026, Camilo: «dos botones para cambiar a la
// vista de hora natural y hora por turno… y jornada»). Con la misma regla que las
// tarjetas de turno (repartoTurnos: la gente de cada turno según el cuadrante; el
// día cuenta desde las 00:00 y la noche desde las 12:00), cortada a la misma hora:
//   · turno de día de cada día, de 00:00 a esa hora;
//   · turno de noche EN CURSO: desde las 12:00 de hoy si ya han dado, y si no,
//     la que empezó ayer a las 12:00; y la de cada día de antes, igual;
//   · jornada de cada día = su turno de día + su turno de noche, todo lo que lleva
//     hasta esa hora (antes de las 12:00 su noche aún no ha empezado).
// Las tres vistas van en la misma respuesta: cambiar de botón no espera a nadie.
//
// `ref` = { dia: 'AAAA-MM-DD', hora: 'HH:MM' } solo para probar con un día pasado.
const OTROS_DIAS = [['ayer', 1], ['anteayer', 2], ['semana', 7]];
const restarDias = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) - n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/**
 * LA HORA Y LOS DÍAS de «A esta hora»: hoy y los que se le comparan, con la hora
 * de corte. La comparten Madrid y Barcelona (modules/Barcelona), que solo cambian
 * de dónde salen las horas.
 *   → { hoy, hora 'HH:MM', hNum (horas desde las 00:00), tarde (¿ha empezado la
 *       noche de hoy?), dias: [{ clave, dia, noche }] } — `noche` = la fecha de la
 *       noche en curso a esa hora de ese día.
 */
function momentoAEstaHora(ref = {}) {
  const hoy = /^\d{4}-\d{2}-\d{2}$/.test(ref.dia || '') ? ref.dia : hoyISO();
  const hora = /^\d{2}:\d{2}$/.test(ref.hora || '') ? ref.hora
    : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false })
      .format(new Date()).replace(/^24/, '00');
  const [hh, mm] = hora.split(':').map(Number);
  const hNum = hh + mm / 60;
  const tarde = hNum >= require('./flotaViva/repartoTurnos').INICIO.noche;
  const dias = [['hoy', 0], ...OTROS_DIAS].map(([clave, n]) => {
    const dia = restarDias(hoy, n);
    return { clave, dia, noche: tarde ? dia : restarDias(dia, 1) };
  });
  return { hoy, hora, hNum, tarde, dias };
}

/**
 * LA RESPUESTA de «A esta hora», de las horas ya contadas. Pura.
 *   natural  [{ clave, dia, horas }]
 *   turnos   [{ clave, dia, noche, turnoDia, turnoNoche, jornada }] (horas)
 */
function armarAEstaHora({ hoy, hora, tarde, natural, turnos }) {
  const r1 = v => Math.round(v * 10) / 10;
  // Cuánto va hoy por encima (+) o por debajo (−) de cada día, en horas y en %.
  // Contra un día con menos de MIN_COMPARAR horas el % no dice nada (a las 12:28
  // la noche lleva media hora: 0 contra 0,5 h sería «−100 %»): va `pocas`.
  const MIN_COMPARAR = 10;
  const comparar = filas => {
    const deHoy = filas[0].horas;
    filas.forEach(f => {
      if (f.clave === 'hoy') { f.difHoras = null; f.difPct = null; return; }
      f.pocas = f.horas < MIN_COMPARAR;
      f.difHoras = f.pocas ? null : r1(deHoy - f.horas);
      f.difPct = f.pocas ? null : Math.round((deHoy - f.horas) / f.horas * 1000) / 10;
    });
    return filas;
  };
  const de = (campo, fecha) => comparar(turnos.map(t => ({ clave: t.clave, dia: t[fecha], horas: r1(t[campo]) })));
  return {
    hora, hoy,
    natural: { filas: comparar(natural.map(n => ({ clave: n.clave, dia: n.dia, horas: r1(n.horas) }))) },
    turno: { dia: { filas: de('turnoDia', 'dia') }, noche: { filas: de('turnoNoche', 'noche'), empezoHoy: tarde } },
    jornada: { filas: de('jornada', 'dia') },
  };
}

async function aEstaHora(ref = {}) {
  const { hoy, hora, hNum, tarde, dias } = momentoAEstaHora(ref);
  const hFin = hNum.toFixed(4);                    // horas desde las 00:00, al minuto
  const reparto = require('./flotaViva/repartoTurnos');
  const [natural, turnos] = await Promise.all([
    Promise.all(dias.map(async ({ clave, dia }) => {
      const h = await horasVentana(dia, 0, 0, hFin);
      return { clave, dia, horas: (h.viajeSeg + h.esperaSeg) / 3600 };
    })),
    Promise.all(dias.map(async ({ clave, dia, noche }) => {
      const m = await reparto.porTurno([dia, noche], { hasta: reparto.instante(dia, hNum) });
      const h = k => { const x = m.get(k); return x ? (x.viajeSeg + x.esperaSeg) / 3600 : 0; };
      return { clave, dia, noche, turnoDia: h(dia + '|dia'), turnoNoche: h(noche + '|noche'),
        jornada: h(dia + '|dia') + h(dia + '|noche') };
    })),
  ]);
  return armarAEstaHora({ hoy, hora, tarde, natural, turnos });
}

// ── Serie del MES para los gráficos (por día, acumulado, ideal, crítico, brecha) ─
// Lee la foto diaria (visibilidad_dia). Si el mes pedido no tiene fotos aún, las
// genera al vuelo (backfill perezoso), para que el gráfico nunca salga vacío. El
// día de hoy se recalcula EN VIVO por encima de la foto, para que el acumulado esté
// siempre fresco sin esperar al cron.
async function serieMes(anio, mes) {
  const config = await leerConfig();
  const dm = Number(config.dias_del_mes) > 0 ? Number(config.dias_del_mes) : diasEnMes(anio, mes);
  const primero = `${anio}-${String(mes).padStart(2, '0')}-01`;

  let fotos = await leerFotosMes(anio, mes);
  // Rellenar CUALQUIER día pasado del mes sin foto. El cron solo hace hoy+ayer, así
  // que tras un backfill de tramos los días anteriores del mes en curso (o un mes
  // pasado entero) se quedaban sin foto y el acumulado no cuadraba con el KPI. Cada
  // día que falte se calcula del núcleo y se guarda; en la siguiente carga ya está.
  const hoy = hoyISO();
  const [Yh, Mh, Dh] = hoy.split('-').map(Number);
  const esMesActual = (Yh === anio && Mh === mes);
  // Un mes FUTURO no tiene ni un día con datos: sin este cero, el navegador de
  // meses pintaba los ceros como serie real (acumulado plano, brecha en rojo) y
  // el backfill perezoso escribía fotos vacías de días que no han pasado.
  const esFuturo = anio > Yh || (anio === Yh && mes > Mh);
  const ultimoConDatos = esFuturo ? 0 : (esMesActual ? Dh : dm);   // mes pasado: todos los días
  // EL HISTÓRICO DE BOLT (25/10/2026). Los días de antes de que el núcleo tuviera
  // datos (antes del 01/07/2026) viven en visibilidad_dia_historico (db/217). La
  // regla del contrato: un día vale su foto si tiene horas y, si no, el histórico
  // (services/visibilidadTendencia.js → fundirDias). Se lee, nunca se escribe: ni el
  // recálculo de abajo lo pisa ni él pisa una foto con horas. Sin db/217, nada.
  // El último día REAL del mes, no `dm`: si Config fija los días del mes (un
  // número para todos los meses), con 30 se pedía el '2026-02-30', PostgreSQL daba
  // error, el .catch se lo tragaba y febrero salía sin histórico, a cero.
  const diasReales = diasEnMes(anio, mes);
  const ultimoISO = `${anio}-${String(mes).padStart(2, '0')}-${String(diasReales).padStart(2, '0')}`;
  const [hist, primerTramo] = esFuturo ? [{ filas: [] }, null] : await Promise.all([
    serieRepo.historico(primero, ultimoISO).catch(() => ({ filas: [] })),
    serieRepo.primerDiaNucleo().catch(() => null),
  ]);
  hist.filas.forEach(h => {
    const d = Number(h.dia.slice(8, 10));
    const f = fotos.get(d);
    if ((f && (f.viajeSeg + f.esperaSeg) > 0) || (h.viajeSeg + h.esperaSeg) <= 0) return;
    fotos.set(d, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg, origen: 'historico' });
  });
  // Tampoco se recalcula un día que no existe (el 31 de septiembre con «días del
  // mes» a 31 en Config): sería una consulta que falla seguro.
  for (let d = 1; d <= Math.min(ultimoConDatos, diasReales); d++) {
    const f = fotos.get(d);
    // Recalcula el día si FALTA o si su foto está a 0: un 0 puede ser una foto vieja
    // de antes de meter el histórico de tramos (backfill). Una foto con horas ya es
    // buena y no se recalcula. Al reescribir con capturarDia se sana también en la BD.
    if (f && (f.viajeSeg + f.esperaSeg) > 0) continue;
    const dISO = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // Antes del primer tramo del núcleo no hay nada que recalcular: abrir julio (que
    // se compara con junio) rehacía cada vez los 30 días de junio para escribir ceros.
    if (primerTramo && dISO < primerTramo) continue;
    try {
      const h = await capturarDia(dISO);
      if (h) fotos.set(d, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg });
    } catch (e) { /* un día que falle no corta el resto del mes */ }
  }
  // Hoy SIEMPRE en vivo por encima de su foto, para que el acumulado esté fresco.
  if (esMesActual) {
    const h = await horasVentana(hoy, 0, 1, 0);
    fotos.set(Dh, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg });
  }

  const dinero = await dineroVentana(primero, 0, dm, 0);
  return {
    anio, mes, diasMes: dm, config,
    // Hasta qué día hay datos de verdad: en el mes en curso, hoy; en uno pasado, todos.
    // Los gráficos cortan ahí las series reales; el ideal y el crítico siguen hasta
    // fin de mes porque son el objetivo, no un dato.
    ultimoConDatos, esMesActual, hoyDia: esMesActual ? Dh : null,
    ...armarSerie({ fotos, dm, config, dinero }),
  };
}

/**
 * LA SERIE DEL MES, de las horas de cada día: el acumulado, el ideal, el crítico
 * y la brecha, y los totales del mes. Pura: la usa también la Visibilidad de
 * Barcelona.
 *   fotos   Map(díaDelMes → { viajeSeg, esperaSeg })
 *   dm      los días del mes
 *   config  { meta, capacidad_diaria_h, vehiculos }
 *   dinero  { neto, viajes } del mes
 */
function armarSerie({ fotos, dm, config, dinero }) {
  const meta = Number(config.meta) || 0;
  const cap = Number(config.capacidad_diaria_h) || 0;
  const veh = Number(config.vehiculos) || 0;
  const idealDiario = dm > 0 ? meta / dm : 0;

  const dias = [];
  let acumulado = 0;
  for (let d = 1; d <= dm; d++) {
    const f = fotos.get(d) || { viajeSeg: 0, esperaSeg: 0 };
    const efectivas = (f.viajeSeg + f.esperaSeg) / 3600;   // TOTAL del día
    const waiting = f.esperaSeg / 3600;
    acumulado += efectivas;
    const ideal = idealDiario * d;
    // CRÍTICO(d) = MAX(0, meta - (díasMes - d) * capacidad·h * vehículos). Es el
    // acumulado mínimo que hay que llevar el día d para que la meta siga siendo
    // alcanzable con la capacidad que queda.
    const critico = Math.max(0, meta - (dm - d) * cap * veh);
    const r1 = (x) => Math.round(x * 10) / 10;
    dias.push({
      dia: d,
      // De dónde sale el día, si no es del núcleo (el histórico de BOLT): la tabla
      // lo marca. Barcelona no lo trae y su serie no cambia.
      ...(f.origen ? { origen: f.origen } : {}),
      total: r1(efectivas),
      waiting: r1(waiting),
      utilizacion: efectivas > 0 ? Math.round((efectivas - waiting) / efectivas * 1000) / 10 : null,
      acumulado: r1(acumulado),
      ideal: Math.round(ideal),
      critico: Math.round(critico),
      brecha: r1(acumulado - ideal),          // + vas por delante del ideal, − por detrás
      sobreCritico: r1(acumulado - critico),  // margen sobre el suelo crítico (− = en riesgo)
    });
  }
  // Totales del MES elegido (para los KPIs de arriba, que ahora siguen al selector de
  // mes en vez de quedarse fijos en "este mes"). Horas del acumulado; neto/viajes de
  // bolt_order en la ventana del mes.
  const totalMes = dias.length ? dias[dias.length - 1].acumulado : 0;   // horas efectivas
  const waitingMes = dias.reduce((a, d) => a + (d.waiting || 0), 0);
  const viajeMes = totalMes - waitingMes;
  const totales = {
    horasEfectivas: Math.round(totalMes * 10) / 10,
    utilizacion: totalMes > 0 ? Math.round((viajeMes / totalMes) * 1000) / 10 : null,
    neto: dinero.neto,
    viajes: dinero.viajes,
    eurosHora: totalMes > 0 ? Math.round((dinero.neto / totalMes) * 100) / 100 : null,
    viajesHora: totalMes > 0 ? Math.round((dinero.viajes / totalMes) * 10) / 10 : null,
  };
  return { idealDiario: Math.round(idealDiario), dias, total: totalMes, totales };
}

// Foto diaria del mes → Map(díaDelMes -> {viajeSeg, esperaSeg}).
async function leerFotosMes(anio, mes) {
  const m = new Map();
  if (!db.HAY_BD) return m;
  const primero = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const r = await db.consulta(
    `SELECT EXTRACT(DAY FROM dia)::int AS d, viaje_seg, espera_seg
       FROM visibilidad_dia
      WHERE dia >= $1::date AND dia < ($1::date + interval '1 month')`, [primero]);
  r.rows.forEach(x => m.set(Number(x.d), { viajeSeg: Number(x.viaje_seg) || 0, esperaSeg: Number(x.espera_seg) || 0 }));
  return m;
}

// ── Foto diaria: la escribe el cron (y el backfill) ──────────────────────────
// Calcula el día NATURAL (00:00→24:00) de flota y lo guarda. El pasado queda fijo;
// hoy/ayer se reescriben en cada pasada. Es la serie del gráfico del mes, que va
// justo debajo de las tarjetas de día natural: tienen que decir lo mismo. (Quien
// quiera el reparto por jornada lo tiene en el Reporte de horas y en la Bitácora,
// que van por 05→05 y cuadran entre sí.)
async function capturarDia(diaIso) {
  if (!db.HAY_BD) return;
  const h = await horasVentana(diaIso, 0, 1, 0);
  await db.consulta(
    `INSERT INTO visibilidad_dia (dia, viaje_seg, espera_seg, descanso_seg, conductores, capturado_at)
     VALUES ($1::date, $2, $3, $4, $5, now())
     ON CONFLICT (dia) DO UPDATE SET
       viaje_seg = EXCLUDED.viaje_seg, espera_seg = EXCLUDED.espera_seg,
       descanso_seg = EXCLUDED.descanso_seg, conductores = EXCLUDED.conductores,
       capturado_at = now()`,
    [String(diaIso).slice(0, 10), h.viajeSeg, h.esperaSeg, h.descansoSeg, h.conductores]);
  return h;
}

// Rellena todas las fotos de un mes (hasta hoy si es el corriente). Días sin datos
// quedan a 0 (que es lo correcto: antes de encender la ingesta no había horas).
async function backfillMes(anio, mes) {
  const hoy = hoyISO();
  const [Yh, Mh, Dh] = hoy.split('-').map(Number);
  const esCorriente = Yh === anio && Mh === mes;
  // Un mes futuro no se fotografía: serían fotos vacías de días sin pasar.
  if (anio > Yh || (anio === Yh && mes > Mh)) return { anio, mes, dias: 0 };
  const hasta = esCorriente ? Dh : diasEnMes(anio, mes);
  let n = 0;
  for (let d = 1; d <= hasta; d++) {
    const diaIso = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try { await capturarDia(diaIso); n++; } catch (e) { /* un día que falle no corta el resto */ }
  }
  return { anio, mes, dias: n };
}

// Lo que llama el cron: refresca hoy y ayer (lo demás ya está sellado).
async function capturaCorriente() {
  // TRES DÍAS, NO DOS. Con la jornada 05→05, a las 02:00 la jornada en curso es la
  // que empezó AYER a las 05:00 y la anterior es la de ANTEAYER. Refrescando solo
  // hoy y ayer, la de anteayer se quedaba sellada a medias para siempre.
  const [r1, r2, r3] = [await capturarDia(hoyISO()),
                        await capturarDia(diaISOhace(1)),
                        await capturarDia(diaISOhace(2))];
  return { hoy: r1, ayer: r2, anteayer: r3 };
}

// Sana el mes CORRIENTE entero (por si el servidor estuvo caído). Calcula el mes en
// Madrid él mismo, para no depender de la hora del servidor.
async function backfillMesActual() {
  const [Y, M] = hoyISO().split('-').map(Number);
  return backfillMes(Y, M);
}

// ── HORAS POR PLANTILLA (30/10/2026) ─────────────────────────────────────────
// Camilo: «dos tarjetas también de total de horas, por plantilla propia y ETT,
// donde se pueda filtrar por fechas, desde y hasta con los datos que tenemos
// disponibles». Las horas son las de Visibilidad (viaje + espera de BOLT, por
// día natural en Madrid, tramo a tramo) y cada día va al contrato que esa
// persona tenía ESE día: quien pasó de la ETT a propia el 14 cuenta en la ETT
// hasta el 13. Lo que no es de nadie va aparte, para que todo sume el total:
// horas de alguien sin contrato ese día y cuentas de BOLT sin ficha.
//
// Hay horas por persona desde el primer tramo del núcleo (01/07/2026): lo de
// antes es la historia de la flota entera (db/217), sin saber de quién era.

const SQL_PLANTILLA = `
  WITH v AS (
    SELECT ($1::date)::timestamp AT TIME ZONE 'Europe/Madrid'     AS ini,
           ($2::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid' AS fin
  ),
  tr AS (
    SELECT t.situacion, t.conductor_uuid,
           GREATEST(t.desde, v.ini) AS d, LEAST(COALESCE(t.hasta, now()), v.fin) AS h
      FROM fv_tramo t CROSS JOIN v
     WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
       AND t.situacion IN ('viaje', 'espera')
  ),
  -- Cada tramo partido por los días naturales que toca: el contrato es de un día.
  trozos AS (
    SELECT tr.situacion, tr.conductor_uuid, g.dia::date AS dia,
           EXTRACT(EPOCH FROM LEAST(tr.h, (g.dia + interval '1 day')::timestamp AT TIME ZONE 'Europe/Madrid')
                            - GREATEST(tr.d, g.dia::timestamp AT TIME ZONE 'Europe/Madrid')) AS seg
      FROM tr
      CROSS JOIN LATERAL generate_series((tr.d AT TIME ZONE 'Europe/Madrid')::date,
                                         (tr.h AT TIME ZONE 'Europe/Madrid')::date, interval '1 day') g(dia)
  ),
  por AS (
    SELECT conductor_uuid, dia,
           COALESCE(sum(seg) FILTER (WHERE situacion = 'viaje'), 0)  AS viaje,
           COALESCE(sum(seg) FILTER (WHERE situacion = 'espera'), 0) AS espera
      FROM trozos WHERE seg > 0
     GROUP BY 1, 2
  )
  SELECT CASE WHEN ce.conductor_id IS NULL THEN 'sinFicha'
              WHEN pe.tipo = 'ett'        THEN 'ett'
              WHEN pe.tipo IS NOT NULL    THEN 'propia'
              ELSE 'sinContrato' END AS grupo,
         sum(p.viaje)::float8  AS viaje,
         sum(p.espera)::float8 AS espera,
         count(DISTINCT COALESCE(ce.conductor_id::text, p.conductor_uuid))::int AS personas
    FROM por p
    LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = p.conductor_uuid
    LEFT JOIN LATERAL (
      SELECT pe.tipo FROM conductor_periodo_empleo pe
       WHERE pe.conductor_id = ce.conductor_id
         AND pe.alta <= p.dia AND (pe.baja IS NULL OR pe.baja >= p.dia)
       ORDER BY pe.alta DESC LIMIT 1
    ) pe ON TRUE
   GROUP BY 1`;

/** El primer día con horas por persona ('AAAA-MM-DD', Madrid), o null. */
async function primerDiaConTramos() {
  const r = await db.consulta(`SELECT to_char(min(desde) AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS d FROM fv_tramo`);
  return (r.rows[0] && r.rows[0].d) || null;
}

/**
 * Las horas de un tramo de fechas, por plantilla: propia, ETT y lo que no es de
 * nadie. `desde` y `hasta` 'AAAA-MM-DD' (por defecto, del 1 del mes a hoy); se
 * recortan a lo que hay —del primer día con tramos a hoy— y se dice.
 */
async function horasPorPlantilla(q = {}) {
  const mal = msg => Object.assign(new Error(msg), { estado: 400 });
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const hoy = hoyISO();
  const pedido = { desde: String(q.desde || `${hoy.slice(0, 8)}01`), hasta: String(q.hasta || hoy) };
  if (!ISO.test(pedido.desde) || !ISO.test(pedido.hasta)) throw mal('Las fechas van como AAAA-MM-DD');
  if (pedido.desde > pedido.hasta) throw mal('«Desde» no puede ir después de «Hasta»');
  const primero = await primerDiaConTramos();
  const es = iso => iso.split('-').reverse().join('/');
  if (!primero) throw mal('Todavía no hay horas por persona');
  const desde = pedido.desde < primero ? primero : pedido.desde;
  const hasta = pedido.hasta > hoy ? hoy : pedido.hasta;
  if (desde > hasta) throw mal(`Hay horas por persona del ${es(primero)} a hoy`);

  const r = await db.consulta(SQL_PLANTILLA, [desde, hasta]);
  const r1 = x => Math.round(x * 10) / 10;
  const grupo = x => {
    const viaje = (x && x.viaje) || 0, espera = (x && x.espera) || 0;
    const horas = (viaje + espera) / 3600;
    return { horas: r1(horas), viaje: r1(viaje / 3600), espera: r1(espera / 3600),
      util: viaje + espera > 0 ? r1((viaje / (viaje + espera)) * 100) : null,
      conductores: (x && x.personas) || 0 };
  };
  const de = new Map(r.rows.map(x => [x.grupo, x]));
  const grupos = Object.fromEntries(['propia', 'ett', 'sinContrato', 'sinFicha'].map(k => [k, grupo(de.get(k))]));
  const suma = k => r.rows.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  return {
    desde, hasta, pedido, disponible: { desde: primero, hasta: hoy },
    recortado: desde !== pedido.desde || hasta !== pedido.hasta,
    incluyeHoy: hasta === hoy,
    ...grupos,
    total: grupo({ viaje: suma('viaje'), espera: suma('espera'), personas: grupos.propia.conductores + grupos.ett.conductores
      + grupos.sinContrato.conductores + grupos.sinFicha.conductores }),
  };
}

module.exports = {
  resumen, aEstaHora, serieMes, leerConfig, guardarConfig,
  horasPorPlantilla,
  // Las piezas de «A esta hora» que comparte Barcelona.
  momentoAEstaHora, armarAEstaHora,
  capturarDia, backfillMes, backfillMesActual, capturaCorriente,
  // internos expuestos por si hacen falta en pruebas
  slice, horasVentana, dineroVentana,
  // Las cuentas, puras: las comparte la Visibilidad de Barcelona (modules/Barcelona).
  metricas, sliceDeTurno, armarSerie, CONFIG_DEFECTO,
  // La usa el panel de inicio para pedir los KM de las MISMAS ventanas que las
  // horas: si cada pantalla eligiera su turno, las dos cifras no se podrian comparar.
  ventanaTurnos,
};
