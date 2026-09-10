// ============================================================
// AUDITORÍA DE FLOTA — la capa de datos
// ============================================================
// Aquí solo se guarda y se lee. El CÁLCULO —pedirle la traza a Mapon, cruzarla
// con los estados de BOLT y repartir cada metro— vive en services/auditoriaFlota
// y no sabe que esto existe: le da un resultado y se olvida.
//
// ── Un día se guarda ENTERO o no se guarda ──────────────────────────────────
// Recalcular un día borra el suyo y escribe el nuevo, todo en la misma
// transacción. Antes, con la hoja de cálculo, esto era un baile de leer el
// libro entero, filtrar en memoria y reescribirlo; y si fallaba a mitad, el día
// se quedaba a medias. Aquí o entra completo o no cambia nada.
//
// ── Por qué jsonb_to_recordset y no 720 inserts ─────────────────────────────
// Un día son ~144 coches × 5 tramos = 720 filas. Insertarlas de una en una son
// 720 idas y vueltas a Frankfurt. Pasando el lote como JSON, PostgreSQL lo
// convierte en filas y de paso resuelve en el mismo SELECT a qué coche y a qué
// conductor nuestro corresponde cada línea, que es justo lo que la hoja no
// podía hacer.

const db = require('../db');

const TRAMOS = ['completo', 'dia', 'noche', 'manana', 'tarde'];
const n2 = v => Math.round((Number(v) || 0) * 100) / 100;

// ============================================================
// ESCRITURA
// ============================================================

/**
 * Guarda el resultado de UN día. Borra lo que hubiera de ese día y escribe lo
 * nuevo; el `ON DELETE CASCADE` de los conductores se encarga de sus filas.
 *
 * @param {Object} r  { dia, filas[], eventos[] } tal como lo devuelve computarDia
 */
async function guardarDia(r, { segundos } = {}) {
  const dia = String(r.dia);
  const filas = (r.filas || []).filter(f => f.placa);

  const km = filas.map(f => ({
    tramo: TRAMOS.includes(f.turno) ? f.turno : 'completo',
    placa: String(f.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    vehiculo: (f.vehiculo || '').slice(0, 60),
    km_mapon: n2(f.kmMapon), km_pasajero: n2(f.kmPasajero), km_ida: n2(f.kmIda),
    km_espera: n2(f.kmEspera), km_descanso: n2(f.kmDescanso), km_fuera: n2(f.kmFuera),
    h_pedido: n2(f.hPedido), h_espera: n2(f.hEspera), h_descanso: n2(f.hDescanso), h_fuera: n2(f.hFuera),
    km_bolt: n2(f.kmBolt), viajes_bolt: Math.round(Number(f.viajesBolt) || 0),
  }));

  // Los conductores llegan como {uuid, nombre}; de la época de la hoja pueden
  // llegar como cadenas sueltas, y entonces no hay uuid con el que enlazar.
  const conductores = [];
  filas.forEach(f => {
    const tramo = TRAMOS.includes(f.turno) ? f.turno : 'completo';
    const placa = String(f.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const vistos = new Set();
    (f.conductores || []).forEach(c => {
      const uuid = typeof c === 'string' ? '' : String(c.uuid || '');
      const nombre = typeof c === 'string' ? c : String(c.nombre || '');
      const clave = uuid || nombre;
      if (!clave || vistos.has(clave)) return;
      vistos.add(clave);
      conductores.push({ tramo, placa, driver_uuid: clave.slice(0, 64), nombre: nombre.slice(0, 120) || null });
    });
  });

  const eventos = (r.eventos || []).map((e, i) => ({
    ocurrido_at: e.hora && /^\d{2}:\d{2}/.test(e.hora) ? `${dia} ${e.hora.slice(0, 5)}` : null,
    orden: Number(e.orden) || i,
    placa: String(e.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, ''),
    vehiculo: (e.vehiculo || '').slice(0, 60),
    tipo: (e.tipo || '').slice(0, 16),
    litros: e.litros == null ? null : n2(e.litros),
    nivel_antes: e.nivelAntes == null ? null : n2(e.nivelAntes),
    lat: e.lat == null ? null : Number(e.lat),
    lng: e.lng == null ? null : Number(e.lng),
    direccion: (e.direccion || '').slice(0, 200),
    fuente: (e.fuente || '').slice(0, 16),
  })).filter(e => e.placa);

  await db.transaccion(async cli => {
    await cli.query('DELETE FROM auditoria_km WHERE dia = $1', [dia]);
    await cli.query('DELETE FROM auditoria_repostaje WHERE dia = $1', [dia]);

    if (km.length) {
      await cli.query(`
        INSERT INTO auditoria_km (dia, tramo, placa, vehiculo_id, vehiculo,
          km_mapon, km_pasajero, km_ida, km_espera, km_descanso, km_fuera,
          h_pedido, h_espera, h_descanso, h_fuera, km_bolt, viajes_bolt)
        SELECT $1::date, x.tramo, x.placa, v.id, NULLIF(x.vehiculo, ''),
               x.km_mapon, x.km_pasajero, x.km_ida, x.km_espera, x.km_descanso, x.km_fuera,
               x.h_pedido, x.h_espera, x.h_descanso, x.h_fuera, x.km_bolt, x.viajes_bolt
          FROM jsonb_to_recordset($2::jsonb) AS x(
                 tramo text, placa text, vehiculo text,
                 km_mapon numeric, km_pasajero numeric, km_ida numeric, km_espera numeric,
                 km_descanso numeric, km_fuera numeric,
                 h_pedido numeric, h_espera numeric, h_descanso numeric, h_fuera numeric,
                 km_bolt numeric, viajes_bolt int)
          -- El coche de la flota, si lo reconocemos. Que no lo reconozcamos no
          -- es motivo para perder la línea: es motivo para mirarla.
          LEFT JOIN vehiculo v ON v.matricula_norm = x.placa AND v.baja_at IS NULL`,
        [dia, JSON.stringify(km)]);
    }

    if (conductores.length) {
      await cli.query(`
        INSERT INTO auditoria_km_conductor (dia, tramo, placa, driver_uuid, nombre, conductor_id)
        SELECT $1::date, x.tramo, x.placa, x.driver_uuid, NULLIF(x.nombre, ''), e.conductor_id
          FROM jsonb_to_recordset($2::jsonb) AS x(
                 tramo text, placa text, driver_uuid text, nombre text)
          -- De la cuenta de BOLT a la ficha, si está enlazada. Es lo que permite
          -- ir de la persona a sus km fuera de servicio.
          LEFT JOIN conductor_externo e
                 ON e.sistema = 'bolt' AND e.externo_id = x.driver_uuid AND e.conductor_id IS NOT NULL
         WHERE EXISTS (SELECT 1 FROM auditoria_km k
                        WHERE k.dia = $1::date AND k.tramo = x.tramo AND k.placa = x.placa)
        ON CONFLICT (dia, tramo, placa, driver_uuid) DO NOTHING`,
        [dia, JSON.stringify(conductores)]);
    }

    if (eventos.length) {
      await cli.query(`
        INSERT INTO auditoria_repostaje (dia, ocurrido_at, orden, placa, vehiculo_id, vehiculo,
          tipo, litros, nivel_antes, lat, lng, direccion, fuente)
        SELECT $1::date,
               CASE WHEN x.ocurrido_at IS NULL THEN NULL
                    ELSE (x.ocurrido_at::timestamp AT TIME ZONE 'Europe/Madrid') END,
               x.orden, x.placa, v.id, NULLIF(x.vehiculo, ''), NULLIF(x.tipo, ''),
               x.litros, x.nivel_antes, x.lat, x.lng, NULLIF(x.direccion, ''), NULLIF(x.fuente, '')
          FROM jsonb_to_recordset($2::jsonb) AS x(
                 ocurrido_at text, orden smallint, placa text, vehiculo text, tipo text,
                 litros numeric, nivel_antes numeric, lat numeric, lng numeric,
                 direccion text, fuente text)
          LEFT JOIN vehiculo v ON v.matricula_norm = x.placa AND v.baja_at IS NULL
        ON CONFLICT (dia, placa, orden) DO NOTHING`,
        [dia, JSON.stringify(eventos)]);
    }

    await cli.query(`
      INSERT INTO auditoria_dia (dia, calculado_at, ok, error, coches, segundos)
      VALUES ($1::date, now(), TRUE, NULL, $2, $3)
      ON CONFLICT (dia) DO UPDATE
        SET calculado_at = now(), ok = TRUE, error = NULL,
            coches = EXCLUDED.coches, segundos = EXCLUDED.segundos`,
      [dia, new Set(km.map(k => k.placa)).size, segundos == null ? null : Math.round(segundos)]);
  });

  return { dia, filas: km.length, conductores: conductores.length, eventos: eventos.length };
}

/**
 * Un día que falló se anota como fallido SIN borrar lo que hubiera: si ayer se
 * calculó bien y hoy el reintento se cae, lo de ayer sigue estando.
 */
async function marcarFallo(dia, error) {
  await db.consulta(`
    INSERT INTO auditoria_dia (dia, calculado_at, ok, error, coches)
    VALUES ($1::date, now(), FALSE, $2, 0)
    ON CONFLICT (dia) DO UPDATE SET calculado_at = now(), ok = FALSE, error = EXCLUDED.error`,
    [String(dia), String(error || 'error desconocido').slice(0, 2000)]);
}

// ============================================================
// LECTURA
// ============================================================

/**
 * Las líneas de un rango. Todo el filtrado ocurre en SQL: antes se leía la hoja
 * entera y se descartaba en memoria, así que un rango de una semana costaba lo
 * mismo que uno de un año.
 */
async function consultar({ desde, hasta, tramo = 'completo', placa, soloFuera = false } = {}) {
  // tramo '*' devuelve los cinco de una vez: la pantalla los enseña todos y
  // pedirlos por separado serían cinco viajes a Frankfurt para las mismas filas.
  const todos = tramo === '*';
  const par = [String(desde), String(hasta)];
  let extra = '';
  if (!todos) { par.push(TRAMOS.includes(tramo) ? tramo : 'completo'); extra += ` AND k.tramo = $${par.length}`; }
  if (placa) {
    par.push(String(placa).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    extra += ` AND k.placa = $${par.length}`;
  }
  if (soloFuera) extra += ' AND k.km_descanso + k.km_fuera > 0';

  const r = await db.consulta(`
    SELECT to_char(k.dia, 'YYYY-MM-DD') AS dia, k.tramo, k.placa, k.vehiculo, k.vehiculo_id,
           k.km_mapon::float8, k.km_pasajero::float8, k.km_ida::float8, k.km_espera::float8,
           k.km_descanso::float8, k.km_fuera::float8,
           k.h_pedido::float8, k.h_espera::float8, k.h_descanso::float8, k.h_fuera::float8,
           k.km_bolt::float8, k.viajes_bolt,
           COALESCE((SELECT array_agg(COALESCE(c.nombre, c.driver_uuid) ORDER BY c.nombre)
                       FROM auditoria_km_conductor c
                      WHERE c.dia = k.dia AND c.tramo = k.tramo AND c.placa = k.placa),
                    '{}') AS conductores
      FROM auditoria_km k
     WHERE k.dia BETWEEN $1::date AND $2::date ${extra}
     ORDER BY k.dia DESC, k.tramo, k.placa`, par);

  return r.rows.map(x => ({
    dia: x.dia, turno: x.tramo, placa: x.placa,
    matricula: x.placa, vehiculo: x.vehiculo || '', vehiculoId: x.vehiculo_id,
    kmMapon: x.km_mapon, kmPasajero: x.km_pasajero, kmIda: x.km_ida, kmEspera: x.km_espera,
    kmDescanso: x.km_descanso, kmFuera: x.km_fuera,
    hPedido: x.h_pedido, hEspera: x.h_espera, hDescanso: x.h_descanso, hFuera: x.h_fuera,
    kmBolt: x.km_bolt, viajesBolt: x.viajes_bolt,
    conductores: x.conductores || [],
  }));
}

/** Los repostajes de un rango. */
async function repostajes({ desde, hasta, placa } = {}) {
  const par = [String(desde), String(hasta)];
  let extra = '';
  if (placa) {
    par.push(String(placa).toUpperCase().replace(/[^A-Z0-9]/g, ''));
    extra = ` AND r.placa = $${par.length}`;
  }
  const r = await db.consulta(`
    SELECT to_char(r.dia, 'YYYY-MM-DD') AS dia,
           to_char(r.ocurrido_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
           r.orden, r.placa, r.vehiculo, r.tipo, r.litros::float8, r.nivel_antes::float8,
           r.lat::float8, r.lng::float8, r.direccion, r.fuente
      FROM auditoria_repostaje r
     WHERE r.dia BETWEEN $1::date AND $2::date ${extra}
     ORDER BY r.dia DESC, r.placa, r.orden`, par);
  return r.rows.map(x => ({
    dia: x.dia, hora: x.hora || '', orden: x.orden, placa: x.placa, matricula: x.placa,
    vehiculo: x.vehiculo || '', tipo: x.tipo || '', litros: x.litros,
    nivelAntes: x.nivel_antes, lat: x.lat, lng: x.lng,
    direccion: x.direccion || '', fuente: x.fuente || '',
  }));
}

/** Qué días están calculados en un rango, y cuáles fallaron. */
async function dias({ desde, hasta } = {}) {
  const r = await db.consulta(`
    SELECT to_char(dia, 'YYYY-MM-DD') AS dia, ok, error, coches, segundos,
           to_char(calculado_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD HH24:MI') AS calculado_at
      FROM auditoria_dia
     WHERE dia BETWEEN $1::date AND $2::date
     ORDER BY dia`, [String(desde), String(hasta)]);
  return r.rows;
}

/**
 * El ranking que de verdad se mira: quién rodó más km no disponibles en el
 * rango. Sale de la tabla de conductores, así que va de la persona al coche y
 * no al revés.
 *
 * OJO AL LEERLO: son los km DEL COCHE mientras esa persona estaba conectada con
 * él, no los km que condujo ella. Si dos conductores comparten tramo, los dos
 * cargan con el mismo total, así que la columna NO se puede sumar. Para afinar,
 * mirar por tramo 'dia' o 'noche', que ya separa los turnos.
 */
async function porConductor({ desde, hasta, tramo = 'completo', limite = 50 } = {}) {
  const r = await db.consulta(`
    SELECT COALESCE(c.nombre, c.driver_uuid) AS conductor, c.conductor_id,
           count(DISTINCT k.placa)::int AS coches,
           count(DISTINCT k.dia)::int    AS dias,
           sum(k.km_descanso)::float8    AS km_descanso,
           sum(k.km_fuera)::float8       AS km_fuera,
           sum(k.h_descanso)::float8     AS h_descanso,
           sum(k.h_fuera)::float8        AS h_fuera
      FROM auditoria_km_conductor c
      JOIN auditoria_km k ON k.dia = c.dia AND k.tramo = c.tramo AND k.placa = c.placa
     WHERE k.dia BETWEEN $1::date AND $2::date AND k.tramo = $3
       AND (k.km_descanso + k.km_fuera) > 0
     GROUP BY 1, 2
     ORDER BY (sum(k.km_descanso) + sum(k.km_fuera)) DESC
     LIMIT $4`,
    [String(desde), String(hasta), TRAMOS.includes(tramo) ? tramo : 'completo',
      Math.min(Number(limite) || 50, 500)]);
  return r.rows;
}

module.exports = { TRAMOS, guardarDia, marcarFallo, consultar, repostajes, dias, porConductor };
