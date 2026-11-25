-- ============================================================
-- 290 — QUIÉN VALIDA LOS PERMISOS RETRIBUIDOS: SU LLAVE
-- ============================================================
-- Módulo 1 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). El
-- encargo: «Permisos retribuidos: validador configurable (persona por definir;
-- de momento, Diana), con el saldo por conductor y tipo de permiso siempre
-- visible según el convenio».
--
-- Camilo, 25/11/2026: la llave en todas las puertas (Plantilla, Ticketera y
-- Ausencias), también para los asuntos propios; y si un permiso pasa de lo que
-- da el convenio, se avisa y se guarda solo con un motivo
-- (modules/Conductores/permisosConvenio.js). Sin tabla nueva: el saldo se
-- cuenta de los tramos de la ficha y del catálogo del convenio (leave_type).
--
-- La llave '/permisos/aprobar', de inicio a Diana (id y nombre, como db/285).
-- No es de una sola persona: se da a más gente en /usuarios.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/290', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/permisos/aprobar', NULL
  FROM usuario u
 WHERE u.id = 20 AND u.nombre = 'Diana'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = '/permisos/aprobar');

COMMIT;
