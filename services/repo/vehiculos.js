// ============================================================
// VEHÍCULOS — consultas contra PostgreSQL
// ============================================================
// Sustituye a la hoja VEHICULOS, que además estaba vacía: el maestro real se
// reconstruyó desde el planificador.
//
// Todo lo que tenga que ver con vigencias (estado del coche, zona) NO se
// escribe aquí: se delega en `repo/vigencia`, que ya sabe cerrar la anterior y
// abrir la nueva en una sola transacción. Este módulo solo pone lo que es
// propio del coche.

const db = require('../db');
const vig = require('./vigencia');

/**
 * Listado con todo lo que la pantalla necesita, en UNA consulta.
 * Antes esto eran tres lecturas de hojas enteras cruzadas en JavaScript.
 */
async function listar({ estado, zona, busca, incluirBajas = false } = {}) {
  const params = [];
  const donde = [];
  if (!incluirBajas) donde.push('v.baja_at IS NULL');
  if (estado) { params.push(estado); donde.push(`v.estado_operativo = $${params.length}`); }
  if (zona)   { params.push(Number(zona)); donde.push(`v.base_zona_id = $${params.length}`); }
  if (busca && String(busca).trim()) {
    params.push('%' + String(busca).trim().toUpperCase().replace(/[^0-9A-Z]/g, '') + '%');
    const i = params.length;
    params.push('%' + String(busca).trim() + '%');
    donde.push(`(v.matricula_norm LIKE $${i} OR v.marca_modelo ILIKE $${params.length})`);
  }

  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.marca_modelo, v.anio,
           v.fecha_matriculacion, v.itv_caduca, v.aseguradora, v.seguro_caduca,
           v.estado_operativo, e.etiqueta AS estado_etiqueta, e.es_operativo,
           v.base_zona_id, b.nombre AS zona,
           v.km_odometro_m, v.km_odometro_at, v.notas, v.baja_at,
           -- Días que faltan para caducar; negativo = ya caducó.
           (v.itv_caduca    - CURRENT_DATE) AS dias_itv,
           (v.seguro_caduca - CURRENT_DATE) AS dias_seguro,
           -- Cuántas de sus 6 plazas están ocupadas hoy.
           (SELECT count(*) FROM plaza p
             JOIN asignacion a ON a.plaza_id = p.id AND a.hasta IS NULL
            WHERE p.vehiculo_id = v.id AND p.baja_at IS NULL) AS plazas_ocupadas,
           -- Con qué sistemas externos está enlazado.
           (SELECT count(*) FROM vehiculo_alias al
             WHERE al.vehiculo_id = v.id AND al.visto_hasta IS NULL) AS enlaces
    FROM vehiculo v
    LEFT JOIN cat_estado_vehiculo e ON e.codigo = v.estado_operativo
    LEFT JOIN base_zona b ON b.id = v.base_zona_id
    ${donde.length ? 'WHERE ' + donde.join(' AND ') : ''}
    ORDER BY e.orden, v.matricula`, params);
  return r.rows;
}

/** Un coche con su ficha completa: plazas, historial y enlaces externos. */
async function ficha(id) {
  const [v] = (await db.consulta(`
    SELECT v.*, e.etiqueta AS estado_etiqueta, b.nombre AS zona
    FROM vehiculo v
    LEFT JOIN cat_estado_vehiculo e ON e.codigo = v.estado_operativo
    LEFT JOIN base_zona b ON b.id = v.base_zona_id
    WHERE v.id = $1`, [id])).rows;
  if (!v) return null;

  const plazas = (await db.consulta(`
    SELECT p.id, p.slot, t.etiqueta AS turno, s.rol, s.orden_ct,
           a.id AS asignacion_id, a.desde,
           COALESCE(NULLIF(btrim(c.nombre_bolt), ''), COALESCE(c.apellidos || ', ', '') || c.nombre) AS conductor,
           c.id AS conductor_id
    FROM plaza p
    JOIN cat_slot s ON s.slot = p.slot
    JOIN turno t ON t.id = s.turno_id
    LEFT JOIN asignacion a ON a.plaza_id = p.id AND a.hasta IS NULL
    LEFT JOIN conductor c ON c.id = a.conductor_id
    WHERE p.vehiculo_id = $1 AND p.baja_at IS NULL
    ORDER BY p.slot`, [id])).rows;

  const enlaces = (await db.consulta(
    `SELECT sistema, externo_id, externo_matricula, visto_desde
       FROM vehiculo_alias WHERE vehiculo_id = $1 AND visto_hasta IS NULL
      ORDER BY sistema`, [id])).rows;

  return {
    ...v,
    plazas,
    enlaces,
    // El historial sale de la capa común: no se repite el SQL de vigencias.
    historialEstado: await vig.historial('estadoVehiculo', id),
    historialZona: await vig.historial('baseVehiculo', id),
  };
}

/** Contadores para las tarjetas de la cabecera. */
async function resumen() {
  const r = await db.consulta(`
    SELECT e.codigo, e.etiqueta, e.es_operativo, e.orden,
           count(v.id)::int coches
    FROM cat_estado_vehiculo e
    LEFT JOIN vehiculo v ON v.estado_operativo = e.codigo AND v.baja_at IS NULL
    GROUP BY e.codigo, e.etiqueta, e.es_operativo, e.orden ORDER BY e.orden`);
  const alertas = await db.consulta(`
    SELECT count(*) FILTER (WHERE itv_caduca    < CURRENT_DATE)                    itv_caducada,
           count(*) FILTER (WHERE itv_caduca    BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) itv_pronto,
           count(*) FILTER (WHERE seguro_caduca < CURRENT_DATE)                    seguro_caducado,
           count(*) FILTER (WHERE seguro_caduca BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) seguro_pronto,
           count(*) FILTER (WHERE km_odometro_at < now() - INTERVAL '3 days')       odometro_viejo
    FROM vehiculo WHERE baja_at IS NULL`);
  return { porEstado: r.rows, alertas: alertas.rows[0] };
}

/** Catálogos para los desplegables. */
async function catalogos() {
  const [estados, zonas] = await Promise.all([
    db.consulta('SELECT codigo, etiqueta, es_operativo FROM cat_estado_vehiculo ORDER BY orden'),
    db.consulta('SELECT id, nombre FROM base_zona WHERE activa ORDER BY nombre'),
  ]);
  return { estados: estados.rows, zonas: zonas.rows };
}

/** Alta de un coche. La matrícula se normaliza sola en la base. */
async function crear({ matricula, estado = 'O', zonaId, ...resto }, usuarioId) {
  return db.transaccion(async cli => {
    const r = await cli.query(
      `INSERT INTO vehiculo (matricula, estado_operativo, base_zona_id,
         marca_modelo, anio, fecha_matriculacion, itv_caduca, aseguradora, seguro_caduca, notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [matricula, estado, zonaId || null, resto.marcaModelo || null, resto.anio || null,
       resto.matriculacion || null, resto.itv || null, resto.aseguradora || null,
       resto.venceSeguro || null, resto.notas || null]);
    const id = r.rows[0].id;
    const hoy = new Date().toISOString().slice(0, 10);
    await vig.reemplazar('estadoVehiculo', id, { estado_codigo: estado, usuario_id: usuarioId || null },
      { desde: hoy, cerrarAnterior: false, cli });
    if (zonaId) {
      await vig.reemplazar('baseVehiculo', id, { base_zona_id: zonaId, usuario_id: usuarioId || null },
        { desde: hoy, cerrarAnterior: false, cli });
    }
    // Las 6 plazas se crean con el coche: un coche sin plazas no se puede planificar.
    for (let slot = 0; slot < 6; slot++) {
      await cli.query('INSERT INTO plaza (vehiculo_id, slot, orden_pantalla) VALUES ($1,$2,$2)', [id, slot]);
    }
    return id;
  });
}

/**
 * Actualiza la ficha. El estado y la zona NO se escriben a pelo: pasan por
 * `vigencia`, que además deja constancia de cuándo cambiaron y quién lo hizo.
 */
async function actualizar(id, campos, usuarioId) {
  return db.transaccion(async cli => {
    const actual = (await cli.query(
      'SELECT estado_operativo, base_zona_id FROM vehiculo WHERE id = $1', [id])).rows[0];
    if (!actual) throw new Error('No existe ese vehículo');

    const editables = {
      marca_modelo: campos.marcaModelo, anio: campos.anio,
      fecha_matriculacion: campos.matriculacion, itv_caduca: campos.itv,
      aseguradora: campos.aseguradora, seguro_caduca: campos.venceSeguro,
      notas: campos.notas,
    };
    const cols = Object.keys(editables).filter(k => editables[k] !== undefined);
    if (cols.length) {
      await cli.query(
        `UPDATE vehiculo SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...cols.map(c => editables[c] === '' ? null : editables[c])]);
    }

    // Cambio de estado: se abre una vigencia nueva y se cierra la anterior.
    if (campos.estado && campos.estado !== actual.estado_operativo) {
      await vig.reemplazar('estadoVehiculo', id,
        { estado_codigo: campos.estado, usuario_id: usuarioId || null }, { cli });
      await cli.query('UPDATE vehiculo SET estado_operativo = $2 WHERE id = $1', [id, campos.estado]);
    }
    const zonaNueva = campos.zonaId === '' ? null : (campos.zonaId != null ? Number(campos.zonaId) : undefined);
    if (zonaNueva !== undefined && zonaNueva !== actual.base_zona_id) {
      if (zonaNueva) {
        await vig.reemplazar('baseVehiculo', id,
          { base_zona_id: zonaNueva, usuario_id: usuarioId || null }, { cli });
      } else {
        await vig.cerrar('baseVehiculo', id, null, { cli });
      }
      await cli.query('UPDATE vehiculo SET base_zona_id = $2 WHERE id = $1', [id, zonaNueva]);
    }
    return true;
  });
}

/** Baja lógica: el coche desaparece de la flota pero su historia se conserva. */
async function darDeBaja(id, usuarioId) {
  return db.transaccion(async cli => {
    await cli.query('UPDATE vehiculo SET baja_at = now() WHERE id = $1 AND baja_at IS NULL', [id]);
    await cli.query('UPDATE plaza SET baja_at = now() WHERE vehiculo_id = $1 AND baja_at IS NULL', [id]);
    // Las asignaciones vivas se cierran hoy: nadie conduce un coche dado de baja.
    await cli.query(
      `UPDATE asignacion SET hasta = CURRENT_DATE
        WHERE hasta IS NULL AND plaza_id IN (SELECT id FROM plaza WHERE vehiculo_id = $1)`, [id]);
    await vig.cerrar('estadoVehiculo', id, null, { cli });
    await vig.cerrar('baseVehiculo', id, null, { cli });
    return true;
  });
}

/**
 * Vuelca los odómetros de Mapon. Se llama desde el cron diario.
 * `lecturas` = Map(unit_id → { odometroCanM, ... }) tal como lo da mapon.unidades().
 *
 * 🚨 Se escribe SOLO `odometroCanM`, que es el odómetro del cuadro leído del CAN.
 * El otro campo de Mapon, `odometroM` (su `mileage`), NO es el odómetro del
 * coche: son los km recorridos desde que se instaló el dispositivo. Se estuvo
 * guardando ese, y por eso /vehiculos enseñaba 30.723 km en un coche que lleva
 * 629.100 (5886LBZ, comprobado contra el taller el 09/09/2026).
 *
 * Los coches cuyo GPS no lee el CAN se quedan SIN dato en vez de con uno falso.
 * Para esos hace falta un anclaje manual: km del cuadro en una fecha, y a partir
 * de ahí `mileage` mantiene la cuenta sumando su propio incremento.
 */
async function sincronizarOdometros(lecturas) {
  if (!lecturas || !lecturas.size) return { actualizados: 0, sinEnlace: 0, sinCan: 0, fotos: 0 };
  let actualizados = 0, sinEnlace = 0, sinCan = 0, fotos = 0;
  await db.transaccion(async cli => {
    for (const [unitId, u] of lecturas) {
      const can = Number.isFinite(u.odometroCanM) && u.odometroCanM > 0 ? u.odometroCanM : null;
      const gps = Number.isFinite(u.odometroM) && u.odometroM > 0 ? u.odometroM : null;
      if (can == null) sinCan++;
      if (can == null && gps == null) continue;
      // El enlace pasa SIEMPRE por vehiculo_alias: la matrícula de Mapon no se
      // usa para casar, solo para diagnosticar descuadres.
      //
      // El odómetro solo se toca si hay CAN — COALESCE deja el anterior si esta
      // vez no vino. El contador del GPS se guarda siempre: es lo que mantiene
      // vivas las anclas de los coches sin CAN.
      const r = await cli.query(
        `UPDATE vehiculo
            SET km_odometro_m  = COALESCE($2, km_odometro_m),
                km_odometro_at = CASE WHEN $2 IS NULL THEN km_odometro_at ELSE now() END,
                km_gps_m       = COALESCE($3, km_gps_m)
          WHERE id = (SELECT vehiculo_id FROM vehiculo_alias
                       WHERE sistema = 'mapon' AND externo_id = $1 AND visto_hasta IS NULL)
            AND baja_at IS NULL
          RETURNING id`,
        [String(unitId), can, gps]);
      if (r.rowCount) { if (can != null) actualizados++; } else sinEnlace++;
    }

    // La foto del día. Sale de la vista, que es donde vive la regla del
    // odómetro; aquí solo se copia. La última lectura del día es la que queda.
    const f = await cli.query(`
      INSERT INTO vehiculo_km_dia (vehiculo_id, dia, km, gps_m, visto_at)
      SELECT o.vehiculo_id, (now() AT TIME ZONE 'Europe/Madrid')::date, o.km, v.km_gps_m, now()
        FROM v_vehiculo_odometro o
        JOIN vehiculo v ON v.id = o.vehiculo_id
       WHERE o.km IS NOT NULL AND v.baja_at IS NULL
      ON CONFLICT (vehiculo_id, dia) DO UPDATE
        SET km = EXCLUDED.km, gps_m = EXCLUDED.gps_m, visto_at = now()`);
    fotos = f.rowCount;
  });
  return { actualizados, sinEnlace, sinCan, fotos };
}

/**
 * Enlaza los coches con sus unidades de Mapon.
 *
 * Aqui SI se casa por matricula, y no contradice la regla de "el nombre nunca
 * identifica": una matricula es un identificador legal y unico del vehiculo,
 * no una forma de escribir algo. Aun asi se guarda la matricula tal como la
 * escribe Mapon (`externo_matricula`), que es lo que permite detectar despues
 * que alguien la cambio alli sin avisar.
 *
 * `unidades` = Map(unit_id -> { matricula, vehiculo, odometroM, ... })
 */
async function enlazarMapon(unidades, { soloVer = false } = {}) {
  const norm = m => String(m || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const nuestros = new Map((await db.consulta(
    'SELECT id, matricula_norm, matricula FROM vehiculo WHERE baja_at IS NULL'))
    .rows.map(r => [r.matricula_norm, r]));

  // Coches que YA tienen unidad vigente: no se les toca.
  const yaTienen = new Map((await db.consulta(
    `SELECT vehiculo_id, externo_id FROM vehiculo_alias
      WHERE sistema = 'mapon' AND visto_hasta IS NULL`))
    .rows.map(r => [r.vehiculo_id, r.externo_id]));

  // VARIAS unidades con la misma matricula: pasa cuando se cambia el GPS y la
  // vieja no se da de baja en Mapon. No se elige por nosotros — el odometro
  // dependeria de cual se leyera la ultima. Se informa y se deja sin enlazar.
  const porMatricula = new Map();
  for (const [unitId, u] of unidades) {
    const k = norm(u.matricula);
    if (!k) continue;
    if (!porMatricula.has(k)) porMatricula.set(k, []);
    porMatricula.get(k).push({ unitId: String(unitId), ...u });
  }

  const nuevos = [], sinCoche = [], ambiguas = [], yaEnlazados = [];
  for (const [k, lista] of porMatricula) {
    const veh = nuestros.get(k);
    if (!veh) { lista.forEach(u => sinCoche.push({ unitId: u.unitId, matricula: u.matricula, vehiculo: u.vehiculo })); continue; }
    if (yaTienen.has(veh.id)) { yaEnlazados.push(veh.matricula); continue; }
    if (lista.length > 1) {
      ambiguas.push({
        matricula: veh.matricula,
        unidades: lista.map(u => ({ unitId: u.unitId, vehiculo: u.vehiculo, odometroM: u.odometroM, ultimoDato: u.ultimoDato })),
      });
      continue;
    }
    nuevos.push({ unitId: lista[0].unitId, vehiculoId: veh.id, matricula: veh.matricula, enMapon: lista[0].matricula });
  }

  const sinUnidad = (await db.consulta(
    `SELECT v.matricula FROM vehiculo v WHERE v.baja_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM vehiculo_alias a
                        WHERE a.vehiculo_id = v.id AND a.sistema = 'mapon' AND a.visto_hasta IS NULL)
     ORDER BY v.matricula`)).rows
    .map(v => v.matricula)
    .filter(m => !nuevos.some(n => n.matricula === m) && !ambiguas.some(a => a.matricula === m));

  if (soloVer) return { nuevos, sinCoche, ambiguas, sinUnidad, yaEnlazados: yaEnlazados.length, aplicado: false };

  let creados = 0;
  const rechazados = [];
  await db.transaccion(async cli => {
    for (const n of nuevos) {
      // Punto de guardado: un choque no puede tumbar los 86 enlaces restantes.
      await cli.query('SAVEPOINT sp');
      try {
        const r = await cli.query(
          `INSERT INTO vehiculo_alias (vehiculo_id, sistema, externo_id, externo_matricula)
           VALUES ($1, 'mapon', $2, $3) RETURNING id`,
          [n.vehiculoId, n.unitId, n.enMapon]);
        await cli.query('RELEASE SAVEPOINT sp');
        if (r.rowCount) creados++;
      } catch (err) {
        await cli.query('ROLLBACK TO SAVEPOINT sp');
        rechazados.push(`${n.matricula} (unidad ${n.unitId}): ${String(err.message).split(String.fromCharCode(10))[0]}`);
      }
    }
  });
  return { nuevos: creados, sinCoche, ambiguas, sinUnidad, yaEnlazados: yaEnlazados.length, rechazados, aplicado: true };
}

module.exports = {
  listar, ficha, resumen, catalogos,
  crear, actualizar, darDeBaja,
  enlazarMapon, sincronizarOdometros,
};
