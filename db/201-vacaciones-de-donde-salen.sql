-- ============================================================
-- 201 — DE DÓNDE SALEN LAS VACACIONES DE LA CARGA INICIAL
-- ============================================================
-- Camilo, 14/10/2026, viendo las vacaciones de Wellim (33 días, «De dónde
-- sale: —»): «rellena "De dónde sale" con la referencia al Excel».
--
-- La carga inicial del 03/09/2026 metió 28 tramos de vacaciones sin usuario y
-- sin motivo. Son las filas 3 a 31 de la pestaña VACACIONES de «PLANTILLA
-- TRABAJADORES», en el mismo orden (la 21 repite la 19, Samuel Pereira, y no
-- entró dos veces). Aquí solo se les pone el motivo: ni fechas ni días cambian.
--
-- Dos no cuadran del todo y el motivo lo dice:
--   · José David Molina: el sistema dice hasta el 29/09; el Excel de hoy, el 30/09.
--   · Mohamed Aboulghazi: Caverel lo pone desde el 01/08, no el 02/08.
-- Cuando Caverel trae el mismo tramo, también se cita.
--
-- Fuera quedan los tramos que alguien puso a mano en Plantilla: esos no salen
-- de ningún Excel.
--
-- Solo toca un tramo si sigue siendo el mismo (ficha, fechas) y sigue sin
-- motivo: aplicarla dos veces no cambia nada, y no pisa un motivo puesto
-- después a mano.
BEGIN;

WITH v (id, conductor_id, desde, hasta, motivo) AS (VALUES
  (28, 39, DATE '2026-07-22', DATE '2026-08-04', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 3)'),
  (29, 3, DATE '2026-07-31', DATE '2026-08-06', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 4)'),
  (30, 130, DATE '2026-08-06', DATE '2026-08-12', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 5)'),
  (31, 35, DATE '2026-08-02', DATE '2026-08-13', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 6). También en Caverel (Vacaciones 2026 AF55)'),
  (32, 74, DATE '2026-08-01', DATE '2026-08-14', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 7)'),
  (33, 17, DATE '2026-08-01', DATE '2026-08-15', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 8). También en Caverel (Vacaciones 2026 AF14)'),
  (34, 85, DATE '2026-08-12', DATE '2026-08-16', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 9)'),
  (35, 62, DATE '2026-08-01', DATE '2026-08-18', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 10)'),
  (36, 169, DATE '2026-08-06', DATE '2026-08-18', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 11)'),
  (37, 22, DATE '2026-08-01', DATE '2026-08-18', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 12)'),
  (38, 24, DATE '2026-08-05', DATE '2026-08-20', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 13)'),
  (39, 19, DATE '2026-08-13', DATE '2026-08-26', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 14)'),
  (40, 6, DATE '2026-08-02', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 15). Caverel pone del 01/08/2026 al 31/08/2026 (Vacaciones 2026 AF9)'),
  (41, 8, DATE '2026-08-01', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 16)'),
  (42, 15, DATE '2026-08-01', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 17). También en Caverel (Vacaciones 2026 AF30)'),
  (43, 37, DATE '2026-08-01', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 18)'),
  (44, 58, DATE '2026-08-01', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 19)'),
  (45, 45, DATE '2026-08-17', DATE '2026-08-31', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 20)'),
  (47, 53, DATE '2026-08-07', DATE '2026-09-01', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 22). También en Caverel (Vacaciones 2026 AF84 + Vacaciones 2026 AI84)'),
  (48, 1, DATE '2026-08-17', DATE '2026-09-01', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 23)'),
  (49, 113, DATE '2026-08-28', DATE '2026-09-01', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 24)'),
  (50, 23, DATE '2026-08-27', DATE '2026-09-10', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 25)'),
  (51, 112, DATE '2026-09-14', DATE '2026-09-27', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 26)'),
  (52, 25, DATE '2026-09-13', DATE '2026-09-29', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 27); hoy allí pone del 13/09/2026 al 30/09/2026'),
  (53, 89, DATE '2026-09-14', DATE '2026-09-30', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 28)'),
  (54, 75, DATE '2026-09-03', DATE '2026-10-05', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 29)'),
  (55, 41, DATE '2026-09-30', DATE '2026-10-20', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 30)'),
  (56, 9, DATE '2026-08-05', DATE '2026-08-16', 'Carga inicial (03/09/2026) desde la PLANTILLA TRABAJADORES de RRHH, pestaña VACACIONES (fila 31)')
)
UPDATE conductor_estado_hist h
   SET motivo = v.motivo
  FROM v
 WHERE h.id = v.id
   AND h.conductor_id = v.conductor_id
   AND h.estado = 'vacaciones'
   AND h.desde = v.desde
   AND h.hasta = v.hasta
   AND nullif(btrim(h.motivo), '') IS NULL;

COMMIT;
