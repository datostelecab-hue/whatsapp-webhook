-- ============================================================
-- DE DÓNDE SALE CADA FOTO DEL ODÓMETRO
-- ============================================================
-- `vehiculo_km_dia` nace vacía, y el ritmo (km/día) necesita al menos dos días
-- separados para existir. Eso significaría un mes entero con la columna "le
-- quedan X días" en blanco, que es justo la que sirve para organizar el taller.
--
-- Hay una forma de no esperar: Mapon SÍ sabe cuántos km ha rodado cada coche en
-- los últimos 30 días (route/list, trayecto a trayecto). Restándolos del
-- odómetro de hoy sale el odómetro de hace 30 días. Es una medición, no una
-- estimación — pero es RECONSTRUIDA, no observada, y las dos cosas no pueden
-- parecer iguales dentro de la misma tabla: si mañana el ritmo sale raro, hay
-- que poder saber si la fila de partida se vio o se dedujo.

BEGIN;

ALTER TABLE vehiculo_km_dia
  ADD COLUMN IF NOT EXISTS origen VARCHAR(14) NOT NULL DEFAULT 'foto';

ALTER TABLE vehiculo_km_dia
  ADD CONSTRAINT ck_kmdia_origen CHECK (origen IN ('foto', 'reconstruido'));

COMMENT ON COLUMN vehiculo_km_dia.origen IS
  'foto = leida ese dia del odometro. reconstruido = odometro de hoy menos los km que Mapon dice que rodo desde entonces';

COMMIT;
