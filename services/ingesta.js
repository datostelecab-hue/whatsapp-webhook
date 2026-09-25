// ============================================================
// INGESTA — la ÚNICA puerta por la que entran datos externos
// ============================================================
// REGLA: ningún módulo llama a BOLT ni a Mapon para pintar una pantalla. Esta
// función los trae y los deja en PostgreSQL; todo lo demás lee de la base.
//
// Lo que se gana:
//   · Una pantalla no depende de que una API responda. Mapon se cae de vez en
//     cuando por temas de pago y RRHH ni se entera: sigue leyendo lo último que
//     entró, y puede decir de cuándo es.
//   · La cuota de la API se controla en un sitio, no en catorce.
//   · Una respuesta se interpreta UNA vez. Hoy `getVehicles` lo leen la
//     auditoría de flota y la auditoría en vivo, y cada una se queda con cosas
//     distintas del mismo JSON.
//
// SOBRE LA CADENCIA: el latido es cada 5 minutos, pero cada tarea declara cada
// cuánto tiene sentido repetirla. El padrón de conductores no cambia cada cinco
// minutos y pedirlo así son cientos de páginas por hora — ya vimos un 429
// pidiéndolo una sola vez. Cada tarea trae su `cadaMin` y el latido decide.
// Todos se pueden cambiar por variable de entorno sin tocar código.

const db = require('./db');

/**
 * Las tareas de ingesta.
 *
 * `cadaMin`      cada cuánto tiene sentido repetirla
 * `critica`      si fallar es un problema que hay que gritar (BOLT sí, Mapon no:
 *                Mapon se cae y el sistema tiene que seguir)
 * `reintentoMin` cuánto esperar tras un FALLO antes de volver a intentarlo.
 *                Sin esto, `toca()` mira solo el último acierto: una tarea que
 *                falla se reintenta en cada latido, o sea cada 5 minutos. Para
 *                las baratas da igual; para la auditoría, que son 144 llamadas
 *                a Mapon por vuelta, sería gastarse la cuota del día en una hora
 *                repitiendo el mismo error.
 */
const TAREAS = {
  padron_bolt: {
    fuente: 'bolt',
    etiqueta: 'Conductores de BOLT',
    cadaMin: Number(process.env.INGESTA_PADRON_BOLT_MIN) || 60,
    critica: true,
    async ejecutar() {
      const r = await require('./cazamientoBolt').sincronizarDesdeBolt();
      return { registros: r.vistas, detalle: r };
    },
  },

  vehiculos_bolt: {
    fuente: 'bolt',
    etiqueta: 'Vehículos de BOLT',
    cadaMin: Number(process.env.INGESTA_VEHICULOS_BOLT_MIN) || 360,
    critica: false,
    async ejecutar() {
      const r = await require('./repo/vehiculosBolt').sincronizar();
      return { registros: r.vistos, detalle: r };
    },
  },

  state_logs_bolt: {
    fuente: 'bolt',
    etiqueta: 'Logs de estado de BOLT',
    // Cada 10 min: es la fuente de la jornada y del panel en vivo. La ventana
    // pedida se solapa a proposito con la anterior; el aterrizaje es idempotente.
    // LA RED DE SEGURIDAD, NO EL DIRECTO. El directo es `estadosAlDia()`, mas
    // abajo, que pregunta cada 10 segundos por los ultimos cinco minutos. Esta
    // tarea pide DOS HORAS cada cinco minutos: si el bucle rapido se cae un
    // rato, aqui se recoge lo que se perdio, y es la que deja la copia cruda y
    // el apunte en `ingesta_ejecucion` para auditar.
    //
    // Historia, por si alguien la vuelve a bajar: era de 10 min y un apunte
    // tardaba de media 7 min 26 s en llegar. Se bajo a 1 el 23/09/2026 y paso a
    // correr cada DOS por la falta de holgura en `toca()`. Con el bucle rapido
    // encima, cinco minutos es de sobra.
    cadaMin: Number(process.env.INGESTA_STATE_LOGS_MIN) || 5,
    critica: true,
    async ejecutar() {
      const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
      const staging = require('./repo/staging');
      const hasta = Math.floor(Date.now() / 1000);
      const desde = hasta - (Number(process.env.INGESTA_STATE_LOGS_VENTANA_H) || 2) * 3600;

      let todos = [], nuevos = 0;
      const t0 = Date.now();
      for (const f of CONFIG_BOLT.flotas) {
        const logs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs',
          { company_id: f.id, start_ts: desde, end_ts: hasta }, 'state_logs', 1000, `ingesta log ${f.id}`);
        todos = todos.concat(logs);
      }
      // Se guarda el crudo (para auditar/reprocesar) y de ahi cuelgan los eventos.
      //
      // PERO NO CADA MINUTO: la ventana se solapa, asi que serian sesenta copias
      // por hora de casi lo mismo -cientos de MB al dia que la poda nocturna
      // viene justo a borrar-. Se queda una copia cada diez minutos, que es el
      // ritmo al que se guardaba hasta hoy. La fila de descarga SI se crea
      // siempre, para no dejar apuntes sin `descarga_id`.
      const guardaCrudo = new Date().getMinutes() % 10 === 0;
      const descargaId = await staging.registrarDescarga({
        fuente: 'bolt', endpoint: 'getFleetStateLogs',
        params: { start_ts: desde, end_ts: hasta }, payload: guardaCrudo ? todos : null,
        filas: todos.length, ms: Date.now() - t0,
      });
      nuevos = await staging.guardarStateLogs(todos, descargaId);
      return { registros: nuevos, detalle: { traidos: todos.length, nuevos } };
    },
  },

  orders_bolt: {
    fuente: 'bolt',
    etiqueta: 'Órdenes de BOLT',
    // Cada hora, no cada diez minutos: las ordenes son para dinero y
    // cancelaciones -cosas mensuales-, no para el panel en vivo. Y la ventana es
    // ancha porque una orden MADURA durante horas: se vuelve a traer para coger
    // su estado y precio finales. El aterrizaje actualiza, no duplica.
    cadaMin: Number(process.env.INGESTA_ORDERS_MIN) || 60,
    critica: false,
    async ejecutar() {
      const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
      const staging = require('./repo/staging');
      const hasta = Math.floor(Date.now() / 1000);
      const desde = hasta - (Number(process.env.INGESTA_ORDERS_VENTANA_H) || 48) * 3600;

      let todas = [];
      const t0 = Date.now();
      for (const f of CONFIG_BOLT.flotas) {
        const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders',
          { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created',
            start_ts: desde, end_ts: hasta }, 'orders', 1000, `ingesta orders ${f.id}`);
        todas = todas.concat(ordenes);
      }
      const descargaId = await staging.registrarDescarga({
        fuente: 'bolt', endpoint: 'getFleetOrders',
        params: { start_ts: desde, end_ts: hasta }, payload: todas,
        filas: todas.length, ms: Date.now() - t0,
      });
      const tocadas = await staging.guardarOrders(todas, descargaId);
      return { registros: tocadas, detalle: { traidas: todas.length, tocadas } };
    },
  },

  // LAS ÓRDENES DE HACE UN RATO, cada diez minutos.
  //
  // `orders_bolt` trae 48 horas cada hora: es perfecto para el dinero (una orden
  // MADURA durante horas y hay que volver a por su precio final) y muy malo para
  // avisar de nada. Las alertas de control preguntan "¿cuántas ha rechazado en
  // esta franja?", y con la ventana de una hora la respuesta llegaba con hasta
  // sesenta minutos de retraso: para cuando sonaba el aviso, el conductor ya
  // había hecho el turno entero.
  //
  // Esta trae solo DOS HORAS. Son unas 2.000 órdenes por pasada en vez de las
  // ~50.000 de la de 48 h: veinticinco veces más barata, y por eso se puede
  // pedir cada diez minutos. Escribe en la MISMA tabla y por la misma puerta
  // (`guardarOrders` es idempotente), así que no duplica nada ni estorba a la
  // otra; simplemente adelanta el aterrizaje de lo recién ocurrido.
  orders_recientes_bolt: {
    fuente: 'bolt',
    etiqueta: 'Órdenes recientes de BOLT (2 h)',
    cadaMin: Number(process.env.INGESTA_ORDERS_RECIENTES_MIN) || 10,
    critica: false,
    async ejecutar() {
      const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
      const staging = require('./repo/staging');
      const hasta = Math.floor(Date.now() / 1000);
      const desde = hasta - (Number(process.env.INGESTA_ORDERS_RECIENTES_H) || 2) * 3600;

      let todas = [];
      const t0 = Date.now();
      for (const f of CONFIG_BOLT.flotas) {
        const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders',
          { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created',
            start_ts: desde, end_ts: hasta }, 'orders', 1000, `ingesta orders recientes ${f.id}`);
        todas = todas.concat(ordenes);
      }
      // Se apunta la descarga PERO SIN EL CRUDO. La de 48 h ya deja su copia
      // cada hora y este payload se repite cada diez minutos: guardarlo serían
      // cientos de MB al día de lo mismo, que es justo lo que la poda diaria
      // viene a borrar. La fila sí se crea, para no dejar sin descarga_id (ni
      // borrárselo al UPDATE) a las órdenes que pasan por aquí.
      const descargaId = await staging.registrarDescarga({
        fuente: 'bolt', endpoint: 'getFleetOrders (recientes)',
        params: { start_ts: desde, end_ts: hasta }, payload: null,
        filas: todas.length, ms: Date.now() - t0,
      });
      const tocadas = await staging.guardarOrders(todas, descargaId);
      return { registros: tocadas, detalle: { traidas: todas.length, tocadas, ventanaH: (hasta - desde) / 3600 } };
    },
  },

  zonas_mapon: {
    fuente: 'mapon',
    etiqueta: 'Zonas de Mapon (entrada/salida)',
    // Cada 15 min. Es lo que decide si la espera cuenta como area (TE_A1), asi
    // que conviene fresco, pero no tanto como los state logs.
    cadaMin: Number(process.env.INGESTA_ZONAS_MIN) || 15,
    critica: false,
    async ejecutar() {
      const mapon = require('./mapon');
      const staging = require('./repo/staging');
      const t0 = Date.now();
      // La ventana la maneja leerAlertas por fechas; se pide el ultimo dia.
      const hoy = new Date();
      const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
      const iso = d => d.toISOString().slice(0, 10);
      const r = await mapon.leerAlertas({ desde: iso(ayer), hasta: iso(hoy), tipo: 'in_object' });
      const eventos = r.alertas || [];
      const descargaId = await staging.registrarDescarga({
        fuente: 'mapon', endpoint: 'alert/list.json (in_object)',
        params: { desde: iso(ayer), hasta: iso(hoy) }, payload: eventos,
        filas: eventos.length, ms: Date.now() - t0,
      });
      const nuevos = await staging.guardarZonas(eventos, descargaId);
      return { registros: nuevos, detalle: { traidos: eventos.length, nuevos } };
    },
  },

  // Las alertas de Mapon: velocidad, zonas, alimentación, batería. Antes las
  // pedía la pantalla de Operaciones en CADA carga, así que si Mapon estaba
  // caído la pantalla no decía "esto es de hace un rato", decía error; y como
  // la ventana de la API es de 31 días, lo anterior no existía para nadie.
  alertas_mapon: {
    fuente: 'mapon',
    etiqueta: 'Alertas de Mapon',
    cadaMin: Number(process.env.INGESTA_ALERTAS_MIN) || 15,
    critica: false,
    async ejecutar() {
      return require('../modules/Operaciones/operaciones.service').pasadaDeAlertas();
    },
  },

  // La auditoría de flota. Es la tarea más cara con diferencia —una llamada a
  // Mapon por coche— y por eso va una vez al día, de madrugada. La dispara el
  // cron de las 5:00 con `forzar`, pero está declarada aquí para que se vea en
  // el panel de ingesta como todo lo demás: cuándo corrió, cuánto tardó, si
  // falló y por qué. Antes era un cron mudo: si dejaba de funcionar, nadie se
  // enteraba hasta que alguien echaba en falta un día en la pantalla.
  //
  // Y se cura sola: si ayer ya está, se ocupa del día pendiente más antiguo de
  // la última semana. Un fallo suelto deja de necesitar que alguien lo vea.
  auditoria_flota: {
    fuente: 'mapon',
    etiqueta: 'Auditoría de flota (KM por estado)',
    cadaMin: Number(process.env.INGESTA_AUDITORIA_MIN) || 1440,
    reintentoMin: Number(process.env.INGESTA_AUDITORIA_REINTENTO_MIN) || 60,
    critica: false,
    async ejecutar() {
      return require('../modules/Operaciones/operaciones.service').pasadaDiaria();
    },
  },

  unidades_mapon: {
    fuente: 'mapon',
    etiqueta: 'Odómetros de Mapon',
    cadaMin: Number(process.env.INGESTA_MAPON_MIN) || 30,
    // Mapon falla de vez en cuando por temas de pago. Que se caiga NO puede
    // parar el resto de la ingesta ni llenar los logs de alarmas rojas.
    critica: false,
    async ejecutar() {
      const r = await require('../modules/Vehiculos/vehiculos.service').diaria();
      return { registros: r.odometros.actualizados, detalle: r };
    },

  // LA ÚNICA PUERTA QUE SIGUE DANDO A GOOGLE, y solo de entrada: se LEEN las
  // respuestas del formulario con el que los conductores piden cosas, y no se
  // escribe nada en esa hoja.
  //
  // Se puede repetir sin miedo: el índice único sobre `fila_form` impide que la
  // misma respuesta entre dos veces, así que una pasada cortada a medias se
  // arregla sola en la siguiente. La marca de agua es para no releer mil filas,
  // no es la garantía.
  //
  // NO es crítica: que Google falle un rato no puede teñir de rojo la ingesta de
  // BOLT y de Mapon, que es de lo que vive el cuadrante.
  tickets_formulario: {
    fuente: 'formulario',
    etiqueta: 'Tickets del formulario',
    cadaMin: Number(process.env.INGESTA_TICKETS_MIN) || 10,
    critica: false,
    async ejecutar() {
      const r = await require('../modules/Ticketera/ticketera.service').sincronizar();
      return { registros: r.nuevas, detalle: r };
    },
  },
  },
};

/** Cuándo se ejecutó por última vez cada tarea, con acierto o sin él. */
async function estado() {
  if (!db.HAY_BD) return { configurada: false, tareas: [] };
  const r = await db.consulta('SELECT * FROM v_ingesta_estado');
  const porTarea = new Map(r.rows.map(x => [x.tarea, x]));
  return {
    configurada: true,
    tareas: Object.entries(TAREAS).map(([tarea, def]) => {
      const u = porTarea.get(tarea) || null;
      return {
        tarea,
        etiqueta: def.etiqueta,
        fuente: def.fuente,
        cadaMin: def.cadaMin,
        critica: def.critica,
        ok: u ? u.ok : null,
        ultima: u ? u.empezada_at : null,
        ultimoAcierto: u ? u.ultimo_acierto : null,
        haceSeg: u ? u.hace_seg : null,
        registros: u ? u.registros : null,
        error: u ? u.error : null,
        // Al día si el último ACIERTO es más reciente que su cadencia con algo
        // de margen. Un fallo puntual no la marca como caída.
        alDia: u && u.ultimo_acierto
          ? (Date.now() - new Date(u.ultimo_acierto).getTime()) < def.cadaMin * 60000 * 2.5
          : false,
      };
    }),
  };
}

/**
 * ¿Toca ya? Se mira el último ACIERTO, no el último intento: un fallo suelto no
 * puede dejar una tarea parada hasta su siguiente turno.
 *
 * Con `reintentoMin` se mira ADEMÁS el último intento, y ahí la lógica se
 * invierte: se espera. Es para las tareas caras, donde reintentar cada cinco
 * minutos lo que acaba de fallar cuesta más que quedarse quieto.
 */
async function toca(tarea) {
  const def = TAREAS[tarea];
  if (!def) throw new Error(`Tarea de ingesta desconocida: "${tarea}"`);
  const r = await db.consulta(
    `SELECT max(empezada_at) FILTER (WHERE ok) AS ultimo,
            max(empezada_at)                  AS intento
       FROM ingesta_ejecucion WHERE tarea = $1`, [tarea]);
  const { ultimo, intento } = r.rows[0];
  if (def.reintentoMin && intento &&
      (Date.now() - new Date(intento).getTime()) < def.reintentoMin * 60000) {
    return false;
  }
  if (!ultimo) return true;
  // CON HOLGURA. El latido salta a :00 de cada minuto, pero la tarea anterior
  // quedo apuntada uno o dos segundos DESPUES -a :01, a :02-, asi que al minuto
  // siguiente llevaba 58 s y "todavia no tocaba". Una tarea de cada minuto
  // corria cada DOS. Se vio en produccion el 23/09/2026: 17:08, 17:10, 17:12...
  // Un cuarto de latido de margen y se acabo.
  return (Date.now() - new Date(ultimo).getTime()) >= def.cadaMin * 60000 - HOLGURA_MS;
}

const HOLGURA_MS = 15000;

/**
 * Ejecuta UNA tarea y deja constancia. Nunca lanza: la ingesta de una fuente no
 * puede tumbar la de otra ni el proceso entero.
 */
async function ejecutar(tarea, { forzar = false } = {}) {
  const def = TAREAS[tarea];
  if (!def) throw new Error(`Tarea de ingesta desconocida: "${tarea}"`);
  if (!db.HAY_BD) return { tarea, saltada: 'sin base de datos' };
  if (!forzar && !(await toca(tarea))) return { tarea, saltada: 'todavía es reciente' };

  const t0 = Date.now();
  try {
    const r = await def.ejecutar();
    const ms = Date.now() - t0;
    await db.consulta(
      `INSERT INTO ingesta_ejecucion (fuente, tarea, ok, duracion_ms, registros, detalle)
       VALUES ($1,$2,TRUE,$3,$4,$5)`,
      [def.fuente, tarea, ms, r.registros ?? null, JSON.stringify(r.detalle || {})]);
    console.log(`📥 [INGESTA] ${def.etiqueta}: ${r.registros ?? '?'} registro(s) en ${(ms / 1000).toFixed(1)}s`);
    return { tarea, ok: true, ms, ...r };
  } catch (e) {
    const ms = Date.now() - t0;
    await db.consulta(
      `INSERT INTO ingesta_ejecucion (fuente, tarea, ok, duracion_ms, error)
       VALUES ($1,$2,FALSE,$3,$4)`,
      [def.fuente, tarea, ms, String(e.message).slice(0, 2000)]).catch(() => {});
    // Mapon cayéndose es lo normal, no una alarma. BOLT cayéndose sí lo es.
    const marca = def.critica ? '❌' : '⚠️ ';
    console.error(`${marca} [INGESTA] ${def.etiqueta}: ${e.message}`);
    return { tarea, ok: false, ms, error: e.message };
  }
}

/**
 * El latido. Recorre todas las tareas y ejecuta las que toquen.
 *
 * Van EN SERIE a propósito: en paralelo, dos tareas de BOLT compiten por la
 * misma cuota y se sacan 429s la una a la otra.
 */
// ── UNO CADA VEZ ───────────────────────────────────────────────────────────
// node-cron NO espera a la promesa: lanza el latido siguiente aunque el
// anterior siga dentro. A cinco minutos casi nunca se notaba; a UNO, basta con
// que BOLT tarde para que se pisen dos, y dos latidos son el doble de
// peticiones justo cuando la API esta diciendo que ya son demasiadas. Eso es
// exactamente lo que tumbó el motor de Flota viva el 23/09/2026.
let latiendo = false;

async function latido({ forzar = false, soloFuente } = {}) {
  if (!db.HAY_BD) return { saltada: 'sin base de datos' };
  if (latiendo && !forzar) return { saltada: 'el latido anterior sigue dentro' };
  latiendo = true;
  const hechas = [];
  for (const [tarea, def] of Object.entries(TAREAS)) {
    if (soloFuente && def.fuente !== soloFuente) continue;
    try {
      hechas.push(await ejecutar(tarea, { forzar }));
    } catch (e) {
      // Que una tarea reviente no puede llevarse por delante a las demas: cada
      // una ya se apunta su fallo, y el latido sigue con la siguiente.
      console.error(`❌ [INGESTA] ${tarea} se cayó dentro del latido:`, e.message);
    }
  }
  latiendo = false;
  return { hechas };
}

// ── EN DIRECTO: LOS APUNTES DE BOLT CADA 10 SEGUNDOS ────────────────────────
//
// Lo pidio Camilo: "matricula X, conductor Y, en espera, hace 5 segundos". El
// mapa y En directo ya leen el apunte crudo; lo que faltaba era que el apunte
// LLEGARA pronto. Medido el 23/09/2026 preguntando cada 10 s durante dos
// minutos:
//
//   · BOLT publica el cambio casi al momento: lo cazamos entre 2 y 11 s
//     despues de que ocurriera, con 10 s entre preguntas. El retraso es
//     NUESTRO, no suyo.
//   · Doce preguntas seguidas, cero 429. Cada una, ~500 ms y una pagina.
//
// Por eso va aparte del latido -que es de minuto- y con su propia bandera: si
// BOLT tarda o protesta, la pasada siguiente se salta sola en vez de apilarse.
// Es lo que tumbo el motor de Flota viva esa misma tarde.
//
// NO deja rastro en `ingesta_ejecucion` ni guarda el crudo: serian 8.640 filas
// al dia de lo mismo. Eso lo hace `state_logs_bolt` cada cinco minutos con una
// ventana de dos horas, que ademas recoge lo que este bucle se haya perdido.
let alDia = false;
let ultimaAlDia = { at: null, traidos: 0, nuevos: 0, ms: null, error: null };

// ── EL VIAJE QUE ACABA DE TERMINAR, AL MOMENTO (25/09/2026) ────────────────
//
// getFleetOrders NO da los viajes en curso: un pedido solo aparece cuando se
// cierra (terminado, cancelado…). Con la pasada de pedidos recientes cada diez
// minutos, el mapa tardaba hasta eso en saber dónde había dejado un coche al
// último pasajero, y mientras tanto enseñaba el viaje de antes. Camilo lo vio
// con el 1208MJY: BOLT decía «Esperando · 1 min» en Aranjuez y el mapa, Tres
// Cantos.
//
// Pero este bucle ve el fin del viaje a los pocos segundos: un conductor pasa
// de `has_order` a otra cosa. En ese momento se le pide a BOLT solo lo creado
// alrededor de cuando empezó ese viaje (un cuarto de hora antes y dos minutos
// después: unas decenas de pedidos de toda la flota, una página) y se guarda.
// Si BOLT aún no lo da por cerrado, se reintenta en las pasadas siguientes
// durante dos minutos; después queda para la pasada de diez minutos, que sigue
// siendo la red.
const viajesPorTraer = new Map();          // 'driver|inicioSeg' → { flota, driver, inicio, fin, intentos }
const INTENTOS_VIAJE = 12;                 // 12 pasadas de 10 s: dos minutos
const ANTES_DEL_INICIO_S = 15 * 60, DESPUES_DEL_INICIO_S = 2 * 60;
// Para decir «este viaje ya lo tenemos» basta mirar desde 5 min antes de que
// empezara: entre que el cliente pide y alguien acepta pasan segundos, o un par
// de minutos si otros no respondieron. Con los 15 de la ventana de pedir, un
// viaje cancelado poco antes se tomaría por este.
const YA_ANTES_S = 5 * 60;

async function traerViajesTerminados(logsPorFlota) {
  const { fetchAllPaginated } = require('./bolt');
  const staging = require('./repo/staging');
  const ahora = Math.floor(Date.now() / 1000);

  // 1. Los fines de viaje: un apunte que NO es has_order justo después de uno
  //    que sí lo era, para ese conductor. Lo de antes se mira en la base, que
  //    ya tiene los apuntes recién guardados.
  const cand = [];
  logsPorFlota.forEach(({ flota, logs }) => logs.forEach(l => {
    const t = Number(l.created);
    if (l.driver_uuid && l.state && l.state !== 'has_order' && t && ahora - t < 15 * 60) {
      cand.push({ flota, driver: l.driver_uuid, t });
    }
  }));
  if (cand.length) {
    const r = await db.consulta(
      `SELECT f.d AS driver, f.t, EXTRACT(EPOCH FROM prev.ocurrido_at)::bigint AS inicio
         FROM unnest($1::text[], $2::bigint[]) AS f(d, t)
         CROSS JOIN LATERAL (
           SELECT l.estado, l.ocurrido_at FROM bolt_state_log l
            WHERE l.driver_uuid = f.d AND l.ocurrido_at < to_timestamp(f.t)
            ORDER BY l.ocurrido_at DESC LIMIT 1) prev
        WHERE prev.estado = 'has_order'`,
      [cand.map(c => c.driver), cand.map(c => c.t)]);
    r.rows.forEach(x => {
      const c = cand.find(y => y.driver === x.driver && y.t === Number(x.t));
      const k = x.driver + '|' + x.inicio;
      if (c && !viajesPorTraer.has(k)) {
        viajesPorTraer.set(k, { flota: c.flota, driver: x.driver, inicio: Number(x.inicio), fin: c.t, intentos: 0 });
      }
    });
  }
  if (!viajesPorTraer.size) return 0;

  // 2. Los que ya están en la base (con cualquier desenlace aceptado) sobran.
  const pend = [...viajesPorTraer.entries()];
  const ya = await db.consulta(
    `SELECT f.k FROM unnest($1::text[], $2::text[], $3::bigint[]) AS f(k, d, i)
      WHERE EXISTS (SELECT 1 FROM bolt_order b
                     WHERE b.driver_uuid = f.d
                       AND b.creado_ts BETWEEN to_timestamp(f.i - ${YA_ANTES_S}) AND to_timestamp(f.i + ${DESPUES_DEL_INICIO_S})
                       AND b.estado NOT IN ('driver_did_not_respond', 'driver_rejected'))`,
    [pend.map(([k]) => k), pend.map(([, v]) => v.driver), pend.map(([, v]) => v.inicio)]);
  ya.rows.forEach(x => viajesPorTraer.delete(x.k));
  if (!viajesPorTraer.size) return 0;

  // 3. Una llamada por flota, con la ventana que cubre a todos sus pendientes.
  let traidos = 0;
  const porFlota = new Map();
  viajesPorTraer.forEach(v => { if (!porFlota.has(v.flota)) porFlota.set(v.flota, []); porFlota.get(v.flota).push(v); });
  for (const [flota, vs] of porFlota) {
    const desde = Math.min(...vs.map(v => v.inicio)) - ANTES_DEL_INICIO_S;
    const hasta = Math.min(ahora, Math.max(...vs.map(v => v.inicio)) + DESPUES_DEL_INICIO_S);
    const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders',
      { company_ids: [flota], company_id: flota, time_range_filter_type: 'created', start_ts: desde, end_ts: hasta },
      'orders', 1000, `viaje terminado ${flota}`);
    if (ordenes.length) traidos += await staging.guardarOrders(ordenes, null);
  }

  // 4. Un intento más para los que sigan; los que agotan, a la pasada de 10 min.
  viajesPorTraer.forEach((v, k) => { if (++v.intentos >= INTENTOS_VIAJE || ahora - v.fin > 15 * 60) viajesPorTraer.delete(k); });
  return traidos;
}

async function estadosAlDia({ ventanaMin = 5 } = {}) {
  if (!db.HAY_BD) return { saltado: 'sin base de datos' };
  if (alDia) return { saltado: 'la pasada anterior sigue dentro' };
  alDia = true;
  const t0 = Date.now();
  try {
    const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
    const staging = require('./repo/staging');
    const hasta = Math.floor(Date.now() / 1000);
    const desde = hasta - ventanaMin * 60;
    let todos = [];
    const porFlota = [];
    for (const f of CONFIG_BOLT.flotas) {
      const logs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs',
        { company_id: f.id, start_ts: desde, end_ts: hasta }, 'state_logs', 1000, `directo ${f.id}`);
      todos = todos.concat(logs);
      porFlota.push({ flota: f.id, logs });
    }
    // Sin descarga: `descarga_id` admite NULL y la copia cruda ya la deja la
    // tarea de cinco minutos.
    const nuevos = await staging.guardarStateLogs(todos, null);
    // El viaje que acaba de terminar, con su destino, sin esperar a la pasada
    // de pedidos. En su propio try: que falle esto no puede parar el directo.
    let viajes = 0;
    try { viajes = await traerViajesTerminados(porFlota); }
    catch (e) { console.warn('⚠️ [DIRECTO] viajes terminados:', e.message); }
    ultimaAlDia = { at: new Date(), traidos: todos.length, nuevos, viajes, pendientes: viajesPorTraer.size, ms: Date.now() - t0, error: null };
    return ultimaAlDia;
  } catch (e) {
    ultimaAlDia = { at: new Date(), traidos: 0, nuevos: 0, ms: Date.now() - t0, error: e.message };
    throw e;
  } finally {
    // En el `finally`: si se queda encendida por una excepcion, el directo se
    // para hasta el siguiente despliegue sin que nadie lo note.
    alDia = false;
  }
}

/** ¿El directo esta vivo? Para diagnosticar sin abrir la base. */
const estadoAlDia = () => ({ corriendo: alDia, ultima: ultimaAlDia });

module.exports = { TAREAS, latido, ejecutar, estado, toca, estadosAlDia, estadoAlDia, _traerViajesTerminados: traerViajesTerminados };
