-- ============================================================
-- 38 - LA PUERTA UNICA: staging de las ordenes de BOLT
-- ============================================================
-- El segundo endpoint por la misma puerta. getFleetOrders una vez, se guarda
-- tal cual, y de aqui salen dos cosas que hoy pide cada modulo por su cuenta:
--
--   · EL DINERO. Propina, peaje y facturacion neta por conductor. Es lo que
--     alimenta las variables de nomina y el bonus.
--   · LAS CANCELACIONES. El estado de cada orden por conductor. El indice de
--     cancelacion es del plus de calidad (art. 25.c).
--
-- DIFERENCIA CON LOS STATE LOGS. Un log de estado es un hecho inmutable: paso y
-- ya. Una orden MADURA: nace pendiente, se acepta, se termina, y su precio se
-- cierra al final. Asi que esta tabla SI se actualiza -la misma orden vuelve con
-- su estado final- mientras que bolt_state_log solo inserta. El historial de esa
-- maduracion queda en el crudo de ingesta_descarga.
--
-- La identidad de una orden es (conductor, cuando se creo): dos ordenes del
-- mismo conductor en el mismo instante no existen. El id de BOLT se guarda al
-- lado si viene, pero no se depende de el.

BEGIN;

CREATE TABLE bolt_order (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El id de la orden en BOLT, si lo manda. Informativo: la idempotencia no
  -- depende de el, porque no siempre viene con el mismo nombre de campo.
  order_ref     VARCHAR(64),
  driver_uuid   VARCHAR(64),
  estado        VARCHAR(24),                  -- finished, client_did_not_show, cancelled...
  creado_ts     TIMESTAMPTZ NOT NULL,         -- order_created_timestamp
  finalizado_ts TIMESTAMPTZ,                  -- order_finished_timestamp, si termino
  -- El dinero, tal como viene en order_price. En euros.
  propina       NUMERIC(10,2) NOT NULL DEFAULT 0,   -- tip
  peaje         NUMERIC(10,2) NOT NULL DEFAULT 0,   -- toll_fee
  neto          NUMERIC(10,2) NOT NULL DEFAULT 0,   -- net_earnings
  descarga_id   BIGINT REFERENCES ingesta_descarga(id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- IDEMPOTENCIA con maduracion: la misma orden que vuelve mas tarde ACTUALIZA su
-- estado y su precio, no duplica. La clave es (conductor, instante de creacion).
CREATE UNIQUE INDEX uq_border ON bolt_order (driver_uuid, creado_ts)
  WHERE driver_uuid IS NOT NULL;
CREATE INDEX idx_border_driver ON bolt_order (driver_uuid, creado_ts);
CREATE INDEX idx_border_estado ON bolt_order (estado);

COMMENT ON TABLE bolt_order IS
  'Las ordenes de BOLT, verbatim. Dinero (propina/peaje/neto) y estado por conductor. Se actualiza cuando la orden madura; el historial queda en ingesta_descarga';

-- ── Dinero y cancelaciones por conductor y dia ─────────────
-- Lo que las ordenes alimentan, ya agregado y cruzado con nuestro conductor.
-- Para que nomina, bonus y el plus de calidad lean de aqui y no vuelva cada uno
-- a sumar las ordenes por su cuenta -que es de donde salian los descuadres-.
--
-- El indice de cancelacion (art. 25.c) es cancelaciones sobre el total. Aqui se
-- dan los numeros; la responsabilidad EXCLUSIVA del conductor es una regla de
-- negocio sobre el estado, que se afina cuando se sepa que estados de BOLT la
-- indican.
CREATE VIEW v_ordenes_conductor AS
SELECT ce.conductor_id,
       (o.creado_ts AT TIME ZONE 'Europe/Madrid')::date AS dia,
       count(*)                                          AS ordenes,
       count(*) FILTER (WHERE o.estado = 'finished')     AS terminadas,
       count(*) FILTER (WHERE o.estado <> 'finished')    AS no_terminadas,
       round(sum(o.neto), 2)                             AS neto,
       round(sum(o.propina), 2)                          AS propina,
       round(sum(o.peaje), 2)                            AS peaje
  FROM bolt_order o
  JOIN conductor_externo ce
    ON ce.sistema = 'bolt' AND ce.externo_id = o.driver_uuid
 GROUP BY ce.conductor_id, (o.creado_ts AT TIME ZONE 'Europe/Madrid')::date;

COMMENT ON VIEW v_ordenes_conductor IS
  'Dinero y cancelaciones por conductor y dia, cruzado con nuestro conductor. La fuente unica para nomina, bonus y plus de calidad';

COMMIT;
