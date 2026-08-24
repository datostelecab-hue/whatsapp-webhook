// ============================================================
// VEHÍCULOS DE BOLT — modelo, año, color y plazas
// ============================================================
// BOLT sabe de cada coche lo que nosotros no: `getVehicles` devuelve modelo,
// año, color, plazas, VIN y número de licencia de transporte, y en las 112
// matrículas reales no falta ninguno.
//
// El maestro de coches se reconstruyó desde el planificador, que solo tenía
// matrícula, estado y zona. Esto rellena el resto.
//
// Solo lo llama `services/ingesta.js`. Ninguna pantalla pregunta a BOLT.

const db = require('../db');

const norm = m => String(m || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

/**
 * Trae el catálogo de vehículos de BOLT y lo vuelca sobre nuestros coches.
 *
 * Dos reglas de las que no se negocian:
 *
 *   · Se casa por MATRÍCULA normalizada. BOLT la escribe con guion o sin él
 *     ("5646-MDM" y "5646MDM" son el mismo coche) y hay placas dadas de alta
 *     varias veces.
 *
 *   · Lo que ha escrito una persona NO se pisa. Si alguien corrigió el modelo a
 *     mano, `datos_origen = 'manual'` y la ingesta lo respeta: al revés, cada
 *     pasada borraría el trabajo de quien lo arregló.
 */
async function sincronizar() {
  const { CONFIG_BOLT, fetchRangoCompleto } = require('../bolt');

  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - 30 * 86400;
  const todos = [];
  for (const f of CONFIG_BOLT.flotas) {
    const v = await fetchRangoCompleto('/fleetIntegration/v1/getVehicles',
      { company_id: f.id }, 'vehicles', desde, hasta, 100, `ingesta-veh-${f.id}`);
    v.forEach(x => todos.push(x));
  }
  if (!todos.length) throw new Error('BOLT no devolvió ningún vehículo');

  // Una matrícula puede venir varias veces: en las dos flotas y con registros
  // viejos que nadie dio de baja. Manda el ACTIVO; si no hay, el más reciente.
  const porPlaca = new Map();
  for (const v of todos) {
    const k = norm(v.reg_number);
    if (!k) continue;
    const prev = porPlaca.get(k);
    if (!prev) { porPlaca.set(k, v); continue; }
    const mejorNuevo = (v.state === 'active' && prev.state !== 'active')
      || (v.state === prev.state && (v.id || 0) > (prev.id || 0));
    if (mejorNuevo) porPlaca.set(k, v);
  }

  // Registros que se contradicen entre sí: mismo coche, distinto modelo o
  // color. No se corrige nada — se informa, que es lo que se puede hacer.
  const discrepan = [];
  const agrupado = new Map();
  todos.forEach(v => {
    const k = norm(v.reg_number);
    if (k) agrupado.set(k, (agrupado.get(k) || []).concat([v]));
  });
  for (const [placa, lista] of agrupado) {
    if (lista.length < 2) continue;
    const modelos = new Set(lista.map(x => String(x.model || '').trim()).filter(Boolean));
    const colores = new Set(lista.map(x => String(x.color || '').trim()).filter(Boolean));
    if (modelos.size > 1 || colores.size > 1) {
      discrepan.push({ placa, modelos: [...modelos], colores: [...colores] });
    }
  }

  const placas = [...porPlaca.keys()];
  const datos = placas.map(k => porPlaca.get(k));

  const r = await db.consulta(`
    UPDATE vehiculo v SET
      marca_modelo        = COALESCE(NULLIF(x.model, ''), v.marca_modelo),
      anio                = COALESCE(x.anio, v.anio),
      color               = COALESCE(NULLIF(x.color, ''), v.color),
      plazas              = COALESCE(x.plazas, v.plazas),
      vin                 = COALESCE(NULLIF(x.vin, ''), v.vin),
      licencia_transporte = COALESCE(NULLIF(x.licencia, ''), v.licencia_transporte),
      datos_origen        = 'bolt',
      datos_at            = now()
    FROM unnest($1::text[], $2::text[], $3::int[], $4::text[], $5::int[], $6::text[], $7::text[])
      AS x(placa, model, anio, color, plazas, vin, licencia)
    WHERE v.matricula_norm = x.placa
      AND v.baja_at IS NULL
      -- Lo escrito a mano se respeta: la ingesta no borra el trabajo de nadie.
      AND COALESCE(v.datos_origen, 'bolt') <> 'manual'
    RETURNING v.id`,
    [placas,
     datos.map(v => String(v.model || '').slice(0, 120)),
     datos.map(v => Number(v.year) || null),
     datos.map(v => String(v.color || '').slice(0, 30)),
     datos.map(v => Number(v.seats) || null),
     datos.map(v => String(v.vin || '').slice(0, 20)),
     datos.map(v => String(v.car_transport_licence_number || '').slice(0, 30))]);

  // Los que BOLT tiene y nosotros no: coches que alguien dio de alta allí y no
  // aquí, o placas viejas que siguen colgando en BOLT.
  const nuestras = new Set((await db.consulta(
    'SELECT matricula_norm FROM vehiculo WHERE baja_at IS NULL')).rows.map(x => x.matricula_norm));
  const soloEnBolt = placas.filter(p => !nuestras.has(p));

  return {
    vistos: todos.length,
    matriculas: placas.length,
    actualizados: r.rowCount,
    soloEnBolt: soloEnBolt.length,
    discrepan: discrepan.length,
    detalleDiscrepan: discrepan.slice(0, 10),
  };
}

module.exports = { sincronizar };
