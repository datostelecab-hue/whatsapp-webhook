-- ============================================================
-- 260 — LA MIGRACIÓN DE SLACK: SUS FICHEROS (ítem 2, entrega 2d)
-- ============================================================
-- Camilo, 17/11/2026: «no necesito integrar slack sino migrarlo y dejar de
-- usarlo, que lo haga mensaje a mensaje». El ERP ya no habla con Slack (ni
-- token ni app): Slack se lee fuera, mensaje a mensaje, y a /chat/slack se sube
-- una exportación (los mensajes) y después la carpeta de sus ficheros.
--
-- Aquí, de qué mensaje es cada fichero de Slack y si ya se subió: al migrar se
-- apunta cada uno con su mensaje; al subir la carpeta, cada fichero va al suyo
-- y no se sube dos veces.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/260', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS chat_slack_fichero (
  -- El id del fichero en Slack ('F0C4CBJ712S'): así se llama en la carpeta.
  slack_id     VARCHAR(24)  PRIMARY KEY,
  mensaje_id   BIGINT       NOT NULL REFERENCES chat_mensaje(id),
  nombre       VARCHAR(255) NOT NULL,
  mime         VARCHAR(150) NOT NULL,
  -- Ya subido: su adjunto (dueño chat_mensaje).
  adjunto_id   BIGINT       REFERENCES adjunto(id),
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_chat_slack_fichero_pendiente ON chat_slack_fichero (slack_id) WHERE adjunto_id IS NULL;

COMMENT ON TABLE chat_slack_fichero IS
  'La migración de Slack (db/260): cada fichero de un mensaje traído, y su adjunto cuando se sube. Ver modules/Chat/slack.service.js.';

SELECT auditoria_vigilar('chat_slack_fichero', 'slack_id');

COMMIT;
