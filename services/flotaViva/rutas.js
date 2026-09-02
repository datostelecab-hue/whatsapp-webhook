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

module.exports = { ingestarRutas, guardarLote, kmPorCoche, kmConectadoDesconectado };
