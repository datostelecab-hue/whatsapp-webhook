-- ============================================================
-- 301 — LAS LLAVES DE DATOS DE SALUD Y DE NÓMINA (FASE 0 DEL PLAN DE RR. HH.)
-- ============================================================
-- La Ticketera de RR. HH. la tenían 15 de 16 personas y, con ella, los casos
-- de baja médica (con sus partes) y los de nómina (con los cambios de cuenta).
-- Desde ahora cada uno va por su llave, persona a persona (Camilo, 26/11/2026):
--
--   '/ticketera/salud'   Datos de salud: Diana, Ignacio, William y Ángel.
--   '/ticketera/nomina'  Datos de nómina: Diana, Ignacio y quien ya tiene
--                        /nominas (la variable de todos).
--
-- /nominas y /convenio pasan a ser `manual` (el catálogo, en el código): ya no
-- se reparten por rol a un usuario nuevo. No se le quita nada a nadie: eso se
-- hace a mano en Usuarios.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/301', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/ticketera/salud'), (1, 'Ignacio', '/ticketera/salud'),
               (2, 'William', '/ticketera/salud'), (31, 'Angel', '/ticketera/salud'),
               (20, 'Diana', '/ticketera/nomina'), (1, 'Ignacio', '/ticketera/nomina')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

-- Quien ya ve la variable de todos (/nominas) ve también los casos de nómina.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT DISTINCT n.usuario_id, '/ticketera/nomina', NULL::integer
  FROM usuario_permiso n
 WHERE n.clave = '/nominas'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = n.usuario_id AND p.clave = '/ticketera/nomina');

COMMIT;
