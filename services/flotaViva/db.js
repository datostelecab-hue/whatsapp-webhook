// ============================================================
// FLOTA VIVA — su propia conexión
// ============================================================
// Módulo aparte a propósito, y no por capricho de arquitectura: este desarrollo
// vive en `main` mientras la migración a PostgreSQL vive en otra rama, y las dos
// necesitan una conexión. Si compartieran fichero, el día del merge habría que
// resolver a mano el trozo más delicado de las dos.
//
// Con su propio pool y su propia variable no se tocan. Y cuando las ramas se
// junten, colapsar dos pools en uno es un rato de trabajo tranquilo; deshacer un
// merge mal resuelto, no.
//
// LA VARIABLE ES SUYA: `FLOTA_VIVA_DB_URL`. Puede apuntar a la misma base que
// todo lo demás —las tablas empiezan por `fv_` y no pisan nada— o a una nueva.
// Esa decisión no se hornea aquí: se cambia una variable y ya.

const { Pool } = require('pg');

const URL = process.env.FLOTA_VIVA_DB_URL || process.env.DATABASE_URL || '';
const HAY_BD = !!URL;

// La interna de Render (sin dominio público) no lleva TLS; la externa sí.
const esExterna = /\.render\.com|amazonaws|\.rds\./i.test(URL);

let _pool = null;

function pool() {
  if (!HAY_BD) {
    throw new Error('FLOTA_VIVA_DB_URL no está definida: la flota viva no tiene dónde guardar');
  }
  if (_pool) return _pool;
  _pool = new Pool({
    connectionString: URL,
    // OCHO. Cuando esto era "un cron y una pantalla" cuatro sobraban, pero el
    // cockpit de Control pide la actividad de los tres turnos a la vez y cada
    // una son cuatro consultas: doce que entraban de cuatro en cuatro.
    //
    // En la MEDIANA no se nota (unos 2 s con cuatro y con ocho), pero el peor
    // caso baja de 4,8 s a 2,0 s, y el peor caso es justo el que se siente como
    // "esto va lento". Sitio hay: la base admite 100 conexiones y entre los dos
    // pools no se pasa de veinte.
    max: Number(process.env.FLOTA_VIVA_POOL_MAX) || 8,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: esExterna ? { rejectUnauthorized: false } : false,
  });
  _pool.on('error', e => console.error('❌ [FLOTA VIVA] conexión inactiva:', e.message));
  console.log(`🐘 [FLOTA VIVA] Pool listo (${esExterna ? 'externa con TLS' : 'interna'})`);
  return _pool;
}

const consulta = (sql, params) => pool().query(sql, params);

/** Varias sentencias como una sola cosa: o entran todas o no entra ninguna. */
async function transaccion(fn) {
  const cli = await pool().connect();
  try {
    await cli.query('BEGIN');
    const r = await fn(cli);
    await cli.query('COMMIT');
    return r;
  } catch (e) {
    await cli.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cli.release();
  }
}

/**
 * Crea las tablas si no están.
 *
 * El esquema se aplica solo, al arrancar. Son cinco tablas de un módulo nuevo
 * que no comparte nada con nadie: pedir que alguien se acuerde de correr un
 * fichero a mano es una forma de que el módulo no funcione el día del despliegue
 * y nadie sepa por qué.
 *
 * ── SOLO SI HA CAMBIADO (28/10/2026) ────────────────────────────────────────
 * Se reaplicaba ENTERO en cada arranque, aunque no cambiara nada. Y aplicarlo
 * bloquea tablas aunque todo sea «IF NOT EXISTS»: fv_cat_situacion, fv_vehiculo
 * y fv_tramo en exclusiva hasta el COMMIT. Al desplegar, con la instancia vieja
 * aún viva y las pantallas reconectando, chocaba con cualquier lectura y salía
 * «deadlock detected» (CRON Mapa y la media de la bitácora, en el log de
 * Render del 28/10). Ahora:
 *
 *   · Se guarda la HUELLA de esquema.sql en `fv_esquema` y, si coincide, no se
 *     ejecuta nada: una lectura y listo. Es lo normal en un despliegue.
 *   · Cuando sí cambia, lo PRIMERO que hace es coger todas las tablas fv_* de
 *     golpe y SIN ESPERAR (LOCK … NOWAIT). Si alguna está ocupada, cede al
 *     momento (55P03) y se reintenta en un rato; si no, ya lo tiene todo y
 *     ninguna sentencia de después puede quedarse esperando con una tabla
 *     cogida, que es lo que cierra un deadlock. Con solo `lock_timeout` no
 *     bastaba: cuenta en cada espera, no en total, y la revisión lo reprodujo
 *     matando a una lectura de la bitácora.
 *   · La huella se escribe en la MISMA transacción que el esquema: o las dos
 *     cosas o ninguna.
 *
 * OJO con un «Rollback» de Render a un commit anterior a este cambio: ese
 * código aplica su esquema.sql sin tocar `fv_esquema`, y al volver a main la
 * huella diría «al día» sin serlo. En ese caso, borrar la fila de `fv_esquema`
 * (con una migración, por el corredor) para que se vuelva a aplicar.
 */
// Se guarda LA PROMESA, no un booleano. Con el booleano la marca se ponía
// DESPUÉS del await, así que varias llamadas a la vez pasaban todas el guardia y
// aplicaban el esquema en paralelo: PostgreSQL las mataba con "deadlock
// detected". Pasaba de verdad en un arranque en frío con varias peticiones a la
// vez, que es justo lo que ocurre al desplegar.
let preparando = null;

// Red de seguridad para lo que no cubra el LOCK de arriba: SIEMPRE por debajo
// del deadlock_timeout (1 s). Un valor raro en la variable se ignora: con
// «0.5s» quitar el punto daba «05s», cinco segundos, y con «0», sin límite.
const ESPERA_BLOQUEO_MS = (() => {
  const v = String(process.env.FLOTA_VIVA_ESQUEMA_LOCK_TIMEOUT || '').trim();
  const m = /^(\d+)(ms)?$/.exec(v);
  const n = m ? Number(m[1]) : NaN;
  if (v && !(n >= 1 && n <= 900)) console.warn(`⚠️  [FLOTA VIVA] FLOTA_VIVA_ESQUEMA_LOCK_TIMEOUT=«${v}» no vale (de 1 a 900 ms): se usan 500 ms`);
  return n >= 1 && n <= 900 ? n : 500;
})();
// Con NOWAIT se cede a menudo, así que se reintenta seguido y durante un minuto.
const REINTENTOS_S = [0.5, 1, 1, 2, 2, 3, 3, 5, 5, 8, 10, 10, 10];
const CEDE = new Set(['55P03', '40P01']);    // lock_not_available, deadlock_detected

// Todas las tablas y vistas fv_* que existan, de golpe y sin esperar.
const COGER_TODO = `
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = current_schema() AND c.relname LIKE 'fv\\_%' AND c.relkind IN ('r', 'p', 'v', 'm')
            ORDER BY c.relname
  LOOP
    EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE NOWAIT', t);
  END LOOP;
END $$;
`;

/**
 * El texto que se manda: el de esquema.sql con dos añadidos dentro de SU
 * transacción, coger todo nada más empezar y la huella justo antes del COMMIT.
 */
function conCandadoYHuella(sql, huella) {
  const ini = sql.search(/^BEGIN;[ \t]*\r?$/m);
  const fin = sql.lastIndexOf('\nCOMMIT;') + 1;
  if (ini < 0 || fin <= 0 || fin < ini) throw new Error('esquema.sql tiene que empezar su transacción con «BEGIN;» y acabarla con «COMMIT;» en líneas propias');
  if (!/^[0-9a-f]+$/.test(huella)) throw new Error('huella rara: ' + huella);
  return sql.slice(0, ini) + 'BEGIN;\n' + COGER_TODO + sql.slice(ini + 'BEGIN;'.length, fin) +
    `\nINSERT INTO fv_esquema (id, huella, aplicado_at) VALUES (1, '${huella}', now())\n` +
    `  ON CONFLICT (id) DO UPDATE SET huella = EXCLUDED.huella, aplicado_at = now();\nCOMMIT;\n`;
}

/** La huella de esquema.sql, sin depender de los saltos de línea del sistema (como el corredor). */
function huellaDe(sql) {
  return require('crypto').createHash('sha256')
    .update(String(sql).replace(/\r\n/g, '\n').trimEnd(), 'utf8').digest('hex').slice(0, 16);
}

/** ¿Ya está aplicado ESTE esquema? Sin `fv_esquema` (base nueva o versión anterior), no. */
async function yaAplicado(huella) {
  try {
    const r = await consulta('SELECT huella FROM fv_esquema WHERE id = 1');
    return !!(r.rows[0] && r.rows[0].huella === huella);
  } catch (e) {
    if (e.code === '42P01') return false;
    throw e;
  }
}

/** Una pasada: el esquema entero, con sus tablas cogidas al empezar y su huella dentro. */
async function aplicarUnaVez(sql, huella) {
  const texto = conCandadoYHuella(sql, huella);
  const cli = await pool().connect();
  let roto = null;
  try {
    await cli.query(`SET lock_timeout = '${ESPERA_BLOQUEO_MS}ms'`);
    await cli.query(texto);
    await cli.query('RESET lock_timeout');
  } catch (e) {
    roto = e;
    throw e;
  } finally {
    // Con error, la conexión se tira: puede haberse quedado a media transacción.
    cli.release(roto || undefined);
  }
}

async function preparar() {
  if (preparando) return preparando;
  preparando = (async () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, 'esquema.sql'), 'utf8');
    const huella = huellaDe(sql);
    if (await yaAplicado(huella)) {
      console.log(`🗂️  [FLOTA VIVA] Esquema al día (${huella}): no se toca`);
      return true;
    }
    for (let intento = 0; ; intento++) {
      try {
        await aplicarUnaVez(sql, huella);
        break;
      } catch (e) {
        if (!CEDE.has(e.code) || intento >= REINTENTOS_S.length) throw e;
        // Un aviso al primer choque y otro cada pocos, no uno por intento.
        if (intento % 4 === 0) {
          console.warn(`⏳ [FLOTA VIVA] Esquema: tablas ocupadas (${e.code}), se cede y se reintenta (intento ${intento + 1} de ${REINTENTOS_S.length + 1})`);
        }
        await new Promise(r => setTimeout(r, REINTENTOS_S[intento] * 1000));
        // Otro proceso con este mismo código puede haberlo aplicado mientras.
        if (await yaAplicado(huella)) {
          console.log(`🗂️  [FLOTA VIVA] Esquema al día (${huella}): lo aplicó otro proceso`);
          return true;
        }
      }
    }
    console.log(`🗂️  [FLOTA VIVA] Esquema listo (${huella})`);
    return true;
  })().catch(e => {
    // Con el código y el detalle: el detalle de un «deadlock detected» dice QUÉ
    // dos procesos chocaron, y sin él no hay forma de saber quién fue el otro.
    console.error(`❌ [FLOTA VIVA] Esquema: ${e.message}${e.code ? ' [' + e.code + ']' : ''}${e.detail ? ' · ' + e.detail : ''}`);
    // Si falla, se olvida: la siguiente petición vuelve a intentarlo en vez de
    // quedarse con el error pegado para toda la vida del proceso.
    preparando = null;
    throw e;
  });
  return preparando;
}

/**
 * Envuelve un grupo de funciones para que ASEGUREN el esquema antes de correr.
 *
 * Antes lo hacía quien llamaba: cada ruta que fuera a leer de flota viva tenía
 * que acordarse de `preparar()` primero. Eso es una precondición de la base
 * viviendo en un controlador —que además es saltarse dos capas— y se rompe el
 * día que alguien añade una ruta y no se acuerda: falla en producción, no aquí.
 *
 * Sale barato porque `preparar` recuerda su promesa: a partir de la primera vez
 * es esperar algo ya resuelto.
 */
function conEsquema(funciones) {
  const out = {};
  for (const [nombre, fn] of Object.entries(funciones)) {
    out[nombre] = typeof fn === 'function'
      ? async (...args) => { await preparar(); return fn(...args); }
      : fn;
  }
  return out;
}

/** Solo para las pruebas: que la siguiente llamada a preparar() vuelva a empezar. */
const _olvidar = () => { preparando = null; };

module.exports = { consulta, transaccion, preparar, conEsquema, HAY_BD, huellaDe, _olvidar };
