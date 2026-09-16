-- ============================================================
-- 129 - EL PLANIFICADOR SE PARTE EN MIRAR Y TOCAR
-- ============================================================
-- Hasta ahora, quien podía abrir el planificador podía cambiarlo. Y abrirlo lo
-- necesita media empresa: RRHH quiere saber dónde cae una persona, Operaciones
-- qué coche sale mañana, el taller cuándo puede llevarse uno. Nadie de esos
-- tiene por qué mover a nadie de sitio.
--
-- Desde ahora son dos permisos, como la bitácora (leer / justificar) o el
-- taller (mirar / apuntar):
--
--   /planificador          abrir el cuadrante y mirarlo
--   /planificador/editar   guardar cambios
--
-- El reparto NO va por una lista de rutas sino por MÉTODO: cualquier petición
-- al planificador que no sea un GET exige el permiso de editar. Es a propósito
-- —el tablero tiene veinte endpoints que escriben y una lista a mano se queda
-- corta el día que alguien añade el veintiuno, que es justo el día en que un
-- candado tiene que seguir cerrado—.
--
-- ── POR QUÉ SE LO DAMOS A TODOS LOS QUE YA ENTRABAN ────────────────────────
-- Porque hoy ya podían editar. Si el permiso naciera apagado, mañana por la
-- mañana Tráfico no podría planificar y nadie sabría por qué: un cambio de
-- permisos nunca debe quitarle a nadie algo que tenía sin que alguien lo
-- decida. Se reparte igual que estaba y a partir de ahí se quita, uno a uno,
-- desde /usuarios — que es justo lo que se pidió poder hacer.

BEGIN;

-- `usuario_mod` guarda el ID de quien toco el permiso, y aqui no lo toco
-- ninguno: lo hace la migracion. Por eso va en NULL y no con una etiqueta.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/planificador/editar', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/planificador'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id
                      AND q.clave = '/planificador/editar');

COMMIT;
