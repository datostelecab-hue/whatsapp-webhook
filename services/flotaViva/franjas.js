// ============================================================
// FLOTA VIVA — las franjas críticas y lo que hay que llamar
// ============================================================
// Hay dos tramos del día en que un coche DEBERÍA estar trabajando: 06:30–15:30 y
// 18:30–03:30. Entre medias hay relevo y no se vigila nada — eso se mira a mano.
//
// Dentro de su franja, cinco cosas obligan a llamar al conductor:
//
//   · se desconecta habiendo trabajado      ← el caso claro
//   · rueda estando desconectado            ← km sin plataforma
//   · lleva demasiado en descanso           ← comer sí, dos horas no
//   · rueda estando en descanso             ← km con la plataforma de adorno
//   · no ha aparecido en toda la franja     ← suele trabajar y hoy no está
//
// EL TIEMPO Y LOS KILÓMETROS SON DOS AUDITORÍAS, no una. Las dos del medio
// miran el mismo estado y saltan por separado: veinte minutos en descanso no es
// noticia, pero veinte minutos y dieciocho kilómetros sí.
//
// LA ÚLTIMA ES LA DELICADA, y por eso no mira solo si el coche está apagado:
// entonces avisaría de todos los coches de repuesto aparcados en la base, todos
// los días. Solo cuenta si ESE coche suele trabajar a esas horas — y eso se sabe
// mirando lo que el propio módulo lleva acumulado.
//
// Las horas viven en `fv_franja`, en la base. Cambiar un turno es un UPDATE.

const db = require('./db');
const { duracion } = require('./formato');

const ZONA = 'Europe/Madrid';

// Minutos en descanso a partir de los cuales sale en la lista. CERO: salen todos
// desde que se ponen.
//
// Estaba en 45 y el caso que mas importa se colaba por debajo — veinte minutos
// en descanso con dieciocho kilometros hechos no llegaba a la lista nunca. Ahora
// salen todos y se despachan con los dos botones, llamando o ignorando; el
// detalle dice cuanto lleva cada uno. Subirlo vuelve al comportamiento de antes.
const MAX_DESCANSO_MIN = Number(process.env.FLOTA_VIVA_MAX_DESCANSO_MIN) || 0;
// Y los km. Descansar no es estar quieto: ir a comer son dos o tres kilómetros y
// eso no es noticia. Veinte, sí. Se vigilan las dos cosas por separado porque un
// coche puede pasarse en una sin pasarse en la otra — y de hecho es lo normal.
const MAX_KM_DESCANSO = Number(process.env.FLOTA_VIVA_MAX_KM_DESCANSO) || 5;
// Margen desde que arranca la franja antes de reclamar a quien no ha aparecido.
// Nadie ficha a las 06:30 clavadas.
const GRACIA_MIN = Number(process.env.FLOTA_VIVA_GRACIA_MIN) || 60;
// En cuántos de los últimos días tiene que haber trabajado en esa franja para
// que su ausencia sea noticia.
const DIAS_HABITO = Number(process.env.FLOTA_VIVA_DIAS_HABITO) || 14;
const VECES_HABITO = Number(process.env.FLOTA_VIVA_VECES_HABITO) || 3;

/** La hora local de un instante, en minutos desde medianoche, y su fecha. */
function localDe(cuando) {
  const p = new Intl.DateTimeFormat('es-ES', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(cuando).reduce((o, x) => (o[x.type] = x.value, o), {});
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** El día anterior a una fecha 'AAAA-MM-DD'. */
function vispera(fecha) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Si la franja termina al día siguiente. La de noche lo hace; la de día no.
 *
 * Está en una función y no escrito a mano en cada consulta porque la pregunta
 * sale en tres sitios —en qué franja estamos, quién suele trabajarla, quién ya
 * la ha trabajado— y basta con que uno de los tres se despiste para que la
 * madrugada desaparezca sin avisar. Ya pasó.
 */
const cruzaMedianoche = franja => franja.fin_min < franja.inicio_min;

/** Si una hora del día —en minutos desde medianoche— cae dentro de la franja. */
const dentroDeFranja = (franja, minutos) => cruzaMedianoche(franja)
  ? (minutos >= franja.inicio_min || minutos < franja.fin_min)
  : (minutos >= franja.inicio_min && minutos < franja.fin_min);

/**
 * En qué franja cae un instante, y a qué día pertenece esa franja.
 *
 * Devuelve null en el relevo, que es lo que hace que no se avise entre las 15:30
 * y las 18:30 ni entre las 03:30 y las 06:30.
 *
 * El día operativo importa: la franja de noche del 25 termina el 26 a las 03:30
 * y sigue siendo la del 25. Sin eso, las incidencias de después de medianoche se
 * apuntarían en el parte del día siguiente.
 */
function franjaDe(franjas, cuando = new Date()) {
  const { fecha, minutos } = localDe(cuando);
  for (const f of franjas) {
    if (!f.activa || !dentroDeFranja(f, minutos)) continue;
    if (!cruzaMedianoche(f)) {
      return { franja: f, diaOperativo: fecha, desdeInicio: minutos - f.inicio_min };
    }
    // Cruza medianoche: o es de hoy después del inicio, o de ayer antes del fin.
    // Y de ahí que el día operativo no sea el del reloj: a la una de la mañana
    // seguimos en la franja de ayer.
    return minutos >= f.inicio_min
      ? { franja: f, diaOperativo: fecha, desdeInicio: minutos - f.inicio_min }
      : { franja: f, diaOperativo: vispera(fecha), desdeInicio: minutos + (1440 - f.inicio_min) };
  }
  return null;
}

const franjas = async () =>
  (await db.consulta('SELECT * FROM fv_franja WHERE activa ORDER BY orden')).rows;

/**
 * Abre o refresca una incidencia.
 *
 * Una por coche, franja y día. Si el mismo coche se cae tres veces en la misma
 * franja no son tres llamadas: es una conversación, y se cuentan las veces.
 *
 * Y una vez justificada NO se reabre sola: si Tráfico ya llamó y anotó el
 * motivo, volver a ponerla en rojo cada cinco minutos convierte el panel en algo
 * que se ignora.
 */
async function abrir({ vehiculoUuid, tipo, franja, diaOperativo, conductorUuid, detalle }) {
  const r = await db.consulta(
    `INSERT INTO fv_incidencia
       (vehiculo_uuid, tipo, franja, dia_operativo, conductor_uuid, detalle)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (vehiculo_uuid, tipo, franja, dia_operativo) DO UPDATE SET
       -- El contador cuenta las veces que PASO, no las veces que hemos mirado.
       --
       -- Antes subia en cada vuelta del cron, asi que un coche cuarenta minutos
       -- desconectado salia como "x8" — que son las ocho veces que le echamos un
       -- ojo, no ocho desconexiones. Solo sube si la incidencia estaba resuelta
       -- y ha vuelto: eso si es otra vez.
       veces = fv_incidencia.veces
             + CASE WHEN fv_incidencia.resuelta_at IS NOT NULL THEN 1 ELSE 0 END,
       resuelta_at = NULL,
       detalle = COALESCE(EXCLUDED.detalle, fv_incidencia.detalle),
       conductor_uuid = COALESCE(EXCLUDED.conductor_uuid, fv_incidencia.conductor_uuid)
     RETURNING id, (xmax = 0) AS nueva`,
    [vehiculoUuid, tipo, franja, diaOperativo, conductorUuid || null, detalle || null]);
  return r.rows[0];
}

/** Deja de estar pasando. No se borra: el parte del cierre la necesita. */
async function resolver(vehiculoUuid, tipo, franja, diaOperativo) {
  await db.consulta(
    `UPDATE fv_incidencia SET resuelta_at = now()
      WHERE vehiculo_uuid = $1 AND tipo = $2 AND franja = $3 AND dia_operativo = $4
        AND resuelta_at IS NULL`,
    [vehiculoUuid, tipo, franja, diaOperativo]);
}

/**
 * Los coches que SUELEN trabajar en esta franja.
 *
 * Sale de lo que el módulo lleva visto: un coche que ha estado conectado en esa
 * franja al menos `VECES_HABITO` de los últimos `DIAS_HABITO` días. Sin esto, la
 * incidencia de "no ha aparecido" saltaría en cada coche de repuesto aparcado.
 */
async function habituales(franja, diaOperativo) {
  // LA FRANJA DE NOCHE CRUZA MEDIANOCHE, y aquí eso importa.
  //
  // El filtro es por hora del día, así que para la de noche —de 18:30 a 04:00—
  // no vale un "entre X e Y": hay que aceptar lo de después de las 18:30 O lo de
  // antes de las 04:00. Antes se estiraba el final hasta las 23:59, y eso dejaba
  // fuera toda la madrugada: un coche que solo se conecta a las 22:00 contaba,
  // pero uno que empieza a la una de la mañana no contaba nunca. Su ausencia no
  // se reclamaba jamás.
  const dentro = cruzaMedianoche(franja)
    ? '(minuto >= $3::int OR minuto < $4::int)'
    : '(minuto >= $3::int AND minuto < $4::int)';

  const r = await db.consulta(
    `WITH v AS (
       SELECT DISTINCT t.vehiculo_uuid,
              (t.desde AT TIME ZONE 'Europe/Madrid')::date AS dia
         FROM fv_tramo t
         JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
         CROSS JOIN LATERAL (
           SELECT EXTRACT(HOUR   FROM (t.desde AT TIME ZONE 'Europe/Madrid')) * 60
                + EXTRACT(MINUTE FROM (t.desde AT TIME ZONE 'Europe/Madrid')) AS minuto) m
        WHERE t.desde >= (($1::date - $2::int) || ' 00:00')::timestamp AT TIME ZONE 'Europe/Madrid'
          AND ${dentro}
     )
     SELECT vehiculo_uuid FROM v
      GROUP BY vehiculo_uuid
     HAVING count(*) >= $5::int`,
    [diaOperativo, DIAS_HABITO, franja.inicio_min, franja.fin_min, VECES_HABITO]);
  return new Set(r.rows.map(x => x.vehiculo_uuid));
}

/**
 * Cierra las incidencias de cualquier franja que no sea la de ahora.
 *
 * Es lo que convierte "esto sigue pasando" en "esto pasó": una incidencia de la
 * franja de día no puede seguir abierta a las nueve de la noche. Se cierran
 * TODAS las de otras franjas o de otros días, y las que nadie justificó salen en
 * el parte como sin revisar.
 *
 * En el relevo se cierran todas, porque ahí no se vigila nada.
 */
async function cerrarFranjasPasadas(ahora) {
  const r = ahora
    ? await db.consulta(
      `UPDATE fv_incidencia SET resuelta_at = now()
        WHERE resuelta_at IS NULL
          AND NOT (franja = $1 AND dia_operativo = $2)`,
      [ahora.franja.codigo, ahora.diaOperativo])
    : await db.consulta('UPDATE fv_incidencia SET resuelta_at = now() WHERE resuelta_at IS NULL');

  if (r.rowCount) {
    console.log(`📋 [FLOTA VIVA] ${r.rowCount} incidencia(s) cerradas al acabar su franja`);
  }
  return r.rowCount;
}

/**
 * Marca dónde estaba cada coche al abrirse la franja.
 *
 * A partir de aquí se cuenta. Un coche que llega a las 06:30 con cuatro horas
 * desconectado y treinta kilómetros encima no es noticia de esta franja: esos
 * kilómetros son de la madrugada, del horario de transición que se mira a mano.
 *
 * Solo se apunta la primera vez —`DO NOTHING`—, así que da igual cuántas vueltas
 * dé el cron: el corte es el de la primera.
 *
 * Y SOLO SE APUNTA DE LOS TRAMOS QUE YA ESTABAN ABIERTOS AL EMPEZAR LA FRANJA.
 *
 * Esto es lo que hace que el corte no pueda mentir. Un tramo que arranca a las
 * 09:21 tiene todos sus kilómetros dentro de la franja por definición: no hay
 * nada que descontarle, nunca. Sin esa condición, cualquier corte tomado tarde
 * —el primer arranque tras un despliegue, un borrado a mano a media mañana—
 * cogía como base los km que ese tramo ya llevaba y los escondía para siempre.
 * Pasó: un descanso con 19,5 km salió avisando de 1,4 porque el corte se tomó
 * cuando ya llevaba 18,1.
 */
async function tomarCorte(franja, diaOperativo) {
  const r = await db.consulta(
    `INSERT INTO fv_corte (vehiculo_uuid, franja, dia_operativo, tramo_id, km_m)
     SELECT a.vehiculo_uuid, $1::varchar, $2::date, a.tramo_id, a.km_m
       FROM fv_ahora a
       CROSS JOIN (SELECT ($2::date + ($3::int || ' minutes')::interval)
                            AT TIME ZONE 'Europe/Madrid' AS inicio) f
      WHERE a.tramo_id IS NOT NULL
        AND a.desde < f.inicio
     ON CONFLICT (vehiculo_uuid, franja, dia_operativo) DO NOTHING`,
    [franja.codigo, diaOperativo, franja.inicio_min]);
  return r.rowCount;
}

/**
 * Cómo está cada coche AHORA, pero contado desde que abrió la franja.
 *
 * Es `fv_ahora` con tres columnas más, y son las que mandan en las alertas:
 *
 *   · `segundos_franja` — lo que lleva así SIN contar lo de antes de la franja
 *   · `km_franja`       — los kilómetros que ha sumado desde el corte
 *   · `venia_de_antes`  — si el tramo ya estaba abierto al empezar
 *
 * El panel en vivo sigue leyendo `fv_ahora` a pelo, con los totales de verdad:
 * ahí lo que se quiere saber es cuánto lleva un coche sin conexión, venga de
 * donde venga. Son dos preguntas distintas y no comparten respuesta.
 */
async function estadoDeFranja(franja, diaOperativo) {
  const r = await db.consulta(
    `SELECT a.*,
            EXTRACT(EPOCH FROM (now() - GREATEST(a.desde, f.inicio)))::bigint AS segundos_franja,
            round(GREATEST(a.km_m - COALESCE(c.km_m, 0), 0) / 1000.0, 1)      AS km_franja,
            (a.desde < f.inicio)                                              AS venia_de_antes
       FROM fv_ahora a
       CROSS JOIN (SELECT ($2::date + ($3::int || ' minutes')::interval)
                            AT TIME ZONE 'Europe/Madrid' AS inicio) f
       -- Si el tramo cambió dentro de la franja, el corte deja de casar y el
       -- nuevo cuenta entero: empezó dentro, luego es todo suyo.
       LEFT JOIN fv_corte c ON c.vehiculo_uuid = a.vehiculo_uuid
                           AND c.franja = $1 AND c.dia_operativo = $2::date
                           AND c.tramo_id = a.tramo_id`,
    [franja.codigo, diaOperativo, franja.inicio_min]);
  return r.rows;
}

/** Los coches que YA han estado conectados en esta franja, hoy. */
async function yaTrabajaronHoy(franja, diaOperativo) {
  // El arranque de la franja en hora local, y su fin —que puede caer al día
  // siguiente si cruza medianoche.
  const r = await db.consulta(
    `SELECT DISTINCT t.vehiculo_uuid
       FROM fv_tramo t
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
      WHERE COALESCE(t.hasta, now()) >= (($1::date + ($2::int || ' minutes')::interval)
              AT TIME ZONE 'Europe/Madrid')
        AND t.desde <= (($1::date + $3::int + ($4::int || ' minutes')::interval)
              AT TIME ZONE 'Europe/Madrid')`,
    [diaOperativo, franja.inicio_min, cruzaMedianoche(franja) ? 1 : 0, franja.fin_min]);
  return new Set(r.rows.map(x => x.vehiculo_uuid));
}

/**
 * Mira qué está pasando ahora y abre o cierra incidencias.
 *
 * Fuera de franja no hace nada: en el relevo no se avisa, se mira a mano.
 *
 * Las incidencias se RESUELVEN solas cuando dejan de pasar, pero no se borran —
 * el parte del cierre necesita saber que ocurrieron, y si alguien ya llamó, esa
 * justificación tiene que sobrevivir.
 */
async function revisar() {
  const lista = await franjas();
  const ahora = franjaDe(lista, new Date());

  // AL SALIR DE UNA FRANJA SE CIERRA LO QUE QUEDARA ABIERTO.
  //
  // Sin esto, una incidencia que salta a las 15:25 —cinco minutos antes de que
  // acabe el turno de día— se quedaba en rojo para siempre: durante el relevo la
  // revisión no corre, así que nadie la resolvía, y seguía pidiendo llamada toda
  // la tarde y dentro del turno de noche.
  //
  // Cerrarla no es darla por buena: si nadie la justificó, sale como "sin
  // revisar" en el parte, que es donde tiene que verse.
  const cerradas = await cerrarFranjasPasadas(ahora);

  if (!ahora) return { franja: null, motivo: 'relevo', abiertas: 0, nuevas: 0, cerradas };

  const { franja, diaOperativo, desdeInicio } = ahora;

  // EL CORTE VA ANTES DE MIRAR, siempre. Es lo que hace que a las 06:30 el
  // contador de todos empiece en cero en vez de heredar la madrugada.
  await tomarCorte(franja, diaOperativo);

  const [estado, trabajaron, activos] = await Promise.all([
    estadoDeFranja(franja, diaOperativo),
    yaTrabajaronHoy(franja, diaOperativo),
    // QUE AVISOS ESTAN ENCENDIDOS LO DICE LA BASE.
    //
    // `fv_cat_incidencia.activa` existia y no lo miraba nadie. Ahora apagar un
    // tipo entero es un UPDATE: util cuando se ensancha una franja y uno de los
    // avisos —el de "no ha aparecido", sobre todo— pasa a saltar en media flota
    // por un cambio de horario y no por un problema.
    db.consulta('SELECT codigo FROM fv_cat_incidencia WHERE activa')
      .then(r => new Set(r.rows.map(x => x.codigo))),
  ]);

  // La ausencia solo es noticia pasada la gracia: nadie ficha a las 06:30
  // clavadas. Y solo de quien suele trabajar a estas horas.
  const habitual = desdeInicio >= GRACIA_MIN
    ? await habituales(franja, diaOperativo)
    : new Set();

  let nuevas = 0, abiertas = 0;
  const clave = { franja: franja.codigo, diaOperativo };

  for (const c of estado) {
    if (!c.vehiculo_uuid) continue;
    const uuid = c.vehiculo_uuid;
    // `min` y `km` son SIEMPRE los de dentro de la franja: son los que deciden
    // si hay que llamar. `segTotal` es lo que lleva de verdad, y solo se usa
    // para escribirlo, nunca para disparar nada.
    const min = Math.floor(Number(c.segundos_franja || 0) / 60);
    const km = c.km_franja == null ? 0 : Number(c.km_franja);
    const segTotal = Number(c.segundos || 0);
    const comun = { vehiculoUuid: uuid, conductorUuid: c.conductor_uuid, ...clave };
    const apunta = async (tipo, detalle) => {
      // Apagado: ni se abre ni se deja abierto lo que hubiera de antes.
      if (!activos.has(tipo)) return resolver(uuid, tipo, franja.codigo, diaOperativo);
      const r = await abrir({ ...comun, tipo, detalle });
      if (r && r.nueva) nuevas++;
      abiertas++;
    };

    if (c.situacion === 'desconectado') {
      if (trabajaron.has(uuid)) {
        // Aquí `venia_de_antes` no puede ser cierto: para llegar a esta rama el
        // coche tuvo que estar conectado dentro de la franja, así que la caída
        // es de la franja. La hora que se escribe es la de verdad.
        await apunta('desconectado',
          `Se desconectó hace ${duracion(segTotal)}` + (km ? ` y lleva ${km} km así` : ''));
      } else if (habitual.has(uuid)) {
        await apunta('no_aparece',
          `Sin conectarse en lo que va de franja (${Math.floor(desdeInicio / 60)} h)`);
      } else {
        await resolver(uuid, 'desconectado', franja.codigo, diaOperativo);
      }
      // Rodar apagado es aparte: puede pasarle al que se acaba de caer y al que
      // no ha aparecido, y es más grave que las dos cosas.
      if (km > 0) await apunta('rueda_caido', `${km} km estando desconectado`);
      else await resolver(uuid, 'rueda_caido', franja.codigo, diaOperativo);
      // Ya no está descansando: está apagado, que es otra cosa y peor.
      await resolver(uuid, 'descanso', franja.codigo, diaOperativo);
      await resolver(uuid, 'rueda_descanso', franja.codigo, diaOperativo);
      continue;
    }

    // Está conectado: lo que hubiera de estar caído deja de pasar.
    await resolver(uuid, 'desconectado', franja.codigo, diaOperativo);
    await resolver(uuid, 'no_aparece', franja.codigo, diaOperativo);
    await resolver(uuid, 'rueda_caido', franja.codigo, diaOperativo);

    if (c.situacion !== 'descanso') {
      await resolver(uuid, 'descanso', franja.codigo, diaOperativo);
      await resolver(uuid, 'rueda_descanso', franja.codigo, diaOperativo);
      continue;
    }

    // DESCANSAR SE MIDE EN DOS EJES, Y NO SON EL MISMO AVISO.
    //
    // Por tiempo: lleva demasiado rato sin coger nada. Por kilómetros: dice que
    // descansa y está rodando. Un coche puede pasarse en uno sin pasarse en el
    // otro, y de hecho el caso que importa es justo ese — veinte minutos en
    // descanso y dieciocho kilómetros hechos. Con un solo aviso por tiempo, ese
    // coche no salía en ninguna lista.
    if (min >= MAX_DESCANSO_MIN) {
      // El detalle lleva SIEMPRE el rato, porque ahora salen todos desde el
      // minuto cero y es lo único que distingue de un vistazo al que acaba de
      // parar del que lleva hora y media.
      //
      // Si venía descansando de antes de la franja, los minutos que cuentan son
      // los de dentro —por eso no salta a las 06:30 quien lleva parado desde las
      // cinco— pero al que llame le hace falta saber el rato de verdad.
      await apunta('descanso',
        (c.venia_de_antes
          ? `${duracion(min * 60)} en descanso dentro de la franja · encadena ${duracion(segTotal)}`
          : `${duracion(min * 60)} en descanso`)
        + (km ? ` · ${km} km` : ''));
    } else {
      await resolver(uuid, 'descanso', franja.codigo, diaOperativo);
    }

    if (km >= MAX_KM_DESCANSO) {
      await apunta('rueda_descanso', `${km} km rodando en descanso · lleva ${min} min así`);
    } else {
      await resolver(uuid, 'rueda_descanso', franja.codigo, diaOperativo);
    }
  }

  if (nuevas) {
    console.log(`🔔 [FLOTA VIVA] ${nuevas} incidencia(s) nueva(s) en la franja de ${franja.codigo}`);
  }
  return { franja: franja.codigo, diaOperativo, abiertas, nuevas, desdeInicio };
}

module.exports = {
  franjas, franjaDe, cruzaMedianoche, dentroDeFranja, localDe, vispera, abrir, resolver, habituales, cerrarFranjasPasadas,
  yaTrabajaronHoy, tomarCorte, estadoDeFranja, revisar,
  MAX_DESCANSO_MIN, MAX_KM_DESCANSO, GRACIA_MIN, DIAS_HABITO, VECES_HABITO,
};
