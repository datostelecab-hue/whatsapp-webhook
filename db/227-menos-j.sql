-- ============================================================
-- 227 — LA −J: CONSTANCIA DE UN PERJUICIO A LA EMPRESA
-- ============================================================
-- Camilo, 30/10/2026: «Vamos a implementar algo nuevo llamado −J. Por el
-- momento con una casuística (cluster), "Perjuicios a la empresa", con el
-- motivo obligatorio y, opcional, el nombre del compañero. Por ejemplo: Alex no
-- le da el coche temprano a Carlos, Carlos sale tarde por culpa de Alex; le
-- dejamos una −J a Alex por perjuicio a la empresa, ya que Carlos no va a poder
-- cumplir su horario. Puede que no sea con un compañero sino por otra cosa, y
-- ahí lo dirá el motivo».
--
-- Lo que decidió al preguntarle:
--   · SOLO CONSTANCIA. No toca horas, ni nómina, ni la letra: queda en su
--     bitácora y se cuentan las que lleva. (Quitar sueldo como castigo sería
--     una multa de haber, que el Estatuto de los Trabajadores prohíbe.)
--   · NACE PENDIENTE y la aprueba un área en /justificantes, como una J. Hasta
--     entonces no cuenta. Rechazada, se queda con quién y por qué.
--   · El TIEMPO que costó es opcional, en minutos («Carlos salió 1 h 30 tarde»).
--   · Se pone desde la Bitácora, desde Control y desde la J del perjudicado: la
--     J «Por compañero» de Carlos puede llevar la −J de Alex (`justificante_id`).
--
-- Tabla propia y no una J con signo: una −J no es un justificante —no
-- justifica nada ni pone marca en el día— y la misma persona puede tener ese
-- día su J y su −J, que el índice de «una J viva por día» no dejaría. Puede
-- haber varias −J el mismo día: son hechos distintos.
--
-- La casuística va con su CHECK, como los tipos de J (db/73): un cluster nuevo
-- es una línea en services/repo/menosJ.js y otra aquí.

BEGIN;

CREATE TABLE IF NOT EXISTS menos_j (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Quien la recibe: el que causó el perjuicio.
  conductor_id     BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo    DATE         NOT NULL,
  casuistica       VARCHAR(30)  NOT NULL DEFAULT 'perjuicio_empresa',
  motivo           VARCHAR(500) NOT NULL,
  -- El compañero perjudicado, si lo hay (Carlos en el ejemplo).
  companero_id     BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  -- Lo que costó, si se sabe.
  minutos          INTEGER,
  -- La J del perjudicado de la que nace, si nació de una.
  justificante_id  BIGINT       REFERENCES justificante(id) ON DELETE SET NULL,
  origen           VARCHAR(16)  NOT NULL DEFAULT 'bitacora',
  usuario_id       INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- La aprobación, como la J (db/73): pendiente = ni aprobada ni anulada.
  aprobado_at      TIMESTAMPTZ,
  aprobado_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at       TIMESTAMPTZ,
  anulado_por      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo   TEXT,
  CONSTRAINT ck_menosj_casuistica CHECK (casuistica IN ('perjuicio_empresa')),
  CONSTRAINT ck_menosj_motivo     CHECK (btrim(motivo) <> ''),
  CONSTRAINT ck_menosj_minutos    CHECK (minutos IS NULL OR (minutos > 0 AND minutos <= 1440)),
  CONSTRAINT ck_menosj_companero  CHECK (companero_id IS NULL OR companero_id <> conductor_id),
  CONSTRAINT ck_menosj_origen     CHECK (origen IN ('bitacora', 'control', 'justificante')),
  CONSTRAINT ck_menosj_rechazo    CHECK (anulado_at IS NULL OR btrim(COALESCE(anulado_motivo, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_menosj_conductor ON menos_j (conductor_id, dia_operativo);
CREATE INDEX IF NOT EXISTS idx_menosj_dia       ON menos_j (dia_operativo);
CREATE INDEX IF NOT EXISTS idx_menosj_jota      ON menos_j (justificante_id) WHERE justificante_id IS NOT NULL;
-- La cola de /justificantes.
CREATE INDEX IF NOT EXISTS idx_menosj_pendientes
  ON menos_j (dia_operativo) WHERE aprobado_at IS NULL AND anulado_at IS NULL;

COMMENT ON TABLE menos_j IS
  'La −J: constancia de un perjuicio a la empresa. No toca horas, nómina ni letra. Nace pendiente y la aprueba un área en /justificantes';
COMMENT ON COLUMN menos_j.conductor_id IS 'Quien la recibe: el que causó el perjuicio';
COMMENT ON COLUMN menos_j.companero_id IS 'El compañero perjudicado, si lo hay';
COMMENT ON COLUMN menos_j.minutos IS 'Lo que costó el perjuicio, si se sabe (opcional)';
COMMENT ON COLUMN menos_j.justificante_id IS 'La J del perjudicado de la que nace, si nació de una';

COMMIT;
