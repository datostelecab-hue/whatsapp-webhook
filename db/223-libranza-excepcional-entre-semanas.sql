-- ============================================================
-- 223 — LA LIBRANZA EXCEPCIONAL PUEDE SER DE SEMANAS DISTINTAS
-- ============================================================
-- Camilo, 28/10/2026: «quita la restricción de la libranza excepcional, que
-- sea de diferentes semanas, no que obligatoriamente sea de la misma».
--
-- Hasta ahora el cambio (trabaja un día que libra y libra uno que trabaja)
-- tenía que caer en la misma semana: el CHECK ck_lexc_semana de db/54 no dejaba
-- más de seis días entre los dos. Se quita. Lo demás se queda:
--   · los dos días tienen que ser distintos (ck_lexc_distintos);
--   · un conductor no puede tener dos cambios en el mismo día (uq_lexc_*).
--
-- f_cobertura ya lee cada día por su cuenta (trabaja ese día / libra ese día),
-- así que no hay que tocarla: cada mitad del cambio sale en su semana.

BEGIN;

ALTER TABLE libranza_excepcional DROP CONSTRAINT IF EXISTS ck_lexc_semana;

COMMENT ON TABLE libranza_excepcional IS
  'Cambio puntual de un fijo: trabaja un día que libra por patrón y libra uno que trabaja, de la misma semana o de semanas distintas (db/223). No toca el patrón; f_cobertura lo lee por encima';

COMMIT;
