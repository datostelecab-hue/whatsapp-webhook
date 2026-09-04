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

const VENTANA_H = Number(process.env.FLOTA_VIVA_VENTANA_H) || 2;
// El padrón de coches y conductores cambia de Pascuas a Ramos: no hace falta
// pedirlo cada cinco minutos.
const PADRON_CADA_MIN = Number(process.env.FLOTA_VIVA_PADRON_MIN) || 60;

let ultimoPadron = 0;

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

/** Refresca el padrón de coches y conductores si toca. */
async function padron(desdeTs, hastaTs) {
  if (Date.now() - ultimoPadron < PADRON_CADA_MIN * 60000) return false;

  const [todosLosCoches, gente, lista] = await Promise.all([
    fuentes.vehiculos(desdeTs, hastaTs),
    fuentes.conductores(desdeTs, hastaTs),
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

  await db.transaccion(async cli => {
    for (const v of coches) {
      await cli.query(
        `INSERT INTO fv_vehiculo (uuid, matricula, flota_id, visto_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (uuid) DO UPDATE SET
           matricula = COALESCE(EXCLUDED.matricula, fv_vehiculo.matricula),
           flota_id = EXCLUDED.flota_id, visto_at = now()`,
        [v.uuid, v.matricula || null, v.flotaId]);
    }
    for (const c of gente) {
      await cli.query(
        `INSERT INTO fv_conductor (uuid, nombre, telefono, flota_id, visto_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (uuid) DO UPDATE SET
           nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), fv_conductor.nombre),
           telefono = COALESCE(NULLIF(EXCLUDED.telefono, ''), fv_conductor.telefono),
           visto_at = now()`,
        [c.uuid, c.nombre || null, c.telefono || null, c.flotaId]);
    }
  });

  ultimoPadron = Date.now();
  console.log(`👥 [FLOTA VIVA] Padrón: ${coches.length} de ${lista.size} vigilada(s) · ` +
              `${gente.length} conductor(es)`);
  return { coches: coches.length, vigiladas: lista.size, sinCoche };
}

/**
 * Una vuelta.
 *
 * Devuelve el recuento de lo que ha pasado, que es lo que se guarda en
 * `fv_vuelta` y lo que deja ver si esto sigue vivo o lleva horas fallando.
 */
async function pasada() {
  const t0 = Date.now();
  await db.preparar();

  const vuelta = (await db.consulta(
    'INSERT INTO fv_vuelta (arrancada_at) VALUES (now()) RETURNING id')).rows[0].id;

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

    console.log(`🚦 [FLOTA VIVA] ${coches.length} coche(s) · ${conectados} conectado(s) · ` +
                `${cambios} cambio(s) · ${ms} ms` +
                (rutas ? ` · ${rutas.trayectos} trayecto(s)` : ''));
    return { vehiculos: coches.length, conectados, cambios, ms, incidencias, rutas };
  } catch (e) {
    await db.consulta('UPDATE fv_vuelta SET terminada_at = now(), error = $2 WHERE id = $1',
      [vuelta, e.message]).catch(() => {});
    throw e;
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
