-- ============================================================
-- 192 — EL CONTRATO DE AARON BORJA GONZÁLEZ ERA PROPIO, NO DE ETT
-- ============================================================
-- Camilo, 13/10/2026: «corrige el contrato con migración con la misma alta».
--
-- Aaron (ficha 463) entró por InfoJobs con contrato de Tibus Luxury (plantilla
-- propia). Victor le dio de alta el 07/10 con el «Alta rápida» de /ett, que
-- abre SIEMPRE contrato de ETT GiGroup; el 09/10 alguien corrigió su
-- candidatura a InfoJobs y TIBUS, pero eso no toca el contrato de la ficha, y
-- el planificador le seguía pintando «ETT GiGroup».
--
-- No es un paso de ETT a propia (eso cerraría un tramo de ETT que nunca
-- existió): es un contrato mal tipificado desde el primer día. Se corrige el
-- MISMO periodo, con la misma alta (13/10/2026). La jornada, que el alta rápida
-- no puso, se toma de su candidatura (40 h) si sigue vacía. Su expediente ya
-- está completo para plantilla propia.
--
-- SOLO SI TODO ESTÁ COMO SE VIO: el periodo 456 de la ficha 463, abierto, de
-- ETT GiGroup y con alta el 13/10. Si alguien lo ha tocado ya (o en una base
-- sin estos datos), no hace nada. Queda en el registro de cambios de la ficha.
BEGIN;

WITH corregido AS (
  UPDATE conductor_periodo_empleo e
     SET tipo = 'propia',
         ett_nombre = NULL,
         jornada_horas = COALESCE(e.jornada_horas,
           (SELECT k.jornada_horas FROM candidatura k WHERE k.id = 85 AND k.conductor_id = 463))
   WHERE e.id = 456 AND e.conductor_id = 463
     AND e.tipo = 'ett' AND e.ett_nombre = 'GiGroup'
     AND e.alta = DATE '2026-10-13' AND e.baja IS NULL
  RETURNING e.conductor_id, e.jornada_horas
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'contrato', 'ETT · GiGroup',
       'Plantilla propia desde el 13/10/2026' || COALESCE(', ' || jornada_horas || ' h', '') ||
       ' (corregido: lo abrió el alta rápida de ETT por error; db/192)',
       7, 'migracion'
  FROM corregido;

COMMIT;
