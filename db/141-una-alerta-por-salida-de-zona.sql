-- ============================================================
-- 141 · EL INDICE DE "UNA ALERTA POR PERSONA" NO PUEDE MANDAR EN LAS DE ZONA
-- ============================================================
-- `uq_alerta_control (tipo, driver_uuid, franja_dia, franja)` es lo que
-- garantiza que a un conductor no se le avise dos veces por lo mismo en la
-- misma franja. Para las alertas de persona es exactamente lo que se quiere.
--
-- Para las de zona, NO. Un coche puede salirse de la zona dos veces en la misma
-- franja y con el mismo conductor dentro, y son DOS salidas: dos sitios, dos
-- horas y dos llamadas. Con el indice tal cual, la segunda no es que se
-- ignorara —seria lo de menos—: reventaba el INSERT con una violacion de
-- unicidad que el `ON CONFLICT (mapon_alerta_id)` no atrapa, porque mira otro
-- indice. La revision entera se caia por una salida repetida.
--
-- Asi que el indice de siempre pasa a ser PARCIAL: manda solo donde tiene
-- sentido, en las filas que no vienen de una alerta de Mapon. En las de zona
-- quien manda es `uq_alerta_control_mapon`, y su clave es el id de la propia
-- alerta, que es la unica definicion honesta de "esta salida ya se aviso".
--
-- Se rehace en vez de tocarse porque un indice unico no se puede "alterar": se
-- crea el nuevo, se comprueba que entra, y se tira el viejo. Y se hace en la
-- misma transaccion para que no exista un instante sin ninguno de los dos.

BEGIN;

CREATE UNIQUE INDEX uq_alerta_control_persona
  ON alerta_control (tipo, driver_uuid, franja_dia, franja)
  WHERE mapon_alerta_id IS NULL;

DROP INDEX uq_alerta_control;

COMMENT ON INDEX uq_alerta_control_persona IS
  'Un aviso por conductor, tipo y franja. Solo en las alertas de persona: las de zona '
  'las gobierna uq_alerta_control_mapon, por el id de la alerta de Mapon.';

COMMIT;
