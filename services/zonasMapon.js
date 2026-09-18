// ============================================================
// ALERTAS DE GEOCERCA DE MAPON — la ingesta y el vocabulario
// ============================================================
// Mapon vigila zonas dibujadas en su mapa y dispara una alerta cuando un coche
// sale (`not_in_obj`) o cuando entra y sale (`in_object`). Aquí se traen, se
// guardan crudas y se les pone nombre; QUIÉN merece un WhatsApp por ellas lo
// decide `modules/Control/alertas.repo`, que es quien sabe de franjas y de
// destinatarios.
//
// ── LO QUE HAY QUE SABER ────────────────────────────────────────────────────
//
// · LAS DOS ZONAS NO SIGNIFICAN LO MISMO, y por eso están separadas:
//     - «Zona Notificación» es el área de trabajo normal. Salir de ahí SIN
//       viaje es raro; salir CON viaje es su trabajo. Sin esa distinción la
//       alerta suena cada vez que alguien lleva a un cliente a Alcalá.
//     - «Zona Madrid» es mucho más grande. De ahí no se sale ni con pasajero.
//
// · EL NOMBRE DE LA ZONA VIENE COMO VIENE. En la cuenta hay una que se llama
//   `"Zona Notificación "` — con un espacio al final— y Mapon manda ese texto
//   tal cual en `alert_val`. Se compara normalizado (sin tildes, sin espacios
//   de sobra, en minúsculas) porque el día que alguien renombre la zona desde
//   la app de Mapon, el aviso no puede dejar de sonar en silencio.
//
// · LA CLAVE ES EL `id` DE MAPON. Las alertas sí lo traen (hay que pedirlo con
//   `include[]=id`), y es mejor clave que unidad+hora+tipo: un coche puede
//   salirse de la zona tres veces en una tarde y son tres salidas, no una
//   repetida. Es lo que hace que la ingesta pueda pedir con solape sin miedo.
//
// · SE PIDE CON SOLAPE A PROPÓSITO. La ventana por defecto mira más atrás que
//   el hueco entre pasadas: las alertas de Mapon llegan con retraso, y una
//   pasada que solo mirara sus cinco minutos exactos se dejaría las que
//   aterrizaron tarde. Duplicar no cuesta nada —lo impide la clave primaria—;
//   perder una alerta sí.

const db = require('./db');
const mapon = require('./mapon');

// Los nombres, normalizados. Se pueden mover por entorno sin tocar código
// porque quien dibuja las zonas es Tráfico, en la app de Mapon, no nosotros.
const NOMBRE_NOTIFICACION = process.env.MAPON_ZONA_NOTIFICACION || 'Zona Notificación';
const NOMBRE_MADRID = process.env.MAPON_ZONA_MADRID || 'Zona Madrid';

/** Sin tildes, sin espacios de sobra y en minúsculas: así se comparan zonas. */
const normalizar = s => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().toLowerCase().replace(/\s+/g, ' ');

const ZONA_NOTIFICACION = normalizar(NOMBRE_NOTIFICACION);
const ZONA_MADRID = normalizar(NOMBRE_MADRID);

/**
 * Qué zona es esta alerta, con el vocabulario del ERP: 'notificacion',
 * 'madrid', o null si es cualquier otra geocerca de la cuenta (las de
 * diagnóstico, la cochera…), que se guardan pero no avisan a nadie.
 */
function claveDeZona(zona) {
  const z = normalizar(zona);
  if (z === ZONA_NOTIFICACION) return 'notificacion';
  if (z === ZONA_MADRID) return 'madrid';
  return null;
}

// ============================================================
// INGESTA
// ============================================================

/**
 * Trae las alertas de zona de los últimos `minutos` y las guarda.
 *
 * Devuelve cuántas ha visto y cuántas eran nuevas. No decide nada: guardar es
 * todo lo que hace.
 */
async function ingestar({ minutos = 60, ahora = new Date() } = {}) {
  const hasta = new Date(ahora);
  const desde = new Date(ahora.getTime() - minutos * 60000);

  const crudas = await mapon.leerAlertasCrudas({
    desde, hasta, tipos: ['not_in_obj', 'in_object'],
  });
  if (!crudas.length) return { vistas: 0, nuevas: 0 };

  let nuevas = 0;
  for (const a of crudas) {
    // Sin id no hay forma de no duplicarla, y meterla sin clave ensuciaría la
    // tabla para siempre. Se cuenta como vista y se deja pasar.
    if (!a.maponId) continue;
    const r = await db.consulta(
      `INSERT INTO mapon_zona_alerta
         (mapon_id, unit_id, matricula, tipo, zona, sentido, ocurrio_at, lat, lon, direccion, msg)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (mapon_id) DO NOTHING
       RETURNING mapon_id`,
      [a.maponId, a.unitId, a.matricula || null, a.tipo, a.zona, a.sentido || null,
       a.iso, a.lat, a.lon, a.direccion || null, (a.msg || '').slice(0, 300)]);
    if (r.rowCount) nuevas++;
  }
  return { vistas: crudas.length, nuevas };
}

// ============================================================
// LECTURA
// ============================================================

/**
 * Las salidas de zona de una ventana, ya con su clave de zona y con el coche
 * y el conductor que tenía el tramo en ese instante.
 *
 * EL CONDUCTOR SALE DEL TRAMO, no de la alerta: Mapon no sabe quién va dentro.
 * Y la SITUACIÓN de ese tramo es lo que distingue una salida normal de una
 * rara, porque `viaje` incluye ir a por el pasajero y llevarlo.
 *
 * Si no hay tramo abierto en ese instante, no hay conductor — y eso NO es un
 * fallo del cruce: es el caso que más preocupa, un coche que se sale de la zona
 * sin que nadie esté fichado con él.
 */
async function salidasEntre(desde, hasta) {
  const r = await db.consulta(
    `SELECT z.mapon_id, z.unit_id, z.tipo, z.zona, z.ocurrio_at, z.lat, z.lon, z.direccion,
            COALESCE(z.matricula, veh.matricula)            AS matricula,
            veh.uuid                                        AS vehiculo_uuid,
            -- ¿ES UNO DE LOS DEL CUADRANTE? El enlace entre flota viva y el
            -- núcleo es la MATRICULA (la tabla vehiculo no guarda la unidad de Mapon),
            -- y «estar en el planificador» es tener plaza y estar operativo:
            -- los 71 de la pantalla. Un coche de reserva o en taller da FALSE, y
            -- eso no es un fallo: esos van al control de coches libres.
            (v.id IS NOT NULL AND cev.es_operativo
             AND EXISTS (SELECT 1 FROM plaza pl
                          WHERE pl.vehiculo_id = v.id AND pl.baja_at IS NULL)) AS planificado,
            v.estado_operativo                              AS estado_veh,
            t.conductor_uuid,
            t.situacion,
            COALESCE(NULLIF(btrim(fc.nombre), ''),
                     NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS nombre_bolt,
            ce.conductor_id,
            tel.e164                                        AS telefono
       FROM mapon_zona_alerta z
       LEFT JOIN fv_vehiculo veh ON veh.mapon_unit = z.unit_id
       LEFT JOIN vehiculo v ON v.matricula = veh.matricula AND v.baja_at IS NULL
       LEFT JOIN cat_estado_vehiculo cev ON cev.codigo = v.estado_operativo
       -- El tramo VIVO en el instante de la alerta. Uno solo: el más reciente
       -- que la envuelve.
       LEFT JOIN LATERAL (
         SELECT tr.conductor_uuid, tr.situacion
           FROM fv_tramo tr
          WHERE tr.vehiculo_uuid = veh.uuid
            AND tr.desde <= z.ocurrio_at
            AND (tr.hasta IS NULL OR tr.hasta > z.ocurrio_at)
          ORDER BY tr.desde DESC LIMIT 1) t ON TRUE
       LEFT JOIN fv_conductor fc ON fc.uuid = t.conductor_uuid
       LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.conductor_uuid
                                     AND ce.conductor_id IS NOT NULL
       LEFT JOIN conductor c ON c.id = ce.conductor_id
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = ce.conductor_id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
      WHERE z.tipo = 'not_in_obj'
        AND z.ocurrio_at >= $1 AND z.ocurrio_at < $2
      ORDER BY z.ocurrio_at`,
    [desde, hasta]);

  return r.rows.map(x => ({
    maponId: Number(x.mapon_id),
    unitId: Number(x.unit_id),
    matricula: x.matricula || `#${x.unit_id}`,
    vehiculoUuid: x.vehiculo_uuid || null,
    planificado: !!x.planificado,
    estadoVeh: x.estado_veh || '',
    zona: x.zona,
    claveZona: claveDeZona(x.zona),
    ocurrioAt: x.ocurrio_at,
    lat: x.lat == null ? null : Number(x.lat),
    lon: x.lon == null ? null : Number(x.lon),
    direccion: x.direccion || '',
    conductorUuid: x.conductor_uuid || null,
    conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    nombreBolt: x.nombre_bolt || '',
    telefono: x.telefono || '',
    situacion: x.situacion || null,
    // LA REGLA que lo cambia todo en «Zona Notificación»: ir a por el pasajero
    // y llevarlo son la misma situación en flota viva, y las dos son trabajo.
    enViaje: x.situacion === 'viaje',
  }));
}

module.exports = {
  NOMBRE_NOTIFICACION, NOMBRE_MADRID,
  normalizar, claveDeZona, ingestar, salidasEntre,
};
