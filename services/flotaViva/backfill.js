// ============================================================
// BACKFILL HISTÓRICO del núcleo — fv_tramo (horas) + bolt_order (financiero)
// ============================================================
// El motor vivo (pasada) va SOLO HACIA DELANTE: no reconstruye el pasado. Tras un
// reset, el histórico se recupera aquí, reusando las mismas fuentes y writes:
//
//   · fv_tramo   → se RECONSTRUYE por coche desde los state-logs históricos de BOLT
//                  (fuentes.estados), con la misma lógica que motor.aplicar(): un
//                  tramo por racha de situación. Como fv_tramo NO es idempotente
//                  (id surrogate, sin ON CONFLICT), se hace delete+reinsert del rango.
//                  SIEMPRE inserta tramos CERRADOS (hasta NOT NULL), así que nunca
//                  choca con el índice del tramo abierto vivo (uq_fv_tramo_abierto):
//                  el backfill llega justo hasta el 'desde' del tramo vivo y ahí para.
//   · bolt_order → se rellena con staging.guardarOrders (idempotente, ON CONFLICT).
//   · fv_ruta (km) NO va aquí: ya lo hace rutas.ingestarRutas / su endpoint.
//
// Por CHUNKS (state-logs 1 día, orders 7 días) para no cargar 2 meses en RAM. El
// estado se ACUMULA entre chunks para no partir un tramo en el borde. Idempotente:
// re-correr un rango da el mismo resultado. Reusa las mismas claves que el latido
// vivo, así que correr los dos a la vez es seguro.

const db = require('./db');                       // pool flotaViva (fv_*)
const fuentes = require('./fuentes');             // estados() históricos de BOLT
const { CONFIG_BOLT, fetchRangoCompleto, sleep } = require('../bolt');
const staging = require('../repo/staging');       // bolt_order (pool principal, idempotente)

const DIA_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const aMs = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// ── fv_tramo: reconstructor por coche ─────────────────────────────────────────
async function backfillTramos({ desde, hasta, chunkDias = 1, pausaMs = 800 } = {}) {
  await db.preparar();
  const desdeMs = aMs(desde);
  const hastaMs = hasta ? aMs(hasta) : Date.now();
  if (!(desdeMs < hastaMs)) throw new Error('backfillTramos: rango vacío o invertido');

  const mapa = await traducir();                  // estado BOLT → situación
  // Solo los coches que ya están en fv_vehiculo (la FK lo exige). El padrón vivo los
  // tiene (se refresca cada 60 min); los que BOLT ya no conoce se quedan fuera.
  const vehSet = new Set((await db.consulta('SELECT uuid FROM fv_vehiculo')).rows.map(r => r.uuid));
  // El tramo VIVO por coche (hasta IS NULL): NO se toca. El backfill llega hasta su
  // 'desde' y para, dejando una costura limpia con lo que gestiona el motor.
  const corteVivo = new Map(
    (await db.consulta(`SELECT vehiculo_uuid, desde FROM fv_tramo WHERE hasta IS NULL`))
      .rows.map(r => [r.vehiculo_uuid, aMs(r.desde)]));
  const corteDe = (uuid) => Math.min(hastaMs, corteVivo.get(uuid) || hastaMs);

  // 1) Borrar los tramos CERRADOS del rango a reconstruir (idempotencia), por coche,
  //    sin tocar el tramo abierto vivo. FK-safe: nada referencia fv_tramo.id.
  let borrados = 0;
  for (const uuid of vehSet) {
    const r = await db.consulta(
      `DELETE FROM fv_tramo
        WHERE vehiculo_uuid = $1 AND hasta IS NOT NULL
          AND desde >= $2::timestamptz AND desde < $3::timestamptz`,
      [uuid, iso(desdeMs), iso(corteDe(uuid))]);
    borrados += r.rowCount || 0;
  }

  // 2) Recorrer el rango por chunks, acumulando el estado entre chunks para no partir
  //    un tramo en el borde (un 'espera' que cruza medianoche sigue siendo UNO).
  const estado = new Map();   // uuid → { sit, cond, estadoBolt, desdeMs }
  let insertados = 0, chunks = 0, errores = 0;
  for (let d = desdeMs; d < hastaMs; d += chunkDias * DIA_MS) {
    const finChunk = Math.min(d + chunkDias * DIA_MS, hastaMs);
    try {
      const porVeh = await fuentes.estados(Math.floor(d / 1000), Math.floor(finChunk / 1000));
      // Conductores nuevos → fv_conductor (FK). uuid basta; el nombre lo pone el padrón.
      const conds = new Set();
      porVeh.forEach(arr => arr.forEach(l => { if (l.conductor) conds.add(l.conductor); }));
      await upsertConductores(conds);

      for (const [uuid, logs] of porVeh) {
        if (!vehSet.has(uuid)) continue;             // no vigilado → no se toca (FK)
        const corte = corteDe(uuid);
        for (const l of logs) {
          const tMs = l.t * 1000;
          if (tMs >= corte) break;                   // no invadir la zona viva
          const sit = mapa.get(l.estado) || 'otro';
          const cur = estado.get(uuid);
          if (!cur) {                                // primer apunte del coche
            estado.set(uuid, { sit, cond: l.conductor || null, estadoBolt: l.estado || null, desdeMs: tMs });
            continue;
          }
          if (cur.sit === sit) {                     // mismo estado = latido, no cambio
            if (l.conductor && !cur.cond) cur.cond = l.conductor;   // rellena conductor si faltaba
            continue;
          }
          await insertarTramo(uuid, cur, tMs);       // cambio → cierra el anterior aquí
          insertados++;
          estado.set(uuid, { sit, cond: l.conductor || null, estadoBolt: l.estado || null, desdeMs: tMs });
        }
      }
    } catch (e) {
      errores++;
      console.error(`⚠️  [FLOTA VIVA] Backfill tramos, chunk ${iso(d).slice(0, 10)}: ${e.message}`);
    }
    chunks++;
    if (pausaMs) await sleep(pausaMs);               // no saturar BOLT (comparte cuota con el cron)
  }

  // 3) Cerrar el último tramo acumulado de cada coche en su corte (toca justo el
  //    'desde' del tramo vivo, sin solaparse). Siempre CERRADO.
  for (const [uuid, cur] of estado) {
    const corte = corteDe(uuid);
    if (cur.desdeMs < corte) { await insertarTramo(uuid, cur, corte); insertados++; }
  }

  const r = { desde: iso(desdeMs), hasta: iso(hastaMs), coches: vehSet.size, chunks, errores, borrados, insertados };
  console.log(`🧩 [FLOTA VIVA] Backfill tramos: ${JSON.stringify(r)}`);
  return r;
}

async function traducir() {
  const r = await db.consulta('SELECT estado, situacion FROM fv_estado_bolt');
  return new Map(r.rows.map(x => [x.estado, x.situacion]));
}

async function upsertConductores(uuidSet) {
  for (const uuid of uuidSet) {
    await db.consulta(
      `INSERT INTO fv_conductor (uuid) VALUES ($1) ON CONFLICT (uuid) DO NOTHING`, [uuid]);
  }
}

async function insertarTramo(uuid, cur, hastaMs) {
  if (!(cur.desdeMs < hastaMs)) return;             // nunca un tramo de duración <= 0
  await db.consulta(
    `INSERT INTO fv_tramo (vehiculo_uuid, conductor_uuid, situacion, estado_bolt, desde, hasta)
     VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz)`,
    [uuid, cur.cond || null, cur.sit, cur.estadoBolt || null, iso(cur.desdeMs), iso(hastaMs)]);
}

// ── bolt_order: financiero (neto/viajes) ──────────────────────────────────────
async function backfillOrders({ desde, hasta, chunkDias = 7, pausaMs = 1200 } = {}) {
  const desdeMs = aMs(desde);
  const hastaMs = hasta ? aMs(hasta) : Date.now();
  if (!(desdeMs < hastaMs)) throw new Error('backfillOrders: rango vacío o invertido');

  let guardadas = 0, chunks = 0, errores = 0;
  for (let d = desdeMs; d < hastaMs; d += chunkDias * DIA_MS) {
    const finChunk = Math.min(d + chunkDias * DIA_MS, hastaMs);
    const desdeTs = Math.floor(d / 1000), hastaTs = Math.floor(finChunk / 1000);
    for (const f of CONFIG_BOLT.flotas) {
      try {
        const tag = `bf-orders ${f.id} ${iso(d).slice(0, 10)}`;
        const ordenes = await fetchRangoCompleto('/fleetIntegration/v1/getFleetOrders',
          { company_ids: [f.id], company_id: f.id, time_range_filter_type: 'created' },
          'orders', desdeTs, hastaTs, 1000, tag);
        await staging.guardarOrders(ordenes, null);   // idempotente (ON CONFLICT DO UPDATE)
        guardadas += ordenes.length;
      } catch (e) {
        // La flota 63530 está cerrada (COMPANY_NOT_ACTIVE) para jul+: no aborta el resto.
        errores++;
        console.error(`⚠️  [FLOTA VIVA] Backfill orders ${f.id} ${iso(d).slice(0, 10)}: ${e.message}`);
      }
    }
    chunks++;
    if (pausaMs) await sleep(pausaMs);
  }
  const r = { desde: iso(desdeMs), hasta: iso(hastaMs), chunks, errores, guardadas };
  console.log(`💶 [FLOTA VIVA] Backfill orders: ${JSON.stringify(r)}`);
  return r;
}

module.exports = { backfillTramos, backfillOrders };
