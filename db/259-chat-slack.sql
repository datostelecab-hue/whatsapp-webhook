-- ============================================================
-- 259 — EL CHAT: LO QUE HACE FALTA PARA TRAER SLACK (ítem 2, entrega 2d)
-- ============================================================
-- Camilo, 17/11/2026: «Ya no queremos usarlo y la idea es migrar toda la info
-- allá. Que no avise menciones ni nada hasta después de la migración». Decidió:
--   · con un token de Slack de solo lectura (de Ignacio) y un script, para
--     copiar el texto exacto, los hilos, las reacciones y los ficheros;
--   · los 19 canales y el privado #efectivo, que no estaba en el chat;
--   · y los mensajes directos de Ignacio.
--
-- Lo hace modules/Chat/slack.service.js (pantalla /chat/slack, solo el
-- desarrollador). Aquí, lo que necesita guardar:
--   · de dónde viene cada mensaje y cada canal (para no traerlo dos veces: se
--     puede repetir mientras se siga escribiendo en Slack);
--   · el autor de Slack que no es usuario del ERP (por su nombre);
--   · quién es quién: cada persona de Slack, con su usuario del ERP.
--
-- Y una cosa para todo el chat: los mensajes se ordenan por FECHA, no por su
-- número. Lo traído de Slack entra después (con números más altos) pero es de
-- antes, y tiene que salir en su sitio.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/259', true),
       set_config('telecab.usuario_id', '7', true);

-- ── De dónde viene: el canal y el mensaje de Slack ─────────────────────────
ALTER TABLE chat_canal ADD COLUMN IF NOT EXISTS slack_id VARCHAR(24);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_canal_slack ON chat_canal (slack_id) WHERE slack_id IS NOT NULL;

ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS slack_canal VARCHAR(24);
ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS slack_ts VARCHAR(24);
-- Quien lo escribió en Slack y no es usuario del ERP (un conductor, alguien que ya no está).
ALTER TABLE chat_mensaje ADD COLUMN IF NOT EXISTS autor_externo VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_mensaje_slack ON chat_mensaje (slack_canal, slack_ts) WHERE slack_ts IS NOT NULL;

-- ── Los mensajes, por fecha ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_chat_mensaje_canal_fecha ON chat_mensaje (canal_id, creado_at, id) WHERE padre_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_chat_mensaje_hilo_fecha ON chat_mensaje (padre_id, creado_at, id) WHERE padre_id IS NOT NULL;

-- ── Quién es quién: cada persona de Slack y su usuario del ERP ─────────────
CREATE TABLE IF NOT EXISTS chat_slack_usuario (
  slack_id     VARCHAR(24)  PRIMARY KEY,
  nombre       VARCHAR(160) NOT NULL,
  email        VARCHAR(200),
  -- Su usuario en el ERP (lo propone la migración por email o nombre y se
  -- corrige en la pantalla). Sin él, sus mensajes salen con su nombre de Slack.
  usuario_id   INTEGER      REFERENCES usuario(id),
  -- Cómo se decidió: 'email', 'nombre' o 'a mano'.
  como         VARCHAR(10)  CHECK (como IS NULL OR como IN ('email', 'nombre', 'a mano')),
  es_bot       BOOLEAN      NOT NULL DEFAULT FALSE,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chat_slack_usuario IS
  'La migración de Slack (db/259): cada persona de Slack y su usuario del ERP. Ver modules/Chat/slack.service.js.';
COMMENT ON COLUMN chat_mensaje.slack_ts IS
  'Traído de Slack (db/259): su marca de tiempo allí. No cuenta como no leído ni avisa a nadie.';

SELECT auditoria_vigilar('chat_slack_usuario', 'slack_id');

COMMIT;
