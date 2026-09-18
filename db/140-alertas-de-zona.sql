-- ============================================================
-- 140 · ALERTAS DE ZONA DE MAPON, Y UNA ALERTA QUE PUEDE SER DE UN COCHE
-- ============================================================
-- Mapon vigila dos geocercas y dispara `not_in_obj` ("Fuera de la zona X")
-- cuando un coche se sale:
--
--   · "Zona Notificacion" — el area de trabajo normal. Salirse de ahi SIN
--     viaje, y en horas de vigilancia, es raro: tienen que estar cerca de la
--     M30. Si va de viaje o yendo a por el pasajero, no se avisa de nada.
--   · "Zona Madrid" — un area mucho mas grande. De ahi no se sale ni con
--     pasajero, asi que esa alerta salta SIEMPRE, este de viaje o no.
--
-- La alerta trae `id` propio de Mapon: es la clave natural de "un mensaje por
-- alerta", y mejor que unidad+hora+tipo. Se guarda cruda tal cual llega, en su
-- propia tabla, por dos razones: para no volver a pedirsela a Mapon cada vez
-- que alguien abra la pantalla, y para que quede la prueba de lo que dijo Mapon
-- aunque luego el coche cambie de mano o de matricula.
--
-- ── Y `alerta_control` deja de ser solo de personas ─────────────────────────
--
-- Hasta ahora toda alerta tenia un conductor detras. Una alerta de zona tambien
-- puede no tenerlo: un coche de reserva que nadie ha fichado se sale de la zona
-- igual, y ese es justamente el caso preocupante —alguien conduce sin estar—.
-- Asi que `driver_uuid` pasa a poder ser NULL y la fila lleva matricula.
--
-- El indice unico de siempre sigue valiendo para las alertas de persona. Para
-- las de zona la unicidad la da el id de Mapon, con su propio indice parcial:
-- un coche puede salirse de la zona tres veces en una tarde y son tres avisos
-- distintos, no uno repetido.

BEGIN;

-- ── Lo que dijo Mapon, crudo ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mapon_zona_alerta (
  -- El id de la propia alerta en Mapon. Es la clave: no hay dos.
  mapon_id     BIGINT       PRIMARY KEY,
  unit_id      BIGINT       NOT NULL,
  matricula    VARCHAR(16),
  -- 'not_in_obj' (fuera de zona) o 'in_object' (entrada/salida).
  tipo         VARCHAR(24)  NOT NULL,
  -- El nombre de la geocerca TAL COMO lo manda Mapon, con sus espacios: en la
  -- cuenta hay una que se llama "Zona Notificacion " con un espacio al final.
  -- Se guarda como viene y se compara normalizado; corregirlo aqui seria
  -- inventarse un dato que Mapon no dijo.
  zona         VARCHAR(120) NOT NULL,
  -- 'IN' / 'OUT' en las de entrada-salida; vacio en las de fuera de zona.
  sentido      VARCHAR(8),
  ocurrio_at   TIMESTAMPTZ  NOT NULL,
  lat          NUMERIC(10,6),
  lon          NUMERIC(10,6),
  direccion    VARCHAR(300),
  msg          VARCHAR(300),
  ingerida_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_mapon_zona_alerta_ts
  ON mapon_zona_alerta (ocurrio_at DESC);
CREATE INDEX IF NOT EXISTS ix_mapon_zona_alerta_unidad
  ON mapon_zona_alerta (unit_id, ocurrio_at DESC);

COMMENT ON TABLE mapon_zona_alerta IS
  'Alertas de geocerca de Mapon, crudas. La ingesta las trae cada 5 min con solape; '
  'el id de Mapon impide duplicarlas.';

-- ── Una alerta de control puede ser de un coche, no de una persona ──────────
ALTER TABLE alerta_control ALTER COLUMN driver_uuid DROP NOT NULL;
ALTER TABLE alerta_control ADD COLUMN IF NOT EXISTS matricula VARCHAR(16);
ALTER TABLE alerta_control ADD COLUMN IF NOT EXISTS mapon_alerta_id BIGINT;
-- La utilizacion que tenia en ese momento. Se guarda por lo mismo que el
-- umbral: una alerta vieja no se puede leer con el criterio de hoy.
ALTER TABLE alerta_control ADD COLUMN IF NOT EXISTS utilizacion NUMERIC(5,1);

COMMENT ON COLUMN alerta_control.matricula IS
  'El coche, en las alertas de zona. Puede haber alerta sin conductor: un coche que '
  'nadie ha fichado tambien se sale de la zona.';
COMMENT ON COLUMN alerta_control.mapon_alerta_id IS
  'El id de la alerta de Mapon que la origino. Es lo que garantiza un aviso por salida.';
COMMENT ON COLUMN alerta_control.utilizacion IS
  'Horas en viaje sobre horas efectivas (%), en el momento de la alerta.';

-- UN AVISO POR SALIDA DE ZONA, y lo garantiza la base.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerta_control_mapon
  ON alerta_control (mapon_alerta_id) WHERE mapon_alerta_id IS NOT NULL;

COMMIT;
