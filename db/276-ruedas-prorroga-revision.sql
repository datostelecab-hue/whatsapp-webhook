-- ============================================================
-- 276 — RUEDAS: LA REVISIÓN DA 15.000 KM MÁS (UNA POR TRAMO)
-- ============================================================
-- Camilo, 23/11/2026: «cuando se haga una revisión de ruedas, que le ponga
-- 15000 KM más de margen para tocar cambiar, entonces, si hay unas ruedas con
-- 30000 KM recorridos y se apunta una revisión, entonces sí o sí se cambia a los
-- 45000, no hay más revisiones, solo una revisión por tramo».
--
-- La cuenta la hace modules/Vehiculos/ruedas.service.js (no la base). Aquí solo
-- cambia el aviso por el chat: era UNA vez por cambio; ahora, una vez por cambio
-- Y por revisión. Así, el coche al que se avisó a los 30.000 y luego se revisó
-- vuelve a avisar al llegar a los 45.000.
--
-- Solo una columna nueva y el índice: se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/276', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE ruedas_aviso ADD COLUMN IF NOT EXISTS revision_id BIGINT REFERENCES ruedas_revision(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS uq_ruedas_aviso;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ruedas_aviso_tramo
  ON ruedas_aviso (vehiculo_id, COALESCE(cambio_id, 0), COALESCE(revision_id, 0));

COMMENT ON COLUMN ruedas_aviso.revision_id IS
  'La revisión del tramo cuando se avisó (db/276): con revisión, el cambio toca a los 45.000 km y se vuelve a avisar.';

COMMIT;
