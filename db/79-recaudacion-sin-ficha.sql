-- ============================================================
-- DEUDA DE QUIEN NO ESTÁ EN LA PLANTILLA
-- ============================================================
-- Christian Muñoz De La Guia cobró 145,00 € en efectivo en 11 viajes de agosto.
-- Existe en BOLT, con su teléfono, y no existe en `conductor`: nunca se le hizo
-- ficha. Esa deuda es real y no se le puede reclamar a nadie porque el módulo
-- solo sabe hablar de conductores.
--
-- NO se le crea una ficha para taparlo. Una ficha dice "esta persona trabaja o
-- trabajó aquí", y meter a alguien en la plantilla para poder cobrarle
-- ensuciaría el sitio donde se cuenta cuánta gente hay: aparecería en altas, en
-- bajas, en los listados. La deuda se ancla a su CUENTA DE BOLT, que es lo que
-- de verdad tenemos de él.
--
-- Así que tanto los cierres como los movimientos apuntan a UNA de dos cosas:
--   · conductor_id → alguien de la plantilla
--   · bolt_uuid    → una cuenta de BOLT sin ficha (sale marcada en rojo)
-- Nunca a las dos, y nunca a ninguna (salvo las salidas de caja, que no son de
-- nadie). El nombre de esas cuentas ya lo guarda `conductor_externo`.

BEGIN;

-- ── Los cierres ────────────────────────────────────────────────────────────
ALTER TABLE recaudacion_cierre ALTER COLUMN conductor_id DROP NOT NULL;
ALTER TABLE recaudacion_cierre ADD COLUMN IF NOT EXISTS bolt_uuid VARCHAR(64);

ALTER TABLE recaudacion_cierre DROP CONSTRAINT IF EXISTS ck_recaud_cierre_quien;
ALTER TABLE recaudacion_cierre ADD CONSTRAINT ck_recaud_cierre_quien CHECK (
  (conductor_id IS NOT NULL AND bolt_uuid IS NULL) OR
  (conductor_id IS NULL AND bolt_uuid IS NOT NULL));

-- La única de antes cubría (conductor_id, …) y con NULLs no sirve: en SQL dos
-- NULL no son iguales, así que dejaría meter la misma quincena mil veces. Dos
-- índices parciales, uno por cada forma de identificar a alguien.
ALTER TABLE recaudacion_cierre DROP CONSTRAINT IF EXISTS uq_recaud_cierre;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recaud_cierre_cond
  ON recaudacion_cierre (conductor_id, anio, mes, quincena) WHERE conductor_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_recaud_cierre_bolt
  ON recaudacion_cierre (bolt_uuid, anio, mes, quincena) WHERE bolt_uuid IS NOT NULL;

-- ── Los movimientos ────────────────────────────────────────────────────────
ALTER TABLE recaudacion_movimiento ADD COLUMN IF NOT EXISTS bolt_uuid VARCHAR(64);

-- La de antes decía: salida → sin conductor; lo demás → con conductor. Ahora
-- "lo demás" puede ir por cuenta de BOLT, y una salida de caja sigue sin ser
-- de nadie.
ALTER TABLE recaudacion_movimiento DROP CONSTRAINT IF EXISTS ck_recaud_quien;
ALTER TABLE recaudacion_movimiento ADD CONSTRAINT ck_recaud_quien CHECK (
  CASE WHEN tipo LIKE 'salida\_%'
       THEN conductor_id IS NULL AND bolt_uuid IS NULL
       ELSE (conductor_id IS NOT NULL) <> (bolt_uuid IS NOT NULL)
  END);

CREATE INDEX IF NOT EXISTS idx_recaud_mov_bolt ON recaudacion_movimiento (bolt_uuid) WHERE bolt_uuid IS NOT NULL;

COMMENT ON COLUMN recaudacion_cierre.bolt_uuid IS
  'Cuenta de BOLT sin ficha en la plantilla. Excluyente con conductor_id';
COMMENT ON COLUMN recaudacion_movimiento.bolt_uuid IS
  'Cuenta de BOLT sin ficha en la plantilla. Excluyente con conductor_id';

COMMIT;
