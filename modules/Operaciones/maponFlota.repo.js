// ============================================================
// FLOTA DE MAPON — lo que sabe Telecab de cada unidad
// ============================================================
// Para el inventario de qué sabe hacer cada coche de Mapon (maponFlota.service):
// a qué coche nuestro está enlazada cada unidad (y con eso su sede y su estado)
// y lo que el bot ha hecho de verdad con sus puertas. Solo lectura.

const db = require('../../services/db');

/**
 * Los coches de Telecab, con las unidades de Mapon que tienen enlazadas
 * (vehiculo_alias), su estado con su nombre (Operativo, Taller…) y la matrícula normalizada, para casar también por ella las
 * unidades que no estén enlazadas.
 */
async function coches() {
  const r = await db.consulta(`
    SELECT v.id, v.matricula, v.matricula_norm, v.sede, COALESCE(ev.etiqueta, v.estado_operativo) AS estado_operativo,
           (v.baja_at IS NOT NULL) AS baja,
           COALESCE((SELECT array_agg(a.externo_id::text) FROM vehiculo_alias a
                      WHERE a.vehiculo_id = v.id AND a.sistema = 'mapon'), '{}') AS unidades
      FROM vehiculo v
      LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo`);
  return r.rows;
}

/**
 * Lo que el bot ha hecho con las puertas (puerta_comando), por unidad y por
 * matrícula: aperturas y cierres que salieron bien, los que fallaron y la
 * última vez que funcionó.
 */
async function historialPuertas() {
  const r = await db.consulta(`
    SELECT NULLIF(btrim(COALESCE(unit_id, '')), '') AS unit_id,
           upper(regexp_replace(COALESCE(matricula, ''), '[^A-Za-z0-9]', '', 'g')) AS matricula,
           count(*) FILTER (WHERE comando = 'open_doors'  AND ok)::int AS aperturas_ok,
           count(*) FILTER (WHERE comando = 'close_doors' AND ok)::int AS cierres_ok,
           count(*) FILTER (WHERE NOT ok)::int AS fallos,
           max(pedido_at) FILTER (WHERE ok) AS ultima_ok
      FROM puerta_comando
     GROUP BY 1, 2`);
  return r.rows;
}

module.exports = { coches, historialPuertas };
