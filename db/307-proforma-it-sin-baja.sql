-- ============================================================
-- 307 — LA PROFORMA: IT QUE EL ERP NO TIENE (plan de RR. HH., módulo 4.5, 26/11/2026)
-- ============================================================
-- El encargo, del doble cruce con la gestoría: «si tenemos una baja registrada
-- y la gestoría no la imputa, alerta (puede que la baja no sea válida y haya que
-- seguir otra vía legal); si la gestoría imputa una IT que no tenemos, alerta
-- también». La primera mitad ya la hacía la proforma (db/296, `baja_medica`);
-- esta es la segunda: `it_sin_baja`.
-- ============================================================

BEGIN;

ALTER TABLE proforma_caso DROP CONSTRAINT IF EXISTS ck_proforma_tipo;
ALTER TABLE proforma_caso ADD CONSTRAINT ck_proforma_tipo
  CHECK (tipo IN ('legajo', 'sin_contrato', 'baja_medica', 'it_sin_baja', 'suspension', 'dias', 'fuera'));

COMMIT;
