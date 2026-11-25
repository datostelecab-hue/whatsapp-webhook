-- ============================================================
-- 288 — EL INFORME DE JORNADA PARA EL SMAC: SU LLAVE
-- ============================================================
-- Módulo 5 del plan de RR. HH. y nóminas (25/11/2026). El informe de horas de
-- un conductor por rango de fechas, en PDF y Excel, desde su ficha, para legal
-- y los abogados. No hay tabla: se calcula de los tramos de BOLT y cada emisión
-- queda en el libro de auditoría de la ficha.
--
-- La llave '/informe-jornada', de inicio a Diana (RR. HH.) y a Ignacio
-- (dirección), por id y nombre como db/285. Se da a más gente en /usuarios.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/288', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/informe-jornada', NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana'), (1, 'Ignacio')) AS c (id, nombre) ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = '/informe-jornada');

COMMIT;
