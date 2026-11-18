-- ============================================================
-- 266 — LAS REMESAS: lo que se le devuelve al conductor
-- ============================================================
-- Camilo, 18/11/2026, con el Excel «Remesas Conductores»: «Vamos a sacar las
-- funcionalidades de este excel y agregarlo a recaudación en un apartado
-- llamado "Remesas"… La remesa sí o sí debe de quitarle efectivo a entregar del
-- conductor, si el conductor no tiene efectivo en BOLT deben de haber los
-- siguientes estados: pagado con efectivo de BOLT (descuenta el monto que debe
-- de entregar), pagado en nómina, pendiente de pago, pendiente de aprobación,
-- pagado en su cuenta. Todos los estados pueden ser editables».
--
-- Una REMESA es un gasto que pagó el conductor y que la casa le devuelve
-- (combustible, ITV, lavado, parking, peaje…). Decidió (18/11/2026): solo
-- devoluciones (el carnet VTC no); solo Madrid por ahora; lo del Excel se sube
-- una vez desde la pantalla (lleva IBAN: no va en una migración, el
-- repositorio es público); las aprueba quien tenga la llave nueva
-- «/recaudacion/remesas/aprobar».
--
-- LO QUE HACE:
--   1 · recaudacion_remesa: cada remesa, con su estado. El IBAN va CIFRADO
--       (services/cripto.js), como el de la ficha del conductor.
--   2 · Un tipo de movimiento más en la recaudación, 'remesa': con los signos de
--       la nómina (baja lo que debe y no entra en el cajón). Una remesa
--       «pagada con efectivo de BOLT» lleva su movimiento (movimiento_id), que
--       se escribe y se anula en la misma transacción que su estado
--       (modules/Administracion/remesas.service.js). Las que se importan del
--       Excel no llevan movimiento: se saldaron en su día.
--   3 · La llave «Aprobar remesas» en el catálogo la añade services/permisos.js
--       (manual: no se siembra en ningún rol).
--
-- Bajo el libro de auditoría (convención 5, db/245).
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/266', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS recaudacion_remesa (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El conductor. NULL solo en lo importado que no se supo casar: se le pone
  -- después. Sin conductor no se puede pagar con su efectivo.
  conductor_id      BIGINT       REFERENCES conductor(id),
  beneficiario      VARCHAR(160) NOT NULL,       -- el nombre tal como se escribió
  fecha             DATE         NOT NULL,       -- la de la remesa
  fecha_documento   DATE,                        -- la del ticket o la factura
  concepto          VARCHAR(200),                -- combustible, ITV, lavado, parking…
  cif               VARCHAR(30),                 -- del que cobró el ticket
  numero_documento  VARCHAR(80),                 -- nº de la factura simplificada
  importe_cent      INTEGER      NOT NULL CHECK (importe_cent > 0),
  estado            VARCHAR(24)  NOT NULL DEFAULT 'pendiente_aprobacion' CHECK (estado IN
                      ('efectivo_bolt', 'nomina', 'pendiente_pago', 'pendiente_aprobacion', 'cuenta')),
  iban_cifrado      TEXT,
  -- El movimiento de la recaudación que la descuenta (estado efectivo_bolt).
  movimiento_id     BIGINT       REFERENCES recaudacion_movimiento(id),
  notas             TEXT,
  -- De dónde salió una importada (para no meterla dos veces).
  origen_ref        VARCHAR(120),
  creado_por        INTEGER      REFERENCES usuario(id),
  creado_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  aprobada_por      INTEGER      REFERENCES usuario(id),
  aprobada_at       TIMESTAMPTZ,
  actualizado_por   INTEGER      REFERENCES usuario(id),
  actualizado_at    TIMESTAMPTZ,
  anulado_at        TIMESTAMPTZ,
  anulado_por       INTEGER      REFERENCES usuario(id),
  anulado_motivo    TEXT,
  CONSTRAINT ck_remesa_anulada CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL)),
  CONSTRAINT ck_remesa_efectivo CHECK (estado <> 'efectivo_bolt' OR conductor_id IS NOT NULL OR origen_ref IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_remesa_origen ON recaudacion_remesa (origen_ref) WHERE origen_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_remesa_movimiento ON recaudacion_remesa (movimiento_id) WHERE movimiento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_remesa_conductor ON recaudacion_remesa (conductor_id) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_remesa_estado ON recaudacion_remesa (estado) WHERE anulado_at IS NULL;

COMMENT ON TABLE recaudacion_remesa IS
  'Las remesas (db/266): gastos que pagó el conductor y se le devuelven. Pagada con efectivo de BOLT lleva su movimiento ''remesa'' en recaudacion_movimiento. El IBAN, cifrado.';

-- ── El tipo de movimiento 'remesa' ─────────────────────────────────────────
ALTER TABLE recaudacion_movimiento DROP CONSTRAINT IF EXISTS recaudacion_movimiento_tipo_check;
ALTER TABLE recaudacion_movimiento
  ADD CONSTRAINT recaudacion_movimiento_tipo_check CHECK (tipo IN (
    'presencial', 'nomina', 'transferencia', 'entrega', 'cambio', 'remesa',
    'salida_banco', 'salida_gastos', 'salida_caja_chica', 'salida_nomina', 'salida_apertura'));

SELECT auditoria_vigilar('recaudacion_remesa', 'id', ARRAY['iban_cifrado']);

COMMIT;
