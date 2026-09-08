-- ============================================================
-- 71 · ROLES — los ocho que faltaban
-- ============================================================
-- Hasta ahora había cuatro (superadmin, desarrollador, oficina, trafico) y la
-- empresa tiene más áreas: el jefe de tráfico no ve lo mismo que un gestor, y
-- el taller no tiene por qué entrar en nóminas.
--
-- NINGUNO lleva `acceso_total`, ni siquiera Directiva: ese salto se queda para
-- superadmin y desarrollador, que son los que arreglan el sistema. A Directiva
-- y Gerencia se les siembran TODOS los módulos del catálogo, que por fuera da
-- lo mismo pero se ve y se afina en la matriz de /usuarios, en vez de ser una
-- excepción invisible metida en el código.
--
-- El reparto de módulos de cada uno vive en services/permisos.js (semillaDeRol):
-- aquí solo existe el rol. Y el permiso REAL es por usuario: el rol solo decide
-- con qué se estrena, y luego se ajusta uno a uno.
--
-- El `id` NO se pone: `rol.id` es una columna de identidad y la base la rechaza
-- si se le manda un valor.

BEGIN;

INSERT INTO rol (codigo, etiqueta, acceso_total) VALUES
  ('jefe_trafico',   'Jefe de tráfico',   FALSE),
  ('gestor_trafico', 'Gestor de tráfico', FALSE),
  ('taller',         'Taller',            FALSE),
  ('reclutador',     'Reclutador',        FALSE),
  ('administracion', 'Administración',    FALSE),
  ('operaciones',    'Operaciones',       FALSE),
  ('gerencia',       'Gerencia',          FALSE),
  ('directiva',      'Directiva',         FALSE)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, acceso_total = EXCLUDED.acceso_total;

COMMIT;
