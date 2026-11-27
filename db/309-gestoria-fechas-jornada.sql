-- ============================================================
-- 309 — EL LISTADO DE TRABAJADORES DE A3: FECHAS Y JORNADA (módulo 8, 27/11/2026)
-- ============================================================
-- El listado de trabajadores de A3 («PLANTILLA TRABAJADORES») trae a todos,
-- también a los que se fueron, con su fecha de ingreso, su fecha de baja y su
-- coeficiente de parcialidad. Con él, el cruce con la gestoría tiene cuatro
-- diferencias más, que decide quien lleva la gestoría (Camilo: «Diana, en cada
-- caso»): corregir el ERP o pedírselo a la gestoría.
--
--   baja_gestoria_alta_nuestra  de baja en la gestoría y de alta con nosotros
--   fecha_alta_distinta         la fecha de alta no es la misma
--   fecha_baja_distinta         los dos le dieron de baja, en fechas distintas
--   jornada_distinta            las horas de su contrato no son las mismas
--
-- Solo amplía los tipos: no cambia nada de lo que ya hay.
-- ============================================================

BEGIN;

ALTER TABLE gestoria_discrepancia DROP CONSTRAINT IF EXISTS ck_gestoria_disc_tipo;
ALTER TABLE gestoria_discrepancia ADD CONSTRAINT ck_gestoria_disc_tipo
  CHECK (tipo IN ('alta_gestoria_baja_nuestra', 'alta_nuestra_no_gestoria', 'legajo_cambiado',
                  'legajo_desconocido', 'nombre_distinto', 'sin_legajo',
                  'baja_gestoria_alta_nuestra', 'fecha_alta_distinta', 'fecha_baja_distinta', 'jornada_distinta'));

COMMIT;
