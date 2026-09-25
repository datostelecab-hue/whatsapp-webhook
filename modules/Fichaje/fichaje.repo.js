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

/**
 * Una hora ESCRITA A MANO, interpretada en Madrid.
 *
 * Lo que llega de la pantalla es 'AAAA-MM-DDTHH:MM:00' sin zona: es la hora
 * que se lee en un reloj de aquí. Un texto así convertido a timestamptz lo
 * interpreta PostgreSQL con la zona de la SESIÓN, y la de este servidor es
 * UTC: escribir 11:00 guardaba las 13:00 de Madrid. Dos horas de regalo en un
 * registro de jornada, y en invierno habría sido una.
 *
 * Por eso se pasa primero por ::timestamp (un instante sin zona, que es lo que
 * de verdad es) y se le dice EN QUÉ zona hay que leerlo. No se arregla
 * cambiando la zona de la sesión: eso movería en silencio todo lo demás.
 */
const MADRID = n => '($' + n + "::timestamp AT TIME ZONE '" + TZ + "')";

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

/**
 * Los fichajes de alguien entre dos días, los dos incluidos.
 *
 * Por rango y no por mes: la pantalla va por SEMANA, que es como se mira una
 * jornada de verdad —lo que hiciste esta semana, no lo que llevas de mes— y un
 * rango sirve para las dos cosas el día que haga falta.
 */
async function delRango(usuarioId, desde, hasta) {
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
     WHERE f.usuario_id = $1 AND f.dia BETWEEN $2::date AND $3::date
     ORDER BY f.entrada`, [usuarioId, desde, hasta]);
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
      entrada = COALESCE(${MADRID(2)}, entrada),
      salida  = CASE WHEN $3::text = 'abierta' THEN NULL
                     WHEN $3::text IS NULL      THEN salida
                     ELSE ${MADRID(3)} END,
      dia = ((COALESCE(${MADRID(2)}, entrada) AT TIME ZONE '${TZ}')::date),
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
    VALUES ($1, ((${MADRID(2)} AT TIME ZONE '${TZ}')::date), ${MADRID(2)}, ${MADRID(3)}, now(), $4, $5)
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
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien,
           -- Si la persona ha pedido corregirla, esas horas están en duda: se
           -- resuelve la corrección antes de confirmarlas (db/159).
           EXISTS (SELECT 1 FROM fichaje_correccion c
                    WHERE c.fichaje_id = f.id AND c.estado = 'pendiente') AS correccion_pedida
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
  // Tampoco se confirma una jornada cuya corrección está pedida: sería dar por
  // buenas justo las horas que la persona dice que están mal. Primero se
  // resuelve la corrección, que ya deja la jornada confirmada si se aprueba.
  const r = await db.consulta(`
    UPDATE fichaje SET aprobado_at = now(), aprobado_por = $2
     WHERE id = ANY($1::bigint[]) AND salida IS NOT NULL AND aprobado_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM fichaje_correccion c
                        WHERE c.fichaje_id = fichaje.id AND c.estado = 'pendiente')
     RETURNING id`, [limpios, usuarioId]);
  return r.rows.map(x => Number(x.id));
}

/**
 * Todos los fichajes de una semana, de toda la plantilla que ficha.
 *
 * LEFT JOIN y no INNER: quien no fichó ni un día tiene que salir igual, con la
 * fila vacía. Es justo a quien se busca al abrir esta pantalla.
 *
 * Y entra también quien YA NO tiene que fichar pero fichó esa semana (el
 * OR de abajo): si a alguien se le quita el fichaje un jueves, sus tres días
 * anteriores no pueden desaparecer del registro.
 */
async function semanaDeTodos(desde, hasta) {
  const r = await db.consulta(`
    SELECT u.id AS usuario_id,
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien,
           u.ficha_obligatorio,
           f.id, to_char(f.dia, 'YYYY-MM-DD') AS dia, f.entrada, f.salida,
           f.aprobado_at, f.corregido_at
      FROM usuario u
      LEFT JOIN fichaje f ON f.usuario_id = u.id AND f.dia BETWEEN $1::date AND $2::date
     WHERE (u.ficha_obligatorio AND u.estado <> 'bloqueado') OR f.id IS NOT NULL
     ORDER BY quien, f.entrada`, [desde, hasta]);
  return r.rows;
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

// ── Las correcciones que pide cada uno (db/159) ────────────────────────────
// Son PETICIONES: aquí se guardan y, al aprobarlas, se aplican. Las reglas de
// qué se puede pedir están en el servicio.

/** El instante de una hora escrita en Madrid ('AAAA-MM-DDTHH:MM:SS'). */
async function aInstante(texto) {
  if (!texto) return null;
  const r = await db.consulta(`SELECT ${MADRID(1)} AS t`, [texto]);
  return r.rows[0].t;
}

/** Un fichaje por su id, con su dueño. */
async function fichajePorId(id) {
  const r = await db.consulta(`
    SELECT id, usuario_id, to_char(dia, 'YYYY-MM-DD') AS dia, entrada, salida, aprobado_at
      FROM fichaje WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

/**
 * La primera jornada de alguien que se pisa con [entrada, salida). Una jornada
 * abierta llega hasta ahora. Recibe el cliente para poder mirarlo dentro de la
 * misma transacción que luego escribe.
 */
async function solape(cli, usuarioId, entrada, salida, excepto) {
  const r = await cli.query(`
    SELECT id, entrada, salida FROM fichaje
     WHERE usuario_id = $1 AND ($4::bigint IS NULL OR id <> $4)
       AND tstzrange(entrada, COALESCE(salida, now()), '[)')
        && tstzrange($2::timestamptz, COALESCE($3::timestamptz, now()), '[)')
     ORDER BY entrada LIMIT 1`, [usuarioId, entrada, salida, excepto || null]);
  return r.rows[0] || null;
}
const haySolape = (usuarioId, entrada, salida, excepto) =>
  solape({ query: (t, p) => db.consulta(t, p) }, usuarioId, entrada, salida, excepto);

/**
 * Guarda la petición. Si la jornada se quedó ABIERTA de un día pasado, en la
 * misma transacción se cierra con la hora de ahora, como si hubiera pulsado
 * «Salir»: así puede volver a fichar hoy sin esperar a que se la aprueben, y lo
 * que pide queda como corrección de esa salida.
 */
async function pedirCorreccion({ usuarioId, fichajeId, nueva, entrada, salida, motivo, cerrarAhora }) {
  return db.transaccion(async cli => {
    let antes = { entrada: null, salida: null };
    if (fichajeId) {
      const f = (await cli.query(`
        SELECT entrada, salida FROM fichaje WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
        [fichajeId, usuarioId])).rows[0];
      if (!f) throw new Error('Esa jornada no es tuya');
      if (cerrarAhora && !f.salida) {
        const c = await cli.query(`
          UPDATE fichaje SET salida = now(), salida_ubicacion = 'sin_pedir'
           WHERE id = $1 AND salida IS NULL RETURNING salida`, [fichajeId]);
        if (c.rows[0]) f.salida = c.rows[0].salida;
      }
      antes = f;
    }
    try {
      const r = await cli.query(`
        INSERT INTO fichaje_correccion (usuario_id, fichaje_id, nueva, dia, entrada, salida,
                                        entrada_antes, salida_antes, motivo)
        VALUES ($1, $2, $3, (($4::timestamptz AT TIME ZONE '${TZ}')::date), $4, $5, $6, $7, $8)
        RETURNING id, to_char(dia, 'YYYY-MM-DD') AS dia, estado, pedida_at`,
        [usuarioId, fichajeId || null, !!nueva, entrada, salida || null, antes.entrada, antes.salida, motivo]);
      return r.rows[0];
    } catch (e) {
      if (e.code === '23505') {
        throw new Error(nueva
          ? 'Ya tienes pedida una jornada para ese día: retírala si quieres pedir otra'
          : 'Ya tienes una corrección pedida de esa jornada: retírala si quieres pedir otra');
      }
      throw e;
    }
  });
}

const CAMPOS_CORRECCION = `
  c.id, c.usuario_id, c.fichaje_id, c.nueva, to_char(c.dia, 'YYYY-MM-DD') AS dia,
  c.entrada, c.salida, c.entrada_antes, c.salida_antes, c.motivo, c.estado,
  c.pedida_at, c.resuelta_at, c.respuesta`;

/**
 * Las peticiones de alguien en unos días, las más nuevas primero. Entra
 * también la que corrige una jornada de esos días aunque pida moverla a otro.
 */
async function correccionesDe(usuarioId, desde, hasta) {
  const r = await db.consulta(`
    SELECT ${CAMPOS_CORRECCION},
           COALESCE(btrim(q.nombre || ' ' || COALESCE(q.apellidos, '')), '') AS resuelta_por
      FROM fichaje_correccion c
      LEFT JOIN usuario q ON q.id = c.resuelta_por
     WHERE c.usuario_id = $1
       AND (c.dia BETWEEN $2::date AND $3::date
            OR c.fichaje_id IN (SELECT id FROM fichaje
                                 WHERE usuario_id = $1 AND dia BETWEEN $2::date AND $3::date))
     ORDER BY c.pedida_at DESC`, [usuarioId, desde, hasta]);
  return r.rows;
}

/** Lo que espera a quien lleva el registro, lo más viejo primero. */
async function correccionesPendientes(tope = 300) {
  const r = await db.consulta(`
    SELECT ${CAMPOS_CORRECCION},
           btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien,
           -- Cómo está la jornada AHORA, que puede no ser como estaba al pedirla.
           f.entrada AS entrada_ahora, f.salida AS salida_ahora
      FROM fichaje_correccion c
      JOIN usuario u ON u.id = c.usuario_id
      LEFT JOIN fichaje f ON f.id = c.fichaje_id
     WHERE c.estado = 'pendiente'
     ORDER BY c.pedida_at
     LIMIT $1`, [tope]);
  return r.rows;
}

async function cuantasCorrecciones() {
  const r = await db.consulta(`SELECT count(*)::int AS n FROM fichaje_correccion WHERE estado = 'pendiente'`);
  return r.rows[0].n;
}

/**
 * Aprueba o rechaza una petición. Todo en una transacción y con la petición
 * bloqueada: dos pestañas abiertas no pueden aplicar la misma corrección dos
 * veces.
 *
 * Aprobar APLICA la corrección con el mismo rastro que una corrección a mano
 * —lo que había queda en `*_original`, que solo se escribe la primera vez—, la
 * firma quien la pidió (con su motivo) y deja la jornada CONFIRMADA por quien
 * la aprueba: acaba de mirar esas horas exactas. Una jornada que sigue abierta
 * no se confirma, que eso no lo deja la base (ck_fichaje_aprobado).
 */
async function resolverCorreccion(id, { aprobar, respuesta, autor }) {
  return db.transaccion(async cli => {
    const c = (await cli.query(`SELECT * FROM fichaje_correccion WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!c) throw new Error('No existe esa corrección');
    if (c.estado !== 'pendiente') throw new Error('Esa corrección ya está resuelta');

    let fichajeId = c.fichaje_id;
    if (aprobar) {
      if (c.nueva) {
        const pisa = await solape(cli, c.usuario_id, c.entrada, c.salida, null);
        if (pisa) throw new Error('Se pisa con otra jornada que ya tiene ese día: recházala o corrígela a mano');
        const n = await cli.query(`
          INSERT INTO fichaje (usuario_id, dia, entrada, salida,
                               corregido_at, corregido_por, corregido_motivo, aprobado_at, aprobado_por)
          VALUES ($1, (($2::timestamptz AT TIME ZONE '${TZ}')::date), $2, $3, now(), $1, $4, now(), $5)
          RETURNING id`, [c.usuario_id, c.entrada, c.salida, c.motivo, autor]);
        fichajeId = n.rows[0].id;
      } else {
        const f = (await cli.query(`SELECT entrada, salida FROM fichaje WHERE id = $1 FOR UPDATE`, [c.fichaje_id])).rows[0];
        if (!f) throw new Error('Esa jornada ya no existe');
        // Sin salida pedida (la entrada de la jornada de hoy), se queda la que
        // tenga ahora: pudo cerrarla después de pedirlo.
        const salida = c.salida || f.salida;
        if (salida && new Date(salida) <= new Date(c.entrada)) {
          throw new Error('La entrada que pide queda después de su salida: recházala o corrígela a mano');
        }
        const pisa = await solape(cli, c.usuario_id, c.entrada, salida, c.fichaje_id);
        if (pisa) throw new Error('Se pisa con otra jornada suya: recházala o corrígela a mano');
        await cli.query(`
          UPDATE fichaje SET
            entrada_original = COALESCE(entrada_original, entrada),
            salida_original  = COALESCE(salida_original, salida),
            entrada = $2, salida = $3,
            dia = (($2::timestamptz AT TIME ZONE '${TZ}')::date),
            corregido_at = now(), corregido_por = $4, corregido_motivo = $5,
            aprobado_at  = CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE now() END,
            aprobado_por = CASE WHEN $3::timestamptz IS NULL THEN NULL ELSE $6::bigint END
           WHERE id = $1`,
          [c.fichaje_id, c.entrada, salida, c.usuario_id, c.motivo, autor]);
      }
    }

    const r = await cli.query(`
      UPDATE fichaje_correccion
         SET estado = $2, resuelta_at = now(), resuelta_por = $3, respuesta = $4, fichaje_id = $5
       WHERE id = $1
       RETURNING id, estado, fichaje_id, usuario_id`,
      [id, aprobar ? 'aprobada' : 'rechazada', autor, respuesta || null, fichajeId]);
    return r.rows[0];
  });
}

/** Retira una petición propia que nadie ha resuelto todavía. */
async function retirarCorreccion(id, usuarioId) {
  const r = await db.consulta(`
    UPDATE fichaje_correccion
       SET estado = 'retirada', resuelta_at = now(), resuelta_por = $2
     WHERE id = $1 AND usuario_id = $2 AND estado = 'pendiente'
     RETURNING id`, [id, usuarioId]);
  return r.rows[0] || null;
}

/**
 * Quién tiene la llave de aprobar. Es una sola persona (lo vigila la base,
 * db/159); si está bloqueada, es como si no hubiera nadie.
 */
async function quienAprueba() {
  const r = await db.consulta(`
    SELECT u.id, btrim(u.nombre || ' ' || COALESCE(u.apellidos, '')) AS quien
      FROM usuario_permiso p JOIN usuario u ON u.id = p.usuario_id
     WHERE p.clave = '/fichaje/revisar' AND u.estado <> 'bloqueado'
     LIMIT 1`);
  return r.rows[0] || null;
}

module.exports = {
  abierto, entrar, salir, delRango, delDia, semanaDeTodos, corregir, crearAMano, sinCerrar,
  pendientes, aprobar, normUbi, TZ,
  aInstante, fichajePorId, haySolape, pedirCorreccion, correccionesDe, correccionesPendientes,
  cuantasCorrecciones, resolverCorreccion, retirarCorreccion, quienAprueba,
};
