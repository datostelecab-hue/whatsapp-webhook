-- ============================================================
-- 189 — LAS VACACIONES LAS APRUEBA UNA SOLA PERSONA: Laura Blanco
-- ============================================================
-- Camilo, 09/10/2026: «el departamento de Laura será el único que apruebe
-- vacaciones; el resto puede verlas pero no aprobarlas. Laura Blanco será la
-- única».
--
-- Aprobar es ponerlas en la ficha por cualquier camino: aplicar o cerrar el
-- ticket que las pide, sacarlo de la bandeja de vacaciones, o poner, corregir o
-- borrar un tramo de vacaciones en Plantilla. Lo exige el servidor con la llave
-- '/vacaciones/aprobar' (services/aprobarVacaciones.js), mirada en la matriz de
-- cada uno: ni el superadmin ni el desarrollador aprueban por su rol.
--
-- La llave la tiene UNA persona, como la de los fichajes (db/159) y la de
-- Usuarios (db/168). Lo vigila la base y no la pantalla de permisos: así no hay
-- camino —otra pantalla, un script, una migración— por el que acaben siendo dos.
-- Para dársela a otra, primero hay que quitársela a quien la tenga.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_permiso_vacaciones_aprobar
  ON usuario_permiso (clave) WHERE clave = '/vacaciones/aprobar';

-- Laura Blanco (usuario 4). Por id Y por nombre: si el 4 fuera otra persona en
-- esta base, no se le da a nadie.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/vacaciones/aprobar', 7
  FROM usuario u
 WHERE u.id = 4 AND u.nombre = 'Laura' AND u.apellidos = 'Blanco'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.clave = '/vacaciones/aprobar');

COMMIT;
