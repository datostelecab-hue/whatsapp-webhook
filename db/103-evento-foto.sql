-- ============================================================
-- 103 — La FOTO del cuadrante antes del evento, y la vuelta
-- ============================================================
-- El modo eventos abría plazas de refuerzo, pero lo que de verdad pasa en un
-- evento es que se mueve gente de sitio: el fijo dice que no sale, el CT
-- descansa, y hay que meter a otro EN SU PLAZA. Colocar a alguien en una plaza
-- ocupada cierra la asignación del que estaba, así que al terminar el evento esa
-- plaza se quedaba VACÍA: el cuadrante no volvía solo a lo de antes.
--
-- Dos piezas para arreglarlo, y la primera es la importante:
--
--   · asignacion.evento_id — qué movimientos son DEL EVENTO. Solo esos se
--     deshacen. Un cambio de plantilla hecho el mismo fin de semana, pero a
--     propósito y para siempre, no lleva la marca y no se toca.
--
--   · evento_foto — cómo estaba cada plaza justo antes. No es solo un registro:
--     es de donde sale el nombre que se le dice al conductor por WhatsApp
--     ("cuando termine el evento, entrega el coche a Fulano") y con lo que se
--     reconcilia el cuadrante al cerrar, por si algo se movió por otro lado.
--
-- LO QUE NO HACE FALTA ESPERAR AL CIERRE: al colocar a alguien en una plaza
-- ocupada durante un evento, al que sale se le REPONE ya mismo con fecha de
-- vuelta (el día siguiente al evento). Así la base dice la verdad sobre el
-- futuro desde el primer momento, y la semana que viene ya sale bien en el
-- WhatsApp de turnos sin que nadie haya cerrado nada todavía.

BEGIN;

ALTER TABLE asignacion
  ADD COLUMN IF NOT EXISTS evento_id bigint REFERENCES evento_operativo(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_asig_evento ON asignacion (evento_id) WHERE evento_id IS NOT NULL;
COMMENT ON COLUMN asignacion.evento_id IS
  'Este apunte es TEMPORAL, del evento: al cerrarse se deshace. Sin marca, el cambio es de verdad y se queda';

CREATE TABLE IF NOT EXISTS evento_foto (
  evento_id     bigint     NOT NULL REFERENCES evento_operativo(id) ON DELETE CASCADE,
  plaza_id      bigint     NOT NULL REFERENCES plaza(id) ON DELETE CASCADE,
  -- NULL = esa plaza estaba VACÍA antes del evento, y vacía se queda al volver.
  conductor_id  bigint     REFERENCES conductor(id),
  asignacion_id bigint,
  desde         date,
  hasta         date,
  dias          smallint[],
  PRIMARY KEY (evento_id, plaza_id)
);
COMMENT ON TABLE evento_foto IS
  'Cómo estaba cada plaza del cuadrante justo antes del evento. Con esto se reconcilia al cerrar y se le dice a cada conductor a quién entrega el coche';

ALTER TABLE evento_operativo
  ADD COLUMN IF NOT EXISTS restaurado_at   timestamptz,
  ADD COLUMN IF NOT EXISTS restaurado_nota varchar(300);
COMMENT ON COLUMN evento_operativo.restaurado_at IS
  'Cuando el cuadrante volvió a la normalidad. Lo pone el repaso automático al pasar la hora de cierre';

COMMIT;
