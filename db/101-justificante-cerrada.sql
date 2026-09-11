-- ============================================================
-- 101 — Una J rechazada se puede REHACER o DAR POR CERRADA
-- ============================================================
-- Rechazar una J deja el día sin justificar y levanta la alerta "Justificación
-- rechazada": hay que volver a llamar al conductor. Pero hasta ahora esa alerta
-- no tenía forma de apagarse, así que el caso se quedaba abierto para siempre.
-- Hay dos finales legítimos:
--
--   · SE REHACE: se corrige (las horas, el motivo, el tipo) y vuelve a
--     revisión. Eso NO necesita columna: es una J nueva para el mismo conductor
--     y el mismo día, creada después del rechazo, y se detecta sola. La
--     rechazada se queda donde está, con su motivo y su firma, que es la traza.
--
--   · SE DA POR CERRADA: se llamó, se habló y no hay nada que justificar. El
--     día cuenta como no justificado —eso no cambia— pero el caso deja de
--     pedir una llamada. Eso sí necesita una firma, y son estas tres columnas:
--     quién lo cerró, cuándo y qué dijo.
--
-- Cerrar NO es borrar: la J rechazada sigue en la lista, en su pestaña, con el
-- motivo del rechazo y la nota de cierre. Solo deja de parpadear.

BEGIN;

ALTER TABLE justificante
  ADD COLUMN IF NOT EXISTS cerrada_at   timestamptz,
  ADD COLUMN IF NOT EXISTS cerrada_por  bigint REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cerrada_nota varchar(300);

COMMENT ON COLUMN justificante.cerrada_at IS
  'Una J RECHAZADA que ya se ha atendido: se llamó y no hay nada que justificar. Deja de pedir llamada; el día sigue sin justificar';

-- Solo tiene sentido cerrar lo que está rechazado: cerrar una viva sería una
-- tercera forma de anularla, y de esas ya hay bastante con una.
ALTER TABLE justificante
  DROP CONSTRAINT IF EXISTS ck_just_cerrada_rechazada;
ALTER TABLE justificante
  ADD CONSTRAINT ck_just_cerrada_rechazada
  CHECK (cerrada_at IS NULL OR anulado_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_just_rechazada_abierta
  ON justificante (conductor_id, dia_operativo)
  WHERE anulado_at IS NOT NULL AND cerrada_at IS NULL;

COMMIT;
