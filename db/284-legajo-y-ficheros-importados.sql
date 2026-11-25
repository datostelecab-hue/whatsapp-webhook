-- ============================================================
-- 284 — EL LEGAJO, CON SU FORMATO, Y LOS FICHEROS IMPORTADOS
-- ============================================================
-- Fase 0 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md, 25/11/2026).
--
-- 1) EL LEGAJO ES EL «CÓDIGO GESTORÍA». Camilo: «Sí, reutiliza Legajo, solo
--    plantilla propia». Es el número de empleado que pone la gestoría y por el
--    que se cruzará cualquier fichero suyo (nunca por el nombre). Los 258 que
--    hay el 25/11 son seis cifras con ceros delante («000057»): ese es el
--    formato, y el código lo normaliza al guardar («57» → «000057»), así que
--    dos escrituras del mismo número no pueden quedar como dos legajos.
--    Obligatorio para la plantilla propia en alta: no puede ser NOT NULL (la
--    gestoría lo da después del alta), así que la falta se avisa en la ficha
--    («Fichas con huecos») y se carga desde un Excel.
--
-- 2) LOS FICHEROS IMPORTADOS. Lo que se sube de fuera (de la gestoría, del
--    INSS…): de qué tipo es, de qué periodo, su huella (sha256), qué estructura
--    se le detectó, qué resultó de cargarlo y cuántas incidencias dejó. EL MISMO
--    FICHERO NO ENTRA DOS VECES: un tipo y una huella, una sola carga viva. El
--    original se guarda como adjunto (dueño `fichero_importado`).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/284', true),
       set_config('telecab.usuario_id', '7', true);

-- ── 1. El legajo ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_conductor_legajo') THEN
    ALTER TABLE conductor ADD CONSTRAINT ck_conductor_legajo CHECK (legajo IS NULL OR legajo ~ '^[0-9]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN conductor.legajo IS
  'El número de empleado de la gestoría («código gestoría», db/284): seis cifras con ceros delante. Por él se cruza cualquier fichero de la gestoría. Obligatorio para la plantilla propia en alta (se avisa, no se impone: lo da la gestoría después del alta)';

-- ── 2. Los ficheros importados ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fichero_importado (
  id            BIGSERIAL PRIMARY KEY,
  tipo          VARCHAR(40)  NOT NULL,
  periodo       VARCHAR(20),
  nombre        VARCHAR(255) NOT NULL,
  sha256        CHAR(64)     NOT NULL,
  bytes         BIGINT,
  adjunto_id    BIGINT REFERENCES adjunto(id),
  estructura    JSONB,
  resultado     JSONB,
  incidencias   INTEGER      NOT NULL DEFAULT 0,
  estado        VARCHAR(10)  NOT NULL DEFAULT 'cargado',
  subido_por    INTEGER REFERENCES usuario(id),
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_por   INTEGER REFERENCES usuario(id),
  anulado_at    TIMESTAMPTZ,
  anulado_motivo TEXT,
  CONSTRAINT ck_fichero_importado_tipo CHECK (tipo ~ '^[a-z][a-z0-9_]{0,39}$'),
  CONSTRAINT ck_fichero_importado_sha CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_fichero_importado_estado CHECK (estado IN ('cargado', 'anulado')),
  CONSTRAINT ck_fichero_importado_anulado CHECK ((estado = 'anulado') = (anulado_at IS NOT NULL))
);

-- El mismo fichero no entra dos veces (mientras su carga siga viva).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fichero_importado_huella
  ON fichero_importado (tipo, sha256) WHERE estado = 'cargado';
CREATE INDEX IF NOT EXISTS ix_fichero_importado_tipo ON fichero_importado (tipo, creado_at DESC);

COMMENT ON TABLE fichero_importado IS
  'Lo que se sube de fuera (gestoría, INSS…), db/284: tipo, periodo, huella, estructura detectada, resultado e incidencias. Un tipo y una huella, una sola carga viva. El original va como adjunto (dueño fichero_importado).';

SELECT auditoria_vigilar('fichero_importado');

COMMIT;
