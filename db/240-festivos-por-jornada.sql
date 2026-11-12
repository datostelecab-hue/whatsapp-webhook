-- ============================================================
-- 240 — LAS HORAS DE LOS FESTIVOS, OTRA VEZ, POR LA JORNADA
-- ============================================================
-- Camilo, 12/11/2026: «en los días festivos trabajados no tomes literal de
-- 00:00 a 23:59. Dependiendo del turno, si empieza el día festivo a las 20:00 y
-- termina a las 04:00 hizo 8 horas en su jornada del día festivo».
--
-- Desde ese día las horas de un festivo son las de la jornada de cada uno: su
-- turno de día de esa fecha (00:00 → 24:00) más su turno de noche (12:00 →
-- 12:00 del día siguiente), la regla de la bitácora y de Control
-- (vacaciones.service.horasDelFestivo). Hasta entonces eran las del día natural.
--
-- Los festivos que ya están calculados se vuelven a calcular: aquí solo se
-- marcan como pendientes y el cron de cada hora (minuto 20, sellarFestivos) los
-- rehace con la regla nueva. Solo los que suman vacaciones: los de septiembre
-- para atrás se pagaron en la nómina y no cuentan (FESTIVOS_PAGADOS_HASTA), y
-- los de hoy en adelante aún no se han calculado.

BEGIN;

UPDATE festivo
   SET horas_at = NULL, horas_fuente = NULL
 WHERE fecha >= DATE '2026-10-01'
   AND fecha < (now() AT TIME ZONE 'Europe/Madrid')::date
   AND horas_at IS NOT NULL;

COMMIT;
