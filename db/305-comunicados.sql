-- ============================================================
-- 305 — LOS COMUNICADOS A LA PLANTILLA (plan de RR. HH., módulos 6 y 9, 26/11/2026)
-- ============================================================
-- El encargo: «comunicaciones con acuse: normativa interna, nuevos códigos de
-- descuento y similares. Envío masivo a toda la plantilla o a un grupo, con
-- seguimiento de quién ha firmado y recordatorios automáticos».
--
-- Lo que decidió Camilo el 26/11/2026:
--   · El acuse es el «Lo he leído» del portal de conductores (día, hora y su
--     sesión, que entró con DNI y código al correo).
--   · Se avisa por correo (con el enlace al portal) y en el portal.
--   · A quien no lo ha leído, un recordatorio cada 2 días hábiles, 3 como mucho.
--   · Lo prepara Diana y no sale hasta que lo aprueba otra persona.
--
-- Llaves (persona a persona, `manual`):
--   '/comunicados'            mirarlos y su seguimiento
--   '/comunicados/preparar'   redactarlos y pedir que se aprueben (Diana)
--   '/comunicados/aprobar'    aprobarlos (se mandan) o devolverlos (Ignacio)
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/305', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS comunicado (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  titulo          VARCHAR(160) NOT NULL,
  cuerpo          TEXT         NOT NULL,
  -- A quién: toda la plantilla de alta, la propia, la de ETT o unas personas.
  alcance         VARCHAR(10)  NOT NULL DEFAULT 'todos',
  personas        BIGINT[],
  estado          VARCHAR(12)  NOT NULL DEFAULT 'borrador',
  nota            TEXT,
  creado_por      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  pedido_at       TIMESTAMPTZ,
  aprobado_por    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  aprobado_at     TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at      TIMESTAMPTZ,
  actualizado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_comunicado_alcance CHECK (alcance IN ('todos', 'propia', 'ett', 'personas')),
  CONSTRAINT ck_comunicado_personas CHECK (alcance <> 'personas' OR cardinality(personas) > 0),
  CONSTRAINT ck_comunicado_estado CHECK (estado IN ('borrador', 'por_aprobar', 'enviado', 'anulado')),
  CONSTRAINT ck_comunicado_titulo CHECK (btrim(titulo) <> '' AND btrim(cuerpo) <> '')
);
CREATE INDEX IF NOT EXISTS ix_comunicado_estado ON comunicado (estado, creado_at DESC);
COMMENT ON TABLE comunicado IS
  'Módulos 6 y 9 (db/305): los comunicados a la plantilla (normativa, códigos de descuento…). Se leen y se acusan en el portal';

-- Una fila por persona al mandarlo: la foto de a quién se le mandó y cómo va.
CREATE TABLE IF NOT EXISTS comunicado_destinatario (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comunicado_id   BIGINT       NOT NULL REFERENCES comunicado(id) ON DELETE CASCADE,
  conductor_id    BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  email           VARCHAR(160),
  correo_at       TIMESTAMPTZ,
  correo_error    TEXT,
  recordatorios   SMALLINT     NOT NULL DEFAULT 0,
  recordado_at    TIMESTAMPTZ,
  visto_at        TIMESTAMPTZ,
  leido_at        TIMESTAMPTZ,
  leido_ip        VARCHAR(64),
  leido_agente    VARCHAR(300),
  CONSTRAINT uq_comunicado_destinatario UNIQUE (comunicado_id, conductor_id)
);
CREATE INDEX IF NOT EXISTS ix_comunicado_dest_conductor ON comunicado_destinatario (conductor_id, leido_at);
COMMENT ON TABLE comunicado_destinatario IS
  'A quién se le mandó cada comunicado: el correo, los recordatorios y su «Lo he leído» del portal (con IP y navegador)';

SELECT auditoria_vigilar('comunicado');

-- Las llaves: Diana prepara, Ignacio aprueba (los dos miran).
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/comunicados'), (20, 'Diana', '/comunicados/preparar'),
               (1, 'Ignacio', '/comunicados'), (1, 'Ignacio', '/comunicados/aprobar')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
