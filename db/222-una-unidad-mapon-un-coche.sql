-- ============================================================
-- 222 — UNA UNIDAD DE MAPON, UN SOLO COCHE VIGENTE
-- ============================================================
-- Lo que tumbó los odómetros del 27 al 28/10/2026 (ver la 221): una unidad de
-- Mapon enlazada a la vez a dos coches. Con este índice ya no se puede:
-- enlazarMapon (modules/Vehiculos/vehiculos.repo.js) crea cada enlace en su
-- propio SAVEPOINT, así que uno que choque sale en «Enlaces rechazados» en vez
-- de dejar a toda la flota sin km.
--
-- Solo Mapon: es un aparato físico que va en un coche. Las otras fuentes
-- (BOLT, Ballenoil) se quedan como estaban.
--
-- Va aparte de la 221 a propósito: si en esta base quedara alguna unidad con
-- dos coches VIVOS, el índice no se podría crear, y fallar aquí no deshace la
-- limpieza urgente de la 221. En ese caso falla con la lista de unidades y
-- matrículas para arreglarlas a mano en Vehículos.

BEGIN;

DO $$
DECLARE
  repetidas text;
BEGIN
  SELECT string_agg(format('unidad %s: %s', externo_id, coches), '; ')
    INTO repetidas
    FROM (SELECT a.externo_id, string_agg(v.matricula || ' (ficha ' || v.id || ')', ', ' ORDER BY v.id) AS coches
            FROM vehiculo_alias a
            JOIN vehiculo v ON v.id = a.vehiculo_id
           WHERE a.sistema = 'mapon' AND a.visto_hasta IS NULL
           GROUP BY a.externo_id
          HAVING count(*) > 1) d;
  IF repetidas IS NOT NULL THEN
    RAISE EXCEPTION 'Hay unidades de Mapon con más de un coche vigente: %. Cerrar el enlace que sobra antes de aplicar la 222.', repetidas;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_valias_mapon_vigente
    ON vehiculo_alias (externo_id)
 WHERE sistema = 'mapon' AND visto_hasta IS NULL;

COMMENT ON INDEX uq_valias_mapon_vigente IS
  'Una unidad de Mapon solo puede estar enlazada a un coche a la vez (db/222, 28/10/2026).';

COMMIT;
