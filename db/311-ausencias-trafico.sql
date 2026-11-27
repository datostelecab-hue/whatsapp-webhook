-- ============================================================
-- 311 — LAS AUSENCIAS DESDE EL CORTE DEL 26/11, A TRÁFICO (27/11/2026)
-- ============================================================
-- Camilo: «en el módulo de ausencias… que empiece a regir a partir de ayer, que
-- empieza el corte del mes, tienen que confirmarlas Tráfico, o darlas como
-- justificadas, Diana no». Quién: William y Ángel. Lo que deciden:
-- injustificada o justificada; justificada pide horas y su J de Tráfico nace
-- ya aprobada.
--
--   · '/ausencias' (mirar) y '/ausencias/trafico' (confirmarlas desde el
--     26/11), a William (2) y a Ángel (31). Diana sigue con '/ausencias/validar'
--     para lo de antes del 26/11 y para abrir una baja médica o un permiso.
--   · La función «ausencias_trafico» (su tarjeta del día) a los dos.
--   · Las tarjetas «Ausencias por revisar» que siguen abiertas y son de
--     ausencias desde el 26/11 (detectadas desde el 27/11) pasan a William.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/311', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (2, 'William', '/ausencias'), (2, 'William', '/ausencias/trafico'),
               (31, 'Angel', '/ausencias'), (31, 'Angel', '/ausencias/trafico')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

INSERT INTO usuario_funcion (usuario_id, funcion, suplente, nota, creado_por)
SELECT u.id, 'ausencias_trafico', FALSE, 'Ausencias desde el corte del 26/11 a Tráfico: decisión del 27/11/2026', 7
  FROM usuario u
 WHERE (u.id, u.nombre) IN ((2, 'William'), (31, 'Angel'))
   AND NOT EXISTS (SELECT 1 FROM usuario_funcion x
                    WHERE x.usuario_id = u.id AND x.funcion = 'ausencias_trafico' AND x.anulado_at IS NULL);

UPDATE tarea t SET responsable_id = 2, asignada_at = now()
 WHERE t.tipo = 'ausencias_revisar' AND t.estado IN ('por_hacer', 'en_curso', 'bloqueada', 'por_asignar')
   AND t.origen_id >= '2026-11-27'
   AND EXISTS (SELECT 1 FROM usuario u WHERE u.id = 2 AND u.nombre = 'William');

COMMIT;
