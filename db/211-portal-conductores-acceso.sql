-- ============================================================
-- 211 · PORTAL DE CONDUCTORES — el acceso: códigos por email y sesiones
-- ============================================================
-- El portal de los conductores (conductorestelecab.es, 19/10/2026). Camilo:
-- «el login es con su DNI y el sistema le enviará un código de verificación al
-- email que fue dado de alta». Sin contraseñas: el conductor escribe su DNI, le
-- llega un código de 6 cifras al email de su ficha, y con él entra.
--
-- DOS TABLAS, y ninguna guarda nada en claro:
--
--   · portal_codigo — cada código que se manda. Se guarda su HUELLA (HMAC), no
--     el código. Caduca a los 10 minutos, admite 5 intentos y sirve una vez.
--     Pedir uno nuevo anula los anteriores de esa persona. Con la IP y la hora
--     se limita cuántos se piden (modules/Portal/portal.service.js).
--
--   · portal_sesion — la sesión del conductor. En la cookie va un testigo
--     aleatorio; aquí, su huella SHA-256. Así se puede CERRAR desde el servidor
--     (al darle de baja, al pulsar «Salir»), cosa que una cookie firmada sin
--     estado no permite. Dura 30 días desde el último uso.
--
-- Las dos cuelgan del conductor: si se borra la ficha, se van con ella.

BEGIN;

CREATE TABLE IF NOT EXISTS portal_codigo (
  id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  huella       CHAR(64)     NOT NULL,             -- HMAC-SHA256 del código, en hex
  email        VARCHAR(200) NOT NULL,             -- a dónde se mandó (el de la ficha en ese momento)
  enviado      BOOLEAN      NOT NULL DEFAULT FALSE,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  caduca_at    TIMESTAMPTZ  NOT NULL,
  intentos     SMALLINT     NOT NULL DEFAULT 0,
  usado_at     TIMESTAMPTZ,                       -- con él se entró
  anulado_at   TIMESTAMPTZ,                       -- se pidió otro, o se gastaron los intentos
  ip           VARCHAR(64),
  CONSTRAINT ck_pcod_caduca CHECK (caduca_at > creado_at)
);

CREATE INDEX IF NOT EXISTS ix_pcod_conductor ON portal_codigo (conductor_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_pcod_ip ON portal_codigo (ip, creado_at DESC);

COMMENT ON TABLE portal_codigo IS
  'Los códigos de acceso al portal de conductores que se mandan por email: solo su huella, 10 minutos, 5 intentos, un uso (db/211)';

CREATE TABLE IF NOT EXISTS portal_sesion (
  id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  huella       CHAR(64)     NOT NULL,             -- SHA-256 del testigo de la cookie, en hex
  creada_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultima_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  caduca_at    TIMESTAMPTZ  NOT NULL,
  cerrada_at   TIMESTAMPTZ,
  ip           VARCHAR(64),
  agente       VARCHAR(300),                      -- el navegador, para reconocer la sesión
  CONSTRAINT ux_psesion_huella UNIQUE (huella)
);

CREATE INDEX IF NOT EXISTS ix_psesion_conductor ON portal_sesion (conductor_id, ultima_at DESC);

COMMENT ON TABLE portal_sesion IS
  'Las sesiones del portal de conductores: la huella del testigo de la cookie, 30 días desde el último uso, cerrables desde el servidor (db/211)';

COMMIT;
