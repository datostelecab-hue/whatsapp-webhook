-- ============================================================
-- 279 — «LIBRANZA EXCEPCIONAL», UNA SITUACIÓN DE LA PLANTILLA
-- ============================================================
-- Camilo, 24/11/2026, con las vacaciones de Tarik Lajane Aamara (ficha 113)
-- del 30/10 al 04/11: «no fueron vacaciones las solicitadas por William sino
-- que era descanso excepcional», «déjalos como libranza excepcional, son 6
-- días» y «él trabajó prácticamente todo el mes y Tráfico le dio esos días de
-- descanso por todos los días que trabajó».
--
-- En el planificador, la libranza excepcional (db/54, db/223) es un CAMBIO de
-- un día por otro: trabaja uno que libra y libra uno que trabaja. Esto es otra
-- cosa: DÍAS DE DESCANSO QUE COMPENSAN los días de libranza que ya trabajó. Va
-- como una situación más, como las vacaciones o los asuntos propios:
--   · es ausencia: esos días no sale;
--   · libera la plaza, como las vacaciones: son días seguidos y el coche
--     necesita a alguien (aparece el hueco en el cuadrante);
--   · tiene fecha de vuelta (fin previsible);
--   · en la bitácora es una «L» (libranza): no es una falta;
--   · NO gasta vacaciones ni se paga como ausencia (la nómina solo cuenta
--     vacaciones, permisos y asuntos propios): los días que compensa ya se
--     pagaron como trabajados. Sin apunte en el convenio (ledger_tipo NULL).
-- Va justo detrás de «Vacaciones» en las listas.
--
-- Pasar las de Tarik a esta situación lo hace Laura desde Vacaciones («Corregir»),
-- con su motivo: queda en el libro de auditoría con su nombre.
-- ============================================================

BEGIN;

-- Hueco detrás de «Vacaciones» (orden 2).
UPDATE cat_estado_conductor SET orden = orden + 1
 WHERE orden >= 3
   AND NOT EXISTS (SELECT 1 FROM cat_estado_conductor WHERE codigo = 'libranza_excepcional');

INSERT INTO cat_estado_conductor
  (codigo, etiqueta, es_ausencia, libera_plaza, fin_previsible, marca_bitacora, orden, es_fin_contrato, ledger_tipo)
VALUES
  ('libranza_excepcional', 'Libranza excepcional', TRUE, TRUE, TRUE, 'L', 3, FALSE, NULL)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, es_ausencia = EXCLUDED.es_ausencia, libera_plaza = EXCLUDED.libera_plaza,
  fin_previsible = EXCLUDED.fin_previsible, marca_bitacora = EXCLUDED.marca_bitacora,
  es_fin_contrato = EXCLUDED.es_fin_contrato, ledger_tipo = EXCLUDED.ledger_tipo;

COMMIT;
