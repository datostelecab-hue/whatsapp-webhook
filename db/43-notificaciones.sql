-- ============================================================
-- 43 - MOTOR DE NOTIFICACIONES (art. 18.9, 39; spec 5)
-- ============================================================
-- Con 1.000 conductores, reclamar justificaciones a mano es imposible. Este es
-- el modulo que las genera: requerimientos de ausencia, comunicaciones de
-- defecto de jornada, entrega del registro. Con su evidencia y su plazo.
--
-- LO QUE YA HAY: notification_template (el catalogo, sembrado y DESACTIVADO
-- hasta que la asesoria valide la redaccion). Lo que falta y va aqui: el correo
-- autorizado, la notificacion enviada y la respuesta del conductor.
--
-- TRES REGLAS DEL CONVENIO, EN LA ESTRUCTURA:
--   · Correo autorizado (art. 13): no se envia un requerimiento a un correo que
--     el trabajador no haya designado. Sin el, se escala y se avisa a RRHH.
--   · Evidencia: cada notificacion guarda el payload con las cifras exactas, el
--     texto renderizado y la marca de tiempo. Un requerimiento sin evidencia es
--     peor que no enviarlo.
--   · Idempotencia: una clave por (conductor, plantilla, periodo, version de los
--     datos). Si el mes se reabre y cambian las cifras, se emite una
--     RECTIFICATIVA que referencia a la anterior; nunca se reenvia la misma.

BEGIN;

-- ── El correo autorizado para notificaciones legales (art. 13) ──────────────
ALTER TABLE conductor
  ADD COLUMN IF NOT EXISTS correo_legal    VARCHAR(160),
  ADD COLUMN IF NOT EXISTS correo_legal_at TIMESTAMPTZ;

COMMENT ON COLUMN conductor.correo_legal IS
  'El correo que el trabajador designo para notificaciones legales (art. 13). NULL = no se le puede requerir por email, se escala a otro canal';

-- ── La notificacion ─────────────────────────────────────────────────────────
CREATE TABLE notificacion (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id     BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- Que plantilla y en que version. La version importa: una plantilla aprobada
  -- de nuevo es otra version, y lo enviado se queda con la que se uso.
  template_code    VARCHAR(40) NOT NULL,
  template_version SMALLINT    NOT NULL DEFAULT 1,
  canal            VARCHAR(12) NOT NULL,
  -- El periodo al que se refiere (un mes, un rango). Parte de la idempotencia.
  periodo          VARCHAR(20) NOT NULL,         -- '2026-08', o 'YYYY-MM-DD..YYYY-MM-DD'
  -- LA EVIDENCIA: las cifras exactas usadas, el texto que se genero, y la
  -- version de los datos con que se calculo (para detectar cuando cambian).
  payload          JSONB,
  version_datos    VARCHAR(40),
  asunto           TEXT,
  cuerpo           TEXT,
  documento_blob_id BIGINT,                      -- el PDF, cuando se genere
  -- El ciclo de vida. Un requerimiento grave nace en 'borrador' esperando
  -- aprobacion; uno automatico, en 'en_cola'.
  estado           VARCHAR(14) NOT NULL DEFAULT 'borrador',
  requiere_aprob   BOOLEAN     NOT NULL DEFAULT FALSE,
  aprobada_por     VARCHAR(120),
  aprobada_at      TIMESTAMPTZ,
  -- El plazo de respuesta. Vencido sin respuesta -> 'vencida' y al expediente.
  vence_el         DATE,
  programada_para  TIMESTAMPTZ,                  -- ventana de envio (art. 46)
  enviada_at       TIMESTAMPTZ,
  entregada_at     TIMESTAMPTZ,
  reconocida_at    TIMESTAMPTZ,
  proveedor_msg_id VARCHAR(120),
  motivo_rebote    TEXT,
  -- Si es una rectificativa, a que notificacion anterior sustituye.
  rectifica_a      BIGINT REFERENCES notificacion(id) ON DELETE SET NULL,
  creada_por       VARCHAR(120),                 -- puede ser 'sistema'
  creada_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_notif_estado CHECK (estado IN
    ('borrador','en_cola','enviada','entregada','rebotada',
     'reconocida','respondida','vencida','cancelada','rectificada')),
  -- IDEMPOTENCIA: no se emite dos veces lo mismo con los mismos datos. Si los
  -- datos cambian (version_datos distinta), SI es otra: la rectificativa.
  CONSTRAINT uq_notif UNIQUE (conductor_id, template_code, periodo, version_datos)
);
CREATE INDEX idx_notif_estado ON notificacion (estado, vence_el);
CREATE INDEX idx_notif_conductor ON notificacion (conductor_id, creada_at DESC);
CREATE INDEX idx_notif_pendiente_aprob ON notificacion (creada_at)
  WHERE estado = 'borrador' AND requiere_aprob;

COMMENT ON TABLE notificacion IS
  'Cada comunicacion al conductor con su evidencia y su ciclo de vida. Idempotente por (conductor, plantilla, periodo, version de los datos)';

-- ── La respuesta del conductor ──────────────────────────────────────────────
CREATE TABLE notificacion_respuesta (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notificacion_id BIGINT      NOT NULL REFERENCES notificacion(id) ON DELETE CASCADE,
  recibida_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  canal           VARCHAR(12),
  texto           TEXT,
  -- Como la clasifica RRHH. De aqui sale si se crea una ausencia o una
  -- justificacion, o si el ciclo escala al art. 39.
  clasificada     VARCHAR(14),                   -- justifica, no_justifica, parcial, sin_respuesta
  procesada_por   VARCHAR(120),
  procesada_at    TIMESTAMPTZ,
  ausencia_id     BIGINT,                        -- conductor_estado_hist(id) si se resolvio en ausencia
  creada_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_resp_clasif CHECK (clasificada IS NULL OR clasificada IN
    ('justifica','no_justifica','parcial','sin_respuesta'))
);
CREATE INDEX idx_resp_notif ON notificacion_respuesta (notificacion_id);

COMMENT ON TABLE notificacion_respuesta IS
  'Lo que contesta el conductor a un requerimiento. RRHH la clasifica y de ahi sale la ausencia o el escalado';

COMMIT;
