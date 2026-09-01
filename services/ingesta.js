// ============================================================
// INGESTA — la ÚNICA puerta por la que entran datos externos
// ============================================================
// REGLA: ningún módulo llama a BOLT ni a Mapon para pintar una pantalla. Esta
// función los trae y los deja en PostgreSQL; todo lo demás lee de la base.
//
// Lo que se gana:
//   · Una pantalla no depende de que una API responda. Mapon se cae de vez en
//     cuando por temas de pago y RRHH ni se entera: sigue leyendo lo último que
//     entró, y puede decir de cuándo es.
//   · La cuota de la API se controla en un sitio, no en catorce.
//   · Una respuesta se interpreta UNA vez. Hoy `getVehicles` lo leen la
//     auditoría de flota y la auditoría en vivo, y cada una se queda con cosas
//     distintas del mismo JSON.
//
// SOBRE LA CADENCIA: el latido es cada 5 minutos, pero cada tarea declara cada
// cuánto tiene sentido repetirla. El padrón de conductores no cambia cada cinco
// minutos y pedirlo así son cientos de páginas por hora — ya vimos un 429
// pidiéndolo una sola vez. Cada tarea trae su `cadaMin` y el latido decide.
// Todos se pueden cambiar por variable de entorno sin tocar código.

const db = require('./db');

/**
 * Las tareas de ingesta.
 *
 * `cadaMin`  cada cuánto tiene sentido repetirla
 * `critica`  si fallar es un problema que hay que gritar (BOLT sí, Mapon no:
 *            Mapon se cae y el sistema tiene que seguir)
 */
const TAREAS = {
  padron_bolt: {
    fuente: 'bolt',
    etiqueta: 'Conductores de BOLT',
    cadaMin: Number(process.env.INGESTA_PADRON_BOLT_MIN) || 60,
    critica: true,
    async ejecutar() {
      const r = await require('./cazamientoBolt').sincronizarDesdeBolt();
      return { registros: r.vistas, detalle: r };
    },
  },

  vehiculos_bolt: {
    fuente: 'bolt',
    etiqueta: 'Vehículos de BOLT',
    cadaMin: Number(process.env.INGESTA_VEHICULOS_BOLT_MIN) || 360,
    critica: false,
    async ejecutar() {
      const r = await require('./repo/vehiculosBolt').sincronizar();
      return { registros: r.vistos, detalle: r };
    },
  },

  state_logs_bolt: {
    fuente: 'bolt',
    etiqueta: 'Logs de estado de BOLT',
    // Cada 10 min: es la fuente de la jornada y del panel en vivo. La ventana
    // pedida se solapa a proposito con la anterior; el aterrizaje es idempotente.
    cadaMin: Number(process.env.INGESTA_STATE_LOGS_MIN) || 10,
    critica: true,
    async ejecutar() {
      const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
      const staging = require('./repo/staging');
      const hasta = Math.floor(Date.now() / 1000);
      const desde = hasta - (Number(process.env.INGESTA_STATE_LOGS_VENTANA_H) || 2) * 3600;

      let todos = [], nuevos = 0;
      const t0 = Date.now();
      for (const f of CONFIG_BOLT.flotas) {
        const logs = await fetchAllPaginated('/fleetIntegration/v1/getFleetStateLogs',
          { company_id: f.id, start_ts: desde, end_ts: hasta }, 'state_logs', 1000, `ingesta log ${f.id}`);
        todos = todos.concat(logs);
      }
      // Se guarda el crudo (para auditar/reprocesar) y de ahi cuelgan los eventos.
      const descargaId = await staging.registrarDescarga({
        fuente: 'bolt', endpoint: 'getFleetStateLogs',
        params: { start_ts: desde, end_ts: hasta }, payload: todos,
        filas: todos.length, ms: Date.now() - t0,
      });
      nuevos = await staging.guardarStateLogs(todos, descargaId);
      return { registros: nuevos, detalle: { traidos: todos.length, nuevos } };
    },
  },

  orders_bolt: {
    fuente: 'bolt',
    etiqueta: 'Órdenes de BOLT',
    // Cada hora, no cada diez minutos: las ordenes son para dinero y
    // cancelaciones -cosas mensuales-, no para el panel en vivo. Y la ventana es
    // ancha porque una orden MADURA durante horas: se vuelve a traer para coger
    // su estado y precio finales. El aterrizaje actualiza, no duplica.
    cadaMin: Number(process.env.INGESTA_ORDERS_MIN) || 60,
    critica: false,
    async ejecutar() {
      const { fetchAllPaginated, CONFIG_BOLT } = require('./bolt');
      const staging = require('./repo/staging');
      const hasta = Math.floor(Date.now() / 1000);
      const desde = hasta - (Number(process.env.INGESTA_ORDERS_VENTANA_H) || 48) * 3600;

      let todas = [];
      const t0 = Date.now();
      for (const f of CONFIG_BOLT.flotas) {
        const ordenes = await fetchAllPaginated('/fleetIntegration/v1/getFleetOrders',
          { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created',
            start_ts: desde, end_ts: hasta }, 'orders', 1000, `ingesta orders ${f.id}`);
        todas = todas.concat(ordenes);
      }
      const descargaId = await staging.registrarDescarga({
        fuente: 'bolt', endpoint: 'getFleetOrders',
        params: { start_ts: desde, end_ts: hasta }, payload: todas,
        filas: todas.length, ms: Date.now() - t0,
      });
      const tocadas = await staging.guardarOrders(todas, descargaId);
      return { registros: tocadas, detalle: { traidas: todas.length, tocadas } };
    },
  },

  zonas_mapon: {
    fuente: 'mapon',
    etiqueta: 'Zonas de Mapon (entrada/salida)',
    // Cada 15 min. Es lo que decide si la espera cuenta como area (TE_A1), asi
    // que conviene fresco, pero no tanto como los state logs.
    cadaMin: Number(process.env.INGESTA_ZONAS_MIN) || 15,
    critica: false,
    async ejecutar() {
      const mapon = require('./mapon');
      const staging = require('./repo/staging');
      const t0 = Date.now();
      // La ventana la maneja leerAlertas por fechas; se pide el ultimo dia.
      const hoy = new Date();
      const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
      const iso = d => d.toISOString().slice(0, 10);
      const r = await mapon.leerAlertas({ desde: iso(ayer), hasta: iso(hoy), tipo: 'in_object' });
      const eventos = r.alertas || [];
      const descargaId = await staging.registrarDescarga({
        fuente: 'mapon', endpoint: 'alert/list.json (in_object)',
        params: { desde: iso(ayer), hasta: iso(hoy) }, payload: eventos,
        filas: eventos.length, ms: Date.now() - t0,
      });
      const nuevos = await staging.guardarZonas(eventos, descargaId);
      return { registros: nuevos, detalle: { traidos: eventos.length, nuevos } };
    },
  },

  unidades_mapon: {
    fuente: 'mapon',
    etiqueta: 'Odómetros de Mapon',
    cadaMin: Number(process.env.INGESTA_MAPON_MIN) || 30,
    // Mapon falla de vez en cuando por temas de pago. Que se caiga NO puede
    // parar el resto de la ingesta ni llenar los logs de alarmas rojas.
    critica: false,
    async ejecutar() {
      const r = await require('./sincroMapon').diaria();
      return { registros: r.odometros.actualizados, detalle: r };
    },
  },
};

/** Cuándo se ejecutó por última vez cada tarea, con acierto o sin él. */
async function estado() {
  if (!db.HAY_BD) return { configurada: false, tareas: [] };
  const r = await db.consulta('SELECT * FROM v_ingesta_estado');
  const porTarea = new Map(r.rows.map(x => [x.tarea, x]));
  return {
    configurada: true,
    tareas: Object.entries(TAREAS).map(([tarea, def]) => {
      const u = porTarea.get(tarea) || null;
      return {
        tarea,
        etiqueta: def.etiqueta,
        fuente: def.fuente,
        cadaMin: def.cadaMin,
        critica: def.critica,
        ok: u ? u.ok : null,
        ultima: u ? u.empezada_at : null,
        ultimoAcierto: u ? u.ultimo_acierto : null,
        haceSeg: u ? u.hace_seg : null,
        registros: u ? u.registros : null,
        error: u ? u.error : null,
        // Al día si el último ACIERTO es más reciente que su cadencia con algo
        // de margen. Un fallo puntual no la marca como caída.
        alDia: u && u.ultimo_acierto
          ? (Date.now() - new Date(u.ultimo_acierto).getTime()) < def.cadaMin * 60000 * 2.5
          : false,
      };
    }),
  };
}

/** ¿Toca ya? Se mira el último ACIERTO, no el último intento. */
async function toca(tarea) {
  const def = TAREAS[tarea];
  if (!def) throw new Error(`Tarea de ingesta desconocida: "${tarea}"`);
  const r = await db.consulta(
    `SELECT max(empezada_at) AS ultimo FROM ingesta_ejecucion
      WHERE tarea = $1 AND ok`, [tarea]);
  const ultimo = r.rows[0].ultimo;
  if (!ultimo) return true;
  return (Date.now() - new Date(ultimo).getTime()) >= def.cadaMin * 60000;
}

/**
 * Ejecuta UNA tarea y deja constancia. Nunca lanza: la ingesta de una fuente no
 * puede tumbar la de otra ni el proceso entero.
 */
async function ejecutar(tarea, { forzar = false } = {}) {
  const def = TAREAS[tarea];
  if (!def) throw new Error(`Tarea de ingesta desconocida: "${tarea}"`);
  if (!db.HAY_BD) return { tarea, saltada: 'sin base de datos' };
  if (!forzar && !(await toca(tarea))) return { tarea, saltada: 'todavía es reciente' };

  const t0 = Date.now();
  try {
    const r = await def.ejecutar();
    const ms = Date.now() - t0;
    await db.consulta(
      `INSERT INTO ingesta_ejecucion (fuente, tarea, ok, duracion_ms, registros, detalle)
       VALUES ($1,$2,TRUE,$3,$4,$5)`,
      [def.fuente, tarea, ms, r.registros ?? null, JSON.stringify(r.detalle || {})]);
    console.log(`📥 [INGESTA] ${def.etiqueta}: ${r.registros ?? '?'} registro(s) en ${(ms / 1000).toFixed(1)}s`);
    return { tarea, ok: true, ms, ...r };
  } catch (e) {
    const ms = Date.now() - t0;
    await db.consulta(
      `INSERT INTO ingesta_ejecucion (fuente, tarea, ok, duracion_ms, error)
       VALUES ($1,$2,FALSE,$3,$4)`,
      [def.fuente, tarea, ms, String(e.message).slice(0, 2000)]).catch(() => {});
    // Mapon cayéndose es lo normal, no una alarma. BOLT cayéndose sí lo es.
    const marca = def.critica ? '❌' : '⚠️ ';
    console.error(`${marca} [INGESTA] ${def.etiqueta}: ${e.message}`);
    return { tarea, ok: false, ms, error: e.message };
  }
}

/**
 * El latido. Recorre todas las tareas y ejecuta las que toquen.
 *
 * Van EN SERIE a propósito: en paralelo, dos tareas de BOLT compiten por la
 * misma cuota y se sacan 429s la una a la otra.
 */
async function latido({ forzar = false, soloFuente } = {}) {
  if (!db.HAY_BD) return { saltada: 'sin base de datos' };
  const hechas = [];
  for (const [tarea, def] of Object.entries(TAREAS)) {
    if (soloFuente && def.fuente !== soloFuente) continue;
    hechas.push(await ejecutar(tarea, { forzar }));
  }
  return { hechas };
}

module.exports = { TAREAS, latido, ejecutar, estado, toca };
