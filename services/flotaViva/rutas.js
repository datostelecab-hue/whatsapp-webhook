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

// ── EL ODÓMETRO DEL CUADRO (CAN) ────────────────────────────────────────────
// Un salto de odómetro entre dos lecturas es creíble mientras no pida ir a más
// de 160 km/h de media. Por encima no es un viaje: es que el equipo cambió de
// coche, o que la lectura vino sucia. Esos se tiran — meter 300 km falsos en la
// jornada de alguien es mucho peor que quedarse corto.
const VELOCIDAD_IMPOSIBLE = 160;
// PERO EL ODÓMETRO CUENTA DE KILÓMETRO EN KILÓMETRO, y el salto se apunta cuando
// cae, no cuando toca. Dos lecturas separadas veinte segundos con un kilómetro
// de diferencia son 180 km/h en el papel y un coche normal en la calle. Sin esta
// holgura el filtro se comía km buenos: a Carlos Borelli le quitaba 16 de 292 y
// a Macilon 30 de 414. Se perdonan dos kilómetros antes de juzgar la velocidad;
// los saltos de verdad —los de un equipo que cambió de coche— son de cientos.
const HOLGURA_CUENTA_KM = 2;
// Y un hueco de más de un día no se reparte: el coche pudo hacer esos km
// cualquier tarde de las que el equipo estuvo callado, y colgárselos al tramo
// que toque sería inventar. Ese coche se queda sin CAN en esa ventana y pasa
// por GPS, que es justo lo que hace `FUENTE_KM` cuando el CAN no llega.
const HUECO_MAXIMO_H = 24;

/**
 * Mete en el núcleo (fv_odometro) el odómetro CAN de la flota en un rango.
 *
 * Idempotente por (unit_id, inicio): repetir una ventana no duplica, solo
 * refresca. Por eso el motor puede pedir tres horas cada vuelta sin cuidado.
 *
 * VA DE UNA UNIDAD EN UNA porque la API no deja pedir la flota entera de un
 * golpe —a diferencia de route/list—, así que son ~85 llamadas por pasada. Se
 * va con cola de 4: la cuenta admite 5 simultáneas y el poller de sanciones
 * también consume.
 *
 * Lo que se guarda no son las lecturas: son los TRAMOS entre lectura y lectura,
 * con sus metros. Esa forma —idéntica a la de fv_ruta— es lo que permite que el
 * reparto entre conductores y ventanas siga siendo el mismo prorrateo de
 * siempre, sin una segunda matemática que mantener.
 */
async function ingestarOdometro({ desde, hasta, ventanaDias = 7, soloActivos = false } = {}) {
  await db.preparar();
  const fin = hasta ? new Date(hasta) : new Date();
  const ini = desde ? new Date(desde) : new Date(fin.getTime() - 3 * 3600 * 1000);

  // EN CADA VUELTA NO SE PREGUNTA POR LOS OCHENTA Y CINCO. Son ochenta y cinco
  // llamadas —la API no deja pedir la flota de un golpe— y la mayoría son coches
  // aparcados que van a contestar lo mismo que hace cinco minutos.
  //
  // «Activo» se mira por DOS caminos a propósito: o Mapon le vio trayectos, o
  // alguien está conectado en BOLT con él. Con uno solo se cae justo el coche que
  // más falta hace: el 0454MMZ, con el GPS medio muerto (45 km de 518), no tiene
  // apenas trayectos y es precisamente donde el odómetro salva el dato.
  //
  // Aun así, una vez a la hora se barre la flota entera (lo decide quien llama):
  // lo que se escape por los dos sitios entra ahí.
  const unidades = (await db.consulta(
    `SELECT v.mapon_unit AS unit, v.matricula
       FROM fv_vehiculo v
       JOIN fv_matricula m ON m.matricula = v.matricula AND m.activa
      WHERE v.mapon_unit IS NOT NULL
        AND ($1::boolean IS NOT TRUE
             OR EXISTS (SELECT 1 FROM fv_ruta r
                         WHERE r.unit_id = v.mapon_unit
                           AND r.inicio < $3::timestamptz AND COALESCE(r.fin, now()) > $2::timestamptz)
             OR EXISTS (SELECT 1 FROM fv_tramo t
                         WHERE t.vehiculo_uuid = v.uuid
                           AND t.situacion IN ('viaje','espera','descanso')
                           AND t.desde < $3::timestamptz
                           AND (t.hasta > $2::timestamptz
                                OR (t.hasta IS NULL AND now() > $2::timestamptz))))
      ORDER BY v.matricula`,
    [!!soloActivos, ini.toISOString(), fin.toISOString()])).rows;
  if (!unidades.length) return { unidades: 0, conCan: 0, tramos: 0, km: 0, sinCan: [], desde: iso(ini), hasta: iso(fin) };

  let tramos = 0, metros = 0, conCan = 0;
  const sinCan = [];

  for (let v = new Date(ini); v < fin;) {
    const vFin = new Date(v.getTime() + ventanaDias * 86400000);
    const hastaV = vFin < fin ? vFin : fin;
    const desdeIso = iso(v), hastaIso = iso(hastaV);

    let i = 0;
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < unidades.length) {
        const u = unidades[i++];
        let lecturas = [];
        try {
          lecturas = await fuentes.odometroCan(u.unit, desdeIso, hastaIso);
        } catch (e) {
          // Un coche que falla no puede tumbar la ingesta de los otros ochenta.
          console.error(`⚠️  [odómetro] ${u.matricula}: ${e.message}`);
          continue;
        }
        const seg = segmentar(u.unit, lecturas);
        if (!seg.length) { sinCan.push(u.matricula); continue; }
        conCan++;
        await guardarOdometro(seg);
        tramos += seg.length;
        metros += seg.reduce((s, x) => s + x.metros, 0);
      }
    }));
    console.log(`   📟 [odómetro] ${desdeIso.slice(0, 10)}…${hastaIso.slice(0, 10)}: ` +
                `${conCan} coche(s) con CAN, ${tramos} tramo(s)`);
    v = vFin;
  }
  return {
    unidades: unidades.length, conCan, tramos,
    km: Math.round(metros / 100) / 10,
    sinCan: [...new Set(sinCan)],
    desde: iso(ini), hasta: iso(fin),
  };
}

/** De lecturas acumuladas a tramos con metros. Aquí se cae lo que no es creíble. */
function segmentar(unitId, lecturas) {
  const out = [];
  for (let k = 1; k < lecturas.length; k++) {
    const a = lecturas[k - 1], b = lecturas[k];
    const seg = (b.t - a.t) / 1000;
    if (seg <= 0 || seg > HUECO_MAXIMO_H * 3600) continue;
    const km = b.km - a.km;
    // Hacia atrás es un reinicio del contador o un equipo que cambió de coche.
    if (!(km >= 0)) continue;
    if ((km - HOLGURA_CUENTA_KM) / (seg / 3600) > VELOCIDAD_IMPOSIBLE) continue;
    if (km === 0) continue;                       // el coche parado no ocupa sitio
    out.push({ unitId, inicio: a.t, fin: b.t, metros: Math.round(km * 1000) });
  }
  return out;
}

/**
 * El odómetro de UN coche en un rango, leído del núcleo (no de la API).
 *
 * Lo usa la Auditoría de flota, que vive en otro módulo y necesita los mismos
 * metros que Control para no dar dos cifras distintas del mismo día. Devuelve
 * los tramos en SEGUNDOS epoch, que es como trabaja allí.
 *
 * Si vuelve vacío es que ese coche no da odómetro (o calló): quien llame decide
 * —la Auditoría se va al GPS y lo dice—, aquí no se inventa nada.
 */
async function odometroDeUnidad({ unitId, fromTs, tillTs }) {
  const r = await db.consulta(
    `SELECT EXTRACT(EPOCH FROM inicio)::bigint AS desde,
            EXTRACT(EPOCH FROM fin)::bigint    AS hasta,
            metros
       FROM fv_odometro
      WHERE unit_id = $1
        AND inicio < to_timestamp($3) AND fin > to_timestamp($2)
      ORDER BY inicio`,
    [Number(unitId), Number(fromTs), Number(tillTs)]);
  return r.rows.map(x => ({ desde: Number(x.desde), hasta: Number(x.hasta), metros: Number(x.metros) }));
}

/** Sube los tramos de odómetro por lotes con upsert. */
async function guardarOdometro(seg) {
  const LOTE = 500;
  for (let i = 0; i < seg.length; i += LOTE) {
    const chunk = seg.slice(i, i + LOTE);
    const vals = [], params = [];
    chunk.forEach((x, k) => {
      const b = k * 4;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      params.push(x.unitId, x.inicio.toISOString(), x.fin.toISOString(), x.metros);
    });
    await db.consulta(
      `INSERT INTO fv_odometro (unit_id, inicio, fin, metros)
       VALUES ${vals.join(',')}
       ON CONFLICT (unit_id, inicio) DO UPDATE SET
         fin = EXCLUDED.fin, metros = EXCLUDED.metros, ingerida_at = now()`,
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
 * Un trayecto cuenta en la jornada de su INICIO. La jornada es la OPERATIVA
 * (05:00 → 05:00), la misma ventana que las horas y los NN del cockpit: antes
 * cortaba por día natural y "Flota hoy X km" iba al lado de cifras 05→05 que no
 * eran del mismo día. Devuelve Map(matrícula -> {km, viajes}).
 */
async function kmPorCoche(dia) {
  const [hi, off, hf] = TURNOS.operativo;
  const r = await db.consulta(
    `WITH w AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
${FUENTE_KM}
     -- Los KM salen de la fuente elegida (odómetro si el coche lo da), prorrateados
     -- a la ventana. Los VIAJES no: un viaje es un trayecto de Mapon y se cuentan
     -- de ahí siempre — el odómetro no sabe de viajes, solo de metros, y contar
     -- sus tramos daría "600 viajes" en un coche que hizo veinte.
     km AS (
       SELECT v.matricula,
              sum(r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(r.fin, w.fin) - GREATEST(r.inicio, w.ini))))
                  / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0)) AS metros
         FROM km_src r CROSS JOIN w
         JOIN fv_vehiculo v ON v.mapon_unit = r.unit_id
        WHERE v.matricula IS NOT NULL
        GROUP BY v.matricula
     ),
     viajes AS (
       SELECT v.matricula, count(*)::int AS n
         FROM fv_ruta r CROSS JOIN w
         JOIN fv_vehiculo v ON v.mapon_unit = r.unit_id
        WHERE v.matricula IS NOT NULL
          AND r.inicio >= w.ini AND r.inicio < w.fin
        GROUP BY v.matricula
     )
     SELECT COALESCE(km.matricula, viajes.matricula) AS matricula,
            round(COALESCE(km.metros, 0)::numeric / 1000.0, 1) AS km,
            COALESCE(viajes.n, 0) AS viajes
       FROM km FULL JOIN viajes ON viajes.matricula = km.matricula`, [String(dia).slice(0, 10), String(hi), off, String(hf)]);
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
// Las horas que parten la jornada vienen del nucleo: estaban repetidas aqui y
// en auditoriaFlota.js, y dos copias de la constante que parte el dia es la
// forma mas silenciosa de que dos pantallas dejen de cuadrar.
const { HORA_DIA, HORA_NOCHE, deLaFlotaVigilada } = require('../nucleo');
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
  // LA NOCHE, COMO LA MIRA EL COCKPIT: se MIDE desde mediodía y termina a las
  // 05:00. Es la misma regla de Tráfico que `noche12` —el turno de noche va de
  // mediodía a mediodía, así su madrugada no se le imputa al día siguiente—,
  // recortada al final real del turno.
  //
  // Por qué no vale 17→05 aquí: lo que un conductor de noche hace a las 06:00
  // es la COLA DE SU TURNO DE AYER, y con la ventana de 05:00 se le contaba como
  // actividad de hoy: le salían alertas de rechazos por viajes de la noche
  // anterior. Y al revés, el que empieza a las 13:00 no aparecía por ninguna
  // parte hasta las 17:00. Midiendo desde las 12:00 las dos cosas caen donde
  // les toca.
  //
  // OJO: medir no es reclamar. Que la ventana esté abierta a las 12:30 no
  // significa que a quien entra a las 17:00 haya que llamarle por no estar; eso
  // lo decide `reclamable` en el cockpit (directo.js).
  nocheControl: [12, 1, HORA_DIA],
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
     w AS (SELECT ini, fin FROM v),
${FUENTE_KM}
     tramo_km AS (
       SELECT CASE WHEN t.conductor_uuid IS NULL THEN '(sin conductor)'
                   ELSE COALESCE(co.nombre, t.conductor_uuid) END AS conductor,
              veh.matricula, veh.mapon_unit AS unit_id, t.situacion,
              GREATEST(t.desde, w.ini)                      AS d,
              LEAST(COALESCE(t.hasta, now()), w.fin)        AS h
         FROM fv_tramo t
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
         LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
        WHERE veh.mapon_unit IS NOT NULL
          AND t.desde < w.fin
          AND t.desde >= w.ini - interval '${VENTANA_ATRAS}'
          AND COALESCE(t.hasta, now()) > w.ini
     ),
     solape AS (
       -- Prorrateado por la ventana TAMBIÉN, no solo por el tramo: si no, un
       -- trozo a caballo del corte cuenta entero en los dos días.
       SELECT tk.conductor, tk.matricula, tk.situacion,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, tk.h) - GREATEST(r.inicio, tk.d))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM km_src r
         JOIN tramo_km tk ON tk.unit_id = r.unit_id AND tk.d < r.fin AND tk.h > r.inicio
        WHERE tk.h > tk.d
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
// ── LA COTA DE ABAJO ────────────────────────────────────────────────────────
// Un tramo que pisa una ventana cumple `desde < fin` y `hasta > ini`. Escrito
// así, `desde < fin` lo cumple CASI TODA LA TABLA —todo lo anterior a ahora— y
// `COALESCE(hasta, now()) > ini` no es indexable, así que PostgreSQL recorría
// los ~3.300 tramos de cada coche para quedarse con 3. En el cockpit, que pide
// los tres turnos, eso eran cuatro segundos de pantalla en blanco.
//
// Con esta cota el índice (vehiculo_uuid, desde) puede SALTAR en vez de barrer.
// Deja fuera lo que empezó hace más de dos semanas y sigue abierto: eso no es
// actividad de hoy, es un registro que se quedó colgado. Comprobado contra la
// consulta sin cota en siete jornadas de agosto y septiembre, los tres turnos:
// MISMO resultado fila a fila, y entre 2 y 12 veces más rápido. Con 2 días ya
// aparecían diferencias; con 14, ninguna.
const VENTANA_ATRAS = '14 days';

// ── HASTA CUÁNDO CUENTAN LOS KM DE UN TRAMO ─────────────────────────────────
// Un tramo de BOLT dura lo que dura, y cuando dice "desconectado" puede durar
// DÍAS: nadie vuelve a tocar ese coche y la línea se queda abierta. Estirarlo
// hasta su final hace que absorba TODO lo que el coche hiciera después, aunque
// lo condujera otro o aunque su dueño llevara dos días en otro coche.
//
// Pasó de verdad y a lo grande. Macilon Dos Santos se desconectó del 7550KYT el
// 15/09 a las 06:41, se fue a otro coche, y el reporte le apuntó 256 km "fuera
// de servicio" que eran 217 de ese coche más sus 38 reales.
//
// EL CORTE VALE PARA TODOS LOS TRAMOS, ABIERTOS Y CERRADOS. La primera versión
// solo cortaba los abiertos, y por eso el número VOLVIÓ: el 17/09 el motor cerró
// el tramo de Macilon con 58 horas de duración, dejó de ser "abierto" y sus 219
// km reaparecieron en el reporte del día 16. Que un tramo esté cerrado no lo
// hace creíble — lo único que dice es que alguien volvió a conectarse al fin.
// Medido el 17/09/2026: 512 tramos cerrados de más de 12 h en treinta días,
// 11.327 horas en total, todos desconectados. Eso son miles de km colgados de
// gente que no iba dentro, y con esos números se llama a la gente.
//
// Se corta en lo que pase ANTES de estas cuatro:
//
//   0. El final del propio tramo, cuando lo hay. Un tramo normal dura minutos y
//      manda él: las otras tres ni se notan.
//
//   1. Otro conductor se conecta a ese coche. A partir de ahí los km son suyos:
//      es el hecho más fuerte que hay y no hace falta suponer nada.
//   2. ÉL aparece en otro coche. Nadie conduce dos a la vez.
//   3. Un tope de 12 h. Solo salta cuando no ocurre ninguna de las dos, que es
//      justo el caso feo: el coche se va de la flota —a Barcelona, al taller— y
//      nadie vuelve a conectarse con él en BOLT, así que ningún hecho cierra el
//      tramo. Son 12 h y no otra cifra para decir lo mismo que la auditoría de
//      flota, que ya da por caduco un estado con esa misma edad.
//
// LEAST ignora los NULL, así que las dos subconsultas no necesitan envoltorio:
// si no hay siguiente tramo, no cuentan.
const TOPE_TRAMO_ABIERTO = '12 hours';
const FIN_KM = `LEAST(
         COALESCE(t.hasta, now()),
         t.desde + interval '${TOPE_TRAMO_ABIERTO}',
         (SELECT min(o.desde) FROM fv_tramo o
           WHERE o.vehiculo_uuid = t.vehiculo_uuid
             AND o.conductor_uuid IS NOT NULL
             AND o.conductor_uuid <> t.conductor_uuid
             AND o.desde > t.desde),
         (SELECT min(x.desde) FROM fv_tramo x
           WHERE x.conductor_uuid = t.conductor_uuid
             AND x.vehiculo_uuid <> t.vehiculo_uuid
             AND x.desde > t.desde)
       )`;

// ── DE DÓNDE SALEN LOS KM: DEL CUADRO SI SE PUEDE, DEL GPS SI NO ────────────
//
// Dos fuentes para la misma pregunta y no dicen lo mismo:
//
//   · fv_ruta  son los km que Mapon CALCULA uniendo los puntos del GPS. Corta
//     las curvas y, cuando el equipo pierde cobertura, pierde el trozo entero.
//   · fv_odometro es el número del CUADRO, leído del bus CAN. No se estima.
//
// Medido en la flota el 16/09/2026: el GPS se queda un 4 % por debajo del
// odómetro, y coche a coche la mediana es un 0,4 % — o sea que donde los dos
// funcionan, dicen lo mismo. La diferencia está en los coches donde el GPS falla:
// el 0454MMZ marcó 45 km de GPS contra 518 reales. Por eso manda el CAN.
//
// PERO NO LO TIENEN TODOS. Nueve coches llevan un equipo que no lee el CAN, y
// algún otro calla a ratos. Ahí no hay nada que discutir: se va con el GPS y la
// pantalla lo dice ("KM POR GPS"), que es mejor que un hueco o que un cero.
//
// LA ELECCIÓN ES POR COCHE Y POR VENTANA, no una configuración. Un equipo que
// hoy lee el CAN y mañana no, cambia de fuente solo. El criterio es simple: si
// el CAN se queda MUY por debajo del GPS es que calló un rato, y entonces no
// vale. Si está por encima o cerca, vale. El 85 % es holgado a propósito: la
// diferencia normal entre los dos es del 1 %, así que solo salta cuando de
// verdad falta serie.
const UMBRAL_CAN = Number(process.env.FV_UMBRAL_CAN || 0.85);

// Requiere una CTE `w` (ini, fin) ya declarada, y deja puestas `km_src`
// —los tramos de la fuente elegida, en la forma de fv_ruta— y `fuente`.
const FUENTE_KM = `
     can_v AS (
       SELECT o.unit_id, o.inicio, o.fin, o.metros, TRUE AS por_can,
              o.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(o.fin, w.fin) - GREATEST(o.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (o.fin - o.inicio)), 0) AS en_ventana
         FROM fv_odometro o CROSS JOIN w
        -- LA COTA EN CONSTANTES NO SOBRA. La ventana se calcula aquí dentro y se usa
        -- muchas veces, así que Postgres la materializa y deja de saber qué
        -- fechas lleva: sin este recorte sobre $1 se leía la tabla entera —1,3
        -- millones de tramos y subiendo— en cada pregunta, y En directo pasó de
        -- segundos a medio minuto. Con la cota, entra por el índice.
        WHERE o.inicio >= $1::date - interval '1 day'
          AND o.inicio <  $1::date + interval '3 days'
          AND o.fin > o.inicio AND o.inicio < w.fin AND o.fin > w.ini
     ),
     gps_v AS (
       SELECT r.unit_id, r.inicio, r.fin, r.metros, FALSE AS por_can,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, w.fin) - GREATEST(r.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS en_ventana
         FROM fv_ruta r CROSS JOIN w
        WHERE r.inicio >= $1::date - interval '1 day'
          AND r.inicio <  $1::date + interval '3 days'
          AND r.fin IS NOT NULL AND r.fin > r.inicio AND r.inicio < w.fin AND r.fin > w.ini
     ),
     fuente AS (
       SELECT COALESCE(c.unit_id, g.unit_id) AS unit_id,
              (c.unit_id IS NOT NULL AND COALESCE(c.m, 0) >= ${UMBRAL_CAN} * COALESCE(g.m, 0)) AS por_can
         FROM      (SELECT unit_id, sum(en_ventana) AS m FROM can_v GROUP BY unit_id) c
         FULL JOIN (SELECT unit_id, sum(en_ventana) AS m FROM gps_v GROUP BY unit_id) g
                ON g.unit_id = c.unit_id
     ),
     km_src AS (
       SELECT k.unit_id, k.inicio, k.fin, k.metros, TRUE AS por_can
         FROM can_v k JOIN fuente f ON f.unit_id = k.unit_id AND f.por_can
       UNION ALL
       SELECT k.unit_id, k.inicio, k.fin, k.metros, FALSE AS por_can
         FROM gps_v k JOIN fuente f ON f.unit_id = k.unit_id AND NOT f.por_can
     ),`;

// El reparto de los metros de un trayecto entre los tramos que lo solapan. Lo
// usan la franja de Control y la actividad por conductor, y estaba COPIADO en
// las dos: la primera vez que se tocó una hubo que acordarse de la otra.
const SOLAPE_KM = `
     -- EL CORTE DEL TRAMO SE CALCULA UNA VEZ POR TRAMO. Antes el corte —que
     -- lleva dos subconsultas dentro— iba metido en el SELECT y en el JOIN del
     -- reparto, o sea que se resolvía dos veces por CADA trozo de km. Con los
     -- trayectos del GPS eran mil y pico y se notaba poco; con el odómetro son
     -- cuarenta mil al día y la pantalla se caía a medio minuto. Sacándolo a su
     -- propia CTE se resuelve unas tres mil veces —una por tramo— y el reparto
     -- pasa a ser un cruce normal.
     -- MATERIALIZED NO ES UN ADORNO. Sin él Postgres mete esta CTE dentro del
     -- cruce de abajo y acaba resolviendo el corte —con sus dos subconsultas—
     -- una vez por cada pareja (tramo, trozo de km): tres mil por cincuenta mil
     -- son ciento cincuenta millones de veces, y la consulta pasa de segundos a
     -- minuto y medio. Con MATERIALIZED se calcula una vez por tramo y ya está.
     tramo_km AS MATERIALIZED (
       -- MIRAR ATRÁS SOLO LO QUE EL TOPE PERMITE. Ningún tramo cuenta más allá
       -- de su inicio más el tope, así que uno que empezó antes de eso no puede
       -- aportar un metro a esta ventana. Antes se barrían catorce días —cincuenta
       -- mil tramos— para descartarlos uno a uno; con la cota son tres mil, y por
       -- eso el corte se puede permitir preguntar por cada uno sin que se note.
       SELECT t.conductor_uuid AS uuid, veh.matricula, veh.mapon_unit AS unit_id, t.situacion,
              GREATEST(t.desde, w.ini)     AS d,
              LEAST(${FIN_KM}, w.fin)      AS h
         FROM fv_tramo t
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE w.fin > w.ini
          AND t.conductor_uuid IS NOT NULL
          AND veh.mapon_unit IS NOT NULL
          AND t.desde < w.fin
          AND t.desde >= w.ini - interval '${TOPE_TRAMO_ABIERTO}'
     ),
     solape AS (
       -- UN TRAYECTO SE REPARTE POR EL TIEMPO QUE PASA DENTRO, no cuenta entero
       -- donde empieza.
       --
       -- La regla de antes —"cuenta en la ventana donde EMPIEZA"— funciona con
       -- trayectos cortos y es demoledora con uno largo. Carlos Arturo Borelli
       -- hizo un trayecto de 249 km y SIETE HORAS que arrancó a las 04:45, un
       -- cuarto de hora antes de que abriera la jornada: su mañana entera se
       -- contó en el día anterior y a él le quedaron 52 km en 8,2 h de trabajo.
       -- Y el error va doble, porque esos 249 km se los llevaba quien condujera
       -- a las 04:45, que no los hizo.
       --
       -- Eran 330 trayectos y 22.302 km mal colocados en diez días.
       --
       -- Ahora los metros se prorratean por el solape con la ventana Y con el
       -- tramo, que es lo que ya se hacía entre conductores: cada jornada se
       -- queda los kilómetros que de verdad vio.
       SELECT tk.uuid, tk.matricula, tk.situacion, r.por_can,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, tk.h) - GREATEST(r.inicio, tk.d))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM km_src r
         JOIN tramo_km tk ON tk.unit_id = r.unit_id
                         AND tk.d < r.fin AND tk.h > r.inicio
        WHERE tk.h > tk.d
     )`;

/**
 * KM RODADOS FUERA DE LA APP dentro de UNA VENTANA CUALQUIERA (no un turno del
 * catálogo): los metros de los trayectos de Mapon que caen en un tramo de
 * DESCANSO o DESCONECTADO, por conductor.
 *
 * Existe aparte de `actividadPorConductor` porque las franjas de vigilancia
 * (08:00-13:00, 20:00-01:00) NO son turnos: son el rato en el que Tráfico mira.
 * Y la pregunta que contesta no es "cuántos km lleva hoy" —esa ya está— sino
 * "cuántos ha hecho DESDE QUE ABRIÓ LA FRANJA", que es la que se puede llamar y
 * preguntar. El relevo de las 05:00 a las 08:00 trae km legítimos (ir a por el
 * coche, la entrega) y meterlos en el mismo saco convertía la alerta en ruido.
 *
 * LOS KM SALEN DE fv_ruta, NUNCA DE fv_tramo.km_m. El odómetro solo llega a
 * ratos y sus metros caen en el tramo que estuviera abierto cuando Mapon habló
 * —11 km imputados a un descanso de 12 minutos—; fv_ruta es la fuente que cuadró
 * con el informe de BOLT al 0,03 %.
 *
 * @returns {Promise<Map<string, {km, kmFuera, matriculas:string[]}>>} por uuid
 */
async function kmFueraEnVentana(dia, hIni, offFin, hFin) {
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan
     ),
     w AS (SELECT ini, LEAST(fin_plan, now()) AS fin FROM v),
${FUENTE_KM}
${SOLAPE_KM}
     SELECT uuid, matricula,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion IN ('viaje','espera')), 0)::numeric / 1000.0, 1)     AS km,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion NOT IN ('viaje','espera')), 0)::numeric / 1000.0, 1) AS km_fuera,
            -- De dónde salieron esos km. Solo cuentan las filas que aportan algo:
            -- un tramo que solapa un trozo de cero metros no dice nada de la fuente.
            bool_or(por_can AND metros_trozo > 0)       AS hay_can,
            bool_or(NOT por_can AND metros_trozo > 0)   AS hay_gps
       FROM solape GROUP BY uuid, matricula`,
    [String(dia).slice(0, 10), String(hIni), Number(offFin) || 0, String(hFin)]);

  const m = new Map();
  r.rows.forEach(x => {
    if (!m.has(x.uuid)) m.set(x.uuid, { km: 0, kmFuera: 0, matriculas: [] });
    const a = m.get(x.uuid);
    a.km = Math.round((a.km + (Number(x.km) || 0)) * 10) / 10;
    a.kmFuera = Math.round((a.kmFuera + (Number(x.km_fuera) || 0)) * 10) / 10;
    if (x.matricula && !a.matriculas.includes(x.matricula)) a.matriculas.push(x.matricula);
  });
  return m;
}

async function minutosEfectivos(dia, turno = 'operativo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     )
     SELECT t.conductor_uuid                          AS uuid,
            -- Sin nombre en fv_conductor NO es sin conductor: es una cuenta con
            -- uuid (el backfill las crea sin nombre) y sus horas son de alguien.
            CASE WHEN t.conductor_uuid IS NULL THEN '(sin conductor)'
                 ELSE COALESCE(co.nombre, t.conductor_uuid) END AS conductor,
            GREATEST(t.desde, v.ini)                  AS desde,
            LEAST(COALESCE(t.hasta, now()), v.fin)     AS hasta
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      -- Sin COALESCE sobre la columna, para que el índice sirva (ver arriba).
      WHERE t.desde < v.fin AND (t.hasta > v.ini OR (t.hasta IS NULL AND now() > v.ini))
        AND t.desde >= v.ini - interval '${VENTANA_ATRAS}'
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
     SELECT CASE WHEN t.conductor_uuid IS NULL THEN '(sin conductor)'
                 ELSE COALESCE(co.nombre, t.conductor_uuid) END AS conductor, veh.matricula,
            floor(sum(EXTRACT(EPOCH FROM (
              LEAST(COALESCE(t.hasta, now()), v.fin) - GREATEST(t.desde, v.ini)
            ))) / 60)::int AS minutos
       FROM fv_tramo t
       CROSS JOIN v
       JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
       LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
      WHERE t.situacion IN ('viaje', 'espera')
        AND t.desde < v.fin AND (t.hasta > v.ini OR (t.hasta IS NULL AND now() > v.ini))
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
 *
 * SOLO LA FLOTA DE MADRID (24/09/2026). Cuenta los coches con los que alguien
 * fichó en BOLT, y si ese coche es de Barcelona —el 1888LTJ, que algún conductor
 * de aquí elige mal en la app— sus km no son de esta flota: fuera el coche, y
 * con él los km de quien lo llevara. Lo pidió Camilo para la cascada; el Sankey
 * sale del mismo sitio y así los dos siguen dando el mismo número.
 */
async function bucketsTurno(dia, turno) {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'          AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin
     ),
     w AS (SELECT ini, fin FROM v),
${FUENTE_KM}
     tramo_km AS (
       SELECT veh.matricula, veh.mapon_unit AS unit_id, t.situacion,
              GREATEST(t.desde, w.ini)               AS d,
              LEAST(COALESCE(t.hasta, now()), w.fin) AS h
         FROM fv_tramo t
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE veh.mapon_unit IS NOT NULL
          AND t.desde < w.fin
          AND t.desde >= w.ini - interval '${VENTANA_ATRAS}'
          AND COALESCE(t.hasta, now()) > w.ini
          AND ${deLaFlotaVigilada('veh.matricula')}
     ),
     solape AS (
       SELECT tk.matricula, tk.situacion,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, tk.h) - GREATEST(r.inicio, tk.d))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM km_src r
         JOIN tramo_km tk ON tk.unit_id = r.unit_id AND tk.d < r.fin AND tk.h > r.inicio
        WHERE tk.h > tk.d
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
      `SELECT CASE WHEN t.conductor_uuid IS NULL THEN '(sin conductor)'
                   ELSE COALESCE(co.nombre, t.conductor_uuid) END AS conductor, t.situacion, count(*)::int AS n
         FROM fv_tramo t
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid AND veh.matricula = $1
         LEFT JOIN fv_conductor co ON co.uuid = t.conductor_uuid
        WHERE t.desde < $3 AND (t.hasta > $2 OR (t.hasta IS NULL AND now() > $2))
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
          WHERE t.desde < $2 AND (t.hasta > $1 OR (t.hasta IS NULL AND now() > $1))
            AND ${conds.join(' AND ')}
          GROUP BY co.nombre, veh.matricula, t.situacion
          ORDER BY n DESC`, params)).rows;
    }
    conductores.push({ nombre, encontrado: tramos.length > 0, tramos });
  }

  return { dia: String(dia).slice(0, 10), turno, ventana: win, matriculas, reparto, conductores };
}



/**
 * LOS KM DE VARIAS VENTANAS, EN UNA SOLA PASADA.
 *
 * El cockpit pregunta por cuatro ventanas del mismo día —día, noche, jornada y
 * la noche de reloj— y hasta ahora eran cuatro consultas iguales con distintas
 * horas. Cada una volvía a barrer `fv_odometro` (1,5 millones de filas) y
 * `fv_ruta`, y a resolver el corte de cada tramo otra vez.
 *
 * Medido el 21/09/2026: esas cuatro eran 20,9 s de los 31,7 s de SQL que gasta
 * la pantalla entera. Lo caro no es agrupar cuatro veces —eso son mil filas—,
 * es LEER cuatro veces.
 *
 * Aquí se lee una vez y se reparte: las filas crudas salen acotadas por la
 * ventana que envuelve a todas (`lim`), y a partir de ahí cada CTE lleva su
 * `codigo` y agrupa por él. Todo lo demás —el prorrateo, la elección entre CAN
 * y GPS, el corte del tramo— se hace EXACTAMENTE igual que antes y ventana por
 * ventana, que es lo que garantiza que los números no se muevan.
 *
 * OJO CON LA FUENTE: la elección entre el odómetro y el GPS se decide POR
 * VENTANA, no una vez para todas. Un coche puede tener CAN suficiente en la
 * jornada entera y no tenerlo en la franja de noche, y ahí la vara de medir
 * cambia. Por eso `fuente` agrupa por (codigo, unit_id) y no solo por unit_id.
 */
async function kmPorVentanas(dia, ventanas) {
  if (!ventanas.length) return new Map();
  const d = String(dia).slice(0, 10);

  // Las horas salen del catálogo TURNOS, no de fuera; aun así se validan antes
  // de escribirlas en el SQL, que es lo que separa "es interno" de "es seguro".
  const filas = ventanas.map(({ codigo, hIni, off, hFin }) => {
    const a = Number(hIni), b = Number(off), c = Number(hFin);
    if (![a, b, c].every(Number.isFinite)) throw new Error('Ventana con horas que no son números');
    if (!/^[a-zA-Z0-9_]+$/.test(codigo)) throw new Error('Código de ventana no válido');
    return `('${codigo}', ($1::date + interval '${a} hours') AT TIME ZONE 'Europe/Madrid',`
         + ` LEAST((($1::date + ${b}) + interval '${c} hours') AT TIME ZONE 'Europe/Madrid', now()))`;
  }).join(',\n         ');

  const r = await db.consulta(
    `WITH w AS (
       SELECT codigo, ini, fin FROM (VALUES
         ${filas}
       ) AS t(codigo, ini, fin)
       -- Una ventana que todavía no ha empezado no se pregunta: igual que antes,
       -- donde el guardia era \`w.fin > w.ini\` dentro de cada consulta.
       WHERE fin > ini
     ),
     -- LA VENTANA QUE ENVUELVE A TODAS. Es lo único que se lee de las tablas
     -- grandes; el reparto por ventana viene después, sobre lo ya leído.
     lim AS (SELECT min(ini) AS ini0, max(fin) AS fin0 FROM w),
     can_raw AS (
       SELECT o.unit_id, o.inicio, o.fin, o.metros
         FROM fv_odometro o CROSS JOIN lim
        -- LA COTA EN CONSTANTES NO SOBRA (ver kmFueraEnVentana): sin el recorte
        -- sobre $1 se lee la tabla entera en cada pregunta.
        WHERE o.inicio >= $1::date - interval '1 day'
          AND o.inicio <  $1::date + interval '3 days'
          AND o.fin > o.inicio AND o.inicio < lim.fin0 AND o.fin > lim.ini0
     ),
     gps_raw AS (
       SELECT r.unit_id, r.inicio, r.fin, r.metros
         FROM fv_ruta r CROSS JOIN lim
        WHERE r.inicio >= $1::date - interval '1 day'
          AND r.inicio <  $1::date + interval '3 days'
          AND r.fin IS NOT NULL AND r.fin > r.inicio
          AND r.inicio < lim.fin0 AND r.fin > lim.ini0
     ),
     -- Y AHORA SÍ, VENTANA POR VENTANA. El prorrateo es el de siempre.
     can_v AS (
       SELECT w.codigo, c.unit_id, c.inicio, c.fin, c.metros,
              c.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(c.fin, w.fin) - GREATEST(c.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (c.fin - c.inicio)), 0) AS en_ventana
         FROM can_raw c JOIN w ON c.inicio < w.fin AND c.fin > w.ini
     ),
     gps_v AS (
       SELECT w.codigo, g.unit_id, g.inicio, g.fin, g.metros,
              g.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(g.fin, w.fin) - GREATEST(g.inicio, w.ini))))
                / NULLIF(EXTRACT(EPOCH FROM (g.fin - g.inicio)), 0) AS en_ventana
         FROM gps_raw g JOIN w ON g.inicio < w.fin AND g.fin > w.ini
     ),
     fuente AS (
       SELECT COALESCE(c.codigo, g.codigo) AS codigo,
              COALESCE(c.unit_id, g.unit_id) AS unit_id,
              (c.unit_id IS NOT NULL AND COALESCE(c.m, 0) >= ${UMBRAL_CAN} * COALESCE(g.m, 0)) AS por_can
         FROM      (SELECT codigo, unit_id, sum(en_ventana) AS m FROM can_v GROUP BY 1, 2) c
         FULL JOIN (SELECT codigo, unit_id, sum(en_ventana) AS m FROM gps_v GROUP BY 1, 2) g
                ON g.unit_id = c.unit_id AND g.codigo = c.codigo
     ),
     km_src AS (
       SELECT k.codigo, k.unit_id, k.inicio, k.fin, k.metros, TRUE AS por_can
         FROM can_v k JOIN fuente f ON f.unit_id = k.unit_id AND f.codigo = k.codigo AND f.por_can
       UNION ALL
       SELECT k.codigo, k.unit_id, k.inicio, k.fin, k.metros, FALSE AS por_can
         FROM gps_v k JOIN fuente f ON f.unit_id = k.unit_id AND f.codigo = k.codigo AND NOT f.por_can
     ),
     -- EL CORTE DEL TRAMO, UNA VEZ PARA TODAS LAS VENTANAS. Antes se resolvía
     -- cuatro veces —y lleva dos subconsultas dentro—; ahora se calcula sobre la
     -- ventana envolvente y cada una se queda con su trozo. MATERIALIZED por lo
     -- mismo de siempre: sin él Postgres lo mete en el cruce de abajo y lo
     -- resuelve una vez por cada pareja (tramo, trozo de km).
     tramo_base AS MATERIALIZED (
       SELECT t.conductor_uuid AS uuid, veh.matricula, veh.mapon_unit AS unit_id, t.situacion,
              t.desde AS d0, ${FIN_KM} AS h0
         FROM fv_tramo t
         CROSS JOIN lim
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE t.conductor_uuid IS NOT NULL
          AND veh.mapon_unit IS NOT NULL
          AND t.desde < lim.fin0
          AND t.desde >= lim.ini0 - interval '${TOPE_TRAMO_ABIERTO}'
     ),
     tramo_km AS (
       SELECT w.codigo, tb.uuid, tb.matricula, tb.unit_id, tb.situacion,
              GREATEST(tb.d0, w.ini) AS d, LEAST(tb.h0, w.fin) AS h
         FROM tramo_base tb CROSS JOIN w
        -- Un tramo que empezó antes de \`ini - tope\` no puede aportar un metro:
        -- su corte cae por debajo del principio de la ventana y el \`h > d\` de
        -- abajo lo descarta solo. Por eso basta con acotar por la envolvente.
        WHERE tb.d0 < w.fin
     ),
     solape AS (
       SELECT tk.codigo, tk.uuid, tk.matricula, tk.situacion, r.por_can,
              r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                LEAST(r.fin, tk.h) - GREATEST(r.inicio, tk.d))))
                / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0) AS metros_trozo
         FROM km_src r
         JOIN tramo_km tk ON tk.unit_id = r.unit_id AND tk.codigo = r.codigo
                         AND tk.d < r.fin AND tk.h > r.inicio
        WHERE tk.h > tk.d
     )
     SELECT codigo, uuid, matricula,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion IN ('viaje','espera')), 0)::numeric / 1000.0, 1)     AS km,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion NOT IN ('viaje','espera')), 0)::numeric / 1000.0, 1) AS km_fuera,
            bool_or(por_can AND metros_trozo > 0)       AS hay_can,
            bool_or(NOT por_can AND metros_trozo > 0)   AS hay_gps
       FROM solape GROUP BY codigo, uuid, matricula`,
    [d]);

  const por = new Map(ventanas.map(v => [v.codigo, []]));
  r.rows.forEach(x => { if (por.has(x.codigo)) por.get(x.codigo).push(x); });
  return por;
}

/**
 * LA ACTIVIDAD DE VARIOS TURNOS DEL MISMO DÍA, LEYENDO LOS KM UNA SOLA VEZ.
 *
 * El cockpit necesita cuatro ventanas —día, la noche que mide desde mediodía,
 * la jornada entera y la noche de reloj— y hasta ahora eran cuatro llamadas
 * independientes. Cada una volvía a barrer `fv_odometro` (1,5 millones de
 * filas) y `fv_ruta` y a resolver el corte de cada tramo otra vez.
 *
 * Medido el 21/09/2026: esas cuatro consultas de km eran **20,9 s de los
 * 31,7 s** de SQL que gastaba En directo. Lo caro no era agrupar cuatro veces,
 * era LEER cuatro veces.
 *
 * Lo demás —los minutos por situación y los minutos efectivos— sigue yendo por
 * ventana, y a propósito: son consultas de décimas de segundo sobre `fv_tramo`,
 * así que fundirlas añadiría riesgo sin ganar tiempo.
 *
 * Devuelve un Map de turno → el mismo objeto que devuelve `actividadPorConductor`,
 * para que quien lo use no tenga que aprender nada nuevo.
 */
async function actividadDeVariosTurnos(dia, turnos) {
  const lista = [...new Set(turnos)].filter(t => TURNOS[t]);
  if (!lista.length) return new Map();

  // Los km de todas las ventanas, de una vez.
  const ventanas = lista.map(t => {
    const [hIni, off, hFin] = TURNOS[t];
    return { codigo: t, hIni, off, hFin };
  });
  const km = await kmPorVentanas(dia, ventanas).catch(e => {
    // Si la pasada única falla, cada turno se lo pregunta por su cuenta: es más
    // lento, pero la pantalla sigue en pie. Un atajo que se lleva la pantalla
    // por delante cuando falla no es un atajo.
    console.error('⚠️  [FLOTA VIVA] km en una pasada:', e.message);
    return null;
  });

  const hechos = await Promise.all(lista.map(t =>
    actividadPorConductor(dia, t, km ? (km.get(t) || []) : null)));
  return new Map(lista.map((t, i) => [t, hechos[i]]));
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
async function actividadPorConductor(dia, turno = 'dia', kmYaHechos = null) {
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
              -- Sin recortar a la ventana: es la hora del apunte de BOLT que
              -- abrio el tramo, y es lo unico comparable con el apunte crudo.
              t.desde                                            AS desde_real,
              GREATEST(t.desde, w.ini)                           AS d,
              LEAST(COALESCE(t.hasta, now()), w.fin)             AS h
         FROM fv_tramo t
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE t.conductor_uuid IS NOT NULL
          AND w.fin > w.ini
          AND t.desde < w.fin
          -- SE ESCRIBE ASÍ Y NO CON COALESCE. Poner COALESCE(t.hasta, now())
          -- envuelve la columna, y con la columna envuelta Postgres no puede
          -- usar índice — barría los 293.000 tramos para quedarse con mil.
          -- Dice exactamente lo mismo, incluso si la ventana fuera futura.
          -- Medido el 21/09/2026: 98 ms → 32 ms, y las mismas 117 filas.
          AND (t.hasta > w.ini OR (t.hasta IS NULL AND now() > w.ini))
          -- AQUÍ NO VA LA COTA. Esta consulta cuenta también el DESCONECTADO, y
          -- un coche parado puede llevar semanas en UN solo tramo abierto: al
          -- acotar, esos minutos desaparecían. Comprobado: a un conductor del
          -- 15/08 le pasaban 1.492 minutos desconectado a 52, y otro se caía de
          -- la lista entero. Las otras dos consultas sí la llevan porque solo
          -- miran situaciones efectivas y trayectos, que duran horas, no semanas.
     ),
     p AS (
       SELECT uuid, matricula, situacion, abierto, desde_real, d, h,
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
            max(p.situacion) FILTER (WHERE p.abierto)                                                    AS situacion_ahora,
            -- Desde cuando esta abierto ese tramo, y si la ventana sigue viva.
            -- Con esas dos cosas se puede decidir si el apunte crudo de BOLT
            -- es mas nuevo que lo que sabe el motor. Ver el bloque de abajo.
            max(p.desde_real) FILTER (WHERE p.abierto)                                                   AS abierto_desde,
            (SELECT fin_plan > now() FROM v)                                                             AS ventana_viva
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
  // SI LOS KM YA VIENEN HECHOS, no se vuelve a preguntar. Es el caso del
  // cockpit, que pide cuatro ventanas del mismo día: `kmPorVentanas` las
  // resuelve todas en una pasada y aquí solo se recogen las de esta.
  const rk = kmYaHechos ? { rows: kmYaHechos } : await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan
     ),
     w AS (SELECT ini, LEAST(fin_plan, now()) AS fin FROM v),
${FUENTE_KM}
${SOLAPE_KM}
     SELECT uuid, matricula,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion IN ('viaje','espera')), 0)::numeric / 1000.0, 1)     AS km,
            round(COALESCE(sum(metros_trozo) FILTER (WHERE situacion NOT IN ('viaje','espera')), 0)::numeric / 1000.0, 1) AS km_fuera,
            -- De dónde salieron esos km. Solo cuentan las filas que aportan algo:
            -- un tramo que solapa un trozo de cero metros no dice nada de la fuente.
            bool_or(por_can AND metros_trozo > 0)       AS hay_can,
            bool_or(NOT por_can AND metros_trozo > 0)   AS hay_gps
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
        fuenteKm: null,
        primera: null, ultima: null, conectadoAhora: false, situacionAhora: null,
        // De cual de las dos tuberias sale el AHORA. No se pinta; contesta
        // "por que dice eso" sin abrir la base.
        fuenteAhora: null, _abiertoDesde: null, _ventanaViva: false,
        _mats: [],
        // Los km de cada coche que llevó, antes de sumarlos. Ver más abajo.
        kmPorCoche: {},
      });
    }
    const a = porUuid.get(x.uuid);
    a.minutos += Number(x.minutos) || 0;
    a.minDescanso += Number(x.min_descanso) || 0;
    a.minDesconectado += Number(x.min_desconectado) || 0;
    if (x.primera && (!a.primera || x.primera < a.primera)) a.primera = x.primera;
    if (x.ultima && (!a.ultima || x.ultima > a.ultima)) a.ultima = x.ultima;
    if (x.conectado_ahora) { a.conectadoAhora = true; a.situacionAhora = x.situacion_ahora || a.situacionAhora; }
    if (x.conectado_ahora || x.situacion_ahora) a.fuenteAhora = a.fuenteAhora || 'tramo';
    if (x.ventana_viva) a._ventanaViva = true;
    if (x.abierto_desde && (!a._abiertoDesde || x.abierto_desde > a._abiertoDesde)) {
      a._abiertoDesde = x.abierto_desde;
    }
    // Solo cuentan como "su coche" los que tienen trabajo o conexión viva: un
    // tramo DESCONECTADO abierto hereda el conductor anterior, y ponía matrícula
    // y "≠ no es el coche del plan" a quien aún no había salido.
    if (x.matricula && (Number(x.minutos) > 0 || x.conectado_ahora)) {
      a._mats.push({ matricula: x.matricula, minutos: Number(x.minutos) || 0 });
    }
  });

  // ── EL AHORA SALE DE LA NOTICIA MAS FRESCA, NO SIEMPRE DEL TRAMO ────────
  //
  // Los MINUTOS necesitan tramos: no se puede sumar tiempo de un solo apunte.
  // Pero "que esta haciendo AHORA" es otra cosa, y ahi el tramo abierto puede
  // llevar horas sin actualizarse si el motor se atasca — el 23/09/2026 estuvo
  // dos horas sin terminar una vuelta y el cockpit siguio diciendo "no ha
  // salido" de gente que estaba de viaje.
  //
  // El AHORA de cada conductor sale de la FOTO DEL AHORA
  // (services/flotaViva/ahora.js), la misma que lee el mapa: el tramo abierto y
  // el ultimo apunte de BOLT (que entra cada 10 s) ya cruzados, con la noticia
  // mas fresca elegida y los empates resueltos con la regla de desempate.js.
  // Hasta el 25/09/2026 esto hacia su propia consulta cruda, sin desempate, y
  // con dos apuntes en el mismo segundo el mapa y Control decian cosas
  // distintas de la misma persona.
  //
  // Solo se toca el AHORA, y solo si la ventana sigue viva: en un dia pasado no
  // hay ningun "ahora" que corregir.
  const vivos = [...porUuid.values()].filter(a => a._ventanaViva);
  if (vivos.length) {
    const foto = await require('./ahora').foto();
    vivos.forEach(a => {
      const x = foto.porConductor.get(a.uuid);
      if (!x || !x.situacion) return;
      // Si el motor sabe algo MAS nuevo de sus tramos, manda el motor.
      if (a._abiertoDesde && new Date(a._abiertoDesde) > new Date(x.desde)) return;
      a.situacionAhora = x.situacion;
      a.conectadoAhora = x.conectado;
      a.fuenteAhora = x.fuente;
    });
  }

  // Los km encima de lo ya montado. Si el conductor no tiene ficha (sus tramos
  // caen fuera de la ventana), esos km se descartan: son de otra jornada.
  rk.rows.forEach(x => {
    if (!porUuid.has(x.uuid)) return;
    const a = porUuid.get(x.uuid);
    a.km = Math.round((a.km + (Number(x.km) || 0)) * 10) / 10;
    a.kmFuera = Math.round((a.kmFuera + (Number(x.km_fuera) || 0)) * 10) / 10;
    // DE DÓNDE SALEN SUS KM. No es un detalle técnico: un conductor con el
    // odómetro del cuadro y otro con la estimación del GPS no están medidos con
    // la misma vara, y quien mire la pantalla tiene derecho a saberlo.
    if (x.hay_can) a._can = true;
    if (x.hay_gps) a._gps = true;
    // Y EL REPARTO POR COCHE, que la suma se come. El reporte de horas lo
    // necesita para apartar los km de un coche de Barcelona sin tocar los del
    // coche de Madrid que esa persona llevó el mismo día (24/09/2026).
    if (x.matricula) {
      const k = a.kmPorCoche[x.matricula] || (a.kmPorCoche[x.matricula] = { km: 0, kmFuera: 0, can: false, gps: false });
      k.km = Math.round((k.km + (Number(x.km) || 0)) * 10) / 10;
      k.kmFuera = Math.round((k.kmFuera + (Number(x.km_fuera) || 0)) * 10) / 10;
      if (x.hay_can) k.can = true;
      if (x.hay_gps) k.gps = true;
    }
  });
  porUuid.forEach(a => {
    a.fuenteKm = a._can && a._gps ? 'mixta' : (a._gps ? 'gps' : (a._can ? 'can' : null));
    delete a._can; delete a._gps;
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

// Todas aseguran el esquema antes de correr: quien lee flota viva no tiene que
// acordarse de prepararla, que es como se colaba esa precondicion en las rutas.
/**
 * COCHES QUE RUEDAN SIN QUE NADIE ESTÉ CONECTADO EN BOLT.
 *
 * Es la pregunta que el sistema nunca se hacía. Un coche solo avanza su línea
 * de estados cuando llega un apunte SUYO de BOLT; si nadie se conecta con él,
 * no llega ninguno y se queda "desconectado" para siempre — rodando, porque
 * Mapon sí lo ve. Así estuvo el 7550KYT 56 horas y 585 km.
 *
 * Antes esos km se le colgaban al último que lo condujo, aunque llevara dos
 * días en otro coche. Ahora ya no, y por eso hace falta esto: los kilómetros
 * que no son de nadie no pueden desaparecer sin más, porque significan que
 * alguien conduce sin fichar.
 *
 * LO QUE CUENTA ES LA RESTA: los km que el coche hizo en la ventana menos los
 * que se le han podido atribuir a alguien. Lo que sobra es lo huérfano. Se hace
 * así y no buscando tramos raros porque la resta no se puede despistar: si
 * mañana cambian las reglas de atribución, esto sigue cuadrando solo.
 */
async function kmSinDuenio(dia, turno = 'operativo') {
  const [hi, off, hf] = TURNOS[turno] || TURNOS.operativo;
  const r = await db.consulta(
    `WITH v AS (
       SELECT ($1::date + ($2 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid'             AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin_plan
     ),
     w AS (SELECT ini, LEAST(fin_plan, now()) AS fin FROM v),
${FUENTE_KM}
     -- Lo que rodó cada coche en la ventana, sin mirar quién iba dentro.
     total AS (
       -- Prorrateado por la ventana, igual que el reparto de abajo: si el total
       -- contara trayectos enteros y el reparto solo los trozos de dentro, la
       -- resta daría km sin dueño que no existen.
       SELECT veh.uuid, veh.matricula,
              sum(r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
                    LEAST(r.fin, w.fin) - GREATEST(r.inicio, w.ini))))
                  / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0)) AS metros,
              bool_and(r.por_can) AS por_can
         FROM km_src r
         CROSS JOIN w
         JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND w.fin > w.ini AND r.inicio < w.fin AND r.fin > w.ini
        GROUP BY 1, 2
     ),
${SOLAPE_KM},
     -- Y lo que sí se le pudo colgar a alguien.
     conDuenio AS (
       SELECT matricula, sum(metros_trozo) AS metros FROM solape GROUP BY 1
     )
     SELECT t.matricula,
            round((t.metros / 1000.0)::numeric, 1)                                   AS km_total,
            round((GREATEST(0, t.metros - COALESCE(c.metros, 0)) / 1000.0)::numeric, 1) AS km_sin_duenio,
            -- Con qué se quedó la línea de ese coche, para saber desde cuándo y
            -- a quién preguntarle: el último que lo llevó es por donde se empieza.
            ab.situacion, ab.desde AS abierto_desde,
            co.nombre AS ultimo_conductor
       FROM total t
       LEFT JOIN conDuenio c ON c.matricula = t.matricula
       -- El tramo que estaba abierto DENTRO de la ventana, no el de ahora: mirando
       -- un día pasado, "el abierto" puede haber empezado después y diría una
       -- fecha que no tiene nada que ver con esos kilómetros.
       LEFT JOIN LATERAL (
         SELECT ft.situacion, ft.desde, ft.conductor_uuid
           FROM fv_tramo ft, w
          WHERE ft.vehiculo_uuid = t.uuid
            AND ft.desde < w.fin
            AND COALESCE(ft.hasta, now()) > w.ini
          ORDER BY ft.desde DESC LIMIT 1) ab ON TRUE
       LEFT JOIN fv_conductor co ON co.uuid = ab.conductor_uuid
      WHERE t.metros - COALESCE(c.metros, 0) > 0
      ORDER BY 3 DESC`,
    [String(dia).slice(0, 10), String(hi), off, String(hf)]);

  return r.rows.map(x => ({
    matricula: x.matricula,
    km: Number(x.km_total),
    kmSinDuenio: Number(x.km_sin_duenio),
    situacion: x.situacion || null,
    desde: x.abierto_desde || null,
    ultimoConductor: x.ultimo_conductor || null,
  }));
}

module.exports = db.conEsquema({
  ingestarRutas, guardarLote, ingestarOdometro, odometroDeUnidad, kmPorCoche, kmConectadoDesconectado,
  horasEfectivasPorConductor, minutosEfectivos, matriculasBoltPorConductor,
  bucketsTurno, sankeyFlota, diagnosticoKm, actividadPorConductor, actividadDeVariosTurnos, kmPorVentanas, kmFueraEnVentana,
  kmSinDuenio,
});
module.exports.TURNOS = TURNOS;
// La Auditoría decide con el MISMO umbral: dos criterios distintos para elegir
// fuente darían dos cifras distintas del mismo día, que es justo lo que no puede pasar.
module.exports.UMBRAL_CAN = UMBRAL_CAN;
// El corte del tramo, para quien tenga que repartir km fuera de aqui. Se
// exporta en vez de copiarse: una alerta que reparta con otra regla acusa a
// gente con un numero que la pantalla no ensena.
module.exports.FIN_KM = FIN_KM;
module.exports.TOPE_TRAMO_ABIERTO = TOPE_TRAMO_ABIERTO;
