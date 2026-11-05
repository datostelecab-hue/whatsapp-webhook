-- ============================================================
-- 229 - MODALIDAD DE LAS 40 HORAS: 40x5 Y 40x4
-- ============================================================
-- Un contrato de 40 horas se reparte en 5 días (40x5) o en 4 días (40x4, 10 h
-- al día, para correturnos de 4 días). Hasta hoy solo había «40».
--
-- · `jornada_dias` guarda en cuántos días se reparten las 40 horas. Solo tiene
--   sentido con 40 horas, y solo vale 4 o 5.
-- · A todo contrato ABIERTO de 40 horas le ponemos 5 (40x5): es la modalidad
--   por defecto. Los cerrados se quedan en NULL: se leen como 40x5 igual.
-- · La candidatura (la contratación) guarda la misma pareja, para que lo
--   pactado con la persona llegue al contrato sin volver a elegirlo.
--
-- No cambia cuántos días cubre un correturno de 40 horas: eso lo sigue diciendo
-- el catálogo (cat_jornada.dias_ct). Lo único que cambia es el de 40x4, que
-- cubre 4 días. Ver `diasDeCt` en modules/Conductores/jornada.js.

BEGIN;

ALTER TABLE conductor_periodo_empleo
  ADD COLUMN IF NOT EXISTS jornada_dias SMALLINT;

ALTER TABLE conductor_periodo_empleo
  DROP CONSTRAINT IF EXISTS ck_empleo_jornada_dias;

ALTER TABLE conductor_periodo_empleo
  ADD CONSTRAINT ck_empleo_jornada_dias CHECK (
    jornada_dias IS NULL OR (jornada_horas = 40 AND jornada_dias IN (4, 5)));

COMMENT ON COLUMN conductor_periodo_empleo.jornada_dias IS
  'Días en que se reparten las 40 horas del contrato: 5 (40x5) o 4 (40x4). NULL si no es de 40 horas';

UPDATE conductor_periodo_empleo
   SET jornada_dias = 5
 WHERE baja IS NULL AND jornada_horas = 40 AND jornada_dias IS NULL;

ALTER TABLE candidatura
  ADD COLUMN IF NOT EXISTS jornada_dias SMALLINT;

COMMENT ON COLUMN candidatura.jornada_dias IS
  'Días de la modalidad de 40 horas pactada: 5 (40x5) o 4 (40x4). NULL si no es de 40 horas';

COMMIT;
