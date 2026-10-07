-- ============================================================
-- 182 — BARCELONA: SUS PEDIDOS DE BOLT (para el dinero de su Visibilidad)
-- ============================================================
-- Camilo, 07/10/2026: «A Barcelona también hazle la Visibilidad con las mismas
-- métricas». Las horas ya las tiene (sede_bolt_state_log, db/181); el neto, los
-- viajes, el €·hora y los viajes·hora salen de los PEDIDOS, y los de Madrid
-- viven en bolt_order, que no sabe de empresas: todo lo que entra ahí lo suma
-- la Visibilidad de Madrid (y la recaudación, y las nóminas). Por eso van en una
-- tabla suya, como las horas. Ver docs/nucleo/Sedes.md.
--
-- Solo lo que la Visibilidad necesita: quién, cuándo, en qué estado y cuánto.
-- La dirección de bajada, el método de pago y el desglose del precio (lo que
-- Madrid usa para el mapa y la recaudación) no se guardan: Barcelona no tiene
-- ni lo uno ni lo otro.

BEGIN;

CREATE TABLE IF NOT EXISTS sede_bolt_order (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede           varchar(16)    NOT NULL REFERENCES cat_sede(codigo),
  company_id     integer        NOT NULL REFERENCES flota(company_id),
  order_ref      varchar(64),                          -- informativo, como en bolt_order
  driver_uuid    varchar(64)    NOT NULL,
  matricula      varchar(16),                          -- normalizada: solo [0-9A-Z]
  estado         varchar(24),                          -- finished, client_did_not_show, cancelled...
  creado_ts      timestamptz    NOT NULL,              -- order_created_timestamp
  finalizado_ts  timestamptz,
  neto           numeric(10,2)  NOT NULL DEFAULT 0,    -- net_earnings
  propina        numeric(10,2)  NOT NULL DEFAULT 0,
  peaje          numeric(10,2)  NOT NULL DEFAULT 0,
  creado_at      timestamptz    NOT NULL DEFAULT now(),
  actualizado_at timestamptz    NOT NULL DEFAULT now(),
  -- La misma clave que bolt_order: un pedido MADURA durante horas y se vuelve a
  -- traer; la segunda vez actualiza, no duplica.
  CONSTRAINT uq_sede_border UNIQUE (driver_uuid, creado_ts)
);
CREATE INDEX IF NOT EXISTS ix_sede_border_sede_t ON sede_bolt_order (sede, creado_ts);

COMMENT ON TABLE sede_bolt_order IS
  'Los pedidos de BOLT de las empresas de OTRAS sedes (Barcelona), aparte de bolt_order para que Madrid no los sume (db/182).';

COMMIT;
