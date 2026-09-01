-- ============================================================
-- 37 - LA PUERTA UNICA: staging de los logs de BOLT
-- ============================================================
-- La arquitectura, en una tabla. A partir de aqui BOLT se llama UNA vez por
-- endpoint, se guarda TAL CUAL lo que dijo, y todo el sistema lee de Postgres,
-- nunca de la API. Se acabo que boltHorasCore, flotaViva y sanciones pidan cada
-- uno su propia ventana e interpreten distinto el mismo log: un hecho, una
-- fuente.
--
-- DOS CAPAS, a proposito:
--
--   ingesta_descarga  Lo que dijo la API, verbatim, en JSON. Es el "por si
--                     acaso": permite reprocesar sin volver a llamar y auditar
--                     que llego de verdad. El JSON se PODA a los pocos dias
--                     -pesa- pero la fila de metadatos (cuando, cuantas, error)
--                     se queda.
--
--   bolt_state_log    Los eventos ya en columnas, pero SIN interpretar: el
--                     driver, el coche, el estado y la hora tal como los manda
--                     BOLT. Esta es LA fuente permanente de la que deriva la
--                     jornada. No decide nada -eso es la capa de normalizacion-;
--                     solo guarda lo que paso.
--
-- La interpretacion (que es trabajo efectivo, que supuesto TE_) NO vive aqui:
-- vive en asiento_jornada, que se deriva de esto. Asi el dia que cambie una
-- regla, se rederiva de los logs guardados sin tocar BOLT.

BEGIN;

-- ── El crudo: lo que dijo la API, para auditar y reprocesar ─────────────────
CREATE TABLE ingesta_descarga (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuente        VARCHAR(12) NOT NULL,          -- bolt, mapon
  endpoint      VARCHAR(60) NOT NULL,          -- getFleetStateLogs, getFleetOrders...
  params        JSONB,                          -- la ventana pedida, para poder repetirla
  filas         INTEGER,
  ms            INTEGER,
  error         TEXT,
  -- Lo que contesto la API, entero. Se poda a los 'PURGA' dias: la fila queda,
  -- el JSON se vacia. Para reprocesar mas viejo, se vuelve a llamar.
  payload       JSONB,
  descargado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_descarga_fuente CHECK (fuente IN ('bolt','mapon'))
);
CREATE INDEX idx_descarga_fecha ON ingesta_descarga (descargado_at DESC);
CREATE INDEX idx_descarga_endpoint ON ingesta_descarga (endpoint, descargado_at DESC);

COMMENT ON TABLE ingesta_descarga IS
  'Lo que contesto cada llamada a BOLT/Mapon, verbatim. El payload se poda a los dias; la fila se queda para auditar';

-- ── Lo tipado: los eventos de estado, sin interpretar ───────────────────────
-- Un evento = "a esta hora, este conductor con este coche paso a este estado".
-- Tal cual lo manda BOLT (getFleetStateLogs). La jornada se deriva de aqui.
CREATE TABLE bolt_state_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  driver_uuid   VARCHAR(64),
  vehiculo_uuid VARCHAR(64),
  estado        VARCHAR(24) NOT NULL,          -- has_order, waiting_orders, busy, inactive...
  ocurrido_at   TIMESTAMPTZ NOT NULL,          -- el `created` de BOLT, la hora REAL del cambio
  descarga_id   BIGINT REFERENCES ingesta_descarga(id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- IDEMPOTENCIA: el mismo evento no entra dos veces. Reingerir una ventana que
-- se solapa con otra ya traida no duplica. Sin driver no hay jornada que
-- derivar, asi que la unicidad solo cubre lo que tiene driver.
CREATE UNIQUE INDEX uq_bsl ON bolt_state_log (driver_uuid, ocurrido_at, estado)
  WHERE driver_uuid IS NOT NULL;
CREATE INDEX idx_bsl_driver_dia ON bolt_state_log (driver_uuid, ocurrido_at);

COMMENT ON TABLE bolt_state_log IS
  'Los cambios de estado de BOLT, verbatim y sin interpretar. LA fuente de la jornada; se deriva de aqui, no de la API';

-- ── Podar el crudo viejo ────────────────────────────────────────────────────
-- Vacia el payload JSON de las descargas de mas de 'p_dias' dias. NO borra la
-- fila ni los eventos tipados: solo el blob pesado. Lo llama un cron.
CREATE OR REPLACE FUNCTION purgar_descargas(p_dias INT DEFAULT 7) RETURNS INT
LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  UPDATE ingesta_descarga
     SET payload = NULL
   WHERE payload IS NOT NULL
     AND descargado_at < now() - (p_dias || ' days')::interval;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

COMMENT ON FUNCTION purgar_descargas(INT) IS
  'Vacia el payload JSON de las descargas viejas. Los eventos tipados y los metadatos se quedan';

COMMIT;
