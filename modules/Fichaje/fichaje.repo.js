// ============================================================
// FICHAJE — el SQL
// ============================================================
// Entradas y salidas de la gente de oficina. Solo datos: quién decide si una
// persona tiene que fichar, o si una corrección está permitida, es el servicio.
//
// OJO CON EL NOMBRE: existe otra tabla `registro_jornada` que NO es esta. Esa va
// por `conductor_id` y la calcula el sistema desde los logs de BOLT; esta va por
// `usuario_id` y la escribe una persona pulsando un botón.

const db = require('../../services/db');

const TZ = 'Europe/Madrid';

const ESTADOS_UBI = ['ok', 'denegada', 'error', 'sin_pedir'];

/**
 * Deja la ubicacion que manda el navegador en algo que la base acepte.
 *
 * NO SE FIA DE LO QUE LLEGA. El cuerpo de la peticion lo escribe el navegador y
 * cualquiera puede mandar lo que quiera: una latitud de 999, un estado
 * inventado, texto donde van numeros. Si algo no cuadra se degrada a 'error' en
 * vez de reventar, porque lo que NO puede pasar es que un dato raro impida
 * fichar: el registro de jornada es obligatorio.
 */
function normUbi(u) {
  const x = u || {};
  const num = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  };
  const lat = num(x.lat, -90, 90);
  const lng = num(x.lng, -180, 180);
  let estado = ESTADOS_UBI.includes(x.estado) ? x.estado : 'error';
  // Coherencia: 'ok' sin coordenadas es mentira, y la base lo rechazaria.
  if (estado === 'ok' && (lat === null || lng === null)) estado = 'error';
  return {
    lat: estado === 'ok' ? lat : null,
    lng: estado === 'ok' ? lng : null,
    // La precision se guarda entera y con tope: hay dispositivos que devuelven
    // numeros enormes y no aportan nada por encima de unos kilometros.
    precision: estado === 'ok' ? (num(x.precision, 0, 100000) === null ? null : Math.round(num(x.precision, 0, 100000))) : null,
    estado,
  };
}

// El día natural de Madrid al que pertenece un instante. En SQL y no en
// JavaScript porque el día lo tiene que decidir la MISMA zona que luego lo
// consulta; si lo calculara el servidor de Node con su reloj, un despliegue en
// otra región cambiaría a qué día pertenece un fichaje.
const DIA_MADRID = `((now() AT TIME ZONE '${TZ}')::date)`;

/** El fichaje abierto de alguien, si lo tiene. */
async function abierto(usuarioId) {
  const r = await db.consulta(`
    SELECT id, to_char(dia, 'YYYY-MM-DD') AS dia,
           entrada, salida, corregido_at
      FROM fichaje
     WHERE usuario_id = $1 AND salida IS NULL`, [usuarioId]);
  return r.rows[0] || null;
}

/**
 * Abre la jornada. Devuelve el fichaje nuevo.
 *
 * Si ya hay uno abierto, la BASE lo rechaza por el índice único parcial y aquí
 * se traduce a un mensaje que se entiende. No se comprueba antes con un SELECT:
 * entre el SELECT y el INSERT caben dos pulsaciones del mismo dedo.
 */
async function entrar(usuarioId, ubi) {
  const u = normUbi(ubi);
  try {
    const r = await db.consulta(`
      INSERT INTO fichaje (usuario_id, dia, entrada,
                           entrada_lat, entrada_lng, entrada_precision, entrada_ubicacion)
      VALUES ($1, ${DIA_MADRID}, now(), $2, $3, $4, $5)
      RETURNING id, to_char(dia, 'YYYY-MM-DD') AS dia, entrada, salida, entrada_ubicacion`,
      [usuarioId, u.lat, u.lng, u.precision, u.estado]);
    return r.rows[0];
  } catch (e) {
    if (e.code === '23505') throw new Error('Ya tienes la jornada abierta');
    throw e;
  }
}

/** Cierra la jornada abierta. Devuelve null si no había ninguna. */
async function salir(usuarioId, ubi) {
  const u = normUbi(ubi);
  const r = await db.consulta(`
    UPDATE fichaje SET salida = now(),
           salida_lat = $2, salida_lng = $3, salida_precision = $4, salida_ubicacion = $5
     WHERE usuario_id = $1 AND salida IS NULL
     RETURNING id, to_char(dia, 'YYYY-MM-DD') AS dia, entrada, salida, salida_ubicacion`,
    [usuarioId, u.lat, u.lng, u.precision, u.estado]);
  return r.rows[0] || null;
}

/** Los fichajes de alguien en un mes ('AAAA-MM'). */
async function delMes(usuarioId, mes) {
  const r = await db.consulta(`
    SELECT f.id, to_char(f.dia, 'YYYY-MM-DD') AS dia, f.entrada, f.salida,
           f.entrada_lat, f.entrada_lng, f.entrada_precision, f.entrada_ubicacion,
           f.salida_lat, f.salida_lng, f.salida_precision, f.salida_ubicacion,
           f.entrada_original, f.salida_original, f.corregido_at, f.corregido_motivo,
           f.aprobado_at,
           COALESCE(btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')), '') AS corregido_por,
           COALESCE(btrim(a.nombre || ' ' || COALESCE(a.apellidos, '')), '') AS aprobado_por
      FROM fichaje f
      LEFT JOIN usuario u ON u.id = f.corregido_por
      LEFT JOIN usuario a ON a.id = f.aprobado_por
     WHERE f.usuario_id = $1 AND to_char(f.dia, 'YYYY-MM') = $2
     ORDER BY f.entrada`, [usuarioId, mes]);
  return r.rows;
}

/** El parte de un día: quién fichó y quién no, de los que TIENEN que fichar. */
async function delDia(dia) {
  const r = await db.consulta(`
    SELECT u.id AS usuario_id,
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien,
           u.email, r.codigo AS rol,
           f.id, f.entrada, f.salida, f.corregido_at, f.corregido_motivo, f.aprobado_at,
           f.entrada_ubicacion, f.entrada_lat, f.entrada_lng, f.entrada_precision,
           f.salida_ubicacion, f.salida_lat, f.salida_lng
      FROM usuario u
      JOIN rol r ON r.id = u.rol_id
      LEFT JOIN fichaje f ON f.usuario_id = u.id AND f.dia = $1::date
     WHERE u.ficha_obligatorio AND u.estado <> 'bloqueado'
     ORDER BY quien`, [dia]);
  return r.rows;
}

/**
 * Corrige un fichaje. GUARDA LO QUE HABÍA: `entrada_original` y
 * `salida_original` solo se escriben la PRIMERA vez, para que lo que quede al
 * lado sea siempre lo que pulsó la persona y no la corrección anterior.
 */
async function corregir(id, { entrada, salida }, { usuarioId, motivo }) {
  const r = await db.consulta(`
    UPDATE fichaje SET
      entrada_original = COALESCE(entrada_original, entrada),
      salida_original  = COALESCE(salida_original, salida),
      entrada = COALESCE($2::timestamptz, entrada),
      salida  = CASE WHEN $3::text = 'abierta' THEN NULL
                     WHEN $3::text IS NULL      THEN salida
                     ELSE $3::timestamptz END,
      dia = ((COALESCE($2::timestamptz, entrada) AT TIME ZONE '${TZ}')::date),
      corregido_at = now(), corregido_por = $4, corregido_motivo = $5,
      -- Tocar las horas TUMBA el visto bueno. Si no, se aprobarian 8 h, se
      -- editarian a 12 y el sello seguiria diciendo que alguien las dio por
      -- buenas. Vuelve a la cola y que lo confirme quien corresponda.
      aprobado_at = NULL, aprobado_por = NULL
     WHERE id = $1
     RETURNING id, to_char(dia, 'YYYY-MM-DD') AS dia, entrada, salida,
               entrada_original, salida_original, aprobado_at`,
    [id, entrada || null, salida === undefined ? null : salida, usuarioId, motivo]);
  if (!r.rowCount) throw new Error('No existe ese fichaje');
  return r.rows[0];
}

/** Crea un fichaje a mano, para el día que alguien no fichó nada. */
async function crearAMano(usuarioId, { entrada, salida }, { autor, motivo }) {
  const r = await db.consulta(`
    INSERT INTO fichaje (usuario_id, dia, entrada, salida,
                         corregido_at, corregido_por, corregido_motivo)
    VALUES ($1, (($2::timestamptz AT TIME ZONE '${TZ}')::date), $2, $3, now(), $4, $5)
    RETURNING id, to_char(dia, 'YYYY-MM-DD') AS dia, entrada, salida`,
    [usuarioId, entrada, salida || null, autor, motivo]);
  return r.rows[0];
}

/**
 * Lo que espera un visto bueno: jornadas CERRADAS que nadie ha confirmado.
 *
 * Las abiertas no entran: todavía no se sabe cuánto duraron, y la base ni
 * siquiera dejaría aprobarlas (ck_fichaje_aprobado). Las más viejas primero,
 * que son las que llevan más tiempo esperando.
 */
async function pendientes(tope = 400) {
  const r = await db.consulta(`
    SELECT f.id, f.usuario_id, to_char(f.dia, 'YYYY-MM-DD') AS dia, f.entrada, f.salida,
           f.corregido_at, f.corregido_motivo, f.entrada_ubicacion,
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien
      FROM fichaje f JOIN usuario u ON u.id = f.usuario_id
     WHERE f.salida IS NOT NULL AND f.aprobado_at IS NULL
     ORDER BY f.dia, quien
     LIMIT $1`, [tope]);
  return r.rows;
}

/**
 * Da por buenas unas horas. Devuelve los ids que de verdad se sellaron.
 *
 * El WHERE repite las condiciones que ya vigila el CHECK a propósito: así una
 * lista con un id abierto o ya aprobado no revienta la petición entera, solo
 * se queda fuera. Aprobar en tanda no puede fallar por una fila rara.
 */
async function aprobar(ids, usuarioId) {
  const limpios = (ids || []).map(Number).filter(Number.isInteger);
  if (!limpios.length) return [];
  const r = await db.consulta(`
    UPDATE fichaje SET aprobado_at = now(), aprobado_por = $2
     WHERE id = ANY($1::bigint[]) AND salida IS NOT NULL AND aprobado_at IS NULL
     RETURNING id`, [limpios, usuarioId]);
  return r.rows.map(x => Number(x.id));
}

/** Las jornadas sin cerrar de días PASADOS: lo que hay que corregir. */
async function sinCerrar() {
  const r = await db.consulta(`
    SELECT f.id, f.usuario_id, to_char(f.dia, 'YYYY-MM-DD') AS dia, f.entrada,
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien
      FROM fichaje f JOIN usuario u ON u.id = f.usuario_id
     WHERE f.salida IS NULL AND f.dia < ${DIA_MADRID}
     ORDER BY f.dia, quien`);
  return r.rows;
}

module.exports = {
  abierto, entrar, salir, delMes, delDia, corregir, crearAMano, sinCerrar,
  pendientes, aprobar, normUbi, TZ,
};
