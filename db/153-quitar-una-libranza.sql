-- ============================================================
-- 153 — QUITAR UNA LIBRANZA DESDE LA BITÁCORA
-- ============================================================
-- En la bitácora se podía decir «ese día era libranza», y quitar esa marca
-- puesta a mano. Lo que no se podía quitar era la libranza que viene del
-- PLANIFICADOR: asignado a una plaza y sin cubrirla ese día. Si se planificó
-- mal —le tocaba trabajar y el cuadrante lo dejó de descanso—, la bitácora lo
-- daba por libranza y nadie podía decir lo contrario.
--
-- `sin_libranza` es eso: una persona dijo que ese día NO libraba. La marca queda
-- vacía (sin horas, el día sale como «Ausencia») y el planificador no se toca:
-- el cuadrante dice lo que se planificó y la bitácora lo que pasó, como con la
-- libranza puesta a mano.
--
-- Si luego se pone una J ese día, la J va encima y `sin_libranza` se queda:
-- al anularla o rechazarla el día vuelve a «Ausencia», no a la libranza del
-- planificador.
--
-- `marcado_por` / `marcado_at`: quién puso o quitó la libranza a mano, y cuándo.
-- Las 76 libranzas puestas a mano que ya había se quedan sin firma: no se sabe.

BEGIN;

ALTER TABLE bitacora_dia
  ADD COLUMN sin_libranza BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN marcado_por  BIGINT      REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN marcado_at   TIMESTAMPTZ;

-- Quitar la libranza y ponerla a la vez no tiene sentido.
ALTER TABLE bitacora_dia
  ADD CONSTRAINT ck_bit_sin_libranza CHECK (NOT (sin_libranza AND marca = 'L'));

COMMENT ON COLUMN bitacora_dia.sin_libranza IS
  'Una persona dijo que ese día NO libraba aunque el planificador lo tuviera de descanso. El planificador no se toca';
COMMENT ON COLUMN bitacora_dia.marcado_por IS
  'Quién puso o quitó a mano la libranza de ese día (las anteriores al 24/09/2026 no lo guardan)';

COMMIT;
