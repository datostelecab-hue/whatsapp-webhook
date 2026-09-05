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
 * total por conductor cuadra. OJO: un tramo desconectado SI suele llevar conductor
 * (el ultimo que iba al volante), asi que sus km se le imputan a esa persona aunque
 * ya no estuviera trabajando. Por eso "salio" no puede mirar km: mira minutos.
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
 * MINUTOS EFECTIVOS POR CONDUCTOR en la ventana de un turno. Del núcleo.
 *
 * EFECTIVO = viaje + espera. El DESCANSO NO CUENTA: en BOLT es 'busy', el conductor
 * sigue con el coche y con la app abierta, pero no está disponible ni trabajando.
 * Aquí no se filtra por `s.conectado` —que también es cierto para el descanso, porque
 * significa "tiene la app abierta"— sino por `s.efectivo`, que es la columna del
 * catálogo que dice qué cuenta como trabajo. Confundir las dos costó un reporte que
 * le puso 14,4 h y "Muy efectivo" a quien había hecho 4h29 de viaje y 1h03 de espera:
 * los otros 8h51 eran descanso.
 *
 * Las horas son TIEMPO DE RELOJ, así que se funden los solapes en vez de sumar
 * duraciones a pelo: un conductor puede tener tramos en dos coches a la vez (un
 * relevo, un coche mal seleccionado) y sumarlos contaba el mismo rato dos veces —de
 * ahí salían 22 h en una ventana de 24—. Es la UNIÓN de los intervalos.
 *
 * Devuelve { porNombre: Map(nombre → minutos), porUuid: Map(uuid → minutos) }.
 */
async function minutosEfectivos(dia, turno = 'operativo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT t.conductor_uuid                          AS uuid,
            COALESCE(co.nombre, '(sin conductor)')    AS conductor,
            GREATEST(t.desde, v.ini)                  AS desde,
            LEAST(COALESCE(t.hasta, now()), v.fin)     AS hasta
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      WHERE t.desde < v.fin AND COALESCE(t.hasta, now()) > v.ini
      ORDER BY uuid, conductor, desde`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  // Se agrupa por las dos claves a la vez: el nombre es lo que esperan los reportes
  // viejos y el uuid es lo que usa el cockpit, y así solo se pregunta una vez.
  const ivsNombre = new Map(), ivsUuid = new Map();
  const mete = (m, k, iv) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(iv); };
  r.rows.forEach(x => {
    const iv = [new Date(x.desde).getTime(), new Date(x.hasta).getTime()];
    mete(ivsNombre, x.conductor, iv);
    mete(ivsUuid, x.uuid, iv);
  });

  // La unión de una lista de intervalos ya ordenada por su inicio.
  const funde = ivs => {
    let total = 0, curIni = null, curFin = null;
    for (const [s, e] of ivs.slice().sort((a, b) => a[0] - b[0])) {
      if (e <= s) continue;
      if (curFin === null || s > curFin) {          // hueco → cierra el bloque anterior
        if (curFin !== null) total += curFin - curIni;
        curIni = s; curFin = e;
      } else if (e > curFin) {                       // solapa → estira el bloque
        curFin = e;
      }
    }
    if (curFin !== null) total += curFin - curIni;
    return Math.floor(total / 60000);
  };
  const aMapa = m => new Map([...m.entries()].map(([k, ivs]) => [k, funde(ivs)]));
  return { porNombre: aMapa(ivsNombre), porUuid: aMapa(ivsUuid) };
}

/**
 * Minutos efectivos por conductor, por NOMBRE. Es lo que consumen los reportes.
 * Devuelve Map(nombre de fv_conductor -> minutos).
 */
async function horasEfectivasPorConductor(dia, turno = 'operativo') {
  return (await minutosEfectivos(dia, turno)).porNombre;
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



/**
 * ACTIVIDAD REAL DE CADA CONDUCTOR EN LA VENTANA DE SU TURNO.
 *
 * Es la respuesta a "¿este ha salido hoy o no?", y se hace siguiendo a la PERSONA
 * (fv_tramo.conductor_uuid), no al coche. Antes se miraba el día operativo entero
 * (05:00→05:00) y se sumaban los km rodados ESTANDO DESCONECTADO, así que el de
 * noche que terminó a las 03:51 y dejó el coche rodando hasta las 07:50 aparecía
 * como "Salió" en el turno de día con 0,0 h y 20,7 km. No salió: eran las sobras
 * de su noche cruzando el corte de las 05:00.
 *
 * Reglas:
 *   · TRABAJAR = viaje + espera. El descanso se cuenta aparte (estás con el coche
 *     pero no disponible) y el desconectado no cuenta nada.
 *   · La ventana se recorta a AHORA: nunca se cuenta futuro. Si el turno todavía
 *     no ha empezado (la noche a las 09:00), `empezada` sale false y la lista vacía
 *     — que no es lo mismo que "no ha salido nadie".
 *   · Los km NO salen de fv_tramo.km_m (el odómetro solo llega a ratos y ensucia
 *     el tramo que estuviera abierto) sino de fv_ruta, la fuente que cuadró con el
 *     informe de BOLT. Se separan en los de trabajo y los de fuera de BOLT.
 *
 * Devuelve { dia, turno, ini, fin, finPlan, empezada, porUuid: Map(uuid → actividad) }.
 */
async function actividadPorConductor(dia, turno = 'dia') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.dia;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan
     ),
     w AS (SELECT ini, LEAST(fin_plan, now()) AS fin, fin_plan FROM v),
     tr AS (
       SELECT t.conductor_uuid                                   AS uuid,
              veh.matricula,
              t.situacion,
              t.hasta IS NULL                                    AS abierto,
              GREATEST(t.desde, w.ini)                           AS d,
              LEAST(COALESCE(t.hasta, now()), w.fin)             AS h
         FROM fv_tramo t
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE t.conductor_uuid IS NOT NULL
          AND w.fin > w.ini
          AND t.desde < w.fin
          AND COALESCE(t.hasta, now()) > w.ini
     ),
     p AS (
       SELECT uuid, matricula, situacion, abierto, d, h,
              EXTRACT(EPOCH FROM (h - d))                        AS seg
         FROM tr
     )
     SELECT p.uuid, p.matricula,
            co.nombre, co.telefono,
            floor(COALESCE(sum(p.seg) FILTER (WHERE p.situacion IN ('viaje','espera')), 0) / 60)::int    AS minutos,
            floor(COALESCE(sum(p.seg) FILTER (WHERE p.situacion = 'descanso'), 0) / 60)::int             AS min_descanso,
            floor(COALESCE(sum(p.seg) FILTER (WHERE p.situacion = 'desconectado'), 0) / 60)::int         AS min_desconectado,
            min(p.d) FILTER (WHERE p.situacion IN ('viaje','espera'))                                    AS primera,
            max(p.h) FILTER (WHERE p.situacion IN ('viaje','espera'))                                    AS ultima,
            bool_or(p.abierto AND p.situacion IN ('viaje','espera','descanso'))                          AS conectado_ahora,
            max(p.situacion) FILTER (WHERE p.abierto)                                                    AS situacion_ahora
       FROM p
       LEFT JOIN fv_conductor co ON co.uuid = p.uuid
      GROUP BY p.uuid, p.matricula, co.nombre, co.telefono`,
    [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  // ── Los km, de fv_ruta (los trayectos de Mapon), NO de fv_tramo.km_m ─────────
  // km_m es el salto de odómetro dentro del tramo, y el odómetro solo llega a
  // ratos: hoy solo 188 de 3.551 tramos traen km y el 43 % no tiene ni lectura.
  // El resultado es que los km caen en el tramo que estuviera abierto cuando
  // Mapon habló — 11,1 km imputados a un descanso de 12 minutos. fv_ruta sí es
  // fiable: es la fuente que cuadró con el informe de BOLT al 0,03 %.
  // Un trayecto cuenta en la ventana donde EMPIEZA, igual que en el resto del ERP.
  const rk = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan
     ),
     w AS (SELECT ini, LEAST(fin_plan, now()) AS fin FROM v),
     solape AS (
       SELECT t.conductor_uuid AS uuid, veh.matricula, t.situacion,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, COALESCE(t.hasta, now())) - GREATEST(r.inicio, t.desde))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM fv_ruta r
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
         JOIN fv_tramo t      ON t.vehiculo_uuid = veh.uuid
                             AND t.desde < r.fin AND COALESCE(t.hasta, now()) > r.inicio
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND w.fin > w.ini
          AND r.inicio >= w.ini AND r.inicio < w.fin
          AND t.conductor_uuid IS NOT NULL
     )
     SELECT uuid, matricula,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion IN ('viaje','espera')), 0)::numeric / 1000.0, 1)     AS km,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion NOT IN ('viaje','espera')), 0)::numeric / 1000.0, 1) AS km_fuera
       FROM solape GROUP BY uuid, matricula`,
    [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  // Una fila por (conductor, coche): se pliega en JS para dar el total de la persona
  // y la lista de coches que llevó, el de más minutos primero — que es "su coche".
  const porUuid = new Map();
  r.rows.forEach(x => {
    if (!porUuid.has(x.uuid)) {
      porUuid.set(x.uuid, {
        uuid: x.uuid, nombre: x.nombre || '', telefono: x.telefono || '',
        minutos: 0, minDescanso: 0, minDesconectado: 0, km: 0, kmFuera: 0,
        primera: null, ultima: null, conectadoAhora: false, situacionAhora: null,
        _mats: [],
      });
    }
    const a = porUuid.get(x.uuid);
    a.minutos += Number(x.minutos) || 0;
    a.minDescanso += Number(x.min_descanso) || 0;
    a.minDesconectado += Number(x.min_desconectado) || 0;
    if (x.primera && (!a.primera || x.primera < a.primera)) a.primera = x.primera;
    if (x.ultima && (!a.ultima || x.ultima > a.ultima)) a.ultima = x.ultima;
    if (x.conectado_ahora) { a.conectadoAhora = true; a.situacionAhora = x.situacion_ahora || a.situacionAhora; }
    if (x.matricula) a._mats.push({ matricula: x.matricula, minutos: Number(x.minutos) || 0 });
  });

  // Los km encima de lo ya montado. Un conductor puede tener km de un coche del
  // que no quedo tramo dentro de la ventana: entonces se crea su ficha igual.
  rk.rows.forEach(x => {
    if (!porUuid.has(x.uuid)) return;
    const a = porUuid.get(x.uuid);
    a.km = Math.round((a.km + (Number(x.km) || 0)) * 10) / 10;
    a.kmFuera = Math.round((a.kmFuera + (Number(x.km_fuera) || 0)) * 10) / 10;
  });
  // LOS MINUTOS, DE LA MISMA FUENTE QUE LOS REPORTES. La consulta de arriba agrupa
  // por (conductor, coche), y sumar esos trozos contaría dos veces el rato en que a
  // una persona se le solapan dos tramos. minutosEfectivos funde los intervalos y
  // filtra por s.efectivo, así que el cockpit y el Reporte de horas no pueden
  // discrepar: es literalmente el mismo número.
  const efect = (await minutosEfectivos(dia, turno)).porUuid;
  porUuid.forEach((a, u) => { a.minutos = efect.get(u) || 0; });

  porUuid.forEach(a => {
    a._mats.sort((p, q) => q.minutos - p.minutos);
    a.matriculas = a._mats.map(m => m.matricula);
    a.matricula = a.matriculas[0] || null;
    delete a._mats;
  });

  // La ventana, para que quien pinte sepa si el turno ya empezó. La noche a las
  // 09:00 no es "no ha salido nadie": es que todavía no le toca a nadie.
  const w = await db.consulta(
    `SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
            (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan,
            now() AS ahora`,
    [String(dia).slice(0, 10), String(hi), off, String(hf)]);
  const { ini, fin_plan: finPlan, ahora } = w.rows[0];
  return {
    dia: String(dia).slice(0, 10), turno,
    ini, finPlan, fin: ahora < finPlan ? ahora : finPlan,
    empezada: ahora > ini,
    terminada: ahora >= finPlan,
    porUuid,
  };
}

module.exports = {
  ingestarRutas, guardarLote, kmPorCoche, kmConectadoDesconectado,
  horasEfectivasPorConductor, minutosEfectivos, matriculasBoltPorConductor,
  bucketsTurno, sankeyFlota, diagnosticoKm, actividadPorConductor, TURNOS,
};
