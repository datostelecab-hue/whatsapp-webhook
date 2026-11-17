-- ============================================================
-- 261 — EL TABLERO, SIN LAS J, LAS −J NI LAS CORRECCIONES DE FICHAJE
-- ============================================================
-- Camilo, 17/11/2026: «quita en tareas lo de los fichajes, la corrección de
-- fichajes no será prioridad» y «vamos a separar las justificaciones del
-- tablero, no los dejemos ahí tampoco ya que no son cosas urgentes».
--
-- El código ya no las registra como colas del tablero (se llevan en
-- /justificantes y en /fichaje, como antes de la 1c). Aquí, las tarjetas que
-- siguen abiertas se ANULAN con su motivo, y queda en su historia: nada se borra.
-- Las cerradas, rechazadas o anuladas se quedan como estaban.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/261', true),
       set_config('telecab.usuario_id', '7', true);

WITH anuladas AS (
  UPDATE tarea
     SET estado = 'anulada', bloqueo_motivo = NULL, cerrada_at = now(),
         cerrada_por = (SELECT id FROM usuario WHERE id = 7),
         cierre_nota = 'Ya no va al tablero: se lleva en su pantalla (decisión del 17/11/2026)'
   WHERE tipo IN ('j', 'menos_j', 'correccion_fichaje')
     AND estado NOT IN ('cerrada', 'rechazada', 'anulada')
  RETURNING id
)
INSERT INTO tarea_evento (tarea_id, tipo, autor_id, motivo)
SELECT id, 'anulada', (SELECT id FROM usuario WHERE id = 7),
       'Ya no va al tablero: se lleva en su pantalla (decisión del 17/11/2026)'
  FROM anuladas;

COMMIT;
