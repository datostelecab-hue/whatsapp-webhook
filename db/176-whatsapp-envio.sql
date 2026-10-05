-- ============================================================
-- 176 — LO QUE META DICE DE CADA WHATSAPP QUE MANDAMOS
-- ============================================================
-- Camilo, 05/10/2026: el bot no contestaba. Meta tenía bloqueados los envíos por
-- un pago pendiente (error 131042, «Business eligibility payment issue»), y ya
-- había pasado el 01/10. Lo grave no era eso, sino que el ERP no se enteraba: Meta
-- ACEPTA el envío —contesta con el id del mensaje— y lo da por fallido después,
-- en un aviso aparte que llega al webhook (`statuses`). El webhook lo tiraba. Así,
-- los avisos de velocidad quedaban como `avisado` y, desde la calificación 2.1,
-- bajaban la letra de gente que no había recibido nada.
--
-- Aquí se apunta cada aviso de estado de Meta: enviado, entregado, leído o
-- fallido, con el error. Una fila por mensaje (su `wamid`), que avanza de estado
-- y no retrocede. Con esto se sabe qué no llegó y desde cuándo, y el webhook pasa
-- a `error` el aviso de velocidad cuyo mensaje falló (velocidad_exceso.envio_id).

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_envio (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  wamid        varchar(160) NOT NULL UNIQUE,      -- el id que da Meta al mensaje
  telefono     varchar(24),                        -- a quién (recipient_id)
  estado       varchar(12)  NOT NULL,
  estado_at    timestamptz  NOT NULL,              -- cuándo lo dijo Meta
  error_codigo integer,
  error_texto  text,
  recibido_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_wa_envio_estado CHECK (estado IN ('enviado', 'entregado', 'leido', 'fallido')),
  CONSTRAINT ck_wa_envio_error CHECK (estado <> 'fallido' OR error_codigo IS NOT NULL OR error_texto IS NOT NULL)
);

-- «¿Qué ha fallado y desde cuándo?»: solo los fallidos, por fecha.
CREATE INDEX IF NOT EXISTS ix_wa_envio_fallidos ON whatsapp_envio (estado_at) WHERE estado = 'fallido';

COMMENT ON TABLE whatsapp_envio IS
  'Lo que Meta dice de cada WhatsApp enviado (webhook statuses): enviado, entregado, leido o fallido. Avanza, no retrocede (db/176).';

COMMIT;
