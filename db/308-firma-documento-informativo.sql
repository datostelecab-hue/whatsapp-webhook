-- ============================================================
-- 308 — EL DOCUMENTO INFORMATIVO DEL CONTRATO A FIRMA (módulo 8, 26/11/2026)
-- ============================================================
-- El modelo oficial del SEPE (RD 723/2026) de los elementos esenciales del
-- contrato, con el texto fijo de Tibus: cada alta nueva de plantilla propia lo
-- manda a firmar con la plantilla de YouTrust «Documento informativo del
-- contrato», junto a su carta de incorporación. Una sola firma, al final.
-- ============================================================

BEGIN;

ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_tipo;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_tipo
  CHECK (tipo IN ('finiquito', 'suspension', 'sancion', 'descuento', 'contrato', 'comunicacion', 'baja_voluntaria',
                  'incorporacion', 'informativo', 'otro'));

COMMIT;
