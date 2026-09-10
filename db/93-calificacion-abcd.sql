-- ============================================================
-- 93 — Calificación de conductores A–D (modelo "ABCD" 1.0)
-- ============================================================
-- Una letra por conductor y periodo, calculada de tres métricas ponderadas:
-- horas (50 %), utilización (30 %) y excesos de velocidad (20 %).
--
-- ── Por qué se guarda TODO el desglose y no solo la letra ───────────────────
-- Porque a una letra se le reclama. "¿Por qué soy B?" solo tiene respuesta si
-- están las tres puntuaciones, los promedios de los que salieron, los días que
-- contaron y si la letra la bajó un tope de seguridad. Sin eso, la única
-- respuesta posible es "lo dice el sistema", que no es una respuesta.
--
-- `version_modelo` es lo que permite comparar periodos cuando se muevan los
-- umbrales: una C de septiembre con el modelo 1.0 y una C de noviembre con el
-- 1.1 no son la misma C, y sin este campo nadie podría notarlo.
--
-- ── Por qué una fila por periodo y no una por conductor ─────────────────────
-- El histórico ES el producto. La letra de esta quincena importa menos que ver
-- que alguien lleva tres periodos bajando. `conductor_rendimiento` (el promedio
-- del mes que se pinta en el planificador) guarda una sola fila por persona
-- porque es una foto; esto es una serie.

BEGIN;

CREATE TABLE conductor_calificacion (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,

  periodo_inicio DATE        NOT NULL,
  periodo_fin    DATE        NOT NULL,

  -- 'A' | 'B' | 'C' | 'D' | 'N/E'. Cabe N/E, por eso son tres caracteres.
  letra            VARCHAR(3) NOT NULL,
  -- La que salía por puntos ANTES de aplicar los topes de seguridad. Es la mitad
  -- de la explicación cuando alguien pregunta por qué no tiene la A.
  letra_por_puntos VARCHAR(1),
  tope_aplicado    BOOLEAN    NOT NULL DEFAULT FALSE,
  motivo           VARCHAR(120),          -- por qué N/E, cuando lo es

  total          NUMERIC(5, 2),
  pts_horas       SMALLINT,
  pts_utilizacion SMALLINT,
  pts_velocidad   SMALLINT,

  horas_prom     NUMERIC(5, 2),
  util_prom      NUMERIC(5, 2),
  excesos_total  INTEGER,
  dias_trabajados SMALLINT,

  -- Días que contaron para cada promedio. No tienen por qué coincidir: un día
  -- entero de taller justificado suma horas y NO tiene utilización que medir.
  dias_utilizacion SMALLINT,

  -- Reservado: los viajes rechazados quedan fuera del modelo 1.0 por decisión de
  -- negocio, pero el hueco se deja hecho para no migrar la tabla el día que entren.
  viajes_rechazados INTEGER,
  pts_rechazos      SMALLINT,

  version_modelo VARCHAR(10) NOT NULL DEFAULT '1.0',
  calculado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_calif_letra   CHECK (letra IN ('A', 'B', 'C', 'D', 'N/E')),
  CONSTRAINT ck_calif_periodo CHECK (periodo_fin >= periodo_inicio),
  -- Un conductor tiene UNA calificación por periodo y versión del modelo. Con la
  -- versión dentro se puede recalcular el mismo periodo con umbrales nuevos y
  -- comparar los dos, que es justo para lo que sirve recalibrar.
  UNIQUE (conductor_id, periodo_inicio, periodo_fin, version_modelo)
);

CREATE INDEX idx_calif_periodo  ON conductor_calificacion (periodo_fin DESC, letra);
CREATE INDEX idx_calif_conductor ON conductor_calificacion (conductor_id, periodo_fin DESC);

COMMENT ON TABLE conductor_calificacion IS
  'Letra A-D por conductor y periodo, con todo el desglose para poder contestar una reclamacion';
COMMENT ON COLUMN conductor_calificacion.letra_por_puntos IS
  'La letra que salia por puntuacion antes de los topes de seguridad';
COMMENT ON COLUMN conductor_calificacion.excesos_total IS
  'SUMA acumulada de excesos del periodo completo, no un promedio diario';
COMMENT ON COLUMN conductor_calificacion.version_modelo IS
  'Version de umbrales con la que se calculo. Sin esto, dos letras de periodos distintos no son comparables';

-- La última calificación de cada uno, que es lo que pintan las pantallas.
CREATE OR REPLACE VIEW v_conductor_calificacion AS
SELECT DISTINCT ON (k.conductor_id)
       k.*,
       COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS conductor
  FROM conductor_calificacion k
  JOIN conductor c ON c.id = k.conductor_id
 ORDER BY k.conductor_id, k.periodo_fin DESC, k.calculado_en DESC;

COMMENT ON VIEW v_conductor_calificacion IS
  'La calificacion mas reciente de cada conductor';

COMMIT;
