-- ============================================================
-- 94 — Cuántos días de telemetría respaldan una calificación
-- ============================================================
-- Los excesos de velocidad pesan un 20 % de la letra, y son una SUMA del
-- periodo: si faltan días de telemetría, el conductor sale con menos excesos de
-- los que tuvo y su letra sale mejor de lo que es.
--
-- Pasa desde el primer día: las reglas de alerta de Mapon se configuraron el 3
-- de septiembre de 2026 y la API no devuelve nada anterior —se le pide agosto
-- entero y contesta lo mismo—, así que los periodos que empiecen antes del 3/09
-- van con la telemetría a medias y no se pueden rellenar.
--
-- Que eso quede EN LA FILA, y no en la cabeza de quien lanzó el cálculo, es la
-- diferencia entre poder decir "esta letra se calculó con 7 días de telemetría
-- de 14" y no poder explicarla.

BEGIN;

ALTER TABLE conductor_calificacion
  ADD COLUMN IF NOT EXISTS dias_telemetria SMALLINT;

COMMENT ON COLUMN conductor_calificacion.dias_telemetria IS
  'Dias del periodo con datos de telemetria. Si es menor que la ventana, los excesos estan infravalorados y la letra sale mejor de lo que es';

COMMIT;
