-- ============================================================
-- 167 — EL CICLO DE BLOQUEO DE MOTOR (permisos del módulo nuevo)
-- ============================================================
-- Camilo, 30/09/2026: «No quiero ningún repaso. Los únicos que bloquearán son
-- los conductores cuando inicien turnos y terminen; el sistema no bloquea nada
-- sino que suelta». Y un módulo nuevo, «Ciclo de bloqueo de motor», con los
-- coches que estamos bloqueando y el botón de soltarlos (el coche que se queda
-- en el taller: Tráfico lo suelta y sale del ciclo hasta que alguien vuelva a
-- empezar y terminar un turno en él).
--
-- No hace falta tabla nueva. El libro del ciclo es `fichaje_orden_motor`, que ya
-- admitía 'bloquear' y 'soltar' y un usuario vacío: desde hoy apunta también lo
-- que hacen los conductores (bloquear al terminar, soltar al empezar), con
-- usuario_id NULL. Con usuario_id es Tráfico, a mano.
--
-- Esta migración solo reparte las dos llaves del módulo a quien ya soltaba
-- motores: el que puede EDITAR el planificador (el panel «Bloqueo de motor»,
-- donde estaba el botón hasta hoy). Superadmin y desarrollador entran sin filas.

BEGIN;

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/bloqueo-motor', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/planificador/editar'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/bloqueo-motor');

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/bloqueo-motor/soltar', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/planificador/editar'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/bloqueo-motor/soltar');

COMMENT ON TABLE fichaje_orden_motor IS
  'El libro del ciclo de bloqueo de motor (db/148, ampliado en db/167): cada vez que '
  'se bloquea o se suelta un motor, quién, cuándo, por qué y qué contestó el coche. '
  'usuario_id NULL = lo hizo el conductor desde el bot (bloquear al terminar, soltar '
  'al empezar); con usuario = Tráfico a mano desde el módulo.';

COMMIT;
