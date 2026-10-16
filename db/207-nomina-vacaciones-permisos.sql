-- ============================================================
-- 207 · NÓMINAS — las vacaciones y los permisos en la fila congelada
-- ============================================================
-- Camilo, 16/10/2026: las vacaciones cuentan para llegar al objetivo de horas,
-- por día NATURAL (cogen también días de libranza), a 8 h × 73 % = 5,84 h cada
-- una; y los permisos retribuidos a 8 h por día. Entran en la diferencia que
-- paga el MBO por horas extra.
--
-- La fila congelada guardaba las horas rodadas, la espera quitada y las
-- justificadas, que con el objetivo explicaban la diferencia. Sin estas cuatro,
-- una nómina cerrada ya no se podría explicar sola: la diferencia no saldría
-- de las piezas guardadas.
--
-- Sin valor en lo que ya estuviera congelado (no se sabe). Hasta aplicar esto
-- la nómina se congela y se lee igual que antes: el repositorio mira qué
-- columnas existen.

BEGIN;

ALTER TABLE nomina_fila
  ADD COLUMN IF NOT EXISTS dias_vacaciones  SMALLINT,
  ADD COLUMN IF NOT EXISTS horas_vacaciones NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS dias_permiso     SMALLINT,
  ADD COLUMN IF NOT EXISTS horas_permiso    NUMERIC(8,2);

COMMENT ON COLUMN nomina_fila.horas_vacaciones IS
  'Días de vacaciones del mes (naturales) × horas de un día × % del día de vacaciones (8 × 0,73). Suman para el objetivo. NULL antes de db/207';
COMMENT ON COLUMN nomina_fila.horas_permiso IS
  'Días de permiso retribuido del mes × horas de un día (8). Suman para el objetivo. NULL antes de db/207';

COMMIT;
