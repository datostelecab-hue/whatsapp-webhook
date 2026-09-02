// ============================================================
// FLOTA VIVA — el núcleo de KM (trayectos de Mapon)
// ============================================================
// Los km de verdad NO salen del `mileage` de unit/list (llega estancado y la
// resta entre vueltas da 0). Salen de route/list —lo que ve la Auditoría—: una
// fila por trayecto con su distancia Mapon en metros.
//
// Aquí se INGIEREN esos trayectos al núcleo (`fv_ruta`) y se LEEN de ahí. La
// gracia es que las pantallas leen del núcleo sin volver a llamar a la API: una
// sola llamada de flota por vuelta alimenta a todo el mundo. Es la misma idea que
// el resto de Flota Viva —una puerta de entrada, muchas lecturas—, ahora para km.

const db = require('./db');
const fuentes = require('./fuentes');

/** Date → ISO 8601 con Z, que es lo que exige Mapon. */
const iso = d => new Date(d).toISOString().slice(0, 19) + 'Z';

/**
 * Mete en el núcleo (fv_ruta) los trayectos de Mapon de un rango.
 *
 * Idempotente: (unit_id, route_id) es la clave, así que repetir una ventana no
 * duplica —solo refresca los metros y la hora de fin de un trayecto que aún se
 * estaba cerrando—. Se trocea en ventanas para no pedir rangos enormes, y se
 * sube por lotes para que un backfill de dos días sea un puñado de queries, no
 * miles de inserts sueltos.
 */
async function ingestarRutas({ desde, hasta, ventanaDias = 3 } = {}) {
  await db.preparar();
  const fin = hasta ? new Date(hasta) : new Date();
  // Por defecto, algo más de un día hacia atrás: cubre "hoy" con holgura.
  const ini = desde ? new Date(desde) : new Date(fin.getTime() - 26 * 3600 * 1000);

  let trayectos = 0, metros = 0;
  for (let v = new Date(ini); v < fin;) {
    const vFin = new Date(v.getTime() + ventanaDias * 86400000);
    const hastaV = vFin < fin ? vFin : fin;
    const trips = (await fuentes.trayectosFlota(iso(v), iso(hastaV)))
      .filter(t => t.inicio && Number.isFinite(t.unitId) && t.routeId);
    await guardarLote(trips);
    trayectos += trips.length;
    metros += trips.reduce((s, t) => s + t.metros, 0);
    // Progreso por ventana: en un backfill de un mes es lo único que dice que
    // sigue vivo y por dónde va.
    console.log(`   🛰️  [rutas] ${iso(v).slice(0, 10)}…${iso(hastaV).slice(0, 10)}: ` +
                `${trips.length} trayecto(s) (acum. ${trayectos})`);
    v = vFin;
  }
  return { trayectos, km: Math.round(metros / 100) / 10, desde: iso(ini), hasta: iso(fin) };
}

/** Sube los trayectos por lotes con upsert. Un route/list no repite route_id. */
async function guardarLote(trips) {
  const LOTE = 400;
  for (let i = 0; i < trips.length; i += LOTE) {
    const chunk = trips.slice(i, i + LOTE);
    const vals = [], params = [];
    chunk.forEach((t, k) => {
      const b = k * 7;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(t.unitId, t.routeId, t.matricula || null, t.inicio, t.fin, t.metros, t.driverId);
    });
    if (!vals.length) continue;
    await db.consulta(
      `INSERT INTO fv_ruta (unit_id, route_id, matricula, inicio, fin, metros, driver_id)
       VALUES ${vals.join(',')}
       ON CONFLICT (unit_id, route_id) DO UPDATE SET
         matricula = EXCLUDED.matricula, fin = EXCLUDED.fin,
         metros = EXCLUDED.metros, driver_id = EXCLUDED.driver_id`,
      params);
  }
}

/**
 * Km por coche en un día operativo (hora peninsular), leído del núcleo.
 *
 * LA MATRÍCULA SALE DE fv_vehiculo, no de fv_ruta. En route/list el objeto de la
 * unidad no trae la matrícula de forma fiable —por eso la Auditoría la resuelve
 * por unit_id aparte—, así que se cruza `fv_ruta.unit_id` con `fv_vehiculo.mapon_unit`,
 * que da la MISMA matrícula que usa el cockpit (la de BOLT). Si se keyeara por la
 * de fv_ruta, no casaría y todo saldría en cero.
 *
 * Un trayecto cuenta en el día de su INICIO. Devuelve Map(matrícula -> {km, viajes}).
 */
async function kmPorCoche(dia) {
  const r = await db.consulta(
    `SELECT v.matricula, round(sum(r.metros) / 1000.0, 1) AS km, count(*)::int AS viajes
       FROM fv_ruta r
       JOIN fv_vehiculo v ON v.mapon_unit = r.unit_id
      WHERE v.matricula IS NOT NULL
        AND (r.inicio AT TIME ZONE 'Europe/Madrid')::date = $1::date
      GROUP BY v.matricula`, [String(dia).slice(0, 10)]);
  const m = new Map();
  r.rows.forEach(x => m.set(x.matricula, { km: Number(x.km) || 0, viajes: x.viajes }));
  return m;
}

/**
 * Km CONECTADO vs DESCONECTADO por conductor en un día, cruzando el núcleo con
 * los tramos. (Fase 3.)
 *
 * Cada trayecto de Mapon (fv_ruta) se reparte entre los tramos de BOLT que toca,
 * en proporción al TIEMPO que solapa con cada uno; los metros de un tramo cuentan
 * como "conectado" o "desconectado" según su situación. Así, un coche que rueda
 * con BOLT apagado suma "km desconectado" —rodar fuera de plataforma— y lo demás
 * es "km conectado". Es la fuente buena (route/list), no el mileage.
 *
 * El reparto es por tiempo (asume velocidad uniforme dentro del trayecto): es una
 * aproximación, pero la única defendible sin la traza punto a punto, y para el km
 * total por conductor cuadra. Los tramos desconectados no llevan conductor en
 * BOLT, así que sus km caen en "(sin conductor)": justo lo que hay que mirar.
 */
// Los turnos, IGUAL que la Auditoría flota (mismas variables de entorno para que
// no se desincronicen): día 05:00→17:00, noche 17:00→05:00 del día siguiente.
const HORA_DIA = Number(process.env.AUDITORIA_HORA_DIA || 5);
const HORA_NOCHE = Number(process.env.AUDITORIA_HORA_NOCHE || 17);
// [hora_inicio, offset_días_fin, hora_fin]. "completo" es el día natural (00→24),
// y NO es la suma de día+noche: la madrugada 00:00–05:00 es del turno de noche de
// la víspera, así que se cuenta aparte.
const TURNOS = {
  completo: [0, 1, 0],
  dia: [HORA_DIA, 0, HORA_NOCHE],
  noche: [HORA_NOCHE, 1, HORA_DIA],
  // El DÍA OPERATIVO: 05:00 → 05:00 del día siguiente (día ∪ noche). Es lo que
  // hizo un conductor en su jornada, sea de día o de noche, sin necesidad de saber
  // su turno. Empieza a las 05:00, así que no se come la madrugada de la víspera
  // (que es del turno de noche del día anterior).
  operativo: [HORA_DIA, 1, HORA_DIA],
  // REGLA DE TRÁFICO para el reporte: el turno de NOCHE va de MEDIODÍA a MEDIODÍA
  // (12:00 D → 12:00 D+1). Así un turno de noche entero cae en UN día y la madrugada
  // va con la noche que la trajo, no con el día siguiente. El turno de DÍA usa el día
  // natural ('completo', 00:00→24:00).
  noche12: [12, 1, 12],
};

/**
 * Km EN BOLT vs DESCONECTADO por conductor, POR TURNO. (Fase 3 / como Auditoría.)
 *
 * Un trayecto cuenta en el turno donde EMPIEZA. El turno de noche cruza medianoche
 * —17:00 a 05:00 del día siguiente—, así que la madrugada va con el conductor de
 * noche de la víspera, no con el de día que entra a las 5. Partir por día natural
 * le metía al de día lo que rodó el de noche: eso es justo lo que arregla esto.
 *
 * EN BOLT = viaje+espera (has_order + waiting_orders). DESCONECTADO = descanso+
 * desconectado (busy + inactive): rodar sin estar disponible para la plataforma.
 */
async function kmConectadoDesconectado(dia, turno = 'completo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.completo;
  const EN_BOLT = "('viaje','espera')";
  const FUERA = "('descanso','desconectado')";
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
     solape AS (
       SELECT COALESCE(co.nombre, '(sin conductor)') AS conductor,
              veh.matricula AS matricula,
              t.situacion,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, COALESCE(t.hasta, now())) - GREATEST(r.inicio, t.desde))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM fv_ruta r
         CROSS JOIN v
         JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
         JOIN fv_tramo t      ON t.vehiculo_uuid = veh.uuid
                             AND t.desde < r.fin AND COALESCE(t.hasta, now()) > r.inicio
         LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND r.inicio >= v.ini AND r.inicio < v.fin
     )
     -- Por conductor Y matrícula: un conductor puede haber cogido más de un coche
     -- en su jornada. Se agrupa en JS para dar el total del conductor + la lista
     -- de matrículas (la de más km primero, que es "el coche" del día).
     SELECT conductor, matricula,
            round(coalesce(sum(metros_trozo) FILTER (WHERE situacion IN ${EN_BOLT}), 0) / 1000.0, 1) AS km_bolt,
            round(coalesce(sum(metros_trozo) FILTER (WHERE situacion IN ${FUERA}), 0) / 1000.0, 1)   AS km_desc
       FROM solape
      GROUP BY conductor, matricula`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  const porCond = new Map();
  r.rows.forEach(x => {
    const enBolt = Number(x.km_bolt) || 0;
    const desconectado = Number(x.km_desc) || 0;
    if (!porCond.has(x.conductor)) {
      porCond.set(x.conductor, { conductor: x.conductor, enBolt: 0, desconectado: 0, _mats: [] });
    }
    const c = porCond.get(x.conductor);
    c.enBolt += enBolt; c.desconectado += desconectado;
    if (x.matricula) c._mats.push({ matricula: x.matricula, km: enBolt + desconectado });
  });
  const conductores = [...porCond.values()].map(c => {
    c.enBolt = Math.round(c.enBolt * 10) / 10;
    c.desconectado = Math.round(c.desconectado * 10) / 10;
    c.total = Math.round((c.enBolt + c.desconectado) * 10) / 10;
    c._mats.sort((a, b) => b.km - a.km);
    // `matricula` = el coche con más km (el principal); `matriculas` = todos.
    c.matricula = c._mats.length ? c._mats[0].matricula : null;
    c.matriculas = c._mats.map(m => m.matricula);
    delete c._mats;
    return c;
  }).sort((a, b) => b.total - a.total);
  const suma = k => Math.round(conductores.reduce((a, f) => a + f[k], 0) * 10) / 10;
  return {
    dia: String(dia).slice(0, 10),
    turno,
    conductores,
    total: { enBolt: suma('enBolt'), desconectado: suma('desconectado'), total: suma('total') },
  };
}

/**
 * Minutos CONECTADO (viaje + espera = en BOLT) por conductor en la ventana de un
 * turno, del núcleo. Es "cuántas horas trabajó" — sale de los tramos, no de km.
 *
 * Devuelve Map(nombreConductor -> minutos). La clave es el nombre de fv_conductor
 * (el mismo que usa kmConectadoDesconectado), así que casan exacto entre sí.
 */
async function horasConectadasPorConductor(dia, turno = 'operativo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT COALESCE(co.nombre, '(sin conductor)') AS conductor,
            floor(sum(EXTRACT(EPOCH FROM (
              LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini)
            ))) / 60)::int AS minutos
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.codigo IN ('viaje', 'espera')
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
      GROUP BY conductor`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);
  const m = new Map();
  r.rows.forEach(x => m.set(x.conductor, Number(x.minutos) || 0));
  return m;
}

/**
 * Horas CONECTADAS (viaje + espera + descanso = "conectado" de BOLT) por conductor
 * en la ventana de un turno, del núcleo. Es "cuántas horas trabajó" con la MISMA
 * definición que el Total de BOLT (que incluye el descanso), para poder sustituir a
 * Datos_API en los turnos de noche —donde la hoja no sirve, porque solo guarda el
 * total por día natural y el turno de noche va de mediodía a mediodía—.
 *
 * Devuelve Map(nombreConductor -> minutos). Clave = nombre de fv_conductor.
 */
async function horasConectadoTotal(dia, turno = 'noche12') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.noche12;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT COALESCE(co.nombre, '(sin conductor)') AS conductor,
            floor(sum(EXTRACT(EPOCH FROM (
              LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini)
            ))) / 60)::int AS minutos
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
      GROUP BY conductor`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);
  const m = new Map();
  r.rows.forEach(x => m.set(x.conductor, Number(x.minutos) || 0));
  return m;
}

/**
 * La(s) matrícula(s) con la(s) que cada conductor FICHÓ en BOLT en la ventana
 * (viaje + espera), del núcleo — con independencia de que Mapon tenga traza o no.
 *
 * Sirve para el caso "REVISAR": un conductor que trabajó y se conectó en BOLT con
 * un coche, pero de ese coche no hay km de Mapon. Pasa cuando el coche que tiene
 * asignado en BOLT está en el taller y sale con OTRO que no está dado de alta en
 * BOLT: BOLT lo sigue por el móvil (con la matrícula vieja), Mapon no ve moverse a
 * la vieja. No se puede medir el km, así que se marca REVISAR y lo cuadra Tráfico.
 *
 * Devuelve { conductores: [{conductor, matricula (la de más rato), matriculas[], minutos}] }.
 */
async function matriculasBoltPorConductor(dia, turno = 'operativo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT COALESCE(co.nombre, '(sin conductor)') AS conductor, veh.matricula,
            floor(sum(EXTRACT(EPOCH FROM (
              LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini)
            ))) / 60)::int AS minutos
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      WHERE t.situacion IN ('viaje', 'espera')
        AND t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
      GROUP BY conductor, veh.matricula`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  const porCond = new Map();
  r.rows.forEach(x => {
    if (!porCond.has(x.conductor)) porCond.set(x.conductor, { conductor: x.conductor, minutos: 0, _mats: [] });
    const c = porCond.get(x.conductor);
    const min = Number(x.minutos) || 0;
    c.minutos += min;
    if (x.matricula) c._mats.push({ matricula: x.matricula, minutos: min });
  });
  const conductores = [...porCond.values()].map(c => {
    c._mats.sort((a, b) => b.minutos - a.minutos);
    c.matricula = c._mats.length ? c._mats[0].matricula : null;
    c.matriculas = c._mats.map(m => m.matricula);
    delete c._mats;
    return c;
  });
  return { dia: String(dia).slice(0, 10), turno, conductores };
}

/**
 * Los km de la flota en un turno, repartidos por estado — SUMANDO POR COCHE, no
 * por conductor. Cada trayecto de Mapon se reparte por tiempo entre los estados
 * (viaje/espera/descanso/desconectado) de SU coche, y se suma una sola vez. Así el
 * total NO se duplica cuando dos conductores comparten matrícula, y cuadra con el
 * total de Mapon. Es la base del Sankey.
 */
async function bucketsTurno(dia, turno) {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
     solape AS (
       SELECT veh.matricula,
              t.situacion,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, COALESCE(t.hasta, now())) - GREATEST(r.inicio, t.desde))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM fv_ruta r
         CROSS JOIN v
         JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
         JOIN fv_tramo t      ON t.vehiculo_uuid = veh.uuid
                             AND t.desde < r.fin AND COALESCE(t.hasta, now()) > r.inicio
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND r.inicio >= v.ini AND r.inicio < v.fin
     )
     SELECT
       round(coalesce(sum(metros_trozo) FILTER (WHERE situacion = 'viaje'), 0) / 1000.0, 1)        AS viaje,
       round(coalesce(sum(metros_trozo) FILTER (WHERE situacion = 'espera'), 0) / 1000.0, 1)       AS espera,
       round(coalesce(sum(metros_trozo) FILTER (WHERE situacion = 'descanso'), 0) / 1000.0, 1)     AS descanso,
       round(coalesce(sum(metros_trozo) FILTER (WHERE situacion = 'desconectado'), 0) / 1000.0, 1) AS fuera,
       count(DISTINCT matricula)::int AS coches
       FROM solape`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);
  const x = r.rows[0] || {};
  return {
    viaje: Number(x.viaje) || 0, espera: Number(x.espera) || 0,
    descanso: Number(x.descanso) || 0, fuera: Number(x.fuera) || 0,
    coches: Number(x.coches) || 0,
  };
}

/**
 * El flujo de km de la flota para el Sankey, listo para generarPdfFlujo: día y
 * noche como tramos, cada uno con sus buckets. Por matrícula (bucketsTurno), así
 * no se duplica. `totalPasajero` = viaje (hasta la Fase 3 no se separa pasajero/ida,
 * `totalIda` queda en 0). El color de los tramos lo pone quien dibuja (tiene pdf-lib).
 */
async function sankeyFlota(dia) {
  const [bDia, bNoche] = await Promise.all([bucketsTurno(dia, 'dia'), bucketsTurno(dia, 'noche')]);
  const tot = b => ({
    totalMapon: Math.round((b.viaje + b.espera + b.descanso + b.fuera) * 10) / 10,
    totalPasajero: b.viaje, totalIda: 0,
    totalEspera: b.espera, totalDescanso: b.descanso, totalFuera: b.fuera,
  });
  return {
    tramos: [
      { txt: 'Turno de día', tot: tot(bDia) },
      { txt: 'Turno de noche', tot: tot(bNoche) },
    ],
    matriculas: Math.max(bDia.coches, bNoche.coches),
  };
}

/**
 * DIAGNÓSTICO — por qué una matrícula sale (o no) con km en el reporte.
 *
 * El km del reporte pasa por TRES cruces, y basta que uno falle para que salga en
 * blanco aunque BOLT y Mapon digan que el coche rodó:
 *   1) fv_ruta      → hay trayectos de Mapon de ese coche en la ventana (por matrícula).
 *   2) fv_vehiculo  → esos trayectos casan por `mapon_unit = unit_id` (si mapon_unit
 *                     está sin resolver, el reporte NO los ve aunque existan).
 *   3) fv_tramo     → hay un tramo de BOLT que solapa, y lleva conductor: si no,
 *                     los km caen en "(sin conductor)" y no se le atribuyen a nadie.
 *
 * Esta función traza los tres para las matrículas pedidas y devuelve dónde se corta,
 * leyendo SOLO del núcleo (no vuelve a llamar a ninguna API). Es la herramienta para
 * el "¿qué pasó con este?" sin tener que adivinar.
 */
async function diagnosticoKm(dia, plates = [], turno = 'operativo', opts = {}) {
  await db.preparar();
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const mats = (Array.isArray(plates) ? plates : [plates])
    .map(p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean);

  // La ventana operativa, una vez; se reusa como parámetros en el resto.
  const win = (await db.consulta(
    `SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
            (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin`,
    [String(dia).slice(0, 10), String(hi), off, String(hf)])).rows[0];

  const matriculas = [];
  for (const mat of mats) {
    // 1) ¿Está el coche, y tiene el id de Mapon resuelto?
    const vehiculo = (await db.consulta(
      `SELECT v.uuid, v.mapon_unit,
              (SELECT m.activa FROM fv_matricula m WHERE m.matricula = v.matricula) AS vigilada
         FROM fv_vehiculo v WHERE v.matricula = $1 ORDER BY v.visto_at DESC`, [mat])).rows;

    // 2a) Lo que el REPORTE ve: trayectos que casan por mapon_unit (el cruce real).
    const rutaVista = (await db.consulta(
      `SELECT count(*)::int n, coalesce(round(sum(r.metros) / 1000.0, 1), 0) km
         FROM fv_ruta r JOIN fv_vehiculo v ON v.mapon_unit = r.unit_id
        WHERE v.matricula = $1 AND r.inicio >= $2 AND r.inicio < $3`,
      [mat, win.ini, win.fin])).rows[0];
    // 2b) Lo que HAY de verdad: trayectos por matrícula (los rellena Mapon aunque
    // mapon_unit esté sin resolver). Si esto trae km y 2a no, el corte es el enlace.
    const rutaReal = (await db.consulta(
      `SELECT count(*)::int n, coalesce(round(sum(metros) / 1000.0, 1), 0) km,
              count(DISTINCT unit_id)::int units, min(inicio) primero, max(inicio) ultimo
         FROM fv_ruta WHERE matricula = $1 AND inicio >= $2 AND inicio < $3`,
      [mat, win.ini, win.fin])).rows[0];

    // 3) Los tramos de BOLT del coche en la ventana, por conductor y situación:
    // dice si hubo conexión y si llevaba conductor (o si todo es "(sin conductor)").
    const tramos = (await db.consulta(
      `SELECT COALESCE(co.nombre, '(sin conductor)') AS conductor, t.situacion, count(*)::int AS n
         FROM fv_tramo t
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid AND veh.matricula = $1
         LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
        WHERE t.desde < $3 AND COALESCE(t.hasta, now()) > $2
        GROUP BY 1, 2 ORDER BY n DESC`, [mat, win.ini, win.fin])).rows;

    // Bifurcación cuando NO hay trayectos en el núcleo: preguntarle a Mapon por la
    // MISMA ventana. Si Mapon los tiene y el núcleo no → hueco de ingesta (backfill
    // lo tapa). Si Mapon tampoco → la baliza del coche no registró (BOLT lo siguió
    // por el móvil, el equipo del coche no). Solo con ?mapon=1: es la excepción a
    // "no volver a llamar a la API", justificada porque esto es un diagnóstico.
    // Solo se pregunta a Mapon si el núcleo NO tiene nada del coche (ni por unit ni
    // por matrícula): entonces la duda es hueco de ingesta vs. baliza caída. Si el
    // núcleo ya tiene km (rutaVista), no hace falta molestar a la API.
    let mapon = null;
    if (opts.conMapon && !Number(rutaVista.n) && !Number(rutaReal.n)) {
      try {
        const u = (await fuentes.flotaMapon()).get(mat);
        if (!u) mapon = { encontrado: false };
        else {
          const crudo = await fuentes.rutasDeUnidad(u.unitId, iso(win.ini), iso(win.fin));
          let trips = 0, metros = 0;
          ((crudo && crudo.data && crudo.data.units) || []).forEach(un =>
            (un.routes || []).forEach(rt => {
              if (rt.type === 'route') { trips++; metros += Number(rt.distance) || 0; }
            }));
          mapon = { encontrado: true, unitId: u.unitId, trips, km: Math.round(metros / 100) / 10 };
        }
      } catch (e) { mapon = { error: e.message }; }
    }

    // El veredicto legible. LA CLAVE es rutaVista: es EXACTAMENTE lo que ve el reporte
    // (cruce por mapon_unit). rutaReal (por matrícula) solo distingue el sub-caso
    // "mapon_unit sin resolver", porque fv_ruta.matricula llega poco fiable de route/list.
    let corte;
    if (!vehiculo.length) corte = 'El coche no está en fv_vehiculo (nunca lo vio BOLT).';
    else if (Number(rutaVista.n)) corte = `El coche SÍ tiene km en el núcleo (${rutaVista.n} trayecto(s) / ${rutaVista.km} km), repartidos entre los conductores de sus tramos. Si un conductor concreto sale en blanco, es que NO tiene tramos en este coche en la ventana → míralo con ?nombre=.`;
    else if (Number(rutaReal.n)) corte = `Hay ${rutaReal.n} trayecto(s) por matrícula pero mapon_unit no casa: fv_vehiculo.mapon_unit está sin resolver → el reporte no los ve.`;
    else if (!mapon) corte = 'Sin km en el núcleo esa ventana. Añade ?mapon=1 para saber si es hueco de ingesta o baliza caída.';
    else if (mapon.error) corte = `Sin km en el núcleo; y al preguntar a Mapon: ${mapon.error}`;
    else if (mapon.encontrado === false) corte = 'Sin km en el núcleo y Mapon no reconoce la matrícula (unit/list no la tiene).';
    else if (mapon.trips > 0) corte = `HUECO DE INGESTA: Mapon SÍ tiene ${mapon.trips} trayecto(s) / ${mapon.km} km esa ventana, pero el núcleo no. Reingesta ese día (backfill).`;
    else corte = 'BALIZA DEL COCHE: ni Mapon tiene trayectos de ese coche esa ventana. BOLT lo siguió por el móvil, el equipo del coche no registró. No es bug nuestro.';

    matriculas.push({ matricula: mat, vehiculo, rutaVista, rutaReal, tramos, mapon, corte });
  }

  // El reparto por conductor (incl. "(sin conductor)"): para ver a nombre de quién
  // —o de nadie— quedaron los km de esos coches. El reporte esconde "(sin conductor)".
  const km = await kmConectadoDesconectado(dia, turno);
  const reparto = km.conductores.filter(c =>
    c.conductor === '(sin conductor)' || (c.matriculas || []).some(m => mats.includes(m)));

  // Traza POR CONDUCTOR: en qué coches tiene tramos en la ventana (lo que ve nuestro
  // sistema). Es el otro lado del diagnóstico: "el conductor trabajó pero sale en
  // blanco" → o no tiene tramos (no lo trackeamos con coche), o los tiene en OTRO
  // coche del que sí midió km otro conductor. Casa por nombre (ILIKE por tokens).
  const conductores = [];
  for (const nombre of (opts.nombres || [])) {
    const toks = String(nombre || '').toLowerCase()
      .replace(/[^a-z0-9áéíóúüñ\s]/gi, ' ').split(/\s+/).filter(t => t.length >= 3).slice(0, 4);
    let tramos = [];
    if (toks.length) {
      const params = [win.ini, win.fin];
      const conds = toks.map(t => { params.push('%' + t + '%'); return `co.nombre ILIKE $${params.length}`; });
      tramos = (await db.consulta(
        `SELECT co.nombre AS conductor, veh.matricula, t.situacion, count(*)::int AS n,
                min(t.desde) AS desde, max(COALESCE(t.hasta, now())) AS hasta
           FROM fv_tramo t
           JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
           JOIN fv_conductor co ON co.uuid = t.conductor_uuid
          WHERE t.desde < $2 AND COALESCE(t.hasta, now()) > $1
            AND ${conds.join(' AND ')}
          GROUP BY co.nombre, veh.matricula, t.situacion
          ORDER BY n DESC`, params)).rows;
    }
    conductores.push({ nombre, encontrado: tramos.length > 0, tramos });
  }

  return { dia: String(dia).slice(0, 10), turno, ventana: win, matriculas, reparto, conductores };
}

module.exports = {
  ingestarRutas, guardarLote, kmPorCoche, kmConectadoDesconectado,
  horasConectadasPorConductor, horasConectadoTotal, matriculasBoltPorConductor,
  bucketsTurno, sankeyFlota, diagnosticoKm,
};
