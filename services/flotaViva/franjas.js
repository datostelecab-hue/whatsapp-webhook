// ============================================================
// FLOTA VIVA — las franjas críticas y lo que hay que llamar
// ============================================================
// Hay dos tramos del día en que un coche DEBERÍA estar trabajando: 06:30–15:30 y
// 18:30–03:30. Entre medias hay relevo y no se vigila nada — eso se mira a mano.
//
// Dentro de su franja, cuatro cosas obligan a llamar al conductor:
//
//   · se desconecta habiendo trabajado      ← el caso claro
//   · rueda estando desconectado            ← km sin plataforma
//   · lleva demasiado en descanso           ← comer sí, dos horas no
//   · no ha aparecido en toda la franja     ← suele trabajar y hoy no está
//
// LA CUARTA ES LA DELICADA, y por eso no mira solo si el coche está apagado:
// entonces avisaría de todos los coches de repuesto aparcados en la base, todos
// los días. Solo cuenta si ESE coche suele trabajar a esas horas — y eso se sabe
// mirando lo que el propio módulo lleva acumulado.
//
// Las horas viven en `fv_franja`, en la base. Cambiar un turno es un UPDATE.

const db = require('./db');

const ZONA = 'Europe/Madrid';

// Minutos seguidos en descanso a partir de los cuales hay que preguntar.
const MAX_DESCANSO_MIN = Number(process.env.FLOTA_VIVA_MAX_DESCANSO_MIN) || 45;
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
    if (!f.activa) continue;
    const cruza = f.fin_min < f.inicio_min;
    if (!cruza) {
      if (minutos >= f.inicio_min && minutos < f.fin_min) {
        return { franja: f, diaOperativo: fecha, desdeInicio: minutos - f.inicio_min };
      }
      continue;
    }
    // Cruza medianoche: o es de hoy después del inicio, o de ayer antes del fin.
    if (minutos >= f.inicio_min) {
      return { franja: f, diaOperativo: fecha, desdeInicio: minutos - f.inicio_min };
    }
    if (minutos < f.fin_min) {
      return {
        franja: f, diaOperativo: vispera(fecha),
        desdeInicio: minutos + (1440 - f.inicio_min),
      };
    }
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
       veces = fv_incidencia.veces + 1,
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
  const r = await db.consulta(
    `SELECT i.vehiculo_uuid
       FROM (
         SELECT DISTINCT t.vehiculo_uuid, x.dia_operativo
           FROM fv_tramo t
           JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
           CROSS JOIN LATERAL (SELECT (t.desde AT TIME ZONE 'Europe/Madrid')::date AS dia_operativo) x
          WHERE t.desde >= (($2::date - $3::int) || ' 00:00')::timestamp AT TIME ZONE 'Europe/Madrid'
            AND t.desde < ($2::date || ' 23:59')::timestamp AT TIME ZONE 'Europe/Madrid'
            AND EXTRACT(HOUR FROM (t.desde AT TIME ZONE 'Europe/Madrid')) * 60
              + EXTRACT(MINUTE FROM (t.desde AT TIME ZONE 'Europe/Madrid'))
              BETWEEN $4::int AND $5::int
       ) i
      GROUP BY i.vehiculo_uuid
     HAVING count(*) >= $6::int`,
    [franja.codigo, diaOperativo, DIAS_HABITO,
     franja.inicio_min, franja.fin_min < franja.inicio_min ? 1439 : franja.fin_min,
     VECES_HABITO]);
  return new Set(r.rows.map(x => x.vehiculo_uuid));
}

/** Los coches que YA han estado conectados en esta franja, hoy. */
async function yaTrabajaronHoy(franja, diaOperativo) {
  // El arranque de la franja en hora local, y su fin —que puede caer al día
  // siguiente si cruza medianoche.
  const cruza = franja.fin_min < franja.inicio_min;
  const r = await db.consulta(
    `SELECT DISTINCT t.vehiculo_uuid
       FROM fv_tramo t
       JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.conectado
      WHERE COALESCE(t.hasta, now()) >= (($1::date + ($2::int || ' minutes')::interval)
              AT TIME ZONE 'Europe/Madrid')
        AND t.desde <= (($1::date + $3::int + ($4::int || ' minutes')::interval)
              AT TIME ZONE 'Europe/Madrid')`,
    [diaOperativo, franja.inicio_min, cruza ? 1 : 0, franja.fin_min]);
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
  if (!ahora) return { franja: null, motivo: 'relevo', abiertas: 0, nuevas: 0 };

  const { franja, diaOperativo, desdeInicio } = ahora;
  const [estado, trabajaron] = await Promise.all([
    db.consulta('SELECT * FROM fv_ahora'),
    yaTrabajaronHoy(franja, diaOperativo),
  ]);

  // La ausencia solo es noticia pasada la gracia: nadie ficha a las 06:30
  // clavadas. Y solo de quien suele trabajar a estas horas.
  const habitual = desdeInicio >= GRACIA_MIN
    ? await habituales(franja, diaOperativo)
    : new Set();

  let nuevas = 0, abiertas = 0;
  const clave = { franja: franja.codigo, diaOperativo };

  for (const c of estado.rows) {
    if (!c.vehiculo_uuid) continue;
    const uuid = c.vehiculo_uuid;
    const min = Math.floor(Number(c.segundos || 0) / 60);
    const km = c.km == null ? 0 : Number(c.km);
    const comun = { vehiculoUuid: uuid, conductorUuid: c.conductor_uuid, ...clave };
    const apunta = async (tipo, detalle) => {
      const r = await abrir({ ...comun, tipo, detalle });
      if (r && r.nueva) nuevas++;
      abiertas++;
    };

    if (c.situacion === 'desconectado') {
      if (trabajaron.has(uuid)) {
        await apunta('desconectado',
          `Se desconectó hace ${min} min` + (km ? ` y lleva ${km} km así` : ''));
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
      continue;
    }

    // Está conectado: lo que hubiera de estar caído deja de pasar.
    await resolver(uuid, 'desconectado', franja.codigo, diaOperativo);
    await resolver(uuid, 'no_aparece', franja.codigo, diaOperativo);
    await resolver(uuid, 'rueda_caido', franja.codigo, diaOperativo);

    if (c.situacion === 'descanso' && min >= MAX_DESCANSO_MIN) {
      await apunta('descanso', `${min} min seguidos en descanso` + (km ? ` · ${km} km` : ''));
    } else {
      await resolver(uuid, 'descanso', franja.codigo, diaOperativo);
    }
  }

  if (nuevas) {
    console.log(`🔔 [FLOTA VIVA] ${nuevas} incidencia(s) nueva(s) en la franja de ${franja.codigo}`);
  }
  return { franja: franja.codigo, diaOperativo, abiertas, nuevas, desdeInicio };
}

module.exports = {
  franjas, franjaDe, localDe, vispera, abrir, resolver, habituales,
  yaTrabajaronHoy, revisar,
  MAX_DESCANSO_MIN, GRACIA_MIN, DIAS_HABITO, VECES_HABITO,
};
