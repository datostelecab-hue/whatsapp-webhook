// ============================================================
// FLOTA VIVA — la vuelta de cada cinco minutos
// ============================================================
// Cada cinco minutos se pregunta a BOLT qué ha pasado y a Mapon cuánto ha rodado
// el coche. Y lo que se guarda son TRAMOS: una fila por racha.
//
// Por qué tramos y no fotos: "¿cuánto lleva este coche desconectado?" con fotos
// obliga a recorrer el historial hacia atrás en cada consulta. Con tramos es leer
// una fila — ya trae `desde` y los km acumulados.
//
// DOS COSAS QUE NO SON OBVIAS y que costaron un fallo cada una:
//
//   1. Los tramos NO se cortan cuando miramos, sino cuando BOLT dice que pasó.
//      Sus apuntes traen la hora exacta y antes se tiraban, así que cada tramo
//      arrastraba hasta cinco minutos de error y un viaje corto entre dos vueltas
//      no existía. Se reproducen uno a uno. Ver `aplicar`.
//
//   2. Los km NO son la resta del odómetro final menos el inicial. Un equipo sin
//      cobertura se pone al día de golpe y ese salto son kilómetros de antes.
//      Se suma el trocito de cada vuelta y solo si es creíble. Ver `kmDelTrozo`.
//
// LA VENTANA DE BOLT ES CORTA A PROPÓSITO (dos horas). BOLT no tiene un "dime
// cómo está todo ahora": tiene un registro de CAMBIOS. Un coche que lleva seis
// horas apagado no genera un solo apunte, así que pedir una ventana enorme para
// "encontrarlo" es tirar cuota. No hace falta: si no hay apunte nuevo, su
// situación es la que ya teníamos, y de eso se encarga el tramo abierto.

const db = require('./db');
const fuentes = require('./fuentes');
const desempate = require('./desempate');

const VENTANA_H = Number(process.env.FLOTA_VIVA_VENTANA_H) || 2;
// El padrón de coches y conductores cambia de Pascuas a Ramos: no hace falta
// pedirlo cada cinco minutos.
const PADRON_CADA_MIN = Number(process.env.FLOTA_VIVA_PADRON_MIN) || 60;

let ultimoPadron = 0;

// ── ANTI-SOLAPE: LO QUE FALTABA ────────────────────────────────────────────
//
// node-cron NO espera a la promesa: lanza la vuelta siguiente aunque la
// anterior siga dentro. Con vueltas de un segundo eso no se nota nunca, y por
// eso estuvo bien un año. El 23/09/2026 se vio lo que pasa cuando no:
//
//   BOLT empezó a contestar 429 (demasiadas peticiones). Cada página reintenta
//   con espera, así que una vuelta pasó de 1 s a 9 MINUTOS. Mientras corría,
//   el cron metió otra, y otra: cada una pidiendo a BOLT lo mismo, lo que
//   provocaba más 429, que alargaban más las vueltas. A las 12:45 dejó de
//   terminar ninguna y el mapa se quedó congelado en la última foto buena —
//   enseñando en rojo "rueda sin nadie" a gente que estaba trabajando.
//
// Una vuelta cada vez. Si la anterior sigue dentro, esta se salta y se dice.
let corriendo = false;

// Y un reloj de guardia: si una vuelta pasa de aquí, se ESCRIBE que se quedó
// colgada. No la mata —no se puede cancelar una petición que ya salió— pero
// deja de ser un misterio: `fv_vuelta` tenía la columna `error` y estaba
// siempre vacía porque el fallo era un cuelgue, no una excepción.
const TOPE_VUELTA_MS = Number(process.env.FLOTA_VIVA_TOPE_MIN || 4) * 60000;

/** Cómo se dice en nuestro vocabulario lo que manda BOLT. */
async function traducir() {
  const r = await db.consulta('SELECT estado, situacion FROM fv_estado_bolt');
  return new Map(r.rows.map(x => [x.estado, x.situacion]));
}

/**
 * Un estado de BOLT que no sabemos traducir se apunta.
 *
 * No se calla ni se convierte en "otro" y ya: se guarda la palabra exacta para
 * que aparezca en el panel. Es la única forma de enterarse de que BOLT ha
 * cambiado su vocabulario, que es la avería silenciosa de este tipo de módulos.
 */
async function apuntarDesconocido(estado) {
  await db.consulta(
    `INSERT INTO fv_estado_bolt (estado, situacion) VALUES ($1, 'otro')
     ON CONFLICT (estado) DO NOTHING`, [estado]);
  console.warn(`⚠️  [FLOTA VIVA] Estado de BOLT sin clasificar: "${estado}"`);
}

/**
 * Las matrículas que se vigilan.
 *
 * La verdad de la flota es la tabla `vehiculo` del dominio: si un coche está de
 * alta, sus horas cuentan. Antes esto salía SOLO de una lista aparte
 * (`fv_matricula`) que había que mantener a mano, y bastaba con olvidarse de
 * apuntar ahí un coche para que sus horas desaparecieran sin que nadie se
 * enterase: en agosto de 2026 se perdieron así 513 h de 3035LTX.
 *
 * `fv_matricula` se queda como AJUSTE, no como fuente:
 *   · activa = TRUE  → se vigila aunque no esté en el dominio (un coche que solo
 *                      existe en BOLT, por ejemplo).
 *   · activa = FALSE → NO se vigila aunque esté de alta (exclusión a propósito).
 */
async function vigiladas() {
  try {
    // Y se APUNTAN en fv_matricula las que falten. No es cosmética: la vista
    // fv_ahora (el panel EN DIRECTO de /control) filtra por fv_matricula.activa,
    // así que un coche de la flota que no esté apuntado se ingiere pero NO SE VE.
    // Con el 3035LTX pasaba justo eso: rodaba con conductores y el panel no lo
    // enseñaba. Apuntarlo aquí hace que lo que se vigila y lo que se ve salgan
    // del mismo sitio: la flota de verdad. Desactivar una matrícula a mano
    // (activa = false) la sigue sacando: esto solo da de alta lo que no está.
    await db.consulta(`
      INSERT INTO fv_matricula (matricula, activa, nota)
      SELECT v.matricula, TRUE, 'alta automática desde la flota'
        FROM vehiculo v
       WHERE v.baja_at IS NULL AND v.matricula IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM fv_matricula m WHERE m.matricula = v.matricula)
      ON CONFLICT (matricula) DO NOTHING`);

    const r = await db.consulta(`
      SELECT matricula FROM (
        SELECT matricula FROM vehiculo WHERE baja_at IS NULL AND matricula IS NOT NULL
        UNION
        SELECT matricula FROM fv_matricula WHERE activa
      ) t
      WHERE matricula NOT IN (SELECT matricula FROM fv_matricula WHERE NOT activa)`);
    return new Set(r.rows.map(x => x.matricula));
  } catch (e) {
    // Si el núcleo viviera en otra base y no viera `vehiculo`, se sigue con la
    // lista de siempre antes que quedarse sin vigilar nada.
    console.warn('⚠️  [FLOTA VIVA] No pude leer la flota del dominio, uso solo fv_matricula:', e.message);
    const r = await db.consulta('SELECT matricula FROM fv_matricula WHERE activa');
    return new Set(r.rows.map(x => x.matricula));
  }
}

/**
 * Refresca el padrón de coches y conductores si toca.
 *
 * EL RELOJ SE PONE AL EMPEZAR, NO AL ACABAR, y esa línea es media avería.
 * Antes se marcaba al final: si la descarga tardaba quince minutos —que es lo
 * que tarda cuando BOLT contesta 429—, las tres vueltas siguientes veían el
 * reloj viejo y lanzaban SU PROPIA descarga del padrón entero. Cuatro veces lo
 * mismo, justo cuando BOLT estaba diciendo que ya eran demasiadas peticiones.
 *
 * Marcándolo al entrar, el que llega tarde se va a casa. Si la descarga falla,
 * se devuelve el reloj atrás para que el siguiente pueda reintentar.
 */
async function padron(desdeTs, hastaTs) {
  if (Date.now() - ultimoPadron < PADRON_CADA_MIN * 60000) return false;
  const relojPrevio = ultimoPadron;
  ultimoPadron = Date.now();
  try {
    return await padronDeVerdad(desdeTs, hastaTs);
  } catch (e) {
    // Que falle no puede dejar el padrón sin refrescar una hora entera.
    ultimoPadron = relojPrevio;
    throw e;
  }
}

/**
 * Los conductores, DE NUESTRO PROPIO PADRON.
 *
 * ── POR QUE NO SE LE PIDEN A BOLT ──────────────────────────────────────────
 * Porque ya se los ha pedido otro. `conductor_externo` lo llena la ingesta
 * (`padron_bolt`) cada hora con el MISMO `getDrivers`, y hasta el 23/09/2026
 * este motor se lo volvia a bajar entero por su cuenta, tambien cada hora. Dos
 * descargas de lo mismo, y `getDrivers` son dieciocho paginas por flota.
 *
 * Eso es lo que hacia que BOLT contestara 429, y los 429 son lo que convirtio
 * una vuelta de un segundo en once minutos y acabo con el mapa congelado
 * acusando de "rueda sin nadie" a gente que estaba de viaje. Ver
 * [[Trampas conocidas]].
 *
 * Y no se pierde nada: medido ese dia, el padron tenia 1.653 cuentas y
 * `fv_conductor` 1.596, con CERO conductores que estuvieran aqui y no alli.
 * Todas con nombre y telefono, que es lo unico que necesita esta tabla.
 *
 * ── SI EL NUCLEO NO SE VE, SE VUELVE A BOLT ────────────────────────────────
 * El modulo puede vivir en otra base (FLOTA_VIVA_DB_URL) y no alcanzar
 * `conductor_externo`. En ese caso se baja de BOLT como siempre: es mas caro,
 * pero quedarse sin nombres deja el panel entero mudo. Mismo criterio que
 * `vigiladas()`.
 */
async function conductoresDeCasa(desdeTs, hastaTs) {
  try {
    const r = await db.consulta(
      `SELECT externo_id                          AS uuid,
              btrim(COALESCE(externo_nombre, '')) AS nombre,
              btrim(COALESCE(externo_telefono, '')) AS telefono
         FROM conductor_externo
        WHERE sistema = 'bolt' AND externo_id IS NOT NULL`);
    // Un padron vacio no es un padron: seria borrar los nombres de todos. Si
    // no hay nadie, se pregunta a BOLT como antes.
    if (r.rows.length) {
      return r.rows.map(x => ({ uuid: x.uuid, nombre: x.nombre, telefono: x.telefono, flotaId: null }));
    }
    console.warn('⚠️  [FLOTA VIVA] El padron de conductores esta vacio: se pregunta a BOLT');
  } catch (e) {
    console.warn('⚠️  [FLOTA VIVA] No pude leer el padron del nucleo, bajo los conductores de BOLT:', e.message);
  }
  return fuentes.conductores(desdeTs, hastaTs);
}

async function padronDeVerdad(desdeTs, hastaTs) {

  // Los COCHES si se le piden a BOLT: son una pagina por flota -noventa y pico
  // matriculas- y de ahi sale el enlace uuid-matricula del que cuelga todo el
  // modulo. Lo caro y lo que provocaba los 429 eran los conductores.
  const [todosLosCoches, gente, lista] = await Promise.all([
    fuentes.vehiculos(desdeTs, hastaTs),
    conductoresDeCasa(desdeTs, hastaTs),
    vigiladas(),
  ]);

  // EL FILTRO. BOLT devuelve la flota entera; aquí se descarta lo que no está en
  // la lista, antes de guardar nada. Así ni ocupa sitio ni sale en el panel.
  const coches = todosLosCoches.filter(v => v.matricula && lista.has(v.matricula));

  // Una matrícula de la lista que BOLT no conoce no es un detalle: o está mal
  // escrita, o ese coche ya no está en la flota. Se dice por su nombre.
  const enBolt = new Set(coches.map(v => v.matricula));
  const sinCoche = [...lista].filter(m => !enBolt.has(m));
  if (sinCoche.length) {
    console.warn(`⚠️  [FLOTA VIVA] ${sinCoche.length} matrícula(s) vigiladas que BOLT no conoce: ` +
                 sinCoche.slice(0, 12).join(', ') + (sinCoche.length > 12 ? '…' : ''));
  }

  // Y AL REVÉS, que es justo lo que se nos escapaba: un coche que BOLT SÍ conoce y
  // que no vigilamos se descarta aquí y sus horas no existen para nosotros, sin
  // que nadie lo sepa. Ahora se dice por su nombre.
  const sinVigilar = todosLosCoches.filter(v => v.matricula && !lista.has(v.matricula));
  if (sinVigilar.length) {
    console.warn(`⚠️  [FLOTA VIVA] ${sinVigilar.length} coche(s) que BOLT conoce y NO vigilamos ` +
                 '(sus horas NO se guardan): ' +
                 sinVigilar.slice(0, 12).map(v => v.matricula).join(', ') +
                 (sinVigilar.length > 12 ? '…' : '') + ' — si son nuestros, dales de alta en la flota.');
  }

  // ── DOS SENTENCIAS, NO MIL SETECIENTAS ────────────────────────────────────
  //
  // Esto eran dos bucles de INSERT uno a uno dentro de una transaccion: con el
  // padron entero son ~1.750 idas y vueltas a Frankfurt, donde el viaje cuesta
  // treinta veces mas que el trabajo. Y mientras duran, la transaccion tiene
  // cogidas las filas: dos padrones a la vez -el de produccion y uno lanzado a
  // mano, por ejemplo- se cruzan y PostgreSQL mata a uno por deadlock. Pasó al
  // probar esto mismo el 23/09/2026.
  //
  // De una vez y ORDENADO por uuid: ademas de ser mas rapido, dos procesos que
  // escriban lo mismo cogen las filas en el mismo orden y ya no pueden cruzarse.
  //
  // Y DEDUPLICADO, que no es un detalle: quien esta en las DOS flotas viene dos
  // veces, y un INSERT masivo con la misma clave repetida no es lento, es un
  // error -"cannot affect row a second time"-. El bucle de antes lo absorbia
  // sin enterarse.
  const unicos = (lista_, clave) => {
    const m = new Map();
    lista_.forEach(x => { if (x && x[clave]) m.set(x[clave], x); });
    return [...m.values()].sort((a, b) => String(a[clave]).localeCompare(String(b[clave])));
  };
  const cs = unicos(coches, 'uuid');
  const gs = unicos(gente, 'uuid');

  await db.transaccion(async cli => {
    if (cs.length) {
      await cli.query(
        `INSERT INTO fv_vehiculo (uuid, matricula, flota_id, visto_at)
         SELECT x.uuid, x.matricula, x.flota, now()
           FROM unnest($1::text[], $2::text[], $3::bigint[]) AS x(uuid, matricula, flota)
         ON CONFLICT (uuid) DO UPDATE SET
           matricula = COALESCE(EXCLUDED.matricula, fv_vehiculo.matricula),
           flota_id = COALESCE(EXCLUDED.flota_id, fv_vehiculo.flota_id), visto_at = now()`,
        [cs.map(v => v.uuid), cs.map(v => v.matricula || null), cs.map(v => v.flotaId || null)]);
    }
    if (gs.length) {
      await cli.query(
        `INSERT INTO fv_conductor (uuid, nombre, telefono, flota_id, visto_at)
         SELECT x.uuid, NULLIF(x.nombre, ''), NULLIF(x.tel, ''), x.flota, now()
           FROM unnest($1::text[], $2::text[], $3::text[], $4::bigint[]) AS x(uuid, nombre, tel, flota)
         ON CONFLICT (uuid) DO UPDATE SET
           nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), fv_conductor.nombre),
           telefono = COALESCE(NULLIF(EXCLUDED.telefono, ''), fv_conductor.telefono),
           flota_id = COALESCE(EXCLUDED.flota_id, fv_conductor.flota_id),
           visto_at = now()`,
        [gs.map(c => c.uuid), gs.map(c => c.nombre || ''), gs.map(c => c.telefono || ''),
         gs.map(c => c.flotaId || null)]);
    }
  });

  console.log(`👥 [FLOTA VIVA] Padrón: ${cs.length} de ${lista.size} vigilada(s) · ` +
              `${gs.length} conductor(es) del padrón de la casa`);
  return { coches: cs.length, conductores: gs.length, vigiladas: lista.size, sinCoche };
}

/**
 * Una vuelta.
 *
 * Devuelve el recuento de lo que ha pasado, que es lo que se guarda en
 * `fv_vuelta` y lo que deja ver si esto sigue vivo o lleva horas fallando.
 */
async function pasada() {
  // UNA CADA VEZ. Saltarse una vuelta no pierde nada: la siguiente mira la
  // misma ventana de dos horas y reconstruye lo que haya pasado. Pisarse, en
  // cambio, multiplica las llamadas a BOLT y acaba con las dos paradas.
  if (corriendo) {
    console.warn('⏭️  [FLOTA VIVA] La vuelta anterior sigue dentro: esta se salta');
    return { saltado: true, motivo: 'la vuelta anterior sigue dentro' };
  }
  corriendo = true;

  const t0 = Date.now();
  await db.preparar();

  const vuelta = (await db.consulta(
    'INSERT INTO fv_vuelta (arrancada_at) VALUES (now()) RETURNING id')).rows[0].id;

  // El reloj de guardia. No corta nada; solo deja escrito que esto se colgó,
  // para que la próxima vez no haya que deducirlo de una tabla con huecos.
  const guardia = setTimeout(() => {
    console.error(`⏰ [FLOTA VIVA] La vuelta ${vuelta} lleva ${TOPE_VUELTA_MS / 60000} min sin terminar`);
    db.consulta('UPDATE fv_vuelta SET error = $2 WHERE id = $1 AND terminada_at IS NULL',
      [vuelta, 'Colgada: más de ' + (TOPE_VUELTA_MS / 60000) + ' min sin terminar']).catch(() => {});
  }, TOPE_VUELTA_MS);

  try {
    const hastaTs = Math.floor(Date.now() / 1000);
    const desdeTs = hastaTs - VENTANA_H * 3600;

    await padron(desdeTs, hastaTs);

    const [estadosBolt, mapon, mapa] = await Promise.all([
      fuentes.estados(desdeTs, hastaTs),
      fuentes.flotaMapon().catch(e => {
        console.error('⚠️  [FLOTA VIVA] Mapon no contestó:', e.message);
        return new Map();
      }),
      traducir(),
    ]);

    // DOS APUNTES EN EL MISMO SEGUNDO: el de ahora es el de más rango, con la
    // MISMA regla que la foto del ahora (desempate.js). Antes mandaba el orden
    // en que BOLT los devolviera, que no está garantizado, y el tramo abierto
    // podía decir «espera» de quien estaba en descanso.
    estadosBolt.forEach(arr => desempate.ordenar(arr, e => mapa.get(e)));

    // Solo los vigilados, y por si acaso: `fv_vehiculo` ya está filtrado al
    // guardarse, pero si alguien desactiva una matrícula, su coche deja de
    // mirarse en la siguiente vuelta sin tener que borrar nada.
    const coches = (await db.consulta(
      `SELECT v.uuid, v.matricula, v.mapon_unit, v.ultimo_log_at
         FROM fv_vehiculo v
         JOIN fv_matricula m ON m.matricula = v.matricula AND m.activa`)).rows;

    let conectados = 0, cambios = 0;

    for (const v of coches) {
      const r = await aplicar(v, {
        logs: estadosBolt.get(v.uuid) || [],
        gps: v.matricula ? mapon.get(v.matricula) : null,
        mapa,
      });
      if (r.cambio) cambios++;
      if (r.conectado) conectados++;
    }

    const ms = Date.now() - t0;
    await db.consulta(
      `UPDATE fv_vuelta SET terminada_at = now(), vehiculos = $2, conectados = $3,
              cambios = $4, ms = $5 WHERE id = $1`,
      [vuelta, coches.length, conectados, cambios, ms]);
    // Tramos nuevos: la foto del ahora que tengan guardada las pantallas ya no
    // vale. Se rehace en la siguiente petición.
    require('./ahora').invalidar('vuelta');

    // Con los tramos ya al día, se mira si toca llamar a alguien. Va DESPUÉS
    // a propósito: la revisión lee `fv_ahora`, y si corriera antes miraría la
    // foto anterior.
    let incidencias = null;
    try {
      incidencias = await require('./franjas').revisar();
    } catch (e) {
      console.error('⚠️  [FLOTA VIVA] La revisión de franjas falló:', e.message);
    }

    // Alimenta el núcleo de km con los trayectos de Mapon de las últimas horas —
    // la fuente BUENA (route/list), no el `mileage` estancado. En su propio try:
    // si route/list falla, la vuelta no se cae. Ventana holgada porque el dedup
    // por route_id absorbe el solape entre vueltas.
    let rutas = null;
    try {
      rutas = await require('./rutas').ingestarRutas({
        desde: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      });
    } catch (e) {
      console.error('⚠️  [FLOTA VIVA] La ingesta de rutas falló:', e.message);
    }

    // Y el ODÓMETRO DEL CUADRO, que es de donde salen los km cuando el coche lo
    // da. No sustituye a lo de arriba: los trayectos siguen haciendo falta —para
    // saber CUÁNDO rodó el coche y para los que no leen el CAN—, pero los metros
    // buenos son estos. En su propio try por lo mismo: si Mapon tose, la vuelta
    // sigue.
    //
    // Al filo de cada hora se barre la flota entera; el resto de vueltas, solo
    // los coches que se han movido o llevan a alguien conectado.
    let odom = null;
    try {
      odom = await require('./rutas').ingestarOdometro({
        desde: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        soloActivos: new Date().getMinutes() >= 5,
      });
    } catch (e) {
      console.error('⚠️  [FLOTA VIVA] La ingesta del odómetro falló:', e.message);
    }

    // Y LAS ALERTAS DE GEOCERCA. Entran por aquí y no por su propio cron por la
    // regla de la casa: BOLT y Mapon tienen UNA puerta. Con una ventana de una
    // hora sobre una vuelta de cinco minutos, porque las alertas de Mapon
    // llegan con retraso y perder una salida de zona es peor que pedirla doce
    // veces — duplicar no puede, lo impide el id de Mapon.
    let zonas = null;
    try {
      zonas = await require('../zonasMapon').ingestar({ minutos: 60 });
    } catch (e) {
      console.error('⚠️  [FLOTA VIVA] La ingesta de alertas de zona falló:', e.message);
    }

    console.log(`🚦 [FLOTA VIVA] ${coches.length} coche(s) · ${conectados} conectado(s) · ` +
                `${cambios} cambio(s) · ${ms} ms` +
                (rutas ? ` · ${rutas.trayectos} trayecto(s)` : '') +
                (odom ? ` · odómetro: ${odom.conCan}/${odom.unidades} coche(s)` : '') +
                (zonas && zonas.nuevas ? ` · ${zonas.nuevas} alerta(s) de zona` : ''));
    return { vehiculos: coches.length, conectados, cambios, ms, incidencias, rutas, odom, zonas };
  } catch (e) {
    await db.consulta('UPDATE fv_vuelta SET terminada_at = now(), error = $2 WHERE id = $1',
      [vuelta, e.message]).catch(() => {});
    throw e;
  } finally {
    clearTimeout(guardia);
    // En el `finally`: si se queda encendida por una excepción, el motor no
    // vuelve a correr hasta el siguiente despliegue y nadie se entera, porque
    // el mapa sigue enseñando lo último que supo.
    corriendo = false;
  }
}

/**
 * Reproduce los cambios de estado de un coche y le suma los km del intervalo.
 *
 * ANTES esto era una FOTO cada cinco minutos: se miraba en qué estaba y se
 * estiraba o se abría un tramo, con la hora en que habíamos mirado NOSOTROS. Dos
 * cosas se perdían por el camino:
 *
 *   · Un estado que empezaba y acababa entre dos vueltas no existía. Un viaje de
 *     cuatro minutos no dejaba rastro, y el tramo decía "en espera" todo el rato.
 *   · Cada tramo arrastraba hasta cinco minutos de error, porque `desde` era
 *     cuándo miramos y no cuándo pasó. Y la hora buena la teníamos delante, en el
 *     propio apunte de BOLT.
 *
 * Ahora se reproducen los apuntes UNO A UNO con su hora real. Los tramos salen
 * exactos y los estados cortos aparecen.
 *
 * El conductor NO abre tramo por sí solo: BOLT deja de mandar driver_uuid al
 * desconectarse, y tratarlo como cambio partía en dos la misma racha.
 */
async function aplicar(vehiculo, { logs, mapa, gps }) {
  const odo = gps && gps.odometroM != null ? gps.odometroM : null;
  const senal = gps && gps.senalAt ? gps.senalAt : null;

  if (gps && gps.unitId && !vehiculo.mapon_unit) {
    await db.consulta('UPDATE fv_vehiculo SET mapon_unit = $2 WHERE uuid = $1',
      [vehiculo.uuid, gps.unitId]);
  }

  let abierto = (await db.consulta(
    `SELECT id, situacion, desde, conductor_uuid, odometro_visto_m, senal_at
       FROM fv_tramo WHERE vehiculo_uuid = $1 AND hasta IS NULL`,
    [vehiculo.uuid])).rows[0] || null;

  // Solo los apuntes que no hemos reproducido. Sin esto, cada vuelta volvería a
  // procesar las dos horas de ventana y duplicaría tramos.
  const visto = vehiculo.ultimo_log_at ? new Date(vehiculo.ultimo_log_at).getTime() : 0;
  const nuevos = (logs || []).filter(l => l.t * 1000 > visto);

  // La lectura de odómetro con la que empezó el intervalo, y los tramos que han
  // estado abiertos durante él. Los dos hacen falta para repartir los km.
  const lecturaPrevia = abierto ? abierto.odometro_visto_m : null;
  const senalPrevia = abierto ? abierto.senal_at : null;
  const tocados = abierto ? [{ id: abierto.id, desde: new Date(abierto.desde) }] : [];

  let cambios = 0, sinClasificar = null;

  for (const l of nuevos) {
    const cuando = new Date(l.t * 1000);
    let situacion = mapa.get(l.estado);
    if (!situacion) { sinClasificar = l.estado; situacion = 'otro'; }

    // UN APUNTE ANTERIOR AL TRAMO QUE YA ESTÁ ABIERTO SE IGNORA.
    //
    // Habla de algo que pasó antes de donde estamos, así que no se puede meter
    // sin reescribir hacia atrás. Cerrar el tramo abierto en una hora anterior a
    // su propio inicio dejaba un tramo de CERO minutos — que es exactamente el
    // "Desconectado 16:54 · 0 min" que apareció junto al bueno de las 16:03.
    //
    // Pasa una sola vez por coche, al estrenar el reproductor: como no había
    // marca de por dónde íbamos, la primera vuelta reprodujo las dos horas de
    // ventana enteras, incluidos apuntes anteriores al tramo que ya estaba
    // abierto. A partir de ahí la marca existe y no vuelve a ocurrir.
    if (abierto && cuando < new Date(abierto.desde)) continue;

    // Mismo estado que el tramo abierto: no es un cambio, es un latido. Se
    // aprovecha para rellenar el conductor, que BOLT no manda siempre.
    if (abierto && abierto.situacion === situacion) {
      if (l.conductor && !abierto.conductor_uuid) {
        await db.consulta('UPDATE fv_tramo SET conductor_uuid = $2 WHERE id = $1',
          [abierto.id, l.conductor]);
        abierto.conductor_uuid = l.conductor;
      }
      continue;
    }

    const anterior = abierto;
    const fila = await db.transaccion(async cli => {
      if (anterior) {
        // GREATEST sigue como red de seguridad para el caso límite —dos apuntes
        // en el mismo segundo—, pero ya no es lo que evita los tramos de cero
        // minutos: eso lo hace el descarte de arriba.
        await cli.query(
          'UPDATE fv_tramo SET hasta = GREATEST(desde, $2::timestamptz) WHERE id = $1',
          [anterior.id, cuando.toISOString()]);
      }
      const r = await cli.query(
        `INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, estado_bolt,
                               desde, odometro_ini_m, odometro_fin_m, senal_at, km_m)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 0) RETURNING id, desde`,
        [vehiculo.uuid, l.conductor || (anterior ? anterior.conductor_uuid : null) || null,
         situacion, l.estado || null, cuando.toISOString(), odo, senal]);
      return r.rows[0];
    });

    abierto = { id: fila.id, situacion, desde: fila.desde, conductor_uuid: l.conductor || null };
    tocados.push({ id: fila.id, desde: new Date(fila.desde) });
    cambios++;
  }

  // Ni apuntes ni tramo: es la primera vez que vemos este coche. Se le supone
  // apagado, y el estado crudo queda en nulo para decir que fue suposición.
  if (!abierto) {
    const r = await db.consulta(
      `INSERT INTO fv_tramo (vehiculo_uuid, situacion, desde, odometro_ini_m,
                             odometro_fin_m, senal_at, km_m)
       VALUES ($1, 'desconectado', now(), $2, $2, $3, 0) RETURNING id, desde`,
      [vehiculo.uuid, odo, senal]);
    abierto = { id: r.rows[0].id, situacion: 'desconectado', desde: r.rows[0].desde };
    tocados.push({ id: r.rows[0].id, desde: new Date(r.rows[0].desde) });
    cambios++;
  }

  // ── Los km del intervalo, repartidos entre los tramos que lo ocuparon ──
  const avance = kmDelTrozo({ odometro_visto_m: lecturaPrevia, senal_at: senalPrevia }, odo, senal);
  const reparto = repartirKm(tocados, avance.metros, senal || new Date());
  const dudoso = avance.dudoso || tocados.length > 1;

  for (const r of reparto) {
    await db.consulta(
      `UPDATE fv_tramo
          SET km_m = km_m + $2,
              km_dudoso = km_dudoso OR $3,
              odometro_fin_m = COALESCE($4, odometro_fin_m),
              odometro_ini_m = COALESCE(odometro_ini_m, $4),
              odometro_visto_m = COALESCE($4, odometro_visto_m),
              senal_at = COALESCE($5, senal_at),
              vueltas = vueltas + 1
        WHERE id = $1`,
      [r.id, r.metros, r.metros > 0 && dudoso, odo, senal]);
  }

  if (sinClasificar) await apuntarDesconocido(sinClasificar);
  if (nuevos.length) {
    await db.consulta('UPDATE fv_vehiculo SET ultimo_log_at = $2 WHERE uuid = $1',
      [vehiculo.uuid, new Date(nuevos[nuevos.length - 1].t * 1000).toISOString()]);
  }

  return { cambio: cambios > 0, conectado: abierto.situacion !== 'desconectado' };
}

/**
 * Reparte los metros del intervalo entre los tramos que han estado abiertos.
 *
 * Cuando en cinco minutos no cambia nada —lo normal— hay un solo tramo y se lo
 * lleva todo. Cuando ha habido cambios, el odómetro no dice EN CUÁL de ellos se
 * hicieron los km: solo sabemos el total del intervalo. Se reparte por tiempo,
 * que es la única aproximación defendible, y los tramos afectados quedan
 * marcados como dudosos para que la pantalla no los enseñe como exactos.
 *
 * Antes esto no existía y el total entero caía en el último tramo. Un conductor
 * que se ponía en descanso, hacía veinte kilómetros y volvía a espera entre dos
 * vueltas aparecía con los veinte km en "espera" — justo lo contrario de lo que
 * hay que ver.
 */
function repartirKm(tocados, metros, hasta) {
  if (!tocados.length) return [];
  if (!metros) return tocados.map(t => ({ id: t.id, metros: 0 }));
  if (tocados.length === 1) return [{ id: tocados[0].id, metros }];

  const fin = new Date(hasta).getTime();
  const duraciones = tocados.map((t, i) => {
    const acaba = i + 1 < tocados.length ? tocados[i + 1].desde.getTime() : fin;
    return Math.max(0, acaba - t.desde.getTime());
  });
  const total = duraciones.reduce((s, d) => s + d, 0);
  if (!total) return tocados.map((t, i) => ({ id: t.id, metros: i ? 0 : metros }));

  let repartido = 0;
  return tocados.map((t, i) => {
    // Al último se le da lo que quede, para que la suma cuadre exactamente y no
    // se pierda un metro por redondeo.
    const m = i === tocados.length - 1 ? metros - repartido
      : Math.round(metros * duraciones[i] / total);
    repartido += m;
    return { id: t.id, metros: m };
  });
}

// Lo más rápido que puede ir un coche, en metros por segundo. 180 km/h es
// generoso a propósito: no es un límite de velocidad, es el listón por encima
// del cual un salto de odómetro NO es un coche circulando.
const MAX_MS = 50;

/**
 * Cuántos metros ha hecho el coche DESDE LA ÚLTIMA VUELTA.
 *
 * Aquí estaba el fallo que sacó 18,9 km en un coche que llevaba tres minutos
 * parado. Antes los km de un tramo eran `odómetro final − odómetro inicial`, y
 * eso da por hecho que el odómetro avanza a la vez que el coche. No es verdad:
 * un equipo que estuvo sin cobertura se pone al día de golpe, y ese salto —que
 * son kilómetros de horas antes, o de otro día— caía entero en el tramo abierto.
 *
 * Así que se mira el trozo de cada vuelta y se compara con el tiempo que ha
 * pasado SEGÚN EL RELOJ DEL EQUIPO, no según el nuestro: si el equipo no ha
 * vuelto a hablar, no hay kilómetros nuevos que contar por mucho que haya pasado
 * el tiempo. Lo que no cabe en ese rato no se suma, y se marca como dudoso.
 */
function kmDelTrozo(tramo, odo, senal) {
  const nada = { metros: 0, dudoso: false };
  if (odo == null || tramo.odometro_visto_m == null) return nada;

  const delta = Number(odo) - Number(tramo.odometro_visto_m);
  if (delta === 0) return nada;
  // El odómetro no baja. Si baja, es que lo han reiniciado o cambiado el equipo.
  if (delta < 0) return { metros: 0, dudoso: true };

  // Sin saber cuándo habló el equipo antes y ahora, no se puede juzgar el salto.
  // Se cuenta igual, porque lo normal es que sea bueno, pero queda señalado.
  if (!senal || !tramo.senal_at) return { metros: delta, dudoso: true };

  const seg = (new Date(senal) - new Date(tramo.senal_at)) / 1000;
  // El equipo no ha vuelto a hablar: no hay nada nuevo, sea cual sea el número.
  if (seg <= 0) return nada;
  if (delta > seg * MAX_MS) return { metros: 0, dudoso: true };
  return { metros: delta, dudoso: false };
}

module.exports = { pasada, padron, vigiladas, kmDelTrozo, repartirKm };
