-- ============================================================
-- 281 — LA FICHA DE PRUEBAS NO CUENTA COMO UN ALTA
-- ============================================================
-- Camilo, 24/11/2026, con el conductor de pruebas de db/280: «Pero ojo, ese
-- conductor de pruebas no cuenta como alta en todo el sistema, no?» y, visto
-- dónde pesaba, «Márcala como de pruebas y sácala de todo eso».
--
-- `conductor.es_prueba`: la ficha es de pruebas. Sigue pudiendo entrar al
-- portal y usar el bot (vincular, puertas, desvincular, motor), pero NO sale en:
-- el Excel de la gestoría, los contratos de RRHH, la nómina, los objetivos del
-- mes, los recuentos de la plantilla, las incorporaciones, el planificador ni
-- vacaciones. En Plantilla se ve, con la etiqueta «Pruebas», para poder
-- editarla. Lo aplica el código (cada consulta), no la base.
--
-- Se marca la de db/280: la que acaba en «(PRUEBAS)».
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/281', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE conductor ADD COLUMN IF NOT EXISTS es_prueba BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN conductor.es_prueba IS
  'Ficha de pruebas (db/281): entra al portal y usa el bot, pero no cuenta como un alta (ni gestoría, ni contratos, ni nómina, ni recuentos, ni planificador, ni vacaciones)';

UPDATE conductor SET es_prueba = TRUE
 WHERE apellidos LIKE '%(PRUEBAS)' AND NOT es_prueba;

COMMIT;
