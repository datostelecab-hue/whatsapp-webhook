-- ============================================================
-- 173 — LOS COCHES DE BARCELONA, DE UNA VEZ
-- ============================================================
-- Camilo, 02/10/2026: «verifica que los que estén marcados como Barcelona en
-- la lista de vehículos en realidad sí estén en Barcelona, y mira los vehículos
-- de BOLT de Barcelona si coinciden; si hacen falta, agrégalos. Primero BOLT,
-- luego sistema, y por último Mapon, a ver si coincide la localización».
--
-- Se cruzaron las tres fuentes (Scripts de análisis/auditoria-coches-barcelona.js,
-- 02/10/2026 19:36): BOLT, los coches de la empresa de Barcelona (company 329430)
-- de los últimos 30 días; el sistema, `vehiculo`; y Mapon, la última posición de
-- cada equipo (`fv_posicion`). Cinco coches cuadraban en las tres (0970LJJ,
-- 1888LTJ, 3031LTV, 3784LFV, 5369LJH). Esto arregla lo que no:
--
--   A · TRES COCHES «DADOS DE BAJA» QUE SON DE BARCELONA. El 09/09 salieron de
--       la operación de Madrid con la nota «pasa a Barcelona» y se les dio de
--       baja, porque la sede no existía todavía (llegó con db/132). Están en
--       BOLT Barcelona y Mapon los sitúa en Barcelona hoy: vuelven, con su sede.
--   B · OCHO COCHES DE BOLT BARCELONA QUE NO ESTABAN EN VEHÍCULOS. Cinco con
--       equipo de Mapon en Barcelona; tres sin equipo (no salen en Mapon). Se
--       dan de alta como un alta de Vehículos: estado «B» —como los otros de
--       Barcelona, para que no entren en el cuadrante de Madrid—, sus seis
--       plazas, su estado con fecha y el equipo de Mapon cuando lo hay.
--   C · 3814KYG ES DE MADRID. Estaba como Barcelona, pero en BOLT es de la
--       empresa de Madrid y Mapon lo tiene en Madrid. Ya pasó el 24/09 (se vio en
--       la flota vigilada) y seguía igual.
--
-- LO QUE NO SE TOCA, porque las fuentes no se ponen de acuerdo y lo decide una
-- persona: 1685KTC (de baja el 23/09; en BOLT es de Barcelona, Mapon lo tiene
-- en Madrid), 9549LTP (dos fichas: una de baja «pasa a Barcelona» y otra viva de
-- Madrid en taller; en BOLT está en las dos empresas y no tiene posición de
-- Mapon), 6287LBG (de baja «pasa a Barcelona», no está en BOLT Barcelona ni en
-- Mapon), 3035LTX (Barcelona aquí y en Mapon; en BOLT sigue en la empresa de
-- Madrid) y 8512LDS (Barcelona aquí y en Mapon; no ha salido en BOLT en 30 días).
--
-- Todo va condicionado al estado de hoy (ids y matrículas): si algo ya cambió a
-- mano, no se pisa.

BEGIN;

-- A · Vuelven los tres, como coches de Barcelona.
UPDATE vehiculo v
   SET sede = 'barcelona', baja_at = NULL,
       marca_modelo = COALESCE(v.marca_modelo, x.modelo),
       anio = COALESCE(v.anio, x.anio),
       notas = 'Coche de Barcelona. Se dio de baja el 09/09/2026 al salir de la operación de Madrid, '
            || 'antes de que existiera la sede. Vuelve con su sede el 02/10/2026 (db/173): '
            || 'está en BOLT Barcelona y Mapon lo sitúa en Barcelona.'
  FROM (VALUES (62, '6544LVX', 'Toyota Corolla Touring', 2022),
               (82, '9037LJR', 'Toyota Corolla Touring', 2020),
               (83, '9107LWS', 'Toyota Corolla Touring', 2022)) AS x(id, m, modelo, anio)
 WHERE v.id = x.id AND v.matricula_norm = x.m AND v.baja_at IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vehiculo o WHERE o.matricula_norm = x.m AND o.baja_at IS NULL);

-- B · Las altas.
CREATE TEMP TABLE _bcn (m TEXT, modelo TEXT, anio INT, unit TEXT) ON COMMIT DROP;
INSERT INTO _bcn VALUES
  ('6584KZV', 'Toyota Corolla Touring', 2019, '899740'),
  ('7136LGM', 'Toyota Corolla Touring', 2020, '894581'),
  ('7909LRJ', 'Toyota Corolla Touring', 2021, '894582'),
  ('8750LTR', 'Toyota Corolla Touring', 2021, '893952'),
  ('9133KZF', 'Toyota Corolla Sedan',   2019, '899743'),
  ('2928KGL', 'Mercedes-Benz E220',     2017, NULL),
  ('8074LXG', 'Toyota Corolla Sedan',   2022, NULL),
  ('8477LTR', 'Toyota Corolla Touring', 2021, NULL);

INSERT INTO vehiculo (matricula, estado_operativo, sede, marca_modelo, anio, datos_origen, datos_at, notas)
SELECT b.m, 'B', 'barcelona', b.modelo, b.anio, 'bolt', now(),
       'Coche de Barcelona, dado de alta el 02/10/2026 (db/173): está en la empresa de BOLT de Barcelona'
       || CASE WHEN b.unit IS NOT NULL THEN ' y Mapon lo sitúa en Barcelona (equipo ' || b.unit || ').'
               ELSE '. No tiene equipo de Mapon.' END
  FROM _bcn b
 WHERE NOT EXISTS (SELECT 1 FROM vehiculo v WHERE v.matricula_norm = b.m AND v.baja_at IS NULL);

-- Lo mismo que hace un alta en Vehículos (`vehiculos.repo.crear`): su estado con
-- fecha y sus seis plazas. Solo a los que se acaban de crear.
INSERT INTO vehiculo_estado_hist (vehiculo_id, estado_codigo, desde)
SELECT v.id, 'B', DATE '2026-10-02'
  FROM vehiculo v JOIN _bcn b ON b.m = v.matricula_norm
 WHERE v.baja_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM vehiculo_estado_hist h WHERE h.vehiculo_id = v.id);

INSERT INTO plaza (vehiculo_id, slot, orden_pantalla)
SELECT v.id, s.slot, s.slot
  FROM vehiculo v JOIN _bcn b ON b.m = v.matricula_norm
 CROSS JOIN generate_series(0, 5) AS s(slot)
 WHERE v.baja_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM plaza p WHERE p.vehiculo_id = v.id);

-- Su equipo de Mapon, si lo tiene y no es ya de otro coche.
INSERT INTO vehiculo_alias (vehiculo_id, sistema, externo_id, externo_matricula)
SELECT v.id, 'mapon', b.unit, b.m
  FROM vehiculo v JOIN _bcn b ON b.m = v.matricula_norm
 WHERE v.baja_at IS NULL AND b.unit IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM vehiculo_alias a
                    WHERE a.sistema = 'mapon' AND a.visto_hasta IS NULL
                      AND (a.externo_id = b.unit OR a.vehiculo_id = v.id));

-- C · 3814KYG, a Madrid.
UPDATE vehiculo
   SET sede = 'madrid',
       notas = btrim(COALESCE(notas, '') || ' Estaba como Barcelona, pero en BOLT es de la empresa de Madrid '
            || 'y Mapon lo tiene en Madrid: pasa a Madrid el 02/10/2026 (db/173).')
 WHERE id = 49 AND matricula_norm = '3814KYG' AND sede = 'barcelona';

COMMIT;
