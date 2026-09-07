-- ============================================================
-- 65 — Usuarios en PostgreSQL de una vez + permisos por usuario
-- ============================================================
-- La tabla `usuario` existía desde el día 1 pero vacía: las cuentas seguían en
-- la hoja USUARIOS. Se completa lo que a la tabla le faltaba de la hoja (los
-- tokens de "olvidé mi contraseña") y nace `usuario_permiso`: QUÉ MÓDULOS Y
-- SUBMÓDULOS puede abrir cada usuario, elegidos uno a uno desde /usuarios.
-- Los roles con acceso_total (superadmin, desarrollador) no necesitan filas.

BEGIN;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS token_reset  VARCHAR(64);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS token_expira TIMESTAMPTZ;

CREATE TABLE usuario_permiso (
  usuario_id  INTEGER     NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- El prefijo de ruta del módulo ('/control', '/control/km', '/rrhh'…): la
  -- misma clave que usa el control de acceso y el menú. El catálogo con las
  -- etiquetas vive en services/permisos.js.
  clave       VARCHAR(40) NOT NULL,
  usuario_mod INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave)
);

COMMIT;
