-- ============================================================
-- 310 — LOS COMUNICADOS CON PDF, Y EL SMS CERTIFICADO A QUIEN NO LOS LEE (27/11/2026)
-- ============================================================
-- Lo que decidió Camilo el 27/11/2026:
--   · Un comunicado puede llevar un PDF (una circular, una norma). Se abre SOLO
--     en el portal: el correo avisa y lleva allí. Así queda cuándo lo abrió cada
--     uno (`pdf_at`), además de su «Lo he leído».
--   · A quien no lo ha leído, un SMS certificado de Mensatek cuando Diana lo
--     decida: el borrador nace desde el comunicado (origen 'comunicado').
-- ============================================================

BEGIN;

ALTER TABLE comunicado_destinatario ADD COLUMN IF NOT EXISTS pdf_at TIMESTAMPTZ;
COMMENT ON COLUMN comunicado_destinatario.pdf_at IS
  'La primera vez que abrió en el portal el PDF del comunicado (db/310)';

ALTER TABLE sms_envio DROP CONSTRAINT IF EXISTS ck_sms_envio_origen;
ALTER TABLE sms_envio ADD CONSTRAINT ck_sms_envio_origen
  CHECK (origen IN ('manual', 'sancion', 'finiquito', 'comunicado'));

COMMIT;
