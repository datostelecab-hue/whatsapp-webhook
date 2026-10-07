-- ============================================================
-- 185 — EL CHAT DE WHATSAPP: lo que manda el bot y lo que le escriben
-- ============================================================
-- Camilo, 07/10/2026: «un chat de WhatsApp del bot donde guarde los mensajes
-- enviados y recibidos, como módulo WhatsApp, para saber qué les envía y qué
-- nos envían ellos; y si podemos escribirles libremente, lo hacemos, que las
-- ventanas de 24 horas son gratis».
--
-- Hasta hoy nada de esto se guardaba: lo que escribían los conductores solo se
-- veía en el log del servidor, y de lo que se mandaba quedaba, desde db/176,
-- solo el estado que da Meta (whatsapp_envio). Meta no da el historial: el chat
-- empieza el día que se aplica esto.
--
--   · whatsapp_mensaje  cada mensaje, entrante o saliente, con quién lo mandó
--                       (`origen`: el conductor, el bot, la oficina, una
--                       alerta, un aviso de velocidad o de turnos) y, si lo
--                       escribió alguien del ERP, quién (`usuario_id`). El
--                       estado de un saliente (entregado, leído, fallido) se
--                       lee de whatsapp_envio por el `wamid`.
--   · whatsapp_chat     una fila por teléfono: el último mensaje (para la
--                       lista), cuándo escribió por última vez (la ventana de
--                       24 h en la que se le puede escribir gratis), hasta
--                       cuándo lo ha leído la oficina y si el bot está en
--                       pausa con él (mientras la oficina habla con alguien,
--                       lo que conteste no lo atiende el bot).
--
-- Son mensajes de personas: se borran a los 180 días (WHATSAPP_RETENCION_DIAS,
-- la poda diaria de app.js), y el módulo /whatsapp tiene su permiso.

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_mensaje (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wamid       varchar(160),                       -- el id que da Meta (sin él si el envío falló)
  telefono    varchar(24)  NOT NULL,              -- solo dígitos, con el prefijo del país
  sentido     varchar(8)   NOT NULL,
  tipo        varchar(16)  NOT NULL,              -- texto, botones, plantilla, boton, imagen, audio…
  texto       text,                               -- lo que se lee en el chat
  detalle     jsonb,                              -- botones, plantilla y parámetros, el adjunto…
  origen      varchar(16)  NOT NULL,
  usuario_id  bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  error       text,                               -- si Meta rechazó el envío en el momento
  ocurrido_at timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_wam_sentido CHECK (sentido IN ('entrante', 'saliente')),
  CONSTRAINT ck_wam_origen CHECK (origen IN ('conductor', 'bot', 'oficina', 'alerta', 'velocidad', 'turnos', 'plantilla'))
);
-- Meta puede mandar el mismo mensaje dos veces: el segundo no entra.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wam_wamid ON whatsapp_mensaje (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_wam_chat  ON whatsapp_mensaje (telefono, ocurrido_at DESC);
CREATE INDEX IF NOT EXISTS ix_wam_fecha ON whatsapp_mensaje (ocurrido_at);

CREATE TABLE IF NOT EXISTS whatsapp_chat (
  telefono           varchar(24)  PRIMARY KEY,
  nombre_perfil      varchar(120),                -- el nombre que tiene puesto en WhatsApp
  ultimo_at          timestamptz  NOT NULL,
  ultimo_texto       text,
  ultimo_sentido     varchar(8),
  ultima_entrante_at timestamptz,                 -- la ventana de 24 h cuenta desde aquí
  leido_at           timestamptz,                 -- hasta dónde lo ha leído la oficina
  bot_pausado_hasta  timestamptz,
  pausado_por        bigint REFERENCES usuario(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_wachat_ultimo ON whatsapp_chat (ultimo_at DESC);

COMMENT ON TABLE whatsapp_mensaje IS
  'Cada WhatsApp del número del bot, entrante o saliente, con su origen (db/185). El estado de entrega va en whatsapp_envio por wamid. Se borra a los 180 días.';
COMMENT ON TABLE whatsapp_chat IS
  'Una fila por teléfono: último mensaje, ventana de 24 h (ultima_entrante_at), leído por la oficina y pausa del bot (db/185).';

COMMIT;
