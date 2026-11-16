-- ============================================================
-- 250 — LAS NOTIFICACIONES AL DISPOSITIVO: dónde se puede avisar a cada uno
-- ============================================================
-- Pieza A8 de docs/Hoja de ruta.md (16/11/2026). Hasta hoy el ERP solo avisaba
-- con la pantalla abierta (la campana, los contadores). Con esto puede mandar
-- una notificación al móvil o al ordenador de alguien aunque no tenga el ERP
-- delante (Web Push: el navegador da una dirección de su servicio de avisos, y
-- el servidor manda por ella, cifrado).
--
--   · UNA FILA POR DISPOSITIVO (por navegador) en que alguien las activó, tras
--     pulsar «Activar» y decir que sí al permiso del navegador.
--   · VA CON SU SESIÓN (`sid`): solo se avisa mientras la sesión con la que se
--     activó, o con la que se vio por última vez, siga abierta. Al salir, al
--     cerrarla desde otro dispositivo o al caducar, ese navegador deja de
--     recibirlas. En un PC compartido de la oficina, lo de una persona no sale
--     en la pantalla de la siguiente. Al volver a entrar, la pantalla la pone
--     al día con la sesión nueva.
--   · NADA SE BORRA: cuando el servicio dice que la dirección ya no vale (el
--     navegador la tiró), o la persona las quita, se da de BAJA con motivo.
--   · NO VA AL LIBRO DE AUDITORÍA: son datos técnicos del navegador (la
--     dirección y sus dos claves), y el alta y la baja ya quedan en sus columnas.
--
-- El envío y quién puede qué: services/notificacionesPush.js.

BEGIN;

CREATE TABLE IF NOT EXISTS push_suscripcion (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id    INTEGER       NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- La dirección del servicio de avisos del navegador (Google, Mozilla, Apple,
  -- Microsoft). Solo esos: se comprueba en el código antes de guardarla.
  endpoint      TEXT          NOT NULL CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  -- Las claves con que se cifra cada aviso para ese navegador (base64url).
  p256dh        VARCHAR(140)  NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]+=*$'),
  auth          VARCHAR(60)   NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]+=*$'),
  -- La sesión de la última vez que la pantalla la confirmó (usuario_sesion.sid).
  sid           VARCHAR(64)   NOT NULL,
  -- Para que la persona reconozca cada uno en su lista: «Chrome en Windows».
  dispositivo   VARCHAR(120),
  creado_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  visto_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- El último aviso que el servicio aceptó, y los fallos seguidos desde entonces.
  enviado_at    TIMESTAMPTZ,
  fallos        SMALLINT      NOT NULL DEFAULT 0,
  baja_at       TIMESTAMPTZ,
  baja_motivo   VARCHAR(200),
  CONSTRAINT ck_push_baja CHECK ((baja_at IS NULL) = (baja_motivo IS NULL))
);

-- Una dirección es de un navegador: si en él entra otra persona, pasa a ella.
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_endpoint ON push_suscripcion (endpoint);
-- Los de una persona que siguen de alta, que es como se piden al avisar.
CREATE INDEX IF NOT EXISTS ix_push_usuario ON push_suscripcion (usuario_id) WHERE baja_at IS NULL;

COMMENT ON TABLE push_suscripcion IS
  'Los navegadores en que cada persona activó las notificaciones (db/250, pieza A8). Solo se avisa mientras su sesión (sid) siga abierta. Quitar es dar de baja con motivo. Ver services/notificacionesPush.js.';
COMMENT ON COLUMN push_suscripcion.sid IS
  'La sesión (usuario_sesion.sid) de la última vez que la pantalla la confirmó. Cerrada o caducada esa sesión, no se avisa a este navegador hasta que se vuelva a entrar.';

COMMIT;
