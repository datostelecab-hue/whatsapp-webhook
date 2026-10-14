-- ============================================================
-- 196 — DOS DE LOS QUE NO CUADRABAN EN LAS VACACIONES (db/195)
-- ============================================================
-- Camilo, 14/10/2026, sobre el informe «Vacaciones RRHH - lo que no cuadra»:
-- «Lo de Lakraa sí, mételo así; Requena pásalo a permiso».
--
-- 1. RACHID LAKRAA (ficha 4). La fila 2 de la pestaña VACACIONES de la
--    plantilla dice del 07/08/2026 al «09/08/0206». El año del fin estaba mal
--    escrito: son del 07/08 al 09/08/2026. Entra solo si no tiene nada esos días.
--
-- 2. VÍCTOR RAFAEL REQUENA OBISPO (ficha 51). El 01/09/2026 estaba como
--    vacaciones (carga inicial del 03/09), y la plantilla dice que fue un DÍA DE
--    ASUNTOS PROPIOS. Pasa a «Permiso retribuido» de tipo asuntos propios
--    (art. 22, párrafo final del convenio). Solo si la fila sigue como se vio, y
--    queda en el historial de cambios de su ficha.
BEGIN;

INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, hasta_previsto, motivo)
SELECT 4, 'vacaciones', DATE '2026-08-07', DATE '2026-08-09', DATE '2026-08-09',
       'Vacaciones según PLANTILLA TRABAJADORES, pestaña VACACIONES (fila 2; el fin ponía 09/08/0206)'
 WHERE EXISTS (SELECT 1 FROM conductor WHERE id = 4)
   AND NOT EXISTS (SELECT 1 FROM conductor_estado_hist h
                    WHERE h.conductor_id = 4
                      AND h.desde <= DATE '2026-08-09'
                      AND COALESCE(h.hasta, 'infinity'::date) >= DATE '2026-08-07');

WITH cambiado AS (
  UPDATE conductor_estado_hist h
     SET estado = 'permiso',
         leave_type_code = 'PR_ASUNTOS_PROPIOS',
         hasta_previsto = DATE '2026-09-01',
         motivo = 'Día de asuntos propios (según la plantilla de RRHH; estaba como vacaciones)'
   WHERE h.id = 60 AND h.conductor_id = 51 AND h.estado = 'vacaciones'
     AND h.desde = DATE '2026-09-01' AND h.hasta = DATE '2026-09-01'
  RETURNING h.conductor_id
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'situacion', 'vacaciones 01/09/2026 → 01/09/2026',
       'permiso (asuntos propios) 01/09/2026 → 01/09/2026 (según la plantilla de RRHH; db/196)',
       7, 'migracion'
  FROM cambiado;

COMMIT;
