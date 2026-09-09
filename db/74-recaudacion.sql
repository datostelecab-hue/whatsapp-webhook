-- ============================================================
-- RECAUDACIÓN DEL EFECTIVO — lo que el conductor cobró en mano y hay que ingresar
-- ============================================================
-- Sale del Excel "Efectivo.xlsx" que llevaban a mano, que son dos cosas:
--
--   · Hoja "Cierres Bolt"     → por conductor y QUINCENA, cuánto efectivo cobró
--                               en la calle. Es LA DEUDA. → recaudacion_cierre
--   · Hoja "Recaudacion CASH" → una matriz conductor × fecha con lo que fue
--                               entregando (y algún número en negativo: dinero
--                               que se le DEVOLVIÓ). Es LA CAJA. → recaudacion_movimiento
--
-- La quincena es (año, mes, 1|2): la 1 va del día 1 al 15 y la 2 del 16 al
-- último del mes, sea 28, 30 o 31. No se guarda el rango, se calcula: guardar
-- fechas de corte invita a que dos filas digan quincenas distintas.
--
-- LA DEUDA SALE SOLA DE BOLT. `getFleetOrders` trae `payment_method` en cada
-- pedido ('in_app' | 'cash' | 'business') y el precio desglosado; lo que pasaba
-- es que la ingesta se quedaba solo con el neto, la propina y el peaje, así que
-- en `bolt_order` no había forma de saber quién pagó en efectivo. Se añaden las
-- cuatro columnas que faltaban.
--
-- LA FÓRMULA, comprobada contra su propio Excel en la quincena 1–15 de agosto,
-- 8 conductores de 8 al céntimo:
--
--     efectivo = Σ (ride_price − cash_discount + booking_fee)
--                sobre los pedidos con payment_method = 'cash' y estado 'finished'
--
-- El `booking_fee` es el que descuadraba: sin él, siete cuadraban y el octavo
-- se iba 2,57 € — que era exactamente la tarifa de reserva de uno de sus viajes.
-- Los pedidos en efectivo CANCELADOS vienen con todo el precio a NULL: ahí no
-- cambió dinero de manos, así que no cuentan.

BEGIN;

-- ── Lo que le faltaba a bolt_order para saber qué se cobró en efectivo ──────
ALTER TABLE bolt_order ADD COLUMN IF NOT EXISTS metodo_pago    VARCHAR(16);
ALTER TABLE bolt_order ADD COLUMN IF NOT EXISTS precio         NUMERIC(10,2);
ALTER TABLE bolt_order ADD COLUMN IF NOT EXISTS dto_efectivo   NUMERIC(10,2);
ALTER TABLE bolt_order ADD COLUMN IF NOT EXISTS tarifa_reserva NUMERIC(10,2);
COMMENT ON COLUMN bolt_order.metodo_pago IS
  'payment_method de BOLT: in_app | cash | business. Lo que decide si el conductor se quedó el dinero';
COMMENT ON COLUMN bolt_order.precio IS 'order_price.ride_price: el precio del viaje';
COMMENT ON COLUMN bolt_order.dto_efectivo IS 'order_price.cash_discount: lo que el pasajero NO pagó';
COMMENT ON COLUMN bolt_order.tarifa_reserva IS 'order_price.booking_fee: suma al efectivo que cobra el conductor';

-- Las que ya están guardadas se rellenan desde el payload crudo de su descarga,
-- que la ingesta guarda entero en ingesta_descarga.payload. Lo que sea más
-- viejo que las descargas guardadas se trae de la API con el backfill.
CREATE INDEX IF NOT EXISTS idx_bolt_order_cash
  ON bolt_order (creado_ts) WHERE metodo_pago = 'cash';

-- ── LA DEUDA: el efectivo que BOLT dice que cobró en la quincena ────────────
CREATE TABLE IF NOT EXISTS recaudacion_cierre (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  anio           SMALLINT    NOT NULL CHECK (anio BETWEEN 2020 AND 2100),
  mes            SMALLINT    NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quincena       SMALLINT    NOT NULL CHECK (quincena IN (1, 2)),
  importe        NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (importe >= 0),
  -- 'bolt'      = calculado de los pedidos en efectivo (lo normal)
  -- 'importado' = pegado de una hoja de fuera
  -- 'manual'    = escrito a mano aquí; el recálculo NO lo pisa
  origen         VARCHAR(12) NOT NULL DEFAULT 'bolt' CHECK (origen IN ('bolt', 'manual', 'importado')),
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Una sola cifra por conductor y quincena: si el cierre se vuelve a cargar,
  -- se PISA la de antes en vez de sumar dos verdades distintas.
  CONSTRAINT uq_recaud_cierre UNIQUE (conductor_id, anio, mes, quincena)
);
COMMENT ON TABLE recaudacion_cierre IS
  'Efectivo cobrado en la calle por quincena, del cierre de BOLT. Es la deuda del conductor con la empresa';

-- ── LA CAJA: todo lo que entra y sale, en un solo libro ────────────────────
-- Un movimiento tiene DOS efectos independientes, y confundirlos es lo que
-- descuadra una caja:
--
--   sobre la CAJA   ¿entra o sale dinero físico del cajón?
--   sobre la DEUDA  ¿el conductor debe menos después de esto?
--
-- No van juntos. Un descuento de nómina baja la deuda y NO mete un billete en
-- la caja. Una salida al banco vacía la caja y no cambia lo que nadie debe.
--
--   tipo                caja  deuda  ¿conductor?
--   presencial           +     +      sí     lo trajo en mano
--   nomina               ·     +      sí     se le descuenta de la nómina
--   entrega              −     −      sí     dinero devuelto al conductor
--   salida_banco         −     ·      no     ingresado en el banco
--   salida_gastos        −     ·      no     gastos de la empresa
--   salida_caja_chica    −     ·      no     pasa a la caja chica
--   salida_nomina        −     ·      no     nóminas pagadas en efectivo
CREATE TABLE IF NOT EXISTS recaudacion_movimiento (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- NULL en las salidas de caja: el dinero sale del cajón, no de nadie.
  conductor_id   BIGINT      REFERENCES conductor(id) ON DELETE CASCADE,
  -- La fecha del recibo, que es la que manda para saber a qué quincena cae.
  -- En los descuentos de nómina la pone RRHH y puede no ser la de hoy.
  fecha          DATE        NOT NULL,
  tipo           VARCHAR(20) NOT NULL CHECK (tipo IN (
                   'presencial', 'nomina', 'entrega',
                   'salida_banco', 'salida_gastos', 'salida_caja_chica', 'salida_nomina')),
  -- Lo de un conductor lleva conductor; una salida de caja, no. Sin esto, una
  -- salida con conductor pegado le bajaría la deuda a alguien sin motivo.
  CONSTRAINT ck_recaud_quien CHECK (
    (tipo LIKE 'salida\_%' AND conductor_id IS NULL) OR
    (tipo NOT LIKE 'salida\_%' AND conductor_id IS NOT NULL)),
  -- SIEMPRE positivo. El sentido lo pone el tipo, no el signo: un importe
  -- negativo y un tipo 'entrega' en la misma fila acabarían discrepando.
  importe        NUMERIC(10,2) NOT NULL CHECK (importe > 0),
  -- El recuento de billetes y monedas del recibo: {"500":0,"200":1,…,"0.01":3}.
  -- Solo en lo presencial. La suma tiene que cuadrar con `importe`; se comprueba
  -- en la aplicación, que aquí no se puede sin escribir aritmética en un CHECK.
  desglose       JSONB,
  -- OBLIGATORIA en las salidas: un billete que sale de la caja sin decir a
  -- dónde va es exactamente el agujero que este módulo viene a tapar.
  observacion    VARCHAR(255),
  CONSTRAINT ck_recaud_salida_obs CHECK (
    tipo NOT LIKE 'salida\_%' OR (observacion IS NOT NULL AND btrim(observacion) <> '')),
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- El dinero no se borra: se anula, con quién y por qué. Un recibo que
  -- desaparece sin rastro es justo lo que no puede pasar en una caja.
  anulado_at     TIMESTAMPTZ,
  anulado_por    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo VARCHAR(255),
  CONSTRAINT ck_recaud_anulado CHECK (anulado_at IS NULL OR anulado_motivo IS NOT NULL)
);
COMMENT ON TABLE recaudacion_movimiento IS
  'Cada entrega de efectivo: presencial (con desglose del recibo), descuento de nómina, o dinero devuelto al conductor';

CREATE INDEX IF NOT EXISTS idx_recaud_mov_cond  ON recaudacion_movimiento (conductor_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_recaud_mov_vivos ON recaudacion_movimiento (fecha) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_recaud_cierre_q  ON recaudacion_cierre (anio, mes, quincena);

COMMIT;