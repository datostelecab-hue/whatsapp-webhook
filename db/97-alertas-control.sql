-- ============================================================
-- 97 — ALERTAS DE CONTROL (avisos a los controladores por WhatsApp)
-- ============================================================
-- Cuando un conductor se pasa de la raya DENTRO de una franja de vigilancia
-- (08:00-13:00 y 20:00-01:00), se avisa por WhatsApp a los controladores que
-- decida el desarrollador — sin importar su rol.
--
-- LA REGLA QUE MANDA: **un mensaje por alerta**. Un conductor puede levantar
-- varias alertas distintas en la misma franja (rechaza, no responde y además
-- rueda en descanso = tres avisos), pero cada una se manda UNA sola vez: que
-- siga rechazando después no vuelve a sonar. Eso no se resuelve con lógica en
-- la aplicación sino con el índice único de abajo: aunque dos revisiones
-- coincidan, la base solo deja entrar la primera.

BEGIN;

-- ── Los ajustes (umbrales, franjas, modo) ────────────────────────────────────
CREATE TABLE alerta_control_config (
  clave           VARCHAR(40)  PRIMARY KEY,
  valor           JSONB        NOT NULL,
  actualizado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_id      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL
);
COMMENT ON TABLE alerta_control_config IS
  'Ajustes del módulo de alertas: umbrales por tipo, franjas y modo test/live';

-- ── Quién recibe ─────────────────────────────────────────────────────────────
-- POR USUARIO Y SIN MIRAR EL ROL, que es justo lo que se pidió: el controlador
-- de noche recibe y el jefe de tráfico puede no recibir, aunque tenga más
-- permisos. `telefono` solo se rellena si hay que mandarlo a uno distinto del
-- de su ficha (un número de guardia, por ejemplo).
CREATE TABLE alerta_control_destinatario (
  usuario_id    INTEGER      PRIMARY KEY REFERENCES usuario(id) ON DELETE CASCADE,
  telefono      VARCHAR(24),
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_alta  INTEGER      REFERENCES usuario(id) ON DELETE SET NULL
);
COMMENT ON COLUMN alerta_control_destinatario.telefono IS
  'Teléfono alternativo. Vacío = el de su ficha de usuario';

-- ── Las alertas disparadas ───────────────────────────────────────────────────
CREATE TABLE alerta_control (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo             VARCHAR(24)  NOT NULL,
  franja           VARCHAR(12)  NOT NULL,      -- manana | noche
  franja_dia       DATE         NOT NULL,      -- el día AL QUE PERTENECE la franja
  driver_uuid      VARCHAR(64)  NOT NULL,
  conductor_id     BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  nombre_bolt      VARCHAR(120),
  telefono         VARCHAR(24),
  -- Lo que se pasó y de cuánto era la raya: sin guardar el umbral, una alerta
  -- vieja no se puede leer después de cambiarlo.
  valor            NUMERIC(10,1) NOT NULL,
  umbral           NUMERIC(10,1) NOT NULL,
  horas_efectivas  NUMERIC(6,2),
  detectada_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  estado           VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
  CONSTRAINT ck_alerta_estado CHECK (estado IN
    ('pendiente','enviada','simulada','sin_destinatarios','error'))
);

-- EL CORAZÓN DEL MÓDULO: una alerta de cada tipo, por conductor y franja.
CREATE UNIQUE INDEX uq_alerta_control
  ON alerta_control (tipo, driver_uuid, franja_dia, franja);
CREATE INDEX ix_alerta_control_dia ON alerta_control (franja_dia DESC, detectada_at DESC);

-- ── A quién se le mandó cada una, y si llegó ────────────────────────────────
CREATE TABLE alerta_control_envio (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alerta_id   BIGINT       NOT NULL REFERENCES alerta_control(id) ON DELETE CASCADE,
  usuario_id  INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  usuario     VARCHAR(120),
  telefono    VARCHAR(24),
  ok          BOOLEAN      NOT NULL,
  simulado    BOOLEAN      NOT NULL DEFAULT FALSE,
  error       VARCHAR(300),
  enviado_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_alerta_envio ON alerta_control_envio (alerta_id);

COMMIT;
