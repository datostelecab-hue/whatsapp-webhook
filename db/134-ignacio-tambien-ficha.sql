-- ============================================================
-- 134 — IGNACIO TAMBIÉN FICHA
-- ============================================================
-- Quién tiene que fichar se elige persona a persona (`usuario.ficha_obligatorio`
-- desde /usuarios) y nace apagado para todos. Esto enciende UNA cuenta, la de
-- operaciones, a petición suya.
--
-- Va por EMAIL y no por id: el email es lo que identifica a una persona en el
-- login, y un id suelto en una migración no se puede revisar de un vistazo
-- dentro de seis meses. Si no existiera, no pasa nada: no actualiza ninguna
-- fila y la migración sigue siendo válida.
--
-- Al resto no se les toca: los que no fichan siguen sin fichar.

BEGIN;

UPDATE usuario SET ficha_obligatorio = TRUE
 WHERE lower(email) = 'operaciones@telecab.es';

COMMIT;
