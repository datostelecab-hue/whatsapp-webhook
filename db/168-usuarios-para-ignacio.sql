-- ============================================================
-- 168 — USUARIOS Y PERMISOS, TAMBIÉN PARA IGNACIO
-- ============================================================
-- Camilo, 30/09/2026: «dale acceso solo a Ignacio al módulo de usuarios y
-- permisos». Hasta hoy /usuarios era solo del desarrollador (su rol). Darle a
-- Ignacio ese rol le abriría además la base de datos y las migraciones, así
-- que se le da el MÓDULO y nada más: la llave '/usuarios' (services/permisos.js).
--
-- La llave es de UNA sola persona, como la de aprobar fichajes (db/159): lo
-- vigila este índice y no la pantalla, para que no haya camino —otra pantalla,
-- un script, otra migración— por el que acaben siendo dos. El desarrollador
-- entra igual que siempre, por su rol; el superadmin, no.
--
-- Ignacio es el usuario 1 (Ignacio Cafferata). Se comprueba el nombre antes de
-- dársela: si el 1 fuera otra persona, no se da a nadie.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_permiso_usuarios
  ON usuario_permiso (clave) WHERE clave = '/usuarios';

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/usuarios', 7
  FROM usuario u
 WHERE u.id = 1 AND u.nombre = 'Ignacio' AND u.apellidos = 'Cafferata'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.clave = '/usuarios');

COMMIT;
