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

// ── Cuánta gente hizo CADA TURNO de una jornada ──────────────────────────────
// No es lo mismo "pasó por la franja" que "hizo ese turno", y la tarjeta decía
// lo primero llamándolo lo segundo: el domingo salía "turno día · 80 cond"
// cuando de día solo hubo 49. La causa es que el de noche que ficha a las 16:40
// toca la ventana de día, y el de día que alarga hasta las 17:30 toca la de
// noche, así que cada uno se contaba DOS veces y día + noche (82 + 71) se iba
// muy por encima de la jornada (100).
//
// Aquí cada persona cuenta UNA sola vez, en el turno donde hizo el grueso de
// sus horas efectivas. Así día + noche = la jornada, siempre.
async function conductoresPorTurno(diaJornada) {
  if (!fv.HAY_BD) return { dia: 0, noche: 0, total: 0 };
  await fv.preparar();
  const T = require('./flotaViva/rutas').TURNOS;
  const r = await fv.consulta(
    `WITH j AS (
       SELECT ($1::date + ($2 || ' hours')::interval)       AT TIME ZONE 'Europe/Madrid' AS ini,
              ($1::date + ($3 || ' hours')::interval)       AT TIME ZONE 'Europe/Madrid' AS corte,
              (($1::date + 1) + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
     tr AS (
       SELECT t.conductor_uuid AS uuid,
              GREATEST(0, EXTRACT(EPOCH FROM (LEAST(COALESCE(t.hasta, now()), j.corte) - GREATEST(t.desde, j.ini))))   AS sd,
              GREATEST(0, EXTRACT(EPOCH FROM (LEAST(COALESCE(t.hasta, now()), j.fin)   - GREATEST(t.desde, j.corte)))) AS sn
         FROM fv_tramo t CROSS JOIN j
         JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
        WHERE t.desde < j.fin AND COALESCE(t.hasta, now()) > j.ini
     ),
     p AS (SELECT uuid, sum(sd) AS d, sum(sn) AS n FROM tr GROUP BY uuid)
     SELECT count(*) FILTER (WHERE d + n > 0)::int      AS total,
            count(*) FILTER (WHERE d >= n AND d > 0)::int AS dia,
            count(*) FILTER (WHERE n > d)::int            AS noche
       FROM p`,
    [String(diaJornada).slice(0, 10), String(T.dia[0]), String(T.dia[2])]);
  const x = r.rows[0] || {};
  return { dia: Number(x.dia) || 0, noche: Number(x.noche) || 0, total: Number(x.total) || 0 };
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

// ── KPIs "en vivo" (mes, hoy, semana, turno actual, turno anterior) ──────────
// Los turnos siguen la regla de tráfico: día = 05:00→17:00, noche = 17:00→05:00.
// "Turno actual" es el que corre AHORA; "anterior", el inmediatamente previo.
// POR TURNO es OTRA COSA que por día: el turno de noche va 17:00→05:00 y CRUZA
// MEDIANOCHE, así que no cuadra con ningún día natural. Aquí se devuelven las dos
// ventanas de turno relevantes "ahora": el día de hoy y la noche que toca.
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

async function resumen() {
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
  // (05:00→05:00) es la que embaldosan los dos turnos sin hueco ni solape y la que
  // cuadra con el Reporte de horas. No son el mismo número —la noche cruza la
  // medianoche— y por eso se enseñan las dos, cada una con su etiqueta.
  const T = require('./flotaViva/rutas').TURNOS;
  const H0 = T.dia[0];                                     // el corte de la jornada: 05:00
  // Antes de las 05:00 la jornada que acaba de cerrarse es la de ANTEAYER.
  const ayerJornada = horaMadrid() < H0 ? diaISOhace(2) : ayer;
  const t = ventanaTurnos();
  // DOS FORMAS DE MIRAR EL MISMO DÍA, Y LAS DOS VALEN. Son la gracia de esta
  // pantalla, no un descuido:
  //   · DÍA NATURAL (00:00→24:00): lo que cuadra con los informes de BOLT y con
  //     el acumulado del mes. Es la fila de la izquierda.
  //   · JORNADA (05:00→05:00): la que embaldosan los dos turnos sin hueco ni
  //     solape y la que cuadra con el Reporte de horas y con la Bitácora.
  // Se probó a poner las dos filas por jornada y fue peor: a media mañana "HOY"
  // y "TURNO DÍA" daban el mismo número (la jornada en curso ES el turno de día
  // hasta las 17:00) y la tarjeta no decía nada.
  const [mes, dia, ayerDia, ayerJor, semana, turnoDia, turnoNoche, cuentaDia, cuentaNoche, config] = await Promise.all([
    slice(primeroMes, 0, dm, 0),           // todo el mes, días naturales (los futuros no suman)
    slice(hoy, 0, 1, 0),                   // HOY, día natural 00:00 → 24:00 (parcial)
    slice(ayer, 0, 1, 0),                  // AYER, día natural completo
    slice(ayerJornada, H0, 1, H0),         // AYER, jornada 05:00 → 05:00 (= turno día + turno noche)
    slice(lunes, 0, 7, 0),                 // lunes → lunes (parcial)
    slice(...t.dia.v),                     // turno DÍA (05→17)
    slice(...t.noche.v),                   // turno NOCHE (17→05, cruza medianoche)
    // Cada persona en UN solo turno: el de la jornada a la que pertenece cada
    // ventana (la de noche empieza el mismo día que su jornada).
    conductoresPorTurno(t.dia.v[0]),
    conductoresPorTurno(t.noche.v[0]),
    leerConfig(),
  ]);
  return {
    hoyISO: hoy,
    // POR DÍA (día natural 00:00→24:00)
    mes: { ...mes, etq: 'Este mes' },
    dia: { ...dia, etq: 'Hoy' },
    ayer: { ...ayerDia, etq: 'Ayer' },
    semana: { ...semana, etq: 'Esta semana' },
    // POR TURNO (ventana del turno; la noche cruza medianoche). Las HORAS son
    // las de la ventana; los CONDUCTORES, los que hicieron ese turno — que no
    // es lo mismo que los que pisaron la franja (ver conductoresPorTurno).
    turnoDia: { ...turnoDia, conductores: cuentaDia.dia, etq: t.dia.etq },
    turnoNoche: { ...turnoNoche, conductores: cuentaNoche.noche, etq: t.noche.etq },
    ayerJornada: { ...ayerJor, etq: 'Ayer · jornada completa', dia: ayerJornada },
    config,
  };
}

// ── Los últimos N días + hoy, para el gráfico de capacidad ───────────────────
// Como el "CAPACIDAD X DIA" de la hoja: la línea de los días cerrados y, aparte, el
// punto de HOY en curso. Lee las fotos (día natural) y cruza meses sin despeinarse;
// hoy va siempre en vivo.
async function ultimosDias(n = 15) {
  const hoy = hoyISO();
  const desde = diaISOhace(n);
  const r = await db.consulta(
    `SELECT to_char(dia, 'YYYY-MM-DD') AS dia, viaje_seg, espera_seg, conductores
       FROM visibilidad_dia
      WHERE dia >= $1::date AND dia < $2::date
      ORDER BY dia`, [desde, hoy]);
  const porDia = new Map(r.rows.map(x => [x.dia, x]));
  const r1 = (x) => Math.round(x * 10) / 10;
  const dias = [];
  for (let i = n; i >= 1; i--) {
    const d = diaISOhace(i);
    const f = porDia.get(d);
    const viaje = f ? Number(f.viaje_seg) : 0, espera = f ? Number(f.espera_seg) : 0;
    dias.push({
      dia: d, esHoy: false,
      total: r1((viaje + espera) / 3600), waiting: r1(espera / 3600),
      conductores: f ? Number(f.conductores) : 0,
      sinFoto: !f,
    });
  }
  const h = await horasVentana(hoy, 0, 1, 0);
  dias.push({
    dia: hoy, esHoy: true,
    total: r1((h.viajeSeg + h.esperaSeg) / 3600), waiting: r1(h.esperaSeg / 3600),
    conductores: h.conductores || 0, sinFoto: false,
  });
  return { n, dias };
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
  for (let d = 1; d <= ultimoConDatos; d++) {
    const f = fotos.get(d);
    // Recalcula el día si FALTA o si su foto está a 0: un 0 puede ser una foto vieja
    // de antes de meter el histórico de tramos (backfill). Una foto con horas ya es
    // buena y no se recalcula. Al reescribir con capturarDia se sana también en la BD.
    if (f && (f.viajeSeg + f.esperaSeg) > 0) continue;
    try {
      const dISO = `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const h = await capturarDia(dISO);
      if (h) fotos.set(d, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg });
    } catch (e) { /* un día que falle no corta el resto del mes */ }
  }
  // Hoy SIEMPRE en vivo por encima de su foto, para que el acumulado esté fresco.
  if (esMesActual) {
    const h = await horasVentana(hoy, 0, 1, 0);
    fotos.set(Dh, { viajeSeg: h.viajeSeg, esperaSeg: h.esperaSeg });
  }

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
  const dinero = await dineroVentana(primero, 0, dm, 0);
  const totales = {
    horasEfectivas: Math.round(totalMes * 10) / 10,
    utilizacion: totalMes > 0 ? Math.round((viajeMes / totalMes) * 1000) / 10 : null,
    neto: dinero.neto,
    viajes: dinero.viajes,
    eurosHora: totalMes > 0 ? Math.round((dinero.neto / totalMes) * 100) / 100 : null,
    viajesHora: totalMes > 0 ? Math.round((dinero.viajes / totalMes) * 10) / 10 : null,
  };
  return {
    anio, mes, diasMes: dm, config,
    // Hasta qué día hay datos de verdad: en el mes en curso, hoy; en uno pasado, todos.
    // Los gráficos cortan ahí las series reales; el ideal y el crítico siguen hasta
    // fin de mes porque son el objetivo, no un dato.
    ultimoConDatos, esMesActual, hoyDia: esMesActual ? Dh : null,
    idealDiario: Math.round(idealDiario),
    dias, total: totalMes, totales,
  };
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

module.exports = {
  resumen, serieMes, ultimosDias, leerConfig, guardarConfig,
  capturarDia, backfillMes, backfillMesActual, capturaCorriente,
  // internos expuestos por si hacen falta en pruebas
  slice, horasVentana, dineroVentana, conductoresPorTurno,
  // La usa el panel de inicio para pedir los KM de las MISMAS ventanas que las
  // horas: si cada pantalla eligiera su turno, las dos cifras no se podrian comparar.
  ventanaTurnos,
};
