-- ============================================================
-- 145 · UN AVISO POR COCHE SUELTO, NO UNO POR VUELTA
-- ============================================================
-- El mapa ya sabe decir que un coche RUEDA SIN QUE NADIE ESTE CONECTADO en
-- BOLT. Esto es para que ademas suene, al momento, por WhatsApp.
--
-- ── POR QUE HACE FALTA UN INDICE NUEVO ─────────────────────────────────────
--
-- La regla de la casa es que "un mensaje por alerta" NO lo garantiza un `if`,
-- lo garantiza un indice unico: si el INSERT no devuelve fila, no se manda
-- nada. Los dos que hay no sirven para esto:
--
--   · `uq_alerta_control_persona` va por (tipo, driver_uuid, franja_dia,
--     franja). Pero en un coche suelto MUCHAS VECES NO HAY CONDUCTOR, y
--     entonces `driver_uuid` es NULL — y en PostgreSQL dos NULL NO chocan en un
--     indice unico. O sea que justo el caso que mas preocupa sonaria cada
--     treinta segundos, para siempre.
--   · `uq_alerta_control_mapon` va por el id de la alerta de Mapon, y aqui no
--     hay ninguna: esto no lo detecta Mapon, lo deduce el ERP cruzando la
--     posicion con el estado de BOLT.
--
-- Asi que la clave de este aviso es EL COCHE: una vez por matricula, franja y
-- dia de jornada. Dos veces al dia como mucho por coche — mañana y noche—, que
-- es lo que hace que un aviso siga siendo un aviso y no un goteo.
--
-- Parcial y con el tipo dentro del predicado a proposito: asi no se cruza con
-- las alertas que ya existen ni les cambia el comportamiento.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_control_coche
  ON alerta_control (tipo, matricula, franja_dia, franja)
  WHERE tipo = 'rueda_suelto' AND matricula IS NOT NULL;

COMMENT ON INDEX uq_alerta_control_coche IS
  'Un aviso por coche suelto, franja y dia. Va por MATRICULA porque en un coche suelto '
  'muchas veces no hay conductor, y dos NULL no chocan en un indice unico.';

COMMIT;
