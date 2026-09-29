-- ============================================================
-- 166 — ALERTAS POR SUCESO: «NO VUELVE A LA M-30»
-- ============================================================
-- Camilo, 29/09/2026: un aviso para «la gente que deja a alguien fuera de la
-- M-30 y se queda por allá o no se devuelve después de 15 minutos».
--
-- Las alertas de persona suenan UNA vez por conductor, tipo y franja
-- (uq_alerta_control_persona), y la del coche suelto una por coche, franja y día
-- (uq_alerta_control_coche). Para esta ninguna de las dos vale: quien deja a dos
-- pasajeros lejos en la misma mañana y se queda por allá las dos veces ha hecho
-- dos cosas, y la segunda también hay que saberla.
--
-- Así que esta va POR SUCESO: una alerta por coche y por pasajero dejado. El
-- suceso es la hora a la que lo dejó (`suceso_at` = bolt_order.dejado_ts), y el
-- índice único es el que impide que la vuelta del mapa, que pasa cada 30 s,
-- mande el mismo aviso dos veces. No un `if`.
--
-- La fila no lleva driver_uuid (va a NULL, como en un coche suelto sin nadie):
-- si lo llevara, el índice de persona la cortaría a una por franja. A la ficha
-- se ata por conductor_id.

BEGIN;

ALTER TABLE alerta_control ADD COLUMN IF NOT EXISTS suceso_at TIMESTAMPTZ;

COMMENT ON COLUMN alerta_control.suceso_at IS
  'El suceso que levanta la alerta, en las que van por suceso y no por franja. En '
  'no_vuelve_m30: la hora a la que dejó al pasajero. Una alerta por coche y suceso.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_control_suceso
  ON alerta_control (tipo, matricula, suceso_at)
  WHERE suceso_at IS NOT NULL AND matricula IS NOT NULL;

COMMENT ON INDEX uq_alerta_control_suceso IS
  'Un aviso por coche y suceso (no_vuelve_m30: por pasajero dejado). Es lo que '
  'impide repetirlo en cada vuelta del mapa.';

COMMIT;
