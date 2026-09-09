-- ============================================================
-- EL AJUSTE DE UNA QUINCENA: lo que se arrastra de otra
-- ============================================================
-- Agosto se cerró de menos: 274,30 € de tres conductores que BOLT sí contaba y
-- el cierre a mano no (dos altas del 31/08 que nadie metió, y 25,50 € sueltos).
-- Ese dinero no se les reclamó en agosto, así que se les suma a la quincena
-- siguiente.
--
-- Podría sumarse sin más a `importe` y nadie se enteraría, y ese es justo el
-- problema: dentro de un mes, "¿por qué debe 1.028,50 € en septiembre?" no
-- tendría respuesta, y ya hemos visto a dónde lleva eso. Así que el arrastre
-- va en su propia columna, con su motivo escrito.
--
-- La deuda de una quincena pasa a ser `importe + ajuste`:
--   importe → lo que dice BOLT de ESA quincena (se recalcula, se pisa)
--   ajuste  → lo que se le suma o se le resta por otra cosa (no lo toca el
--             recálculo, porque no sale de los viajes de esa quincena)

BEGIN;

ALTER TABLE recaudacion_cierre
  ADD COLUMN IF NOT EXISTS ajuste        NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ajuste_motivo VARCHAR(255);

-- Un ajuste sin explicación es un número que nadie podrá defender.
ALTER TABLE recaudacion_cierre DROP CONSTRAINT IF EXISTS ck_recaud_ajuste;
ALTER TABLE recaudacion_cierre
  ADD CONSTRAINT ck_recaud_ajuste CHECK (
    ajuste = 0 OR (ajuste_motivo IS NOT NULL AND btrim(ajuste_motivo) <> ''));

COMMENT ON COLUMN recaudacion_cierre.importe IS
  'El efectivo de ESA quincena segun BOLT. Lo pisa el recalculo';
COMMENT ON COLUMN recaudacion_cierre.ajuste IS
  'Lo que se suma o resta por algo ajeno a los viajes de la quincena (un arrastre de otra, una correccion). El recalculo NO lo toca';

COMMIT;
