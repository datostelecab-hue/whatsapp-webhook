-- ============================================================
-- 183 — QUE LA INGESTA TRAIGA YA LOS COCHES DE BARCELONA
-- ============================================================
-- El 07/10/2026 la tarea `vehiculos_otras_sedes` corrió a las 14:44:13, dos
-- minutos ANTES de aplicar db/181. Como no tenía tabla donde guardar, apuntó
-- «falta db/181» como una pasada BUENA, y una pasada buena no vuelve hasta seis
-- horas después (su cadencia): Barcelona se quedó sin matrículas que
-- planificar. Lo mismo hizo `pedidos_otras_sedes` con db/182, pero esa se
-- repite cada hora y ya se recuperó sola.
--
-- Se borran esas pasadas falsas (solo las que dicen «falta db/18…»). La ingesta
-- decide si toca mirando la última pasada buena: sin ella, la tarea corre en el
-- siguiente latido, al minuto de aplicar esto.
--
-- El código ya no lo repite: desde este mismo cambio, una pasada sin sus
-- tablas cuenta como FALLIDA y se reintenta a los diez minutos
-- (services/ingesta.js).

BEGIN;

DELETE FROM ingesta_ejecucion
 WHERE tarea IN ('state_logs_otras_sedes', 'vehiculos_otras_sedes', 'pedidos_otras_sedes')
   AND ok
   AND detalle::text LIKE '%falta db/18%';

COMMIT;
