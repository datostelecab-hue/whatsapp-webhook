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
const CONFIG_DEFECTO = { capacidad_diaria_h: 16, meta: 28157, vehiculos: 73, dias_del_mes: null };

// ── Utilidades de fecha (todo en hora de Madrid, como el núcleo) ──────────────
const fmtFecha = (d) => new Intl.DateTimeFormat('en-CA',
  { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hoyISO = () => fmtFecha(new Date());
const diaISOhace = (n) => fmtFecha(new Date(Date.now() - n * 86400000));
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
     SELECT COALESCE(round(sum(o.neto), 2), 0)::float          AS neto,
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
  for (const k of ['capacidad_diaria_h', 'meta', 'vehiculos', 'dias_del_mes']) {
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
  const dia = (d) => [d, 5, 0, 17];      // 05:00 → 17:00 del mismo día
  const noche = (d) => [d, 17, 1, 5];    // 17:00 → 05:00 del día siguiente
  // Turno DÍA: siempre el de hoy (en curso o ya cerrado).
  const turnoDia = { etq: 'Turno día · hoy', v: dia(hoy) };
  // Turno NOCHE: por la tarde/noche (>=17) la de ESTA noche (hoy 17→mañana 05); de
  // madrugada o de día, la que acaba de pasar (anoche 17→hoy 05).
  const turnoNoche = H >= 17
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

  const t = ventanaTurnos();
  const [mes, dia, ayerDia, semana, turnoDia, turnoNoche, config] = await Promise.all([
    slice(primeroMes, 0, dm, 0),           // todo el mes (los días futuros no suman)
    slice(hoy, 0, 1, 0),                   // HOY, día natural 00:00 → 24:00 (parcial)
    slice(ayer, 0, 1, 0),                  // AYER, día natural completo
    slice(lunes, 0, 7, 0),                 // lunes → lunes (parcial)
    slice(...t.dia.v),                     // turno DÍA (05→17)
    slice(...t.noche.v),                   // turno NOCHE (17→05, cruza medianoche)
    leerConfig(),
  ]);
  return {
    hoyISO: hoy,
    // POR DÍA (día natural 00:00→24:00)
    mes: { ...mes, etq: 'Este mes' },
    dia: { ...dia, etq: 'Hoy' },
    ayer: { ...ayerDia, etq: 'Ayer' },
    semana: { ...semana, etq: 'Esta semana' },
    // POR TURNO (ventana del turno; la noche cruza medianoche)
    turnoDia: { ...turnoDia, etq: t.dia.etq },
    turnoNoche: { ...turnoNoche, etq: t.noche.etq },
    config,
  };
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
  if (fotos.size === 0) {
    await backfillMes(anio, mes);
    fotos = await leerFotosMes(anio, mes);
  }
  // Hoy en vivo (solo si el mes pedido es el corriente).
  const hoy = hoyISO();
  const [Yh, Mh, Dh] = hoy.split('-').map(Number);
  if (Yh === anio && Mh === mes) {
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
  return {
    anio, mes, diasMes: dm, config,
    idealDiario: Math.round(idealDiario),
    dias,
    // Totales del mes = último acumulado.
    total: dias.length ? dias[dias.length - 1].acumulado : 0,
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
// hoy/ayer se reescriben en cada pasada.
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
  const r1 = await capturarDia(hoyISO());
  const r2 = await capturarDia(diaISOhace(1));
  return { hoy: r1, ayer: r2 };
}

// Sana el mes CORRIENTE entero (por si el servidor estuvo caído). Calcula el mes en
// Madrid él mismo, para no depender de la hora del servidor.
async function backfillMesActual() {
  const [Y, M] = hoyISO().split('-').map(Number);
  return backfillMes(Y, M);
}

module.exports = {
  resumen, serieMes, leerConfig, guardarConfig,
  capturarDia, backfillMes, backfillMesActual, capturaCorriente,
  // internos expuestos por si hacen falta en pruebas
  slice, horasVentana, dineroVentana,
};
