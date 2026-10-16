-- ============================================================
-- 206 · NÓMINAS — la facturación neta en la fila congelada
-- ============================================================
-- Camilo, 16/10/2026: «Hazme una pestaña con el resumen del cálculo por cada
-- conductor con su total». El resumen explica el MBO FAS —(facturación neta −
-- umbral) × 40 %—, y la fila congelada guardaba el FAS ya calculado pero no la
-- facturación de la que sale. Sin ella, de un mes cerrado solo se podría decir
-- «no llegó al umbral», no cuánto facturó.
--
-- Sin valor en las filas que ya estaban congeladas: no se sabe con qué
-- facturación se cerraron, y un cero diría que no facturó nada. El resumen de
-- esas dice el FAS sin la facturación.
--
-- Hasta aplicar esto la nómina se congela y se lee igual que antes (el
-- repositorio mira si la columna existe).

BEGIN;

ALTER TABLE nomina_fila
  ADD COLUMN IF NOT EXISTS neto NUMERIC(12,2);

COMMENT ON COLUMN nomina_fila.neto IS
  'Facturación neta del mes de esa persona, de la que sale el MBO FAS. NULL en las filas congeladas antes de db/206';

COMMIT;
