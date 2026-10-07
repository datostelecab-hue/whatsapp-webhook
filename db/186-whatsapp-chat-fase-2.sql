-- ============================================================
-- 186 — EL CHAT DE WHATSAPP, SEGUNDA FASE
-- ============================================================
-- Lo que quedó apuntado al estrenar el chat (db/185): ver aquí las fotos, audios
-- y documentos que mandan; respuestas rápidas; asignar cada conversación a quien
-- la lleva. (Las plantillas de pago y el enlace con el Call Center no necesitan
-- tablas.) Y un arreglo: rehacer las conversaciones que no se guardaron.
--
--   · whatsapp_adjunto           el fichero de cada foto, audio, vídeo, documento
--                                o sticker que llega. Meta solo lo guarda 30 días,
--                                así que se baja al llegar y se queda aquí hasta
--                                que se borra su mensaje (180 días, en cascada).
--                                Lo que pasa de WHATSAPP_ADJUNTO_MAX_MB (16) no se
--                                guarda: se pide a Meta al abrirlo, mientras lo
--                                tenga.
--   · whatsapp_respuesta_rapida  los textos que la oficina escribe una y otra vez,
--                                de todos. {nombre} se cambia por el nombre de la
--                                persona al usarla.
--   · whatsapp_chat.asignado_a   quién lleva la conversación. Al escribir a alguien
--                                que no lleva nadie, se la queda quien escribe.
--
-- EL ARREGLO. Del 07/10 hasta este despliegue, la consulta que pone al día cada
-- conversación fallaba (Postgres: «inconsistent types deduced for parameter $5»)
-- y los mensajes se guardaban sin su conversación: la pantalla salía vacía. Se
-- rehacen desde los mensajes. El nombre que cada uno tiene en WhatsApp no se
-- guardaba en el mensaje: vuelve con el siguiente que escriba.

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_adjunto (
  mensaje_id  bigint       PRIMARY KEY REFERENCES whatsapp_mensaje(id) ON DELETE CASCADE,
  mime        varchar(120) NOT NULL,
  nombre      varchar(255),                       -- el de un documento, si lo trae
  tamano      integer      NOT NULL,
  sha256      varchar(100),
  bytes       bytea        NOT NULL,
  guardado_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_respuesta_rapida (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo         varchar(60) NOT NULL,
  texto          text        NOT NULL,
  creado_por     bigint      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      timestamptz NOT NULL DEFAULT now(),
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_warr_texto CHECK (length(texto) BETWEEN 1 AND 4096)
);

-- Cuatro para empezar, que la oficina cambia o borra a su gusto.
INSERT INTO whatsapp_respuesta_rapida (titulo, texto)
SELECT x.titulo, x.texto
  FROM (VALUES
    ('Te llamamos',      'Hola {nombre}, ahora te llamamos desde la oficina.'),
    ('Manda una foto',   'Hola {nombre}, ¿nos puedes mandar una foto por aquí, por favor?'),
    ('Recibido',         'Recibido, gracias {nombre}.'),
    ('Escribe al bot',   'Para abrir o terminar tu turno, escribe «Hola» y sigue los botones del bot.')
  ) AS x(titulo, texto)
 WHERE NOT EXISTS (SELECT 1 FROM whatsapp_respuesta_rapida);

ALTER TABLE whatsapp_chat
  ADD COLUMN IF NOT EXISTS asignado_a   bigint      REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS asignado_at  timestamptz,
  ADD COLUMN IF NOT EXISTS asignado_por bigint      REFERENCES usuario(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_wachat_asignado ON whatsapp_chat (asignado_a) WHERE asignado_a IS NOT NULL;

-- ── El arreglo: una conversación por teléfono, desde sus mensajes ────────────
-- El texto de la lista es el de services/whatsappChat.resumen.
INSERT INTO whatsapp_chat (telefono, ultimo_at, ultimo_texto, ultimo_sentido, ultima_entrante_at)
SELECT DISTINCT ON (m.telefono)
       m.telefono,
       m.ocurrido_at,
       left(CASE
              WHEN m.tipo IN ('imagen', 'video', 'audio', 'documento', 'sticker', 'ubicacion', 'contacto', 'reaccion') THEN
                CASE m.tipo WHEN 'imagen' THEN 'Foto' WHEN 'video' THEN 'Vídeo' WHEN 'audio' THEN 'Audio'
                            WHEN 'documento' THEN 'Documento' WHEN 'sticker' THEN 'Sticker' WHEN 'ubicacion' THEN 'Ubicación'
                            WHEN 'contacto' THEN 'Contacto' ELSE 'Reacción' END
                || COALESCE(': ' || NULLIF(btrim(regexp_replace(COALESCE(m.texto, ''), '\s+', ' ', 'g')), ''), '')
              ELSE COALESCE(NULLIF(btrim(regexp_replace(COALESCE(m.texto, ''), '\s+', ' ', 'g')), ''),
                            CASE WHEN m.tipo = 'otro' THEN 'Mensaje' ELSE '' END)
            END, 300),
       m.sentido,
       (SELECT max(e.ocurrido_at) FROM whatsapp_mensaje e WHERE e.telefono = m.telefono AND e.sentido = 'entrante')
  FROM whatsapp_mensaje m
 ORDER BY m.telefono, m.ocurrido_at DESC, m.id DESC
ON CONFLICT (telefono) DO NOTHING;

COMMENT ON TABLE whatsapp_adjunto IS
  'El fichero de cada foto, audio, vídeo o documento que llega por WhatsApp (db/186). Se baja al llegar porque Meta solo lo guarda 30 días; se borra con su mensaje.';
COMMENT ON TABLE whatsapp_respuesta_rapida IS
  'Textos que la oficina reutiliza en el chat de /whatsapp (db/186). {nombre} se cambia por el nombre de la persona.';
COMMENT ON COLUMN whatsapp_chat.asignado_a IS
  'Quién de la oficina lleva la conversación (db/186). Al escribir a alguien que no lleva nadie, se la queda quien escribe.';

COMMIT;
