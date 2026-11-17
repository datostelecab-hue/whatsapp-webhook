-- ============================================================
-- 257 — EL CHAT INTERNO, entrega 2b: adjuntos, reacciones, editar y anular,
--       fijar y guardar, vista previa de enlaces y convertir en tarea
-- ============================================================
-- Ítem 2 de la hoja de ruta, sobre db/256. Lo que decidió Camilo el 17/11/2026:
--   · REACCIONES: seis emojis fijos (👍 ✅ 👀 🙏 😂 ❤️). Aquí van por su
--     código ('ok', 'hecho', 'visto', 'gracias', 'risa', 'corazon').
--   · EDITAR Y ANULAR LO PROPIO cuando se quiera y sin motivo, como en Slack. Quien
--     lleva los canales (chat_canales) anula lo de otro, y ahí sí con motivo. Nada
--     se borra: el texto queda en la fila y en el libro (chat_mensaje ya está
--     vigilado desde db/256).
--   · CONVERTIR EN TAREA, como una tarea a mano del tablero (tipo 'mensaje', con
--     su aprobación); el mensaje lleva el sello y, al cerrarse, la respuesta sale
--     en su hilo (evento 'tarea_cerrada').
--   · FIJAR: cualquiera del canal; GUARDAR: cada uno lo suyo.
--
-- Quitar una reacción, desfijar o dejar de guardar es una marca con fecha, no un
-- borrado (convención 5).

BEGIN;

SELECT set_config('telecab.origen', 'migración db/257', true),
       set_config('telecab.usuario_id', '7', true);

-- ── Los mensajes: los que solo llevan ficheros, el enlace y las respuestas solas ─
ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS con_adjuntos BOOLEAN NOT NULL DEFAULT FALSE;
-- El primer enlace del texto, para su vista previa (chat_enlace).
ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS enlace_url VARCHAR(2000);
-- Un mensaje que pone el sistema en nombre de alguien: la tarea se cerró.
ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS evento VARCHAR(20)
  CHECK (evento IS NULL OR evento IN ('tarea_cerrada'));

-- El texto ya puede ir vacío si el mensaje lleva ficheros. Se quita la regla de
-- db/256 (la de la columna, con el nombre que le dio Postgres) y va la nueva.
DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'chat_mensaje'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%btrim(texto)%'
              AND conname <> 'ck_chat_mensaje_texto'
  LOOP
    EXECUTE format('ALTER TABLE chat_mensaje DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_chat_mensaje_texto') THEN
    ALTER TABLE chat_mensaje ADD CONSTRAINT ck_chat_mensaje_texto
      CHECK (length(texto) <= 8000 AND (btrim(texto) <> '' OR con_adjuntos));
  END IF;
END $$;

-- ── Las reacciones: seis, por su código ────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_reaccion (
  mensaje_id  BIGINT       NOT NULL REFERENCES chat_mensaje(id),
  usuario_id  INTEGER      NOT NULL REFERENCES usuario(id),
  emoji       VARCHAR(12)  NOT NULL CHECK (emoji IN ('ok', 'hecho', 'visto', 'gracias', 'risa', 'corazon')),
  puesta_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Quitarla es una marca; volver a ponerla la limpia.
  quitada_at  TIMESTAMPTZ,
  PRIMARY KEY (mensaje_id, usuario_id, emoji)
);

-- ── Lo fijado en cada canal ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_fijado (
  mensaje_id   BIGINT       PRIMARY KEY REFERENCES chat_mensaje(id),
  canal_id     BIGINT       NOT NULL REFERENCES chat_canal(id),
  fijado_por   INTEGER      REFERENCES usuario(id),
  fijado_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  quitado_por  INTEGER      REFERENCES usuario(id),
  quitado_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_chat_fijado_canal ON chat_fijado (canal_id, fijado_at) WHERE quitado_at IS NULL;

-- ── Lo guardado por cada uno (solo lo ve él) ───────────────────────────────
CREATE TABLE IF NOT EXISTS chat_guardado (
  usuario_id   INTEGER      NOT NULL REFERENCES usuario(id),
  mensaje_id   BIGINT       NOT NULL REFERENCES chat_mensaje(id),
  guardado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  quitado_at   TIMESTAMPTZ,
  PRIMARY KEY (usuario_id, mensaje_id)
);
CREATE INDEX IF NOT EXISTS ix_chat_guardado_usuario ON chat_guardado (usuario_id, guardado_at) WHERE quitado_at IS NULL;

-- ── La vista previa de los enlaces (lo leyó el servidor, una vez por enlace) ─
CREATE TABLE IF NOT EXISTS chat_enlace (
  url          VARCHAR(2000) PRIMARY KEY,
  -- 'ok': hay algo que enseñar; 'nada': la página no da título; 'error': no se pudo leer.
  estado       VARCHAR(8)    NOT NULL CHECK (estado IN ('ok', 'nada', 'error')),
  titulo       VARCHAR(200),
  descripcion  VARCHAR(400),
  sitio        VARCHAR(120),
  leido_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE chat_reaccion IS 'Las reacciones del chat (db/257): seis emojis fijos por su código. Quitar es marcar quitada_at.';
COMMENT ON TABLE chat_fijado IS 'Los mensajes fijados en un canal (db/257): los fija cualquiera del canal. Desfijar es marcar quitado_at.';
COMMENT ON TABLE chat_guardado IS 'Lo que guarda cada uno para luego (db/257). Solo lo ve quien lo guardó.';
COMMENT ON TABLE chat_enlace IS 'La vista previa de los enlaces del chat (db/257): título, descripción y sitio, leídos por services/enlaces.js (protegido contra SSRF).';

-- Fijar y desfijar, en el libro: es de todo el canal.
SELECT auditoria_vigilar('chat_fijado', 'mensaje_id');

COMMIT;
