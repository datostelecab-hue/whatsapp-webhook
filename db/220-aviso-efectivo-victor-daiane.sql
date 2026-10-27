-- ============================================================
-- 220 — EL AVISO DEL EFECTIVO SIN ENTREGAR: para Víctor y Daiane
-- ============================================================
-- Camilo, 27/10/2026: «necesito un PopUp como el de los cumpleaños pero solo
-- para Víctor y Dahian, en el cual salgan las personas con efectivo activo,
-- desestima a los que ya entregaron efectivo así sea una vez en recaudación».
--
-- La tarjeta la ve quien tenga la llave '/avisos/efectivo' en su matriz
-- (modules/Administracion/avisoEfectivo.service.js). Es `manual`: no la siembra
-- ningún rol, y ni el superadmin ni el desarrollador la ven por su rol. Para
-- dársela a alguien más, en Usuarios y permisos.
--
-- Víctor (usuario 3, rrhh@telecab.es) y Daiane Alves (usuario 9,
-- admin@telecab.es). Por id Y por correo: si en esta base el 3 o el 9 fueran
-- otra persona, a esa no se le da.

BEGIN;

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/avisos/efectivo', 7
  FROM usuario u
 WHERE (u.id = 3 AND lower(u.email) = 'rrhh@telecab.es')
    OR (u.id = 9 AND lower(u.email) = 'admin@telecab.es')
ON CONFLICT (usuario_id, clave) DO NOTHING;

COMMIT;
