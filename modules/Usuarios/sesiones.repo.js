// ============================================================
// SESIONES ABIERTAS · REPOSITORIO — y la regla del dispositivo padre
// ============================================================
// Una fila por inicio de sesión (`usuario_sesion`) y una por navegador
// (`usuario_dispositivo`). Las dos hacen falta y no son lo mismo: de un PC sales
// y vuelves a entrar diez veces, y sigue siendo el mismo PC.
//
// ── LA REGLA ────────────────────────────────────────────────────────────────
//
// Solo el dispositivo con el PRIMER inicio de sesión más antiguo puede cerrar
// las sesiones de los demás. Entraste por primera vez en el PC en abril y en el
// móvil en mayo: el PC manda, y desde el móvil no se puede echar al PC.
//
// El motivo es que un robo de sesión se parece mucho a esta pantalla. Quien te
// coge el móvil desbloqueado no puede usarlo para dejarte fuera de tu propio
// ordenador; lo único que puede hacer desde ahí es cerrar lo que ya tiene.
//
// Manda el PRIMER VISTO DEL DISPOSITIVO y no el inicio de la sesión en curso: si
// mandara la sesión, bastaría con que la del padre caducara una noche para que
// el teléfono heredara el mando a la mañana siguiente.
//
// `principal_forzado` mueve el mando, y NO hay pantalla que lo escriba: se hace
// en la base, a mano. Si se pudiera cambiar desde dentro, la regla no protegería
// de nada — el que entrase se haría padre y luego echaría al de verdad.

const db = require('../../services/db');

/** Un id de sesión o de dispositivo: aleatorio y suficientemente largo. */
const nuevoId = () => require('crypto').randomBytes(24).toString('base64url');

// ── Cómo se llama un navegador en pantalla ──────────────────────────────────
/**
 * "Windows · Chrome" a partir del user-agent.
 *
 * El user-agent miente con facilidad, así que esto es una AYUDA para reconocer
 * cuál es cuál —"ah, ese es el del taller"— y nunca lo que decide nada. Quien
 * decide es el identificador de la cookie.
 */
function etiquetaDe(agente) {
  const a = String(agente || '');
  const so = /Android/i.test(a) ? 'Android'
    : /iPhone|iPad|iPod/i.test(a) ? 'iPhone/iPad'
    : /Windows/i.test(a) ? 'Windows'
    : /Macintosh|Mac OS/i.test(a) ? 'Mac'
    : /Linux/i.test(a) ? 'Linux' : 'Dispositivo';
  // El orden importa: Edge y Opera también dicen "Chrome", y Chrome dice
  // "Safari". Se mira de lo más específico a lo más común.
  const nav = /Edg\//i.test(a) ? 'Edge'
    : /OPR\/|Opera/i.test(a) ? 'Opera'
    : /Firefox\//i.test(a) ? 'Firefox'
    : /SamsungBrowser/i.test(a) ? 'Samsung Internet'
    : /Chrome\//i.test(a) ? 'Chrome'
    : /Safari\//i.test(a) ? 'Safari' : '';
  return (so + (nav ? ' · ' + nav : '')).slice(0, 80);
}

// ── Alta de dispositivo y de sesión ─────────────────────────────────────────

/**
 * Deja constancia del dispositivo y devuelve su fila.
 *
 * `primer_visto_at` NO se toca al volver: es lo que decide quién manda, y
 * pisarlo en cada entrada convertiría la regla en "el último que entró", que es
 * justo lo contrario de lo que se quiere.
 */
async function verDispositivo(usuarioId, dispositivo, agente) {
  const r = await db.consulta(
    `INSERT INTO usuario_dispositivo (usuario_id, dispositivo, etiqueta)
     VALUES ($1, $2, $3)
     ON CONFLICT (usuario_id, dispositivo) DO UPDATE
       SET ultimo_visto_at = now(),
           -- La etiqueta sí se refresca: un navegador que se actualiza cambia
           -- su user-agent, y el nombre viejo confundiría a quien mira la lista.
           etiqueta = COALESCE(NULLIF(EXCLUDED.etiqueta, ''), usuario_dispositivo.etiqueta)
     RETURNING *`,
    [usuarioId, dispositivo, etiquetaDe(agente)]);
  return r.rows[0];
}

/** Abre una sesión y devuelve su `sid`, que es lo que viaja en el token. */
async function abrir({ usuarioId, dispositivo, agente, ip, larga, duracionMs }) {
  const disp = dispositivo ? await verDispositivo(usuarioId, dispositivo, agente) : null;
  const sid = nuevoId();
  await db.consulta(
    `INSERT INTO usuario_sesion (sid, usuario_id, dispositivo_id, expira_at, larga, ip, agente)
     VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval, $5, $6, $7)`,
    [sid, usuarioId, disp ? disp.id : null, String(Number(duracionMs) || 0),
     !!larga, String(ip || '').slice(0, 64), String(agente || '').slice(0, 300)]);
  return { sid, dispositivoId: disp ? disp.id : null };
}

/**
 * ¿Sigue abierta esta sesión? Es lo que se pregunta en CADA petición, así que
 * devuelve lo mínimo y se apoya en el índice del `sid`.
 *
 * Devuelve null si no existe, si la cerraron o si caducó.
 */
async function viva(sid) {
  if (!sid) return null;
  const r = await db.consulta(
    `SELECT id, usuario_id, dispositivo_id, vista_at
       FROM usuario_sesion
      WHERE sid = $1 AND cerrada_at IS NULL AND expira_at > now()`, [sid]);
  return r.rows[0] || null;
}

/**
 * Apunta que se ha visto, como mucho una vez cada cinco minutos.
 *
 * Sin el filtro sería una escritura por clic, y lo que se gana con el dato es
 * saber si una sesión está viva hoy — no el segundo exacto.
 */
async function tocar(sid) {
  await db.consulta(
    `UPDATE usuario_sesion SET vista_at = now()
      WHERE sid = $1 AND cerrada_at IS NULL AND vista_at < now() - interval '5 minutes'`,
    [sid]).catch(() => {});
}

// ── Quién manda ─────────────────────────────────────────────────────────────

/**
 * El dispositivo padre de una persona: el forzado si lo hay, y si no el del
 * primer inicio de sesión más antiguo.
 *
 * Devuelve null si la persona no tiene ninguno todavía — y entonces NADIE puede
 * cerrar sesiones ajenas, que es el lado seguro: sin padre conocido, no se
 * reparte el mando por defecto.
 */
async function padreDe(usuarioId) {
  const r = await db.consulta(
    `SELECT id, dispositivo, etiqueta, primer_visto_at, principal_forzado
       FROM usuario_dispositivo
      WHERE usuario_id = $1
      ORDER BY principal_forzado DESC, primer_visto_at, id
      LIMIT 1`, [usuarioId]);
  return r.rows[0] || null;
}

// ── La lista de la pantalla ─────────────────────────────────────────────────

/**
 * Las sesiones abiertas de una persona, la más reciente primero, y con todo lo
 * que la pantalla necesita para explicarse: cuál es la de ahora, cuál es el
 * padre y por qué se puede o no se puede cerrar cada una.
 */
async function listar(usuarioId, sidActual) {
  const [padre, r] = await Promise.all([
    padreDe(usuarioId),
    db.consulta(
      `SELECT s.sid, s.creada_at, s.vista_at, s.expira_at, s.larga, s.ip,
              s.dispositivo_id, d.etiqueta, d.primer_visto_at, d.principal_forzado
         FROM usuario_sesion s
         LEFT JOIN usuario_dispositivo d ON d.id = s.dispositivo_id
        WHERE s.usuario_id = $1 AND s.cerrada_at IS NULL AND s.expira_at > now()
        ORDER BY s.creada_at DESC`, [usuarioId]),
  ]);

  const actual = r.rows.find(x => x.sid === sidActual) || null;
  const mando = !!(padre && actual && actual.dispositivo_id
    && String(actual.dispositivo_id) === String(padre.id));

  return {
    // Si el que mira ES el padre, puede cerrar las de los demás.
    mando,
    padre: padre ? {
      etiqueta: padre.etiqueta || 'Dispositivo',
      desde: padre.primer_visto_at,
      forzado: !!padre.principal_forzado,
      // Si el padre no tiene ninguna sesión abierta, sigue mandando: el mando es
      // del dispositivo, no de la sesión.
      conectado: r.rows.some(x => String(x.dispositivo_id) === String(padre.id)),
    } : null,
    sesiones: r.rows.map(x => ({
      sid: x.sid,
      actual: x.sid === sidActual,
      esPadre: !!(padre && String(x.dispositivo_id) === String(padre.id)),
      etiqueta: x.etiqueta || 'Dispositivo desconocido',
      desde: x.creada_at,
      // Cuándo entró por PRIMERA vez desde ahí, que es la fecha de la regla.
      dispositivoDesde: x.primer_visto_at || null,
      vista: x.vista_at,
      expira: x.expira_at,
      larga: !!x.larga,
      ip: x.ip || '',
    })),
  };
}

// ── Cerrar ──────────────────────────────────────────────────────────────────

/** Cierra UNA sesión por su sid. Devuelve cuántas filas ha tocado. */
async function cerrar(sid, { porUsuarioId, motivo } = {}) {
  const r = await db.consulta(
    `UPDATE usuario_sesion
        SET cerrada_at = now(), cerrada_por = $2, cerrada_motivo = $3
      WHERE sid = $1 AND cerrada_at IS NULL`,
    [sid, porUsuarioId || null, String(motivo || 'manual').slice(0, 40)]);
  return r.rowCount;
}

/** Cierra TODAS las de una persona menos la que se indique. */
async function cerrarLasDemas(usuarioId, sidQueSeQueda, { porUsuarioId, motivo } = {}) {
  const r = await db.consulta(
    `UPDATE usuario_sesion
        SET cerrada_at = now(), cerrada_por = $3, cerrada_motivo = $4
      WHERE usuario_id = $1 AND cerrada_at IS NULL AND sid <> COALESCE($2, '')`,
    [usuarioId, sidQueSeQueda || null, porUsuarioId || null, String(motivo || 'las demas').slice(0, 40)]);
  return r.rowCount;
}

/** La sesión de un sid, con su dueño y su dispositivo. Para poder decidir. */
async function porSid(sid) {
  const r = await db.consulta(
    `SELECT sid, usuario_id, dispositivo_id, cerrada_at FROM usuario_sesion WHERE sid = $1`, [sid]);
  return r.rows[0] || null;
}

module.exports = {
  nuevoId, etiquetaDe, verDispositivo, abrir, viva, tocar,
  padreDe, listar, cerrar, cerrarLasDemas, porSid,
};
