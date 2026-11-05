-- ============================================================
-- 230 - BARCELONA: SU RECAUDACIÓN DEL EFECTIVO
-- ============================================================
-- Camilo, 05/11/2026: «Déjame listo la recaudación de efectivo en Barcelona, de
-- la misma forma». La deuda empieza el 1 de noviembre de 2026 (lo eligió él) y
-- la llevan sus propias llaves (/barcelona/recaudacion y …/nomina).
--
-- 1. EL PAGO DE CADA PEDIDO. db/182 guardó de los pedidos de Barcelona solo lo
--    que pedía su Visibilidad, y dejó fuera el método de pago y el desglose del
--    precio: «Barcelona no tiene ni lo uno ni lo otro». Ahora sí lo necesita.
--    Son las mismas columnas que bolt_order (db/74). metodo_pago NULL = un
--    pedido de antes de esta migración que aún no se ha releído; la ingesta los
--    vuelve a pedir a BOLT desde el 1 de noviembre (services/repo/otrasSedes.js,
--    `primerPedidoSinPago`). '' = leído, y BOLT no lo dice.
--
-- 2. SUS TABLAS DE RECAUDACIÓN, aparte de las de Madrid: las mismas columnas,
--    restricciones e índices (LIKE … INCLUDING ALL), vacías. Así nada de lo que
--    se cobre en Barcelona puede sumar en la caja ni en la deuda de Madrid, y al
--    revés. No llevan columna `sede`: hoy son solo de Barcelona. Si entrara otra
--    sede, o tablas suyas o una columna sede con su filtro en el repositorio.
--    En Barcelona no hay fichas: cada persona es su cuenta de BOLT (bolt_uuid).

BEGIN;

-- ── 1. El pago de los pedidos de Barcelona ──────────────────────────────────
ALTER TABLE sede_bolt_order ADD COLUMN IF NOT EXISTS metodo_pago    VARCHAR(16);
ALTER TABLE sede_bolt_order ADD COLUMN IF NOT EXISTS precio         NUMERIC(10,2);
ALTER TABLE sede_bolt_order ADD COLUMN IF NOT EXISTS dto_efectivo   NUMERIC(10,2);
ALTER TABLE sede_bolt_order ADD COLUMN IF NOT EXISTS tarifa_reserva NUMERIC(10,2);

COMMENT ON COLUMN sede_bolt_order.metodo_pago IS
  'payment_method de BOLT (cash, card…). NULL = entró antes de db/230 y aún no se ha releído; '''' = leído y BOLT no lo dice';

-- Lo que lee la recaudación: el efectivo terminado de una sede en unos días.
CREATE INDEX IF NOT EXISTS ix_sede_border_efectivo
  ON sede_bolt_order (sede, creado_ts) WHERE metodo_pago = 'cash' AND estado = 'finished';

-- ── 2. Sus tablas de recaudación ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sede_recaudacion_cierre (LIKE recaudacion_cierre INCLUDING ALL);
CREATE TABLE IF NOT EXISTS sede_recaudacion_movimiento (LIKE recaudacion_movimiento INCLUDING ALL);

-- LIKE no copia las claves foráneas: las de quién apuntó y quién anuló.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srec_cierre_usuario') THEN
    ALTER TABLE sede_recaudacion_cierre
      ADD CONSTRAINT fk_srec_cierre_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srec_mov_usuario') THEN
    ALTER TABLE sede_recaudacion_movimiento
      ADD CONSTRAINT fk_srec_mov_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_srec_mov_anulado_por') THEN
    ALTER TABLE sede_recaudacion_movimiento
      ADD CONSTRAINT fk_srec_mov_anulado_por FOREIGN KEY (anulado_por) REFERENCES usuario(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE sede_recaudacion_cierre IS
  'Barcelona: la deuda de efectivo por quincena según BOLT, por cuenta de BOLT (db/230). La de Madrid es recaudacion_cierre';
COMMENT ON TABLE sede_recaudacion_movimiento IS
  'Barcelona: lo entregado, descontado, transferido y las salidas de su caja (db/230). La de Madrid es recaudacion_movimiento';

COMMIT;
