-- ============================================================
-- 312 — EL FICHERO FIE DE LA GESTORÍA: LAS BAJAS MÉDICAS LEGALES (27/11/2026)
-- ============================================================
-- La gestoría manda cada día (a Diana, que lo reenvía a datos@telecab.es) el
-- fichero FIE de la Seguridad Social: quién está de baja médica de verdad, con
-- su fecha de baja y su fecha de alta (o sin alta). Es lo legal: si una baja del
-- ERP no coincide, el FIE la corrige. Camilo, 27/11/2026, desde el 27/09/2026:
--   · la Fecha Fin IT es el día del alta: vuelve al día siguiente;
--   · una baja del ERP que no sale en ningún FIE se marca para revisar, no se toca;
--   · primero una previa con lo que cambiaría; tras «Aplicar», cada FIE nuevo
--     se aplica solo (el parámetro fie.automatico).
--
-- Una fila por PROCESO de IT (persona + fecha de baja), con lo último que dijo
-- el FIE de él. Los ficheros, en `fichero_importado` (tipo 'fie').
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/312', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS fie_proceso (
  id                   BIGSERIAL PRIMARY KEY,
  -- El documento de la persona (el IPF del FIE sin su primer dígito) y su NAF.
  dni                  VARCHAR(16)  NOT NULL,
  naf                  VARCHAR(16),
  nombre               VARCHAR(160),
  fecha_baja           DATE         NOT NULL,
  fecha_fin            DATE,
  causa_fin            VARCHAR(4),
  contingencia         VARCHAR(24),
  recaida              BOOLEAN      NOT NULL DEFAULT FALSE,
  proceso_inicial      DATE,
  duracion_estimada    INTEGER,
  revision             DATE,
  confirmacion         DATE,
  baja_anulada         BOOLEAN      NOT NULL DEFAULT FALSE,
  alta_anulada         BOOLEAN      NOT NULL DEFAULT FALSE,
  -- De qué día es lo último que se sabe (la «Fecha Registro» del FIE) y de qué fichero.
  registro             DATE,
  fichero_id           BIGINT       REFERENCES fichero_importado(id),
  conductor_id         BIGINT       REFERENCES conductor(id),
  -- Cómo va en el ERP: pendiente (por aplicar), aplicado, al_dia (ya cuadraba),
  -- sin_ficha (no hay nadie con ese DNI) o error.
  estado               VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
  nota                 TEXT,
  aplicado_at          TIMESTAMPTZ,
  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_fie_proceso UNIQUE (dni, fecha_baja),
  CONSTRAINT ck_fie_estado CHECK (estado IN ('pendiente', 'aplicado', 'al_dia', 'sin_ficha', 'error'))
);
CREATE INDEX IF NOT EXISTS ix_fie_proceso_conductor ON fie_proceso (conductor_id, fecha_baja);
CREATE INDEX IF NOT EXISTS ix_fie_proceso_estado ON fie_proceso (estado);
COMMENT ON TABLE fie_proceso IS
  'db/312: cada proceso de IT del fichero FIE de la gestoría (lo legal), con lo último que dijo y cómo va contra las bajas del ERP';

SELECT auditoria_vigilar('fie_proceso');

COMMIT;
