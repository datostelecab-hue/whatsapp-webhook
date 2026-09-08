-- ============================================================
-- 70 · RENDIMIENTO — la letra "N" de conductor NUEVO
-- ============================================================
-- Elena llevaba dos días de alta y salía con "0 h · C", como si fuera la peor de
-- la flota. No lo es: es que todavía no ha dado tiempo a saberlo. Los tres
-- primeros días desde el alta no se promedia: se dice "Nuevo conductor" y ya.
--
-- Se añade 'N' a las letras posibles. Esas filas van con horas_prom 0 y dias 0:
-- no son un promedio, son una etiqueta.

BEGIN;

ALTER TABLE conductor_rendimiento DROP CONSTRAINT IF EXISTS ck_rend_letra;
ALTER TABLE conductor_rendimiento
  ADD CONSTRAINT ck_rend_letra CHECK (letra IN ('S','A','B','C','N'));

COMMENT ON COLUMN conductor_rendimiento.letra IS
  'S >= 9 h · A 8-9 · B 6-8 · C < 6 · N = recién incorporado (menos de 3 días de alta): todavía no se promedia.';

COMMIT;
