-- ============================================================
-- 165 — BAJA DE WILLIAM AZIER BENAVIDES GUAMAN: 16/09/2026, NO 16/08/2033
-- ============================================================
-- Camilo, 29/09/2026. Su periodo de ETT (GiGroup, alta el 19/08/2026) tenía la
-- baja escrita el 16/08/2033: un error al teclear el año. Con esa fecha no salía
-- en ninguna lista de bajas —la tarjeta del planificador, el histórico— porque
-- para el sistema se iba dentro de siete años.
--
-- La fecha buena la dicen sus datos: su primer viaje de BOLT es del 19/08 (el
-- día del alta), el último del 15/09/2026 a las 11:01, y ese mismo día terminó
-- su plaza de fijo de noche en el 0524MMZ. La baja, el día siguiente: 16/09.
-- (El 16/08/2026 que se pidió primero no puede ser: es anterior al alta, y la
-- base lo prohíbe con ck_empleo_rango.)
--
-- Se hace lo mismo que al dar una baja desde la pantalla (conductores.repo
-- `darDeBaja`): al teclear 2033 se cortó también su turno en 2033, así que se
-- corta en la fecha buena. No tiene estados, libranzas ni asignaciones abiertas
-- más allá: la plaza del 0524MMZ ya terminó el 14/09.
--
-- Todo va atado a los valores de hoy (WHERE … = 2033-08-16): si alguien ya lo
-- hubiera corregido a mano, esto no toca nada.

BEGIN;

UPDATE conductor_periodo_empleo
   SET baja = DATE '2026-09-16'
 WHERE conductor_id = 335 AND baja = DATE '2033-08-16';

UPDATE conductor_turno_hist
   SET hasta = DATE '2026-09-16'
 WHERE conductor_id = 335 AND hasta = DATE '2033-08-16';

INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', 335, 'baja', '2033-08-16', '2026-09-16 (año mal tecleado; corregido por db/165)', 7, 'migracion'
 WHERE EXISTS (SELECT 1 FROM conductor_periodo_empleo WHERE conductor_id = 335 AND baja = DATE '2026-09-16');

COMMIT;
