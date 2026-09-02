// ============================================================
// FLOTA VIVA — el núcleo de KM (trayectos de Mapon)
// ============================================================
// Los km de verdad NO salen del `mileage` de unit/list (llega estancado y la
// resta entre vueltas da 0). Salen de route/list —lo que ve la Auditoría—: una
// fila por trayecto con su distancia Mapon en metros.
//
// Aquí se INGIEREN esos trayectos al núcleo (`fv_ruta`) y se LEEN de ahí. La
// gracia es que las pantallas leen del núcleo sin volver a llamar a la API: una
// sola llamada de flota por vuelta alimenta a todo el mundo. Es la misma idea que
// el resto de Flota Viva —una puerta de entrada, muchas lecturas—, ahora para km.

const db = require('./db');
const fuentes = require('./fuentes');

/** Date → ISO 8601 con Z, que es lo que exige Mapon. */
const iso = d => new Date(d).toISOString().slice(0, 19) + 'Z';

/**
 * Mete en el núcleo (fv_ruta) los trayectos de Mapon de un rango.
 *
 * Idempotente: (unit_id, route_id) es la clave, así que repetir una ventana no
 * duplica —solo refresca los metros y la hora de fin de un trayecto que aún se
 * estaba cerrando—. Se trocea en ventanas para no pedir rangos enormes, y se
 * sube por lotes para que un backfill de dos días sea un puñado de queries, no
 * miles de inserts sueltos.
 */
async function ingestarRutas({ desde, hasta, ventanaDias = 3 } = {}) {
  await db.preparar();
  const fin = hasta ? new Date(hasta) : new Date();
  // Por defecto, algo más de un día hacia atrás: cubre "hoy" con holgura.
  const ini = desde ? new Date(desde) : new Date(fin.getTime() - 26 * 3600 * 1000);

  let trayectos = 0, metros = 0;
  for (let v = new Date(ini); v < fin;) {
    const vFin = new Date(v.getTime() + ventanaDias * 86400000);
    const hastaV = vFin < fin ? vFin : fin;
    const trips = (await fuentes.trayectosFlota(iso(v), iso(hastaV)))
      .filter(t => t.inicio && Number.isFinite(t.unitId) && t.routeId);
    await guardarLote(trips);
    trayectos += trips.length;
    metros += trips.reduce((s, t) => s + t.metros, 0);
    v = vFin;
  }
  return { trayectos, km: Math.round(metros / 100) / 10, desde: iso(ini), hasta: iso(fin) };
}

/** Sube los trayectos por lotes con upsert. Un route/list no repite route_id. */
async function guardarLote(trips) {
  const LOTE = 400;
  for (let i = 0; i < trips.length; i += LOTE) {
    const chunk = trips.slice(i, i + LOTE);
    const vals = [], params = [];
    chunk.forEach((t, k) => {
      const b = k * 7;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
      params.push(t.unitId, t.routeId, t.matricula || null, t.inicio, t.fin, t.metros, t.driverId);
    });
    if (!vals.length) continue;
    await db.consulta(
      `INSERT INTO fv_ruta (unit_id, route_id, matricula, inicio, fin, metros, driver_id)
       VALUES ${vals.join(',')}
       ON CONFLICT (unit_id, route_id) DO UPDATE SET
         matricula = EXCLUDED.matricula, fin = EXCLUDED.fin,
         metros = EXCLUDED.metros, driver_id = EXCLUDED.driver_id`,
      params);
  }
}

/**
 * Km por coche en un día operativo (hora peninsular), leído del núcleo.
 *
 * LA MATRÍCULA SALE DE fv_vehiculo, no de fv_ruta. En route/list el objeto de la
 * unidad no trae la matrícula de forma fiable —por eso la Auditoría la resuelve
 * por unit_id aparte—, así que se cruza `fv_ruta.unit_id` con `fv_vehiculo.mapon_unit`,
 * que da la MISMA matrícula que usa el cockpit (la de BOLT). Si se keyeara por la
 * de fv_ruta, no casaría y todo saldría en cero.
 *
 * Un trayecto cuenta en el día de su INICIO. Devuelve Map(matrícula -> {km, viajes}).
 */
async function kmPorCoche(dia) {
  const r = await db.consulta(
    `SELECT v.matricula, round(sum(r.metros) / 1000.0, 1) AS km, count(*)::int AS viajes
       FROM fv_ruta r
       JOIN fv_vehiculo v ON v.mapon_unit = r.unit_id
      WHERE v.matricula IS NOT NULL
        AND (r.inicio AT TIME ZONE 'Europe/Madrid')::date = $1::date
      GROUP BY v.matricula`, [String(dia).slice(0, 10)]);
  const m = new Map();
  r.rows.forEach(x => m.set(x.matricula, { km: Number(x.km) || 0, viajes: x.viajes }));
  return m;
}

module.exports = { ingestarRutas, guardarLote, kmPorCoche };
