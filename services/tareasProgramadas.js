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
//     desde: '2026-12',                         // la primera vez que tiene que hacer
//     toca: ahora => cuando.mensualHabil(ahora, { dia: 20, hora: '08:00' }),
//     hacer: async ({ periodo, cli }) => ({ tareas: await crearPendientes(cli, periodo) }),
//   });
//
// En vez de un cron por tarea hay UNO, cada diez minutos, que pregunta a cada
// tarea qué veces le tocan ya (`toca`) y hace las que no estén hechas:
//
//   · UNA SOLA VEZ por tarea y periodo, aunque durante un despliegue haya dos
//     procesos: `una()` trabaja dentro de una transacción con un cerrojo de la
//     base (pg_try_advisory_xact_lock) y apunta la vez como hecha EN ESA MISMA
//     transacción. `hacer` escribe con el `cli` que recibe, así que su trabajo
//     y el «hecha» entran juntos o no entra ninguno.
//   · SI EL PROCESO MUERE A MEDIAS (un despliegue manda SIGTERM y app.js sale en
//     el acto), la base deshace lo hecho y suelta el cerrojo: la siguiente vuelta
//     la hace entera, sin duplicados y sin esperar.
//   · SI EL SERVIDOR ESTABA CAÍDO A LA HORA, la siguiente vuelta la recupera:
//     `toca` devuelve también la vez anterior (ayer, el mes pasado) mientras no
//     esté hecha. `desde` evita que una tarea recién estrenada haga la de antes.
//   · SI FALLA, queda apuntado el error y se reintenta más tarde (a los 10, 30,
//     60 y 120 minutos); tras 5 fallos se deja y se avisa en el log.
//   · LO QUE SALE FUERA DE LA BASE (un correo, un WhatsApp) no se deshace: va
//     al final de `hacer`, o con su propia marca de «ya enviado».
//   · `hacer` DEVUELVE RECUENTOS (cuántas tareas creó), nunca datos de personas:
//     el resultado se guarda para siempre y solo se quedan números, sí/no y
//     textos cortos.
//
// Con MODO_PRUEBAS no arranca (lo decide `programar`, de app.js), como todos.
// Los crons que ya existían en app.js siguen como estaban.
'use strict';

const os = require('os');
const db = require('./db');
const calendario = require('./calendario');
const repo = require('./repo/tareasProgramadas');

const CADA = '*/10 * * * *';                   // cada diez minutos, en hora de Madrid
const ESPERAS_MIN = [0, 10, 30, 60, 120];       // tras 1, 2, 3, 4 fallos
const MAX_FALLOS = ESPERAS_MIN.length;          // al quinto, se deja
const NOMBRE = /^[a-z][a-z0-9_.]{0,63}$/;

const INSTANCIA = `${process.env.RENDER_INSTANCE_ID || os.hostname()}:${process.pid}`.slice(0, 120);

// ── Lo que se guarda ───────────────────────────────────────────────────────
/** Del resultado, solo números, sí/no y textos cortos: nunca listas de personas. */
function resultadoGuardable(r) {
  if (r == null) return null;
  if (typeof r !== 'object' || Array.isArray(r)) r = { valor: r };
  const limpio = {};
  let quitados = 0;
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'number' && Number.isFinite(v)) limpio[k] = v;
    else if (typeof v === 'bigint') limpio[k] = Number(v);
    else if (typeof v === 'boolean') limpio[k] = v;
    else if (typeof v === 'string' && v.length <= 200 && !v.includes('\u0000')) limpio[k] = v;
    else quitados++;
  }
  if (quitados) limpio._sin_guardar = quitados;
  return JSON.stringify(limpio);
}

// ── Hacer una vez ──────────────────────────────────────────────────────────
const avisadosPorFallos = new Set();

/**
 * Hace `fn({ periodo, cli })` una sola vez para (tarea, periodo). Devuelve
 *   { hecha: true, resultado }
 *   { saltada: 'ya hecha' | 'en curso en otro proceso' | 'esperando para reintentar' | 'demasiados fallos' }
 *   { fallida: true, error }     (queda apuntado; se reintentará)
 * No lanza: es lo que llama un cron.
 */
async function una(tarea, periodo, fn) {
  const t = String(tarea || ''), p = String(periodo == null ? '' : periodo).trim();
  if (!NOMBRE.test(t)) return { fallida: true, error: `Nombre de tarea no válido: «${tarea}»` };
  if (!p || p.length > 40 || typeof periodo !== 'string') return { fallida: true, error: `Periodo no válido: «${periodo}»` };

  const empezada = new Date();
  let resultado;
  try {
    const salida = await db.transaccion(async cli => {
      if (!await repo.bloquear(cli, t, p)) return { saltada: 'en curso en otro proceso' };
      if (await repo.estaHecha(cli, t, p)) return { saltada: 'ya hecha' };
      const f = await repo.fallos(cli, t, p);
      if (f.n >= MAX_FALLOS) {
        if (!avisadosPorFallos.has(`${t}|${p}`)) {
          avisadosPorFallos.add(`${t}|${p}`);
          console.error(`❌ [TAREAS] ${t} (${p}) ha fallado ${f.n} veces: se deja de intentar. Hay que mirarlo.`);
        }
        return { saltada: 'demasiados fallos' };
      }
      if (f.n > 0 && f.minutos != null && f.minutos < ESPERAS_MIN[f.n]) return { saltada: 'esperando para reintentar' };

      resultado = await fn({ periodo: p, cli });
      await repo.apuntarHecha(cli, { tarea: t, periodo: p, empezada, resultado: resultadoGuardable(resultado), instancia: INSTANCIA });
      return { hecha: true, resultado };
    });
    return salida;
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 500);
    console.error(`❌ [TAREAS] ${t} (${p}) falló: ${error}`);
    try {
      await repo.apuntarFallida({ tarea: t, periodo: p, empezada, error, instancia: INSTANCIA });
    } catch (e2) {
      console.error(`❌ [TAREAS] ${t} (${p}): ni siquiera se pudo apuntar el fallo: ${e2.message}`);
    }
    return { fallida: true, error };
  }
}

// ── Cuándo toca ────────────────────────────────────────────────────────────
// Cada una devuelve LAS VECES que ya deberían estar hechas: la de ahora si ya
// toca y la anterior, para recuperarla si se perdió (un servidor caído a la
// hora, un fallo que duró hasta el cambio de día o de mes). `una()` salta las
// hechas, así que repetirlas no cuesta nada.
const aMinutos = hhmm => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  if (!m) throw new Error(`Hora no válida: «${hhmm}» (va como 08:00)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

const mesMas = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const cuando = {
  /**
   * Una vez al día, desde la `hora` de Madrid: ['ayer', 'hoy'] o ['ayer'] si
   * aún no es la hora. Una hora pasada las 23:50 (después de la última vuelta)
   * se hace a las 00:00, como la de ayer.
   */
  diaria(ahora, { hora = '00:00' } = {}) {
    const { fecha, min } = calendario.partesMadrid(ahora);
    const ayer = calendario.sumarDias(fecha, -1);
    return min >= aMinutos(hora) ? [ayer, fecha] : [ayer];
  },

  /**
   * Una vez al mes, el día `dia` a la `hora` de Madrid; si ese día no es hábil,
   * el hábil anterior (ítem 7: «si el 20 no es hábil, se genera el día hábil
   * anterior»), aunque caiga en el mes de antes (el día 1, un domingo, toca el
   * viernes 30). Un mes más corto que `dia` toma su último día. Devuelve los
   * meses que ya tocan: el anterior, este si ya llegó su día, y el siguiente si
   * su día hábil cayó en este mes.
   */
  async mensualHabil(ahora, { dia, hora = '00:00', sede = 'madrid' } = {}) {
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new Error('mensualHabil: el día va de 1 a 31');
    const { fecha, min } = calendario.partesMadrid(ahora);
    const h = aMinutos(hora);
    const cal = await calendario.de(sede);
    const mes = fecha.slice(0, 7);
    const tocan = [];
    for (const m of [mesMas(mes, -1), mes, mesMas(mes, 1)]) {
      const [y, mm] = m.split('-').map(Number);
      const ultimo = new Date(Date.UTC(y, mm, 0)).getUTCDate();
      const dia0 = cal.habilEnOAntes(`${m}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`);
      if (fecha > dia0 || (fecha === dia0 && min >= h)) tocan.push(m);
    }
    return tocan;
  },
};

// ── El registro ────────────────────────────────────────────────────────────
const REGISTRO = new Map();

/**
 * Registra una tarea:
 *   clave        'nomina.pendientes_dia_20'
 *   toca(ahora)  las veces que ya tocan: un periodo, una lista o null (puede ser async)
 *   hacer({ periodo, cli, ahora })  la hace con `cli` y devuelve recuentos
 *   desde        opcional: periodos anteriores no se hacen (para estrenarla sin hacer los de antes)
 * Devuelve una función que la quita del registro.
 */
function registrar({ clave, descripcion = '', toca, hacer, desde = null } = {}) {
  if (!NOMBRE.test(String(clave || ''))) throw new Error(`Nombre de tarea no válido: «${clave}»`);
  if (typeof toca !== 'function' || typeof hacer !== 'function') throw new Error(`${clave}: faltan «toca» y «hacer»`);
  if (desde != null && typeof desde !== 'string') throw new Error(`${clave}: «desde» va como el periodo, en texto`);
  if (REGISTRO.has(clave)) throw new Error(`La tarea ${clave} ya está registrada`);
  REGISTRO.set(clave, { clave, descripcion, toca, hacer, desde });
  return () => REGISTRO.delete(clave);
}

/** Las tareas registradas: lo que enseñará una pantalla. */
function registradas() {
  return [...REGISTRO.values()].map(({ clave, descripcion, desde }) => ({ clave, descripcion, desde }));
}

/**
 * Una vuelta: a cada tarea, las veces que le tocan y no están hechas. Una
 * tarea que falla no para a las demás. Devuelve lo que pasó con cada vez.
 */
async function revisar(ahora = new Date()) {
  const hechas = [];
  if (!REGISTRO.size || !db.HAY_BD) return hechas;
  for (const t of REGISTRO.values()) {
    let periodos;
    try {
      const r = await t.toca(ahora);
      periodos = (Array.isArray(r) ? r : [r]).filter(p => typeof p === 'string' && p && (!t.desde || p >= t.desde));
    } catch (e) {
      console.error(`❌ [TAREAS] ${t.clave}: no se pudo saber si toca: ${e.message}`);
      hechas.push({ clave: t.clave, fallida: true, error: e.message });
      continue;
    }
    for (const periodo of [...new Set(periodos)].sort()) {
      const r = await una(t.clave, periodo, ({ periodo: p, cli }) => t.hacer({ periodo: p, cli, ahora }));
      if (r.hecha) console.log(`⏱️  [TAREAS] ${t.clave} (${periodo}) hecha`);
      hechas.push({ clave: t.clave, periodo, ...r });
    }
  }
  return hechas;
}

/**
 * Engancha la vuelta con el `programar` de app.js (que con MODO_PRUEBAS no
 * arranca nada). Si una vuelta aún no ha acabado, la siguiente no empieza.
 */
function arrancar(programar) {
  let enMarcha = false;
  return programar(CADA, async () => {
    if (enMarcha) return;
    enMarcha = true;
    try { await revisar(); } catch (e) { console.error('❌ [TAREAS] vuelta:', e.message); } finally { enMarcha = false; }
  }, { timezone: 'Europe/Madrid' });
}

/** Los últimos intentos (de una tarea o de todas), del más nuevo al más viejo. */
function ultimas({ tarea = null, limite = 50 } = {}) {
  return repo.ultimas({ tarea, limite: Math.min(Math.max(Number(limite) || 50, 1), 500) });
}

module.exports = { CADA, MAX_FALLOS, una, cuando, registrar, registradas, revisar, arrancar, ultimas };
