-- ============================================================
-- 274 — CHAT: OCULTAR, SALIR DEL GRUPO, ARCHIVAR Y «ELIMINAR» SIN BORRAR
-- ============================================================
-- Camilo, 23/11/2026: «en los chats me deja crear grupos, pero no me deja luego
-- eliminarlos o quitar gente de los grupos creados». Y: «que se "borren" los
-- chats, pero que nunca se borre de la base de datos, que se guarden siempre
-- como "Mensajes eliminados"».
--
--   · OCULTAR una conversación (directos): cada uno, la suya. Vuelve a salir
--     cuando alguien escribe después (chat_miembro.oculto_at y oculto_hasta_id).
--   · SALIR DE UN GRUPO y QUITAR GENTE de un directo de grupo: con la marca de
--     salida que ya había (chat_miembro.salido_at). Sin columnas nuevas.
--   · ARCHIVAR un canal: con chat_canal.archivado_at, que ya existía (db/256)
--     y no usaba ninguna pantalla.
--   · ELIMINAR un chat: desaparece para todos, pero NO se borra nada. Queda la
--     marca (eliminado_at, eliminado_por) y lo sigue viendo, de solo lectura,
--     el rol desarrollador en «Mensajes eliminados».
--
-- Solo columnas nuevas, que pueden ser nulas: se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/274', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE chat_miembro ADD COLUMN IF NOT EXISTS oculto_at TIMESTAMPTZ;
-- El último mensaje que había al ocultarla: con uno después, vuelve a salir.
ALTER TABLE chat_miembro ADD COLUMN IF NOT EXISTS oculto_hasta_id BIGINT;

ALTER TABLE chat_canal ADD COLUMN IF NOT EXISTS eliminado_at  TIMESTAMPTZ;
ALTER TABLE chat_canal ADD COLUMN IF NOT EXISTS eliminado_por INTEGER REFERENCES usuario(id);

CREATE INDEX IF NOT EXISTS ix_chat_canal_eliminado ON chat_canal (eliminado_at DESC) WHERE eliminado_at IS NOT NULL;

COMMENT ON COLUMN chat_miembro.oculto_at IS 'Lo ocultó de su lista (db/274). Vuelve a salir si llega un mensaje después.';
COMMENT ON COLUMN chat_canal.eliminado_at IS 'Eliminado para todos (db/274), pero nunca borrado: lo ve el rol desarrollador en «Mensajes eliminados».';

COMMIT;
