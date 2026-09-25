-- ============================================================
-- 156 — DÓNDE DEJÓ AL PASAJERO: EL DESTINO DE CADA VIAJE
-- ============================================================
-- Camilo, 25/09/2026, mirando en el mapa un coche «en espera fuera de la
-- M-30»: «¿puede darme la ubicación del último destino? para saber si está
-- regresando a la M-30 o simplemente está dando vueltas».
--
-- BOLT lo manda en cada pedido —`destination_address` y, en `order_stops`, las
-- coordenadas de la parada de bajada— y la ingesta lo tiraba: `bolt_order` solo
-- guardaba el dinero y las horas. Tampoco guardaba la matrícula, así que no se
-- podía preguntar «¿cuál fue el último viaje de ESTE coche?».
--
-- Se llenan solas: la ingesta de pedidos pasa cada 10 minutos por las últimas
-- 2 horas y cada hora por las últimas 48, y actualiza lo que ya tenía.

BEGIN;

ALTER TABLE bolt_order
  ADD COLUMN IF NOT EXISTS matricula_norm VARCHAR(15),
  ADD COLUMN IF NOT EXISTS dejado_ts      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS destino        VARCHAR(300),
  ADD COLUMN IF NOT EXISTS destino_lat    NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS destino_lng    NUMERIC(9,6);

COMMENT ON COLUMN bolt_order.matricula_norm IS 'La matrícula del pedido, sin espacios ni guiones y en mayúsculas (como vehiculo.matricula_norm)';
COMMENT ON COLUMN bolt_order.dejado_ts IS 'Cuándo dejó al pasajero (order_drop_off_timestamp)';
COMMENT ON COLUMN bolt_order.destino_lat IS 'La parada de bajada de order_stops: la real si BOLT la da, si no la pedida';

-- «El último viaje de este coche», que es lo que pregunta el mapa.
CREATE INDEX IF NOT EXISTS idx_border_coche_dejado
  ON bolt_order (matricula_norm, dejado_ts DESC) WHERE dejado_ts IS NOT NULL;

COMMIT;
