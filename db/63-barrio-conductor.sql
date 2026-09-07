-- ============================================================
-- 63 — El BARRIO del conductor ("Aluche", "San Blas"…)
-- ============================================================
-- La zona DE LA PERSONA para planificar, dicha por Tráfico con sus palabras.
-- No es la `localidad` (el municipio del padrón, que usa la gestoría y ya está
-- rellena con "MADRID", "ALCOBENDAS"…) ni la `base_zona` de los coches.
-- Se edita desde el planificador y se pide en el alta rápida de la ETT.

BEGIN;

ALTER TABLE conductor ADD COLUMN IF NOT EXISTS barrio VARCHAR(60);

COMMENT ON COLUMN conductor.barrio IS
  'Zona de casa del conductor (Aluche, San Blas…), texto libre de Tráfico. No confundir con localidad (municipio de la gestoría).';

COMMIT;
