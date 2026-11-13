// ============================================================
// TAREAS PROGRAMADAS DE NEGOCIO — cada vez, una sola vez (db/246)
// ============================================================
// Pieza A10 de docs/Hoja de ruta.md (13/11/2026). Las tareas que el ERP hace
// solo en su momento —el informe de pendientes de nómina del día 20 (ítem 7),
// los vencimientos del tablero (1), las ITV a 30 días (14)…— se registran aquí:
//
//   tareasProgramadas.registrar({
//     clave: 'nomina.pendientes_dia_20',
//     descripcion: 'Informe de pendientes de nómina',
//     toca: ahora => cuando.mensualHabil(ahora, { dia: 20, hora: '08:00' }),   // '2026-12' o null
//     hacer: async ({ periodo }) => ({ tareas: await crearPendientes(periodo) }),
//   });
//
// En vez de un cron por tarea hay UNO, cada diez minutos, que pregunta a cada
// tarea si ya le toca su vez (`toca`) y, si toca, la hace con `una()`:
//   · una sola vez por tarea y periodo, aunque durante un despliegue haya dos
//     procesos (lo garantiza el índice único de tarea_programada_vez);
//   · si el servidor estaba caído a la hora, la hace en la siguiente vuelta:
//     `toca` sigue diciendo «2026-12» hasta que esté hecha;
//   · si falla, queda apuntado el error y la siguiente vuelta la reintenta;
//   · si el proceso murió con ella a medias, pasado un rato se da por
//     abandonada y se reintenta.
//
// Con MODO_PRUEBAS no arranca (lo decide `programar`, de app.js), como todos.
// Los crons que ya existían en app.js siguen como estaban.
'use strict';

const os = require('os');
const db = require('./db');
const calendario = require('./calendario');

const CADA = '*/10 * * * *';     // cada diez minutos, en hora de Madrid
const CADUCA_MIN = 120;          // en curso más de dos horas = el proceso murió

const INSTANCIA = `${process.env.RENDER_INSTANCE_ID || os.hostname()}:${process.pid}`.slice(0, 120);

// ── Hacer una vez ──────────────────────────────────────────────────────────
/**
 * Hace `fn` una sola vez para (tarea, periodo). Devuelve
 *   { hecha: true, resultado }                       si la ha hecho ahora
 *   { saltada: 'ya hecha' | 'en curso en otro proceso' }
 *   { fallida: true, error }                         si `fn` lanzó (queda apuntado; se reintentará)
 * No lanza: es lo que llama un cron.
 */
async function una(tarea, periodo, fn, { caducaMin = CADUCA_MIN } = {}) {
  const t = String(tarea || ''), p = String(periodo || '').trim();
  if (!/^[a-z][a-z0-9_.]*$/.test(t)) throw new Error(`Nombre de tarea no válido: «${tarea}»`);
  if (!p) throw new Error('Falta el periodo de la tarea');

  // Lo que se quedó a medias hace demasiado: el proceso murió con ello.
  await db.consulta(
    `UPDATE tarea_programada_vez
        SET estado = 'abandonada', acabada_at = clock_timestamp(),
            error = 'Se quedó a medias (el proceso se paró): se vuelve a intentar'
      WHERE tarea = $1 AND periodo = $2 AND estado = 'en_curso'
        AND empezada_at < clock_timestamp() - make_interval(mins => $3)`,
    [t, p, caducaMin]);

  const r = await db.consulta(
    `INSERT INTO tarea_programada_vez (tarea, periodo, instancia) VALUES ($1, $2, $3)
     ON CONFLICT (tarea, periodo) WHERE estado IN ('en_curso', 'hecha') DO NOTHING
     RETURNING id`,
    [t, p, INSTANCIA]);

  if (!r.rows.length) {
    const ya = await db.consulta(
      `SELECT estado FROM tarea_programada_vez
        WHERE tarea = $1 AND periodo = $2 AND estado IN ('en_curso', 'hecha') LIMIT 1`, [t, p]);
    return { saltada: ya.rows[0] && ya.rows[0].estado === 'hecha' ? 'ya hecha' : 'en curso en otro proceso' };
  }

  const id = Number(r.rows[0].id);
  try {
    const resultado = await fn({ periodo: p });
    await db.consulta(
      `UPDATE tarea_programada_vez SET estado = 'hecha', acabada_at = clock_timestamp(), resultado = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(resultado === undefined ? null : resultado)]);
    return { hecha: true, resultado };
  } catch (e) {
    console.error(`❌ [TAREAS] ${t} (${p}) falló: ${e.message}`);
    await db.consulta(
      `UPDATE tarea_programada_vez SET estado = 'fallida', acabada_at = clock_timestamp(), error = $2 WHERE id = $1`,
      [id, String(e.message || e).slice(0, 2000)]);
    return { fallida: true, error: e.message };
  }
}

// ── Cuándo toca ────────────────────────────────────────────────────────────
// Cada una devuelve el periodo que ya debería estar hecho, o null si aún no
// toca. Mientras no esté hecho, lo siguen devolviendo: así se recupera una vez
// que se perdió porque el servidor estaba caído.
const aMinutos = hhmm => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  if (!m) throw new Error(`Hora no válida: «${hhmm}» (va como 08:00)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

const cuando = {
  /** Una vez al día, desde la `hora` de Madrid: el periodo es el día ('2026-12-18'). */
  diaria(ahora, { hora = '00:00' } = {}) {
    const { fecha, min } = calendario.partesMadrid(ahora);
    return min >= aMinutos(hora) ? fecha : null;
  },

  /**
   * Una vez al mes, el día `dia` a la `hora` de Madrid; si ese día no es hábil,
   * el hábil anterior (ítem 7: «si el 20 no es hábil, se genera el día hábil
   * anterior»). El periodo es el mes ('2026-12'). Un mes más corto que `dia`
   * toma su último día.
   */
  async mensualHabil(ahora, { dia, hora = '00:00', sede = 'madrid' } = {}) {
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new Error('mensualHabil: el día va de 1 a 31');
    const { fecha, min } = calendario.partesMadrid(ahora);
    const mes = fecha.slice(0, 7);
    const [y, m] = mes.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const objetivo = `${mes}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
    const cal = await calendario.de(sede);
    const dia0 = cal.habilEnOAntes(objetivo);
    if (fecha > dia0 || (fecha === dia0 && min >= aMinutos(hora))) return mes;
    return null;
  },
};

// ── El registro ────────────────────────────────────────────────────────────
const REGISTRO = new Map();

/**
 * Registra una tarea. `toca(ahora)` devuelve su periodo pendiente o null (puede
 * ser async); `hacer({ periodo, ahora })` la hace y devuelve lo que se apunta
 * como resultado. Devuelve una función que la quita del registro.
 */
function registrar({ clave, descripcion = '', toca, hacer, caducaMin = CADUCA_MIN } = {}) {
  if (!/^[a-z][a-z0-9_.]*$/.test(String(clave || ''))) throw new Error(`Nombre de tarea no válido: «${clave}»`);
  if (typeof toca !== 'function' || typeof hacer !== 'function') throw new Error(`${clave}: faltan «toca» y «hacer»`);
  if (REGISTRO.has(clave)) throw new Error(`La tarea ${clave} ya está registrada`);
  REGISTRO.set(clave, { clave, descripcion, toca, hacer, caducaMin });
  return () => REGISTRO.delete(clave);
}

/** Las tareas registradas: lo que enseñará una pantalla. */
function registradas() {
  return [...REGISTRO.values()].map(({ clave, descripcion }) => ({ clave, descripcion }));
}

/**
 * Una vuelta: a cada tarea que tenga su vez pendiente, la hace (una vez). Una
 * tarea que falla no para a las demás. Devuelve lo que pasó con cada una.
 */
async function revisar(ahora = new Date()) {
  const hechas = [];
  if (!REGISTRO.size || !db.HAY_BD) return hechas;
  for (const t of REGISTRO.values()) {
    try {
      const periodo = await t.toca(ahora);
      if (!periodo) continue;
      const r = await una(t.clave, periodo, ({ periodo: p }) => t.hacer({ periodo: p, ahora }), { caducaMin: t.caducaMin });
      if (r.hecha) console.log(`⏱️  [TAREAS] ${t.clave} (${periodo}) hecha`);
      hechas.push({ clave: t.clave, periodo, ...r });
    } catch (e) {
      console.error(`❌ [TAREAS] ${t.clave}: ${e.message}`);
      hechas.push({ clave: t.clave, fallida: true, error: e.message });
    }
  }
  return hechas;
}

/** Engancha la vuelta con el `programar` de app.js (que con MODO_PRUEBAS no arranca nada). */
function arrancar(programar) {
  return programar(CADA, () => { revisar().catch(e => console.error('❌ [TAREAS] vuelta:', e.message)); },
    { timezone: 'Europe/Madrid' });
}

/** Los últimos intentos (de una tarea o de todas), del más nuevo al más viejo. */
async function ultimas({ tarea = null, limite = 50 } = {}) {
  const r = await db.consulta(
    `SELECT id, tarea, periodo, estado, empezada_at, acabada_at, resultado, error, instancia
       FROM tarea_programada_vez
      WHERE $1::text IS NULL OR tarea = $1
      ORDER BY empezada_at DESC, id DESC
      LIMIT $2`, [tarea, Math.min(Math.max(Number(limite) || 50, 1), 500)]);
  return r.rows.map(f => ({ ...f, id: Number(f.id) }));
}

module.exports = { CADA, una, cuando, registrar, registradas, revisar, arrancar, ultimas };
