-- ============================================================
-- CINCO COCHES QUE YA NO SON DE ESTA OPERACIÓN: se van a Barcelona
-- ============================================================
-- 6287LBG · 6544LVX · 9037LJR · 9107LWS · 9549LTP
--
-- No se BORRAN. Borrar un coche de la base se lleva por delante su ficha, su
-- historial de ITV y seguro, sus plazas y cualquier rastro de que existió; y el
-- día que alguien pregunte "¿de quién era esta multa de julio?" no habrá a qué
-- mirar. Se hacen dos cosas, que juntas dan lo que se pidió:
--
--   1. base_zona = 'Barcelona'  → la ficha DICE dónde están
--   2. baja_at + estado 'B'     → desaparecen de la operación de Madrid
--
-- `baja_at` es lo que los saca de verdad: `v_plaza` —de donde come el
-- planificador— exige `v.baja_at IS NULL`, así que dejan de existir para el
-- tablero, y el listado de /vehiculos los esconde salvo que se pida "incluir
-- bajas". Con solo cambiarles el estado seguirían saliendo en el tablero, en
-- gris pero saliendo, que es justo lo que no se quiere.
--
-- La zona nace `activa = false` A PROPÓSITO: los desplegables de zona (el
-- planificador, la ficha del coche, el generador de vacantes) leen
-- `WHERE activa`, así que Barcelona etiqueta pero nadie puede mandar allí un
-- coche de Madrid por un clic de más. Es una etiqueta, no un destino.
--
-- Ninguno de los cinco tenía a nadie asignado ni lo tuvo NUNCA (cero
-- asignaciones en todo el histórico), así que esto no deja huérfano a nadie.

BEGIN;

-- `nombre_norm` la calcula la propia tabla (columna generada): no se le pasa.
-- Las coordenadas son obligatorias —la tabla nació para calcular distancias a
-- las bases de Madrid— así que van las del centro de Barcelona. Nadie va a
-- medir kilómetros contra ellas: la zona está inactiva.
INSERT INTO base_zona (nombre, lat, lng, activa)
SELECT 'Barcelona', 41.387400, 2.168600, false
 WHERE NOT EXISTS (SELECT 1 FROM base_zona WHERE nombre_norm = 'barcelona');

-- El historial de bases se cierra y se abre como cualquier otra vigencia: si
-- mañana vuelven, se sabrá desde cuándo estuvieron fuera.
UPDATE vehiculo_base_hist h SET hasta = CURRENT_DATE - 1
  FROM vehiculo v
 WHERE v.id = h.vehiculo_id AND h.hasta IS NULL
   AND v.matricula_norm IN ('6287LBG', '6544LVX', '9037LJR', '9107LWS', '9549LTP');

INSERT INTO vehiculo_base_hist (vehiculo_id, base_zona_id, desde)
SELECT v.id, (SELECT id FROM base_zona WHERE nombre_norm = 'barcelona'), CURRENT_DATE
  FROM vehiculo v
 WHERE v.matricula_norm IN ('6287LBG', '6544LVX', '9037LJR', '9107LWS', '9549LTP')
   AND NOT EXISTS (SELECT 1 FROM vehiculo_base_hist x
                    WHERE x.vehiculo_id = v.id AND x.hasta IS NULL);

UPDATE vehiculo SET
    base_zona_id     = (SELECT id FROM base_zona WHERE nombre_norm = 'barcelona'),
    estado_operativo = 'B',
    baja_at          = COALESCE(baja_at, now()),
    notas            = COALESCE(NULLIF(btrim(notas), '') || ' · ', '')
                       || 'Fuera de la operación de Madrid: pasa a Barcelona (09/09/2026)'
 WHERE matricula_norm IN ('6287LBG', '6544LVX', '9037LJR', '9107LWS', '9549LTP');

COMMIT;
