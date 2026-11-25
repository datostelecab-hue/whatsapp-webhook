-- ============================================================
-- 285 — DIANA LLEVA RR. HH., Y LAS VENCIDAS AVISAN A IGNACIO
-- ============================================================
-- Fase 0 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). La
-- persona que llevaba RR. HH. (Laura, usuario 4) ha salido y Diana (usuario 20,
-- «Diana C») asume el puesto. Camilo, 25/11/2026: «Diana C. Ese es el usuario
-- de ella. Programa que le lleguen a Ignacio».
--
-- 1) LAS LLAVES DE RR. HH. A DIANA: las que tenía Laura y Diana no
--    (/convenio, /reportes) y la de APROBAR VACACIONES, que es de una sola
--    persona (db/189, uq_permiso_vacaciones_aprobar): pasa de Laura a Diana.
--    Las demás llaves de Laura no se tocan (su usuario sigue activo: darlo de
--    baja es cosa de /usuarios).
-- 2) LA LLAVE '/tablero/vencidas' (nueva, manual): quien la tiene recibe el
--    aviso de todas las tarjetas que vencen. De inicio, Ignacio (usuario 1).
--
-- Por id Y por nombre, como db/243: en una base que no es la de producción
-- (pruebas, local antigua) no se le da nada a quien no es.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/285', true),
       set_config('telecab.usuario_id', '7', true);

DO $$
DECLARE
  diana  INTEGER := (SELECT id FROM usuario WHERE id = 20 AND nombre = 'Diana');
  laura  INTEGER := (SELECT id FROM usuario WHERE id = 4 AND nombre = 'Laura');
  nacho  INTEGER := (SELECT id FROM usuario WHERE id = 1 AND nombre = 'Ignacio');
BEGIN
  IF diana IS NOT NULL THEN
    -- La de aprobar vacaciones es de una sola persona: primero se le quita a quien la tenga.
    DELETE FROM usuario_permiso WHERE clave = '/vacaciones/aprobar' AND usuario_id <> diana;
    INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
    SELECT diana, c, NULL
      FROM unnest(ARRAY['/vacaciones/aprobar', '/convenio', '/reportes']) AS c
     WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = diana AND p.clave = c);
    -- Y cualquier otra que tuviera Laura y Diana no (si para entonces hay más).
    IF laura IS NOT NULL THEN
      INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
      SELECT diana, l.clave, NULL
        FROM usuario_permiso l
       WHERE l.usuario_id = laura AND l.clave NOT IN ('/usuarios', '/fichaje/revisar')
         AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = diana AND p.clave = l.clave);
    END IF;
  ELSE
    RAISE NOTICE 'db/285: no está el usuario 20 «Diana»: no se traspasan llaves';
  END IF;

  IF nacho IS NOT NULL THEN
    INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
    SELECT nacho, '/tablero/vencidas', NULL
     WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = nacho AND p.clave = '/tablero/vencidas');
  ELSE
    RAISE NOTICE 'db/285: no está el usuario 1 «Ignacio»: la llave de las vencidas no se da a nadie';
  END IF;
END $$;

COMMIT;
