-- ============================================================
-- 204 — LA FECHA DE NACIMIENTO DE LA GENTE DE OFICINA
-- ============================================================
-- Camilo, 15/10/2026: «Vamos a crear algo para el cumpleaños de los
-- conductores… ahora también queremos saber quién cumple en la oficina…
-- habilítame primero lo de la fecha de nacimiento en configuración para
-- decirle a mis compañeros que la pongan».
--
-- Los conductores ya la tienen en su ficha (`conductor.fecha_nacimiento`). La
-- oficina entra con un `usuario`, que no la tenía. Cada uno pone la suya en
-- Configuración → Mi perfil. Para el cumpleaños solo se usa el día y el mes.
--
-- Va en su propia columna y el código la lee en consultas aparte, NO en la
-- lectura general del usuario (la del inicio de sesión): así, si el código
-- llega antes que esta migración, se puede seguir entrando.

BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;
ALTER TABLE usuario DROP CONSTRAINT IF EXISTS ck_usuario_nacimiento;
ALTER TABLE usuario ADD CONSTRAINT ck_usuario_nacimiento
  CHECK (fecha_nacimiento IS NULL OR fecha_nacimiento >= DATE '1920-01-01');

COMMENT ON COLUMN usuario.fecha_nacimiento IS
  'La pone cada uno en Configuración → Mi perfil. Para felicitarle el cumpleaños (solo día y mes). db/204';

COMMIT;
