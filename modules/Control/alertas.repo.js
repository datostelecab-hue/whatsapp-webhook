// ============================================================
// ALERTAS DE CONTROL — avisar por WhatsApp de quien se pasa de la raya
// ============================================================
// Dos franjas de vigilancia al día (08:00-13:00 y 20:00-01:00) y tres cosas que
// obligan a llamar a un conductor:
//
//   · sin_respuesta    deja pasar ofertas sin contestar        (5 por defecto)
//   · rechazo_directo  las rechaza él, con el dedo             (5 por defecto)
//   · km_parado        rueda estando en descanso o desconectado (20 km)
//
// LA REGLA: **un mensaje por alerta**. El mismo conductor puede levantar las
// tres en la misma franja —son tres avisos distintos— pero cada una suena UNA
// vez: que siga rechazando después del aviso no vuelve a molestar a nadie. Eso
// NO se resuelve aquí con un `if`, se resuelve con el índice único de db/97:
// aunque dos revisiones se crucen, la base solo deja entrar la primera, y solo
// se manda WhatsApp por la fila que de verdad se insertó.
//
// LOS KM SE PRORRATEAN POR TIEMPO. Un tramo de descanso que empezó antes de que
// abriera la franja trae kilómetros de antes, y cargarlos enteros sería acusar
// a alguien de lo que hizo a otra hora. Se cuenta la parte del tramo que cae
// dentro. Los tramos que nacen y mueren dentro de la franja —la mayoría— van
// enteros y son exactos.
//
// LAS HORAS que se enseñan son las EFECTIVAS (viaje + espera) de su JORNADA
// OPERATIVA (05:00 → ahora), no las de la franja: quien recibe el aviso quiere
// saber si el tío lleva dos horas o diez, no cuánto lleva desde las ocho.

const db = require('../../services/db');
const zonasMapon = require('../../services/zonasMapon');
// El corte de los tramos, tal cual lo usa Control. NO se copia aqui: si la
// alerta repartiera los km con una regla y la pantalla con otra, se llamaria a
// la gente con un numero que no sale por ningun lado.
const { FIN_KM, TOPE_TRAMO_ABIERTO } = require('../../services/flotaViva/rutas');
const whatsapp = require('../../services/whatsapp');

// ── EL MODELO: todo lo que se puede discutir, en un sitio ───────────────────
const MODELO = {
  version: '1.0',
  // Las franjas, en hora de Madrid. `fin` menor que `ini` = cruza medianoche.
  franjas: [
    { codigo: 'manana', etiqueta: 'Mañana', ini: 8, fin: 13 },
    { codigo: 'noche', etiqueta: 'Noche', ini: 20, fin: 1 },
  ],
  // Minutos de cortesía DESPUÉS de cerrar la franja. Las órdenes de BOLT llegan
  // con algo de retraso, y sin este margen lo que cruzó el umbral a las 12:58
  // no se llegaba a avisar nunca.
  graciaMin: 10,
  tipos: {
    // NO RESPONDER NO ES RECHAZAR. Puede ser cobertura, el móvil colgado o el
    // soporte del salpicadero. Por eso aguanta hasta cinco y por eso NO baja la
    // calificación del conductor (el modelo ABCD no cuenta rechazos, §15): lo
    // que dispara es una comprobación —"¿qué le pasa, necesita algo?"—, no un
    // expediente.
    sin_respuesta: {
      etiqueta: 'Viajes perdidos por NO RESPONDER', corto: 'no responde',
      umbral: 5, unidad: 'viajes', activo: true, ventana: 'franja',
    },
    // AL PRIMERO. Aquí no se rechaza ningún viaje, de ningún tipo: rechazar uno
    // ya es motivo de llamada. Si resulta que iba lejísimos, se justifica por
    // teléfono — pero se pregunta. Por eso el umbral es 1 y no un "a partir de".
    //
    // Y va SEPARADO de `sin_respuesta` a propósito: no responder puede ser
    // cobertura o un móvil que se cuelga, y eso se atiende ayudando al
    // conductor, no sancionándole.
    // Y en TODA LA JORNADA, no solo en la franja: rechazar no está permitido a
    // ninguna hora, así que uno hecho a las 15:30 —entre franja y franja— tiene
    // que sonar igual en cuanto abra la siguiente.
    rechazo_directo: {
      etiqueta: 'Viajes RECHAZADOS por el conductor', corto: 'rechaza',
      umbral: 1, unidad: 'viajes', activo: true, ventana: 'jornada',
      // PERO SOLO SI NO ESTÁ DANDO SERVICIO.
      //
      // Rechazar sigue sin estar permitido, pero un rechazo no significa lo
      // mismo en los dos casos: quien va al 90 % de utilización está cargado de
      // trabajo y rechazó uno que le venía mal; quien va al 60 % está eligiendo.
      // Al primero no se le llama —el aviso no se abre siquiera, ni en pantalla
      // ni por WhatsApp—, al segundo sí.
      //
      // Utilización = horas en VIAJE sobre horas EFECTIVAS (viaje + espera) de
      // su jornada. Es la misma cifra de la ficha 360 y de la calificación, no
      // una inventada aquí.
      maxUtilizacion: 75,
    },
    km_parado: {
      etiqueta: 'KM rodando en descanso o desconectado', corto: 'rueda parado',
      umbral: 20, unidad: 'km', activo: true, ventana: 'franja',
    },
    // ── LAS DOS DE ZONA. No van por umbral ni por persona: cada salida de
    // geocerca que manda Mapon es un aviso, y la clave de "una vez" es el id de
    // esa alerta. Por eso llevan `fuente: 'zona'` y el bucle de personas las
    // salta.
    zona_notificacion: {
      etiqueta: 'Fuera de la ZONA DE NOTIFICACIÓN sin viaje', corto: 'sale de zona',
      umbral: 1, unidad: 'salidas', activo: true, ventana: 'franja', fuente: 'zona',
      // Las tres condiciones, y las tres hacen falta:
      //   · el coche está en el planificador (los 71 del cuadrante);
      //   · la salida cae dentro de una franja de vigilancia;
      //   · y NO iba de viaje.
      // Esa última es la que hace que la alerta sirva: ir a por el pasajero y
      // llevarlo son la misma situación en flota viva, y las dos son su
      // trabajo. Sin ese filtro esto sonaría cada vez que alguien lleva a un
      // cliente a Alcalá.
      soloPlanificados: true, soloSinViaje: true,
    },
    zona_madrid: {
      etiqueta: 'Fuera de la ZONA MADRID (aunque vaya de viaje)', corto: 'fuera de Madrid',
      umbral: 1, unidad: 'salidas', activo: true, ventana: 'siempre', fuente: 'zona',
      // Esta zona es enorme: de ahí no se sale ni con pasajero. Así que suena
      // esté de viaje o no, a cualquier hora, y también con coches que no están
      // en el cuadrante — que son los que más preocupan.
      soloPlanificados: false, soloSinViaje: false,
    },
  },
  // CORTAFUEGOS. Si un día se disparan cuarenta, algo pasa con los datos o con
  // el umbral, y lo último que ayuda es cuarenta WhatsApps. Se avisa de los
  // peores y el resto queda en la pantalla.
  maxPorFranja: 25,
  // En pruebas se registra la alerta y NO se manda nada (estado 'simulada').
  modo: 'test',
  plantilla: (process.env.PLANTILLA_ALERTA_CONTROL || 'alerta_control').trim(),
  // Una plantilla PROPIA para cada tipo, si se quiere. Nacen vacías a propósito:
  // mientras lo estén, los tres tipos salen por la genérica y esto no cambia
  // nada. Se encienden poniendo el nombre aprobado en Meta, y si la de un tipo
  // no existe todavía, ese aviso vuelve solo a la genérica (ver `mandar`).
  //
  // Con plantilla propia, el texto fijo ya dice QUÉ ha pasado, así que la cuarta
  // variable lleva solo la cifra ("3 viajes") en vez de la frase entera.
  plantillasPorTipo: {
    rechazo_directo: (process.env.PLANTILLA_ALERTA_RECHAZO_DIRECTO || '').trim(),
    sin_respuesta: (process.env.PLANTILLA_ALERTA_SIN_RESPUESTA || '').trim(),
    km_parado: (process.env.PLANTILLA_ALERTA_KM_PARADO || '').trim(),
    // Estas dos SÍ nacen con nombre: son plantillas propias desde el principio
    // porque un aviso de zona no cabe en el texto de la genérica. Si todavía no
    // están aprobadas en Meta, el aviso no se pierde: sale por la genérica con
    // su frase larga, como los demás.
    zona_notificacion: (process.env.PLANTILLA_ALERTA_ZONA_NOTIFICACION || 'zona_notificacion').trim(),
    zona_madrid: (process.env.PLANTILLA_ALERTA_ZONA_MADRID || 'zona_madrid').trim(),
  },
};

const TZ = 'Europe/Madrid';
const CLAVE_CONFIG = 'parametros';

// ── Fechas, siempre en Madrid ───────────────────────────────────────────────
const partesMadrid = (d = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).formatToParts(d).reduce((o, p) => (o[p.type] = p.value, o), {});

const hoyMadrid = (d = new Date()) => { const p = partesMadrid(d); return `${p.year}-${p.month}-${p.day}`; };
const horaMadrid = (d = new Date()) => Number(partesMadrid(d).hour) % 24;
const minutoMadrid = (d = new Date()) => Number(partesMadrid(d).minute);

/** Suma días a un 'AAAA-MM-DD' caminando el calendario (a prueba de cambio de hora). */
function sumarDias(iso, n) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * ¿En qué franja estamos AHORA? Devuelve null en el hueco entre franjas — y eso
 * es a propósito: fuera de la vigilancia no se avisa a nadie.
 *
 * `franja_dia` es el día AL QUE PERTENECE la franja, no el del reloj: a las
 * 00:30 seguimos en la franja de noche de AYER, y es ahí donde tiene que contar
 * el conductor para no avisar dos veces de lo mismo al cruzar la medianoche.
 */
function franjaDe(config, ahora = new Date()) {
  const hm = horaMadrid(ahora) * 60 + minutoMadrid(ahora);
  const hoy = hoyMadrid(ahora);
  const gracia = Number(config.graciaMin ?? MODELO.graciaMin) || 0;
  for (const f of (config.franjas || MODELO.franjas)) {
    const ini = f.ini * 60, fin = f.fin * 60 + gracia;
    if (f.fin > f.ini) {
      // No cruza medianoche: 08:00 → 13:00.
      if (hm >= ini && hm < fin) return { ...f, dia: hoy };
    } else {
      // Cruza: 20:00 → 01:00. Antes de medianoche es de HOY; después, de AYER.
      if (hm >= ini) return { ...f, dia: hoy };
      if (hm < fin) return { ...f, dia: sumarDias(hoy, -1) };
    }
  }
  return null;
}

// LOS INSTANTES DE LA FRANJA LOS MONTA POSTGRESQL, no JavaScript.
// `new Date('2026-09-11T08:00:00')` usa el reloj DEL SERVIDOR, y Render va en
// UTC: las ocho de la mañana habrían sido las diez en Madrid, y en invierno las
// nueve. Así que la franja viaja como (día, hora, salto de día) y la base la
// clava con AT TIME ZONE, igual que en Visibilidad y en el núcleo.
const paramsFranja = franja => [franja.dia, String(franja.ini), franja.fin > franja.ini ? 0 : 1, String(franja.fin)];

// ── Config ──────────────────────────────────────────────────────────────────
async function leerConfig() {
  try {
    const r = await db.consulta('SELECT valor FROM alerta_control_config WHERE clave = $1', [CLAVE_CONFIG]);
    const guardado = r.rows[0] ? r.rows[0].valor : {};
    // Los tipos se fusionan uno a uno: añadir un tipo nuevo al MODELO no debe
    // quedar tapado por una config vieja que no lo conoce.
    const tipos = {};
    for (const [k, def] of Object.entries(MODELO.tipos)) tipos[k] = { ...def, ...((guardado.tipos || {})[k] || {}) };
    // Igual con las plantillas por tipo: un tipo nuevo del MODELO no puede
    // quedar fuera porque la config guardada sea de antes.
    const plantillasPorTipo = { ...MODELO.plantillasPorTipo, ...(guardado.plantillasPorTipo || {}) };
    return { ...MODELO, ...guardado, tipos, plantillasPorTipo };
  } catch (e) {
    // Sin la tabla (migración sin aplicar) el módulo se ve, pero no alerta.
    return { ...MODELO, sinTabla: true };
  }
}

async function guardarConfig(patch, { usuarioId } = {}) {
  const actual = await leerConfig();
  const num = (v, def) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
  const tipos = {};
  for (const [k, def] of Object.entries(actual.tipos)) {
    const p = ((patch || {}).tipos || {})[k] || {};
    tipos[k] = {
      umbral: Math.max(1, num(p.umbral, def.umbral)),
      activo: p.activo === undefined ? !!def.activo : !!p.activo,
    };
    // El tope de utilización solo existe en los tipos que lo tienen. Si no se
    // arrastra, guardar los ajustes lo borraría y la puerta se quedaría abierta
    // sin que nadie lo hubiera pedido.
    if (def.maxUtilizacion != null) {
      tipos[k].maxUtilizacion = Math.min(100, Math.max(0, num(p.maxUtilizacion, def.maxUtilizacion)));
    }
  }
  const valor = {
    tipos,
    maxPorFranja: Math.max(1, num((patch || {}).maxPorFranja, actual.maxPorFranja)),
    modo: (patch || {}).modo === 'live' ? 'live' : 'test',
    plantilla: String((patch || {}).plantilla || actual.plantilla).trim().slice(0, 60) || MODELO.plantilla,
    plantillasPorTipo: Object.fromEntries(Object.keys(actual.tipos).map(k => {
      const p = ((patch || {}).plantillasPorTipo || {})[k];
      const v = p === undefined ? (actual.plantillasPorTipo || {})[k] : p;
      return [k, String(v || '').trim().slice(0, 60)];
    })),
  };
  await db.consulta(
    `INSERT INTO alerta_control_config (clave, valor, actualizado_at, usuario_id)
     VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor,
       actualizado_at = now(), usuario_id = EXCLUDED.usuario_id`,
    [CLAVE_CONFIG, JSON.stringify(valor), usuarioId || null]);
  return leerConfig();
}

// ── Destinatarios ───────────────────────────────────────────────────────────
/**
 * ¿Sirve este teléfono para mandar un WhatsApp?
 *
 * No basta con contar nueve dígitos. En las fichas de usuario hay números de
 * relleno —"000000000", "00000000"— puestos para poder crear la cuenta, y esos
 * pasaban el filtro: el aviso se daba por mandado, Meta lo rechazaba y nadie se
 * enteraba de que el controlador no recibió nada. Un número de un solo dígito
 * repetido no es un teléfono.
 */
function telefonoUtil(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length < 9) return false;
  return !/^(\d)\1+$/.test(d);
}
/** Todos los usuarios, marcando quién recibe. Es lo que pinta la pantalla. */
async function destinatarios() {
  const r = await db.consulta(
    `SELECT u.id, btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS nombre,
            u.email, u.estado, ro.etiqueta AS rol,
            COALESCE(NULLIF(btrim(d.telefono), ''), u.telefono) AS telefono,
            (d.usuario_id IS NOT NULL AND d.activo)             AS recibe
       FROM usuario u
       JOIN rol ro ON ro.id = u.rol_id
       LEFT JOIN alerta_control_destinatario d ON d.usuario_id = u.id
      WHERE u.estado <> 'bloqueado'
      ORDER BY recibe DESC, nombre`);
  return r.rows.map(x => ({
    id: Number(x.id), nombre: x.nombre, email: x.email, rol: x.rol,
    telefono: x.telefono || '', recibe: !!x.recibe,
    // Un destinatario sin teléfono (o con uno de relleno) no recibe nada, y hay
    // que verlo ANTES de contar con él: si no, el aviso se da por mandado y no
    // llegó a ninguna parte.
    sinTelefono: !telefonoUtil(x.telefono),
  }));
}

/** Fija la lista entera: los que vengan reciben, los demás dejan de recibir. */
async function guardarDestinatarios(ids, { usuarioId } = {}) {
  const limpios = [...new Set((ids || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
  await db.transaccion(async cli => {
    await cli.query('DELETE FROM alerta_control_destinatario WHERE NOT (usuario_id = ANY($1::int[]))', [limpios]);
    for (const id of limpios) {
      await cli.query(
        `INSERT INTO alerta_control_destinatario (usuario_id, activo, usuario_alta)
         VALUES ($1, TRUE, $2)
         ON CONFLICT (usuario_id) DO UPDATE SET activo = TRUE`, [id, usuarioId || null]);
    }
  });
  return destinatarios();
}

/** Los que de verdad van a recibir el WhatsApp (activos y con teléfono). */
async function aQuienAviso() {
  const r = await db.consulta(
    `SELECT u.id, btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS nombre,
            COALESCE(NULLIF(btrim(d.telefono), ''), u.telefono) AS telefono
       FROM alerta_control_destinatario d
       JOIN usuario u ON u.id = d.usuario_id
      WHERE d.activo AND u.estado <> 'bloqueado'
      ORDER BY nombre`);
  return r.rows
    .map(x => ({ id: Number(x.id), nombre: x.nombre, telefono: String(x.telefono || '') }))
    .filter(x => telefonoUtil(x.telefono));
}

// ── QUIÉN SE HA PASADO ──────────────────────────────────────────────────────
/**
 * Los conductores de una franja con sus tres cifras y sus horas. Una sola
 * consulta: órdenes, tramos y ficha viven en la misma base.
 */
async function candidatos(franja) {
  const [dia, hIni, offFin, hFin] = paramsFranja(franja);
  // LA JORNADA DE LA FRANJA ES LA DE LA FRANJA, no la del reloj.
  //
  // Antes salía de `ahora`, y en vivo daba igual —la franja en curso es siempre
  // la de la jornada en curso—, pero dejaba esta consulta inservible para mirar
  // atrás: preguntando por la franja de mañana del día 3 contaba los viajes
  // desde las 05:00 de HOY. Una franja pertenece siempre a la jornada de su
  // propio día (la de noche empieza a las 20:00 y muere antes de las 05:00 del
  // siguiente), así que el día de la franja ES la jornada. Con eso el Histórico
  // puede reconstruir las alertas de un día ya cerrado.
  const jornadaDia = String(franja.dia).slice(0, 10);

  const r = await db.consulta(
    `WITH f AS (
       SELECT ($1::date + ($2 || ' hours')::interval)            AT TIME ZONE 'Europe/Madrid' AS ini,
              (($1::date + $3::int) + ($4 || ' hours')::interval) AT TIME ZONE 'Europe/Madrid' AS fin,
              ($5::date + interval '5 hours')                     AT TIME ZONE 'Europe/Madrid' AS jini,
              -- EL FINAL DE LA JORNADA, no "ahora" a secas: en la jornada en
              -- curso son lo mismo (aún no ha llegado), pero en una cerrada
              -- now() se llevaría por delante los días siguientes.
              LEAST((($5::date + 1) + interval '5 hours') AT TIME ZONE 'Europe/Madrid', now()) AS jfin),
     -- DOS VENTANAS, no una, porque las dos faltas no son la misma:
     --   · NO RESPONDER, solo dentro de la FRANJA. Fuera está el cambio de
     --     turno, y ahí que se escape alguna oferta es lo esperable.
     --   · RECHAZAR A DEDO, en toda la JORNADA (desde las 05:00): no está
     --     permitido a ninguna hora, ni antes de ver el viaje ni después.
     ords AS (
       SELECT o.driver_uuid AS uuid,
              -- En la FRANJA (y hasta el final de la franja, aunque la revisión
              -- corra en el margen de cortesía de las 13:05).
              count(*) FILTER (WHERE o.estado = 'driver_did_not_respond'
                                 AND o.creado_ts >= f.ini
                                 AND o.creado_ts < LEAST(f.fin, f.jfin))::int AS sin_respuesta,
              count(*) FILTER (WHERE o.estado = 'finished'
                                 AND o.creado_ts >= f.ini
                                 AND o.creado_ts < LEAST(f.fin, f.jfin))::int AS hechos,
              count(*) FILTER (WHERE o.creado_ts >= f.ini
                                 AND o.creado_ts < LEAST(f.fin, f.jfin))::int AS ofertas,
              -- En toda la JORNADA, hasta AHORA. Lo que rechazó a las 15:30
              -- (entre franja y franja) tiene que sonar cuando abra la siguiente.
              count(*) FILTER (WHERE o.estado = 'driver_rejected')::int        AS rechazo_directo
         FROM bolt_order o CROSS JOIN f
        WHERE o.driver_uuid IS NOT NULL
          AND o.creado_ts >= f.jini AND o.creado_ts < f.jfin
        GROUP BY 1),
     -- KM RODADOS FUERA DE LA APP dentro de la franja, de fv_ruta.
     --
     -- Al principio esto salía de fv_tramo.km_m prorrateado por tiempo, y
     -- estaba MAL: el odómetro solo llega a ratos —hoy 188 de 3.551 tramos
     -- traen km— y sus metros caen en el tramo que estuviera abierto cuando
     -- Mapon habló. Medido el 11/09: con km_m NADIE pasaba de 20 km en la
     -- franja de mañana; con fv_ruta pasan seis, y el primero lleva 119. O sea,
     -- la alerta no habría sonado nunca.
     --
     -- fv_ruta es la fuente de la casa (cuadró con BOLT al 0,03 %): cada
     -- trayecto de Mapon se reparte entre los tramos que toca en proporción al
     -- tiempo, y los que caen en descanso o desconectado son los que no
     -- deberían existir. Un trayecto cuenta en la franja donde EMPIEZA.
     -- LOS TRAMOS, YA CORTADOS Y DE UNA SOLA VEZ.
     --
     -- El corte es el MISMO que usa Control (FIN_KM): un tramo "desconectado"
     -- puede durar dias —nadie vuelve a tocar ese coche— y sin cortarlo se le
     -- cuelgan al ultimo que lo condujo todos los km que el coche haga despues.
     -- Con eso se le manda un WhatsApp a alguien que no iba dentro: a Macilon le
     -- salieron 219 km de un coche que habia dejado dos dias antes.
     --
     -- MATERIALIZED y en su propia CTE por lo mismo que en Control: metido en el
     -- ON del cruce, Postgres resuelve el corte —con sus dos subconsultas— una
     -- vez por cada pareja de tramo y trayecto. Asi tardaba quince segundos; asi
     -- tarda medio.
     --
     -- Y solo se mira lo que el tope permite hacia atras: ningun tramo cuenta
     -- mas alla de su inicio mas el tope, asi que uno anterior a eso no puede
     -- aportar un metro.
     km_tramo AS MATERIALIZED (
       SELECT t.conductor_uuid AS uuid, veh.mapon_unit AS unit_id, t.situacion,
              t.desde AS d, ${FIN_KM} AS h
         FROM fv_tramo t
         CROSS JOIN f
         JOIN fv_vehiculo veh ON veh.uuid = t.vehiculo_uuid
        WHERE t.conductor_uuid IS NOT NULL
          AND veh.mapon_unit IS NOT NULL
          AND t.desde < LEAST(f.fin, f.jfin)
          AND t.desde >= f.ini - interval '${TOPE_TRAMO_ABIERTO}'),
     km AS (
       SELECT k.uuid,
              sum(r.metros * GREATEST(0, EXTRACT(epoch FROM (
                    LEAST(r.fin, k.h) - GREATEST(r.inicio, k.d))))
                  / NULLIF(EXTRACT(epoch FROM (r.fin - r.inicio)), 0))
                FILTER (WHERE k.situacion NOT IN ('viaje', 'espera'))  AS km_m
         FROM fv_ruta r
         CROSS JOIN f
         JOIN km_tramo k ON k.unit_id = r.unit_id AND k.d < r.fin AND k.h > r.inicio
        WHERE r.fin IS NOT NULL AND r.fin > r.inicio
          AND r.inicio >= f.ini AND r.inicio < LEAST(f.fin, f.jfin)
        GROUP BY 1),
     -- Horas EFECTIVAS de su jornada operativa (05:00 → ahora).
     horas AS (
       SELECT t.conductor_uuid AS uuid,
              sum(EXTRACT(epoch FROM (LEAST(COALESCE(t.hasta, f.jfin), f.jfin)
                                      - GREATEST(t.desde, f.jini)))) AS seg,
              -- LO MISMO, PERO SOLO EN VIAJE. Es el numerador de la
              -- utilización, y sale de aquí y no de las vistas de BI a
              -- propósito: la alerta no puede depender de que BI esté
              -- calculado, tiene que poder contestar ahora mismo.
              sum(EXTRACT(epoch FROM (LEAST(COALESCE(t.hasta, f.jfin), f.jfin)
                                      - GREATEST(t.desde, f.jini))))
                FILTER (WHERE t.situacion = 'viaje')                  AS seg_viaje
         FROM fv_tramo t
         JOIN fv_cat_situacion s ON s.codigo = t.situacion AND s.efectivo
         CROSS JOIN f
        WHERE t.desde < f.jfin AND COALESCE(t.hasta, f.jfin) > f.jini
        GROUP BY 1),
     todos AS (SELECT uuid FROM ords UNION SELECT uuid FROM km)
     SELECT t.uuid,
            COALESCE(o.sin_respuesta, 0)                       AS sin_respuesta,
            COALESCE(o.rechazo_directo, 0)                     AS rechazo_directo,
            COALESCE(o.hechos, 0)                              AS hechos,
            COALESCE(o.ofertas, 0)                             AS ofertas,
            round(COALESCE(k.km_m, 0) / 1000.0, 1)::float8     AS km_parado,
            round(COALESCE(h.seg, 0) / 3600.0, 2)::float8      AS horas_efectivas,
            -- NULL cuando no hay horas efectivas: 0 de 0 no es "cero por
            -- ciento", es "no se sabe", y las dos cosas se deciden distinto.
            round((COALESCE(h.seg_viaje, 0) / NULLIF(h.seg, 0) * 100)::numeric, 1)::float8
                                                               AS utilizacion,
            COALESCE(NULLIF(btrim(fc.nombre), ''),
                     NULLIF(btrim(c.nombre_bolt), ''),
                     btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')),
                     '#' || t.uuid)                            AS nombre_bolt,
            COALESCE(NULLIF(btrim(tel.e164), ''), fc.telefono) AS telefono,
            ce.conductor_id
       FROM todos t
       LEFT JOIN ords o  ON o.uuid = t.uuid
       LEFT JOIN km   k  ON k.uuid = t.uuid
       LEFT JOIN horas h ON h.uuid = t.uuid
       LEFT JOIN fv_conductor fc ON fc.uuid = t.uuid
       LEFT JOIN conductor_externo ce ON ce.sistema = 'bolt' AND ce.externo_id = t.uuid
                                     AND ce.conductor_id IS NOT NULL
       LEFT JOIN conductor c ON c.id = ce.conductor_id
       LEFT JOIN LATERAL (
         SELECT e164 FROM conductor_telefono
          WHERE conductor_id = ce.conductor_id AND vigente_hasta IS NULL
          ORDER BY principal DESC, id LIMIT 1) tel ON TRUE`,
    [dia, hIni, offFin, hFin, jornadaDia]);

  return r.rows.map(x => ({
    uuid: x.uuid,
    conductorId: x.conductor_id ? Number(x.conductor_id) : null,
    nombreBolt: x.nombre_bolt,
    telefono: x.telefono || '',
    horasEfectivas: Number(x.horas_efectivas) || 0,
    // Puede ser null a propósito: quien no tiene horas efectivas no tiene
    // utilización que medir.
    utilizacion: x.utilizacion == null ? null : Number(x.utilizacion),
    valores: {
      sin_respuesta: Number(x.sin_respuesta) || 0,
      rechazo_directo: Number(x.rechazo_directo) || 0,
      km_parado: Number(x.km_parado) || 0,
    },
    hechos: Number(x.hechos) || 0,
    ofertas: Number(x.ofertas) || 0,
  }));
}

// ── El texto que lee el controlador ─────────────────────────────────────────
const fmtNum = n => String(Math.round(Number(n) * 10) / 10).replace('.', ',');
/** 'HH:MM' en hora de Madrid. La alerta se guarda en UTC; se lee en Madrid. */
const horaCorta = ts => !ts ? '—' : new Date(ts).toLocaleTimeString('es-ES',
  { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtHoras = h => {
  const t = Math.max(0, Math.round(Number(h) * 60));
  return `${Math.floor(t / 60)} h ${String(t % 60).padStart(2, '0')} min`;
};

/** La cuarta variable de la plantilla: QUÉ ha hecho y en qué franja. */
function textoAlerta(tipo, valor, cfgTipo, franja, extra = {}) {
  // Las de zona no hablan de cifras: hablan de un sitio y una hora. Y dicen
  // SIEMPRE si iba de viaje, porque es lo primero que va a preguntar quien
  // llame — en «Zona Madrid» la alerta salta igual, y entonces hay que saber
  // si el coche llevaba pasajero.
  if (tipo === 'zona_notificacion' || tipo === 'zona_madrid') {
    const s = extra.salida || {};
    const zona = s.zona ? `«${String(s.zona).trim()}»` : 'la zona';
    const donde = s.direccion ? ` · ${s.direccion}` : '';
    const como = s.enViaje ? 'CON viaje en curso'
      : (s.conductorUuid ? 'SIN viaje' : 'SIN NADIE FICHADO en el coche');
    return `${s.matricula || ''} fuera de ${zona} a las ${horaCorta(s.ocurrioAt)} (${como})${donde}`.trim();
  }
  const horas = `${String(franja.ini).padStart(2, '0')}:00-${String(franja.fin).padStart(2, '0')}:00`;
  if (tipo === 'km_parado') {
    return `${fmtNum(valor)} km rodando en descanso o desconectado (franja ${horas})`;
  }
  // El rechazo directo se cuenta en toda la jornada, así que decir "(franja
  // 08:00-13:00)" sería mentir sobre de dónde salen esos viajes.
  if (tipo === 'rechazo_directo') {
    return `${fmtNum(valor)} ${valor === 1 ? 'viaje RECHAZADO' : 'viajes RECHAZADOS'} por él hoy `
      + '(no se puede rechazar ningún viaje)';
  }
  return `${fmtNum(valor)} viajes perdidos por NO RESPONDER (franja ${horas})`;
}

/**
 * ¿Falla porque esa plantilla no se puede usar (no existe, está en pausa o
 * deshabilitada), y no por otra cosa?
 *
 * Solo en ese caso tiene sentido reintentar con la genérica. Un fallo de número
 * de parámetros o de teléfono daría igual con otra plantilla y gastaría envíos.
 * El 132001 llega aquí ya habiendo probado los cuatro códigos de español, que es
 * lo que hace `services/whatsapp.js` por su cuenta.
 */
const esPlantillaQueNoExiste = e =>
  /132001|132015|132016|does not exist|not exist in the translation|paused|disabled/i.test(e || '');

/**
 * La misma cuarta variable, pero para las plantillas que ya dicen QUÉ ha pasado
 * en su texto fijo: ahí repetir la frase entera sonaría a eco. Solo la cifra.
 *
 * Los km SÍ se quedan con la franja: sin ella, "24,6 km" no dice de cuándo son.
 */
function textoCorto(tipo, valor, franja, extra = {}) {
  // Con plantilla propia el texto fijo ya dice de qué zona se trata, así que
  // aquí va lo que esa frase no puede llevar: cuándo, dónde y si iba de viaje.
  if (tipo === 'zona_notificacion' || tipo === 'zona_madrid') {
    const s = extra.salida || {};
    const como = s.enViaje ? 'con viaje'
      : (s.conductorUuid ? 'sin viaje' : 'sin nadie fichado');
    return `${horaCorta(s.ocurrioAt)} · ${como}${s.direccion ? ' · ' + s.direccion : ''}`;
  }
  if (tipo === 'km_parado') {
    const horas = `${String(franja.ini).padStart(2, '0')}:00-${String(franja.fin).padStart(2, '0')}:00`;
    return `${fmtNum(valor)} km (franja ${horas})`;
  }
  return `${fmtNum(valor)} ${valor === 1 ? 'viaje' : 'viajes'}`;
}

// ── LA REVISIÓN ─────────────────────────────────────────────────────────────
/**
 * Mira la franja en curso, abre las alertas nuevas y las manda.
 *
 * Fuera de franja no hace nada. Lo que ya estaba avisado no vuelve a sonar: lo
 * impide el índice único, no un `if`.
 */
async function revisar({ ahora = new Date(), forzar = false } = {}) {
  const config = await leerConfig();
  if (config.sinTabla) return { activa: false, motivo: 'sin-tabla', nuevas: 0 };

  const gente = await aQuienAviso();
  const simulado = config.modo !== 'live';
  const franja = franjaDe(config, ahora);

  // LAS DE ZONA NO ESPERAN A LA FRANJA, y por eso van antes del corte de abajo.
  // «Zona Madrid» tiene que sonar a las cuatro de la mañana igual que a las
  // once: de esa zona no se sale nunca. La de notificación sí mira la franja,
  // pero la mira sobre la HORA DE LA SALIDA, no sobre la hora del cron.
  const zonas = await revisarZonas({ config, gente, simulado, ahora });

  if (!franja) {
    return { activa: false, motivo: 'fuera-de-franja', nuevas: zonas.nuevas,
      enviadas: zonas.enviadas, zonas, modo: config.modo };
  }

  const lista = await candidatos(franja);

  // Los que se pasan, peor primero: si hay que cortar por el tope, que se avise
  // de los gordos.
  const pasados = [];
  for (const c of lista) {
    for (const [tipo, def] of Object.entries(config.tipos)) {
      if (!def.activo) continue;
      // Las de zona no son de persona: tienen su propia pasada, arriba.
      if (def.fuente === 'zona') continue;
      const valor = c.valores[tipo];
      if (valor == null || valor < def.umbral) continue;
      // LA PUERTA DE LA UTILIZACIÓN. Quien va cargado de trabajo no genera
      // alerta aunque haya rechazado: ni en pantalla ni por WhatsApp. Rechazar
      // sigue sin estar permitido, pero un rechazo al 90 % de utilización es
      // uno que le venía mal, y al 60 % es elegir viajes.
      //
      // SIN UTILIZACIÓN (cero horas efectivas) SÍ se avisa: no se sabe que esté
      // ocupado, y alguien con cero horas que además rechaza es justo el caso.
      if (def.maxUtilizacion != null && c.utilizacion != null
          && c.utilizacion >= def.maxUtilizacion) continue;
      pasados.push({ ...c, tipo, valor, umbral: def.umbral, exceso: valor / def.umbral });
    }
  }
  pasados.sort((a, b) => b.exceso - a.exceso);

  const res = { activa: true, franja: franja.codigo, dia: franja.dia, modo: config.modo,
    candidatos: lista.length, pasan: pasados.length, nuevas: 0, enviadas: 0,
    errores: 0, cortadas: 0, destinatarios: gente.length, detalle: [] };

  for (const p of pasados) {
    if (res.nuevas >= config.maxPorFranja && !forzar) { res.cortadas++; continue; }

    // El INSERT es el que decide si esta alerta es nueva. Si ya estaba, no
    // devuelve fila y aquí no se manda nada: un mensaje por alerta.
    const ins = await db.consulta(
      `INSERT INTO alerta_control
         (tipo, franja, franja_dia, driver_uuid, conductor_id, nombre_bolt, telefono,
          valor, umbral, horas_efectivas, utilizacion, estado)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,'pendiente')
       ON CONFLICT (tipo, driver_uuid, franja_dia, franja) WHERE mapon_alerta_id IS NULL
         DO NOTHING
       RETURNING id`,
      [p.tipo, franja.codigo, franja.dia, p.uuid, p.conductorId, p.nombreBolt,
       p.telefono || null, p.valor, p.umbral, p.horasEfectivas, p.utilizacion]);
    if (!ins.rowCount) continue;

    res.nuevas++;
    const alertaId = ins.rows[0].id;
    const r = await mandar(alertaId, p, franja, config, gente, simulado);
    res.enviadas += r.ok;
    res.errores += r.fallos;
    res.detalle.push({ tipo: p.tipo, conductor: p.nombreBolt, valor: p.valor, enviados: r.ok, estado: r.estado });
  }

  // Lo que quedó a medias en esta misma franja (un fallo de red, la plantilla
  // aún sin aprobar) se reintenta: la alerta ya existe, así que no se duplica.
  if (gente.length) res.reintentos = await reintentarPendientes(franja, config, gente, simulado);

  res.zonas = zonas;
  res.nuevas += zonas.nuevas;
  res.enviadas += zonas.enviadas;
  res.errores += zonas.errores;
  return res;
}

/**
 * LAS SALIDAS DE ZONA. Una pasada aparte porque no se parecen en nada a lo de
 * arriba: no hay umbral que superar ni persona a la que contarle viajes. Lo que
 * hay es un aviso de Mapon —«este coche se ha salido»— y una decisión de si
 * merece llamar a alguien.
 *
 * TRES FILTROS, y cada uno tiene su motivo:
 *
 *   · LA ZONA. Solo las dos que significan algo. En la cuenta hay más geocercas
 *     (de diagnóstico, la cochera) y sus alertas se guardan pero no avisan.
 *   · EL VIAJE, solo en la de notificación. Ir a por el pasajero y llevarlo son
 *     la misma situación en flota viva, y las dos son su trabajo: sin este
 *     filtro la alerta sonaría cada vez que alguien lleva un cliente a Alcalá.
 *   · LA FRANJA, también solo en la de notificación, y medida sobre la HORA DE
 *     LA SALIDA. Si se midiera sobre la hora del cron, una salida de las 12:58
 *     dejaría de contar por revisarse a las 13:06 — que es justo el caso para el
 *     que existen los minutos de cortesía.
 *
 * La ventana mira seis horas atrás a propósito. La ingesta trae las alertas con
 * retraso y el módulo puede haber estado parado; repetir no puede, porque el id
 * de Mapon es único en la base.
 */
async function revisarZonas({ config, gente, simulado, ahora }) {
  const res = { vistas: 0, pasan: 0, nuevas: 0, enviadas: 0, errores: 0, detalle: [] };
  const tipoDe = { notificacion: 'zona_notificacion', madrid: 'zona_madrid' };

  let salidas;
  try {
    salidas = await zonasMapon.salidasEntre(new Date(ahora.getTime() - 6 * 3600000), ahora);
  } catch (e) {
    // Sin la tabla (migración sin aplicar) el resto de la revisión sigue.
    console.error('⚠️  [ALERTAS] No se han podido leer las salidas de zona:', e.message);
    return res;
  }
  res.vistas = salidas.length;

  for (const sal of salidas) {
    const tipo = tipoDe[sal.claveZona];
    if (!tipo) continue;
    const def = config.tipos[tipo];
    if (!def || !def.activo) continue;
    if (def.soloPlanificados && !sal.planificado) continue;
    if (def.soloSinViaje && sal.enViaje) continue;

    // La franja DE LA SALIDA, no la de ahora.
    const suFranja = franjaDe(config, new Date(sal.ocurrioAt));
    if (def.ventana === 'franja' && !suFranja) continue;
    res.pasan++;

    // Fuera de franja la fila necesita un día y un código igualmente: el día es
    // el de la JORNADA (05:00 → 05:00), que es como se mira todo aquí.
    const franja = suFranja || { codigo: 'fuera', dia: jornadaDeMadrid(new Date(sal.ocurrioAt)) };

    const ins = await db.consulta(
      `INSERT INTO alerta_control
         (tipo, franja, franja_dia, driver_uuid, conductor_id, nombre_bolt, telefono,
          matricula, mapon_alerta_id, valor, umbral, estado)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,1,1,'pendiente')
       -- El predicado del indice parcial va en el ON CONFLICT: sin el,
       -- Postgres no sabe a que indice te refieres y contesta 42P10.
       ON CONFLICT (mapon_alerta_id) WHERE mapon_alerta_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [tipo, franja.codigo, franja.dia, sal.conductorUuid, sal.conductorId,
       sal.nombreBolt || null, sal.telefono || null, sal.matricula, sal.maponId]);
    if (!ins.rowCount) continue;

    res.nuevas++;
    const p = {
      tipo, valor: 1, nombreBolt: sal.nombreBolt, telefono: sal.telefono,
      horasEfectivas: 0, matricula: sal.matricula, salida: sal,
    };
    const r = await mandar(ins.rows[0].id, p, franja, config, gente, simulado);
    res.enviadas += r.ok;
    res.errores += r.fallos;
    res.detalle.push({ tipo, matricula: sal.matricula, conductor: sal.nombreBolt || '(nadie)',
      zona: sal.zona, enviados: r.ok, estado: r.estado });
  }
  return res;
}

/** El día de la JORNADA (05:00 → 05:00) de un instante, en Madrid. */
function jornadaDeMadrid(cuando) {
  const hoy = hoyMadrid(cuando);
  return horaMadrid(cuando) < 5 ? sumarDias(hoy, -1) : hoy;
}

/** Manda UNA alerta a todos los destinatarios y apunta el resultado. */
async function mandar(alertaId, p, franja, config, gente, simulado) {
  if (!gente.length) {
    await db.consulta(`UPDATE alerta_control SET estado = 'sin_destinatarios' WHERE id = $1`, [alertaId]);
    return { ok: 0, fallos: 0, estado: 'sin_destinatarios' };
  }
  // Si este tipo tiene plantilla propia se usa, y entonces la cuarta variable va
  // corta porque el texto fijo de esa plantilla ya explica el motivo.
  const propia = ((config.plantillasPorTipo || {})[p.tipo] || '').trim();
  // LAS CUATRO VARIABLES SON SIEMPRE LAS MISMAS COSAS: quién, su teléfono, el
  // contexto y qué ha pasado. Lo único que cambia es el contexto: en una alerta
  // de persona son sus horas, y en una de zona es la MATRÍCULA — que es el dato
  // que hay que leer primero cuando puede que no haya nadie fichado.
  //
  // Se mantiene así para que la plantilla genérica siga sirviendo de reserva:
  // si `zona_madrid` aún no está aprobada en Meta, el aviso sale igual.
  const deZona = p.tipo === 'zona_notificacion' || p.tipo === 'zona_madrid';
  const extra = { salida: p.salida || null };
  const cabecera = [
    p.nombreBolt || (deZona ? 'SIN CONDUCTOR FICHADO' : '—'),
    p.telefono || 'sin teléfono',
    deZona ? (p.matricula || '—') : fmtHoras(p.horasEfectivas),
  ];
  const vars = [...cabecera, propia ? textoCorto(p.tipo, p.valor, franja, extra)
    : textoAlerta(p.tipo, p.valor, config.tipos[p.tipo], franja, extra)];
  // La de reserva: si la propia aún no está aprobada en Meta, el aviso NO se
  // pierde — sale por la genérica con su frase larga.
  const reserva = propia
    ? { plantilla: config.plantilla,
        vars: [...cabecera, textoAlerta(p.tipo, p.valor, config.tipos[p.tipo], franja, extra)] }
    : null;

  let ok = 0, fallos = 0;
  for (const d of gente) {
    let r;
    if (simulado) r = { ok: true };
    else {
      r = await whatsapp.enviarPlantillaPosicional(d.telefono, propia || config.plantilla, vars);
      if (!r.ok && reserva && esPlantillaQueNoExiste(r.error)) {
        console.log(`📩 [ALERTAS] "${propia}" no está disponible en Meta: este aviso sale por "${reserva.plantilla}"`);
        r = await whatsapp.enviarPlantillaPosicional(d.telefono, reserva.plantilla, reserva.vars);
      }
    }
    if (r.ok) ok++; else fallos++;
    await db.consulta(
      `INSERT INTO alerta_control_envio (alerta_id, usuario_id, usuario, telefono, ok, simulado, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [alertaId, d.id, d.nombre, d.telefono, !!r.ok, simulado, r.ok ? null : String(r.error || '').slice(0, 300)]);
  }
  const estado = simulado ? 'simulada' : (ok ? 'enviada' : 'error');
  await db.consulta('UPDATE alerta_control SET estado = $2 WHERE id = $1', [alertaId, estado]);
  return { ok, fallos, estado };
}

/** Reintenta las de ESTA franja que no llegaron a salir. Máximo 3 intentos. */
async function reintentarPendientes(franja, config, gente, simulado) {
  const r = await db.consulta(
    `SELECT a.*, (SELECT count(*) FROM alerta_control_envio e WHERE e.alerta_id = a.id) AS intentos
       FROM alerta_control a
      WHERE a.franja_dia = $1::date AND a.franja = $2
        AND a.estado IN ('pendiente', 'error', 'sin_destinatarios')
        AND NOT EXISTS (SELECT 1 FROM alerta_control_envio e WHERE e.alerta_id = a.id AND e.ok)`,
    [franja.dia, franja.codigo]);
  let n = 0;
  for (const a of r.rows) {
    if (Number(a.intentos) >= 3 * gente.length) continue;
    const p = {
      tipo: a.tipo, valor: Number(a.valor), nombreBolt: a.nombre_bolt,
      telefono: a.telefono, horasEfectivas: Number(a.horas_efectivas) || 0,
      matricula: a.matricula || '',
      // Al reintentar no se vuelve a Mapon: lo que la fila guarda basta para
      // rehacer el texto, y pedirlo otra vez gastaría cuota por un aviso que
      // ya se sabe cuál es.
      salida: a.mapon_alerta_id ? { matricula: a.matricula || '' } : null,
    };
    const res = await mandar(a.id, p, franja, config, gente, simulado);
    if (res.ok) n++;
  }
  return n;
}

// ── Lo que lee la pantalla ──────────────────────────────────────────────────
async function historial({ dia, limite = 200 } = {}) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dia || '')) ? dia : hoyMadrid();
  const r = await db.consulta(
    `SELECT a.id, a.tipo, a.franja, to_char(a.franja_dia, 'YYYY-MM-DD') AS franja_dia,
            a.nombre_bolt, a.telefono, a.conductor_id, a.matricula, a.mapon_alerta_id,
            a.valor::float8 AS valor, a.umbral::float8 AS umbral,
            a.horas_efectivas::float8 AS horas_efectivas,
            a.utilizacion::float8 AS utilizacion, a.estado,
            -- El sitio donde se salió, para las de zona. Sale de la alerta de
            -- Mapon y no de la fila: la fila guarda la decisión, no el mapa.
            z.direccion AS lugar, z.zona,
            to_char(z.ocurrio_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora_salida,
            to_char(a.detectada_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
            (SELECT count(*) FROM alerta_control_envio e WHERE e.alerta_id = a.id AND e.ok)::int AS enviados,
            (SELECT string_agg(DISTINCT e.usuario, ', ') FROM alerta_control_envio e
              WHERE e.alerta_id = a.id AND e.ok) AS a_quien,
            (SELECT e.error FROM alerta_control_envio e
              WHERE e.alerta_id = a.id AND NOT e.ok ORDER BY e.id DESC LIMIT 1) AS error
       FROM alerta_control a
       LEFT JOIN mapon_zona_alerta z ON z.mapon_id = a.mapon_alerta_id
      WHERE a.franja_dia = $1::date
      ORDER BY a.detectada_at DESC
      LIMIT $2`, [d, Math.min(500, Number(limite) || 200)]);
  return { dia: d, alertas: r.rows };
}

/** El panel: config, destinatarios, franja en curso y lo que va de día. */
async function estado({ dia } = {}) {
  const config = await leerConfig();
  const ahora = new Date();
  const franja = franjaDe(config, ahora);
  const [gente, hist] = await Promise.all([destinatarios(), historial({ dia })]);
  let enVivo = null;
  if (franja && !config.sinTabla) {
    // Lo que YA está por encima del umbral ahora mismo, esté avisado o no: es la
    // diferencia entre "saltó una alerta" y "esto está pasando".
    const lista = await candidatos(franja).catch(() => []);
    enVivo = [];
    for (const c of lista) {
      for (const [tipo, def] of Object.entries(config.tipos)) {
        // Las de zona no se miden por umbral: no tienen "en vivo" que calcular.
        if (!def.activo || def.fuente === 'zona') continue;
        if (c.valores[tipo] < def.umbral) continue;
        // LA MISMA PUERTA QUE EN EL ENVÍO. Si aquí no se aplicara, la pantalla
        // diría "esto está pasando" de gente a la que nunca se va a avisar, y
        // Tráfico llamaría igual: el filtro no habría servido de nada.
        if (def.maxUtilizacion != null && c.utilizacion != null
            && c.utilizacion >= def.maxUtilizacion) continue;
        enVivo.push({ tipo, conductor: c.nombreBolt, telefono: c.telefono,
          valor: c.valores[tipo], umbral: def.umbral, horas: c.horasEfectivas,
          utilizacion: c.utilizacion });
      }
    }
    enVivo.sort((a, b) => (b.valor / b.umbral) - (a.valor / a.umbral));
  }
  return {
    config, franja, ahora: `${String(horaMadrid(ahora)).padStart(2, '0')}:${String(minutoMadrid(ahora)).padStart(2, '0')}`,
    destinatarios: gente, ...hist, enVivo,
    tipos: Object.entries(config.tipos).map(([k, v]) => ({ codigo: k, ...v })),
  };
}

module.exports = {
  MODELO, revisar, estado, historial, candidatos,
  leerConfig, guardarConfig, destinatarios, guardarDestinatarios, aQuienAviso,
  franjaDe, textoAlerta, textoCorto, esPlantillaQueNoExiste,
};
