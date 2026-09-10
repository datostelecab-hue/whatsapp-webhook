-- ============================================================
-- `orden` NO ERA UN NÚMERO DE ORDEN
-- ============================================================
-- Lo llamé así porque así se llama en el resto del código, y le puse SMALLINT
-- dando por hecho que era un 1, 2, 3 dentro del día. No lo es: `mapon.enLocal()`
-- lo rellena con `d.getTime()`, o sea la marca de tiempo del evento en
-- milisegundos (1.788.967.729.000). Un SMALLINT llega a 32.767.
--
-- Se queda con el nombre que tiene en el resto del sistema —cambiarlo aquí y no
-- allí sería peor— pero con el tipo que le corresponde y dicho lo que guarda de
-- verdad, que es lo que evita el siguiente susto.

BEGIN;

ALTER TABLE auditoria_repostaje
  ALTER COLUMN orden TYPE BIGINT;

COMMENT ON COLUMN auditoria_repostaje.orden IS
  'Marca de tiempo del evento en MILISEGUNDOS, tal como la da mapon.enLocal(). Se llama orden por herencia; sirve para ordenar y para no duplicar al recalcular';

COMMIT;
