-- ============================================================
-- 306 — EL SMS CERTIFICADO DE MENSATEK (plan de RR. HH., módulo 9, 26/11/2026)
-- ============================================================
-- El encargo: «envío a un conductor, un grupo o toda la plantilla, con texto
-- libre o con plantillas que rellenan solas los datos del conductor
-- (suspensión, sanción, requerimiento, aviso de finiquito, etc.). Los módulos 3
-- y 7 lanzan sus envíos desde aquí, y el historial queda centralizado. Cada
-- envío guarda su certificado de entrega en el expediente del conductor».
--
-- Lo que decidió Camilo el 26/11/2026: todo el módulo; el remitente, el que
-- tenga la cuenta de Mensatek por defecto; para abrir la notificación el
-- conductor escribe su DNI (sin DNI en la ficha, su móvil); y lo manda Diana
-- sola (llave '/sms/enviar').
--
-- Las credenciales van en el entorno (MENSATEK_USUARIO, MENSATEK_API_KEY), nunca aquí.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/306', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS sms_envio (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  asunto          VARCHAR(160) NOT NULL,
  mensaje         TEXT         NOT NULL,
  plantilla       VARCHAR(24)  NOT NULL DEFAULT 'libre',
  alcance         VARCHAR(10)  NOT NULL DEFAULT 'personas',
  personas        BIGINT[],
  -- De dónde sale: a mano, o de una sanción o un finiquito (su id).
  origen          VARCHAR(12)  NOT NULL DEFAULT 'manual',
  origen_id       TEXT,
  -- Días para aceptar o rechazar la notificación antes de verla (0: no se pide).
  aceptacion      SMALLINT     NOT NULL DEFAULT 0,
  estado          VARCHAR(10)  NOT NULL DEFAULT 'borrador',
  error           TEXT,
  creditos        NUMERIC(12, 2),
  creado_por      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  enviado_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  enviado_at      TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at      TIMESTAMPTZ,
  actualizado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_sms_envio_alcance CHECK (alcance IN ('todos', 'propia', 'ett', 'personas')),
  CONSTRAINT ck_sms_envio_personas CHECK (alcance <> 'personas' OR cardinality(personas) > 0),
  CONSTRAINT ck_sms_envio_origen CHECK (origen IN ('manual', 'sancion', 'finiquito')),
  CONSTRAINT ck_sms_envio_estado CHECK (estado IN ('borrador', 'enviando', 'enviado', 'error', 'anulado')),
  CONSTRAINT ck_sms_envio_aceptacion CHECK (aceptacion BETWEEN 0 AND 15),
  CONSTRAINT ck_sms_envio_texto CHECK (btrim(asunto) <> '' AND btrim(mensaje) <> '')
);
CREATE INDEX IF NOT EXISTS ix_sms_envio_estado ON sms_envio (estado, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_sms_envio_origen ON sms_envio (origen, origen_id);
COMMENT ON TABLE sms_envio IS
  'Módulo 9 (db/306): los SMS certificados de Mensatek, a una persona, a un grupo o a la plantilla';

-- Una fila por persona: cada una va en su propia petición (su DNI es su llave
-- para abrirla), con su idMensaje de Mensatek, su estado y su certificado.
CREATE TABLE IF NOT EXISTS sms_destinatario (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  envio_id         BIGINT       NOT NULL REFERENCES sms_envio(id) ON DELETE CASCADE,
  conductor_id     BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  movil            VARCHAR(20),
  identificar      VARCHAR(8),
  id_mensaje       BIGINT,
  -- El último estado que dio Mensatek (código y texto) y cuándo.
  resultado        INTEGER,
  estado_texto     VARCHAR(160),
  estado_at        TIMESTAMPTZ,
  entregado_at     TIMESTAMPTZ,
  certificado_at   TIMESTAMPTZ,
  abierto_at       TIMESTAMPTZ,
  aceptado_at      TIMESTAMPTZ,
  rechazado_at     TIMESTAMPTZ,
  -- El PDF del certificado, en el almacén (adjunto, dueño 'sms_certificado').
  certificado_adjunto_id BIGINT,
  error            TEXT,
  CONSTRAINT uq_sms_destinatario UNIQUE (envio_id, conductor_id)
);
CREATE INDEX IF NOT EXISTS ix_sms_dest_mensaje ON sms_destinatario (id_mensaje);
CREATE INDEX IF NOT EXISTS ix_sms_dest_conductor ON sms_destinatario (conductor_id);
COMMENT ON TABLE sms_destinatario IS
  'A quién se le mandó cada SMS certificado: su idMensaje de Mensatek, su estado de entrega, si lo abrió o aceptó y su certificado';

-- Todo lo que llega de Mensatek por el receptor de estados, tal cual: si algo no
-- cuadra, la pregunta será «¿qué dijo Mensatek exactamente?».
CREATE TABLE IF NOT EXISTS sms_report (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recibido_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  servicio    VARCHAR(40),
  id_mensaje  BIGINT,
  movil       VARCHAR(20),
  resultado   INTEGER,
  cuerpo      JSONB        NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sms_report_mensaje ON sms_report (id_mensaje, recibido_at);

SELECT auditoria_vigilar('sms_envio');

-- Las llaves: Diana manda; Ignacio mira.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/sms'), (20, 'Diana', '/sms/enviar'), (1, 'Ignacio', '/sms')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
