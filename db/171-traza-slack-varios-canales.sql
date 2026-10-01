-- ============================================================
-- 171 — «TRAZA POR SLACK» CON VARIOS CANALES
-- ============================================================
-- Camilo, 01/10/2026: «que sea multi selección los canales de slack». La misma
-- traza puede haber quedado en #9-rrhh y en #4-bajas-medicas a la vez.
--
-- Sigue habiendo UNA marca vigente por conductor y jornada (uq_traza_slack_
-- vigente, de db/170): lo que cambia es que esa marca lleva una LISTA de
-- canales. Cambiarla anula la anterior y escribe la nueva, como hasta ahora, así
-- que la historia de qué canales se marcaron y quién los cambió se conserva.
--
-- Las que ya había (3 a la hora de escribir esto) pasan a una lista de uno. La
-- columna `canal` se quita: con la lista no dice nada que la lista no diga.
--
-- Cada canal tiene que seguir pareciendo un canal: la comprobación de db/170,
-- ahora sobre la lista entera (y al menos uno: una traza sin canal no es nada).

BEGIN;

ALTER TABLE control_traza_slack ADD COLUMN IF NOT EXISTS canales TEXT[];
UPDATE control_traza_slack SET canales = ARRAY[canal] WHERE canales IS NULL;
ALTER TABLE control_traza_slack ALTER COLUMN canales SET NOT NULL;

ALTER TABLE control_traza_slack DROP CONSTRAINT IF EXISTS ck_traza_slack_canal;
ALTER TABLE control_traza_slack DROP COLUMN IF EXISTS canal;

ALTER TABLE control_traza_slack ADD CONSTRAINT ck_traza_slack_canales CHECK (
  cardinality(canales) >= 1
  AND array_to_string(canales, ',') ~ '^[a-z0-9][a-z0-9_-]*(,[a-z0-9][a-z0-9_-]*)*$');

COMMENT ON COLUMN control_traza_slack.canales IS
  'Los canales de Slack de la empresa donde quedó la traza, con su nombre exacto (sin #). Uno o varios (db/171).';

COMMIT;
