-- ============================================================
-- 130 - LA JORNADA ES LA QUE DIGA EL CONTRATO, NO LA QUE QUEPA EN UNA LISTA
-- ============================================================
-- `ck_empleo_jornada` solo admitía 20, 25, 30, 32, 35 y 40 horas. La lista se
-- escribió mirando lo que hacíamos nosotros, y la realidad no se enteró: en la
-- relación de contratos que manda gigroup a 15/09/2026 hay jornadas de 18, 21,
-- 24, 27 y 29 horas. Ocho personas de las 73 que tienen contrato.
--
-- No son erratas: son contratos firmados, con sus horas y su fecha. Una lista
-- cerrada que la realidad desmiente es un dato disfrazado de código.
--
-- Así que el CHECK pasa a exigir lo único que de verdad tiene que ser cierto:
-- un número entero de horas entre 1 y 40. El 40 es el tope legal de la jornada
-- ordinaria; por debajo cabe cualquier parcial que se firme.
--
-- El desplegable de la ficha sigue ofreciendo las jornadas habituales (ahora
-- con las que existen de verdad), pero ya no es él quien decide qué es válido.

BEGIN;

ALTER TABLE conductor_periodo_empleo
  DROP CONSTRAINT IF EXISTS ck_empleo_jornada;

ALTER TABLE conductor_periodo_empleo
  ADD CONSTRAINT ck_empleo_jornada CHECK (
    jornada_horas IS NULL OR (jornada_horas BETWEEN 1 AND 40));

COMMENT ON COLUMN conductor_periodo_empleo.jornada_horas IS
  'Horas semanales del contrato. Las que diga el contrato: entre 1 y 40';

COMMIT;
