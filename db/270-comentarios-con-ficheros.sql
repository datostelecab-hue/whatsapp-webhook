-- ============================================================
-- 270 — LOS COMENTARIOS DEL TABLERO, CON FICHEROS Y GIF (18/11/2026)
-- ============================================================
-- Camilo, 18/11/2026: «que en cada tarea también se puedan adjuntar archivos,
-- lo que sea: imágenes, vídeos, Word, Excel, etc., hasta GIFs en los
-- comentarios».
--
-- Los ficheros van al servicio de adjuntos (db/249), que ya admite cualquier
-- dueño: no hace falta tabla nueva para ellos. Lo que sí cambia es el
-- comentario: un GIF o un fichero puede mandarse SIN texto. Por eso el texto
-- deja de ser obligatorio cuando el comentario lleva ficheros (con_adjuntos).
--
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/270', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE tarea_comentario ADD COLUMN IF NOT EXISTS con_adjuntos BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tarea_comentario DROP CONSTRAINT IF EXISTS tarea_comentario_texto_check;
ALTER TABLE tarea_comentario ADD CONSTRAINT ck_tarea_comentario_texto
  CHECK ((btrim(texto) <> '' OR con_adjuntos) AND length(texto) <= 4000);

COMMENT ON COLUMN tarea_comentario.con_adjuntos IS
  'El comentario lleva ficheros o GIF (adjuntos de dueño tarea_comentario). Con ellos, el texto puede ir vacío (db/270).';

COMMIT;
