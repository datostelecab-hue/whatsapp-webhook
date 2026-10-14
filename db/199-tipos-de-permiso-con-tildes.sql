-- ============================================================
-- 199 — LOS TIPOS DE PERMISO, CON SUS TILDES
-- ============================================================
-- Desde el 14/10/2026 el tipo de un permiso se elige al ponerlo (Plantilla y
-- Ticketera), porque de los permisos retribuidos solo los de ASUNTOS PROPIOS
-- restan de las vacaciones. Los nombres del catálogo (`leave_type`, db/31) se
-- escribieron sin tildes ni eñes —«Acompanyamiento», «hospitalizacion»— y ahora
-- se leen en un desplegable. Solo cambia el nombre: los códigos, que es lo que
-- se guarda y se mira, no se tocan. Nada busca estos permisos por su nombre.
BEGIN;

UPDATE leave_type AS l SET name = v.nombre
  FROM (VALUES
    ('PR_ACOMP_MEDICO',     'Acompañamiento a visitas médicas de familiares de 1.er grado'),
    ('PR_DEBER_PUBLICO',    'Deber inexcusable de carácter público y personal'),
    ('PR_ENF_GRAVE',        'Accidente o enfermedad grave, hospitalización o intervención con reposo domiciliario'),
    ('PR_FALLECIMIENTO',    'Fallecimiento de un familiar hasta 2.º grado'),
    ('PR_GUARDA_LEGAL',     'Guarda legal de menor de 12 años o persona con discapacidad'),
    ('PR_PRENATAL',         'Exámenes prenatales y preparación al parto'),
    ('PR_SINDICAL',         'Funciones sindicales o de representación'),
    ('PR_VIOLENCIA_GENERO', 'Víctima de violencia de género')
  ) AS v (codigo, nombre)
 WHERE l.leave_type_code = v.codigo;

COMMIT;
