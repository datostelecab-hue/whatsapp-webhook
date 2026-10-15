-- ============================================================
-- 202 — LAS PLAZAS Y EL TURNO, DESDE EL ALTA QUE SE CAMBIÓ
-- ============================================================
-- Camilo, 15/10/2026: «A Daniela Patricia Duran Tella se le cambió la fecha de
-- alta, todos los desde tienen que cuadrar con su fecha de alta modificada,
-- verifica que no la planifiquen dos veces en una plaza».
--
-- Cambiar la fecha de alta (Plantilla → «Fecha de alta») solo movía el
-- contrato. El turno, las plazas del planificador y el inicio previsto de
-- Selección se quedaban en la fecha vieja. Desde esta tanda se mueven con ella
-- (conductores.repo.moverConElAlta). Esto arregla a las dos personas a las que
-- ya les pasó:
--
--   · Daniela Patricia Durán Tella (ficha 484), ETT: alta del 15 al 16/10 el
--     15/10. Sus dos plazas de correturnos (5736LGK y 1096MJY), su turno y el
--     inicio previsto seguían en el 15/10. El jueves 15/10 salía planificada de
--     correturnos en el 1096MJY sin estar todavía de alta.
--   · Alejandro Duarte López (ficha 464), ETT: alta del 13 al 14/10 el 09/10.
--     Sus dos plazas, su turno y el inicio previsto seguían en el 13/10.
--
-- Doble planificación no hay: cada día cubre una sola plaza, y en ninguna de
-- esas plazas hay dos personas el mismo día (lo prohíbe ex_asig_plaza).
--
-- Solo se toca una fila si sigue como se vio (persona, plaza y fechas), así que
-- aplicarla dos veces no cambia nada. Cada cambio queda en el historial de su
-- ficha.
BEGIN;

WITH v (tabla, id, conductor_id, antes, ahora) AS (VALUES
  ('asignacion',           1572::bigint, 484::bigint, DATE '2026-10-15', DATE '2026-10-16'),
  ('asignacion',           1573,         484,         DATE '2026-10-15', DATE '2026-10-16'),
  ('asignacion',           1342,         464,         DATE '2026-10-13', DATE '2026-10-14'),
  ('asignacion',           1343,         464,         DATE '2026-10-13', DATE '2026-10-14'),
  ('conductor_turno_hist', 284,          484,         DATE '2026-10-15', DATE '2026-10-16'),
  ('conductor_turno_hist', 261,          464,         DATE '2026-10-13', DATE '2026-10-14'),
  ('candidatura',          102,          484,         DATE '2026-10-15', DATE '2026-10-16'),
  ('candidatura',          86,           464,         DATE '2026-10-13', DATE '2026-10-14')
),
a AS (
  UPDATE asignacion x SET desde = v.ahora FROM v
   WHERE v.tabla = 'asignacion' AND x.id = v.id AND x.conductor_id = v.conductor_id
     AND x.desde = v.antes AND (x.hasta IS NULL OR x.hasta >= v.ahora)
  RETURNING x.conductor_id, 'plazas del planificador'::text AS campo, v.antes, v.ahora
),
t AS (
  UPDATE conductor_turno_hist x SET desde = v.ahora FROM v
   WHERE v.tabla = 'conductor_turno_hist' AND x.id = v.id AND x.conductor_id = v.conductor_id
     AND x.desde = v.antes AND (x.hasta IS NULL OR x.hasta >= v.ahora)
  RETURNING x.conductor_id, 'turno'::text AS campo, v.antes, v.ahora
),
c AS (
  UPDATE candidatura x SET inicio_previsto = v.ahora FROM v
   WHERE v.tabla = 'candidatura' AND x.id = v.id AND x.conductor_id = v.conductor_id
     AND x.inicio_previsto = v.antes
  RETURNING x.conductor_id, 'inicio previsto (Selección)'::text AS campo, v.antes, v.ahora
),
todo AS (SELECT * FROM a UNION ALL SELECT * FROM t UNION ALL SELECT * FROM c)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, campo,
       'desde el ' || to_char(antes, 'DD/MM/YYYY'),
       'desde el ' || to_char(ahora, 'DD/MM/YYYY') || ' (con su fecha de alta; db/202)'
         || CASE WHEN count(*) > 1 THEN ' (' || count(*) || ')' ELSE '' END,
       7, 'migracion'
  FROM todo
 GROUP BY conductor_id, campo, antes, ahora;

COMMIT;
