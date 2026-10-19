-- ============================================================
-- 210 · LA PUNTUACIÓN DE CADA SEMANA, SELLADA
-- ============================================================
-- Para el portal de los conductores (conductorestelecab.es). Camilo, 19/10/2026:
-- «la idea es que todavía no vean sus horas, solo turnos y la puntuación que
-- llevan semana tras semana, entonces toca que no se reinicien los puntajes ya
-- que hay que mostrarlos semanalmente a los conductores, como el sistema nació
-- apenas en septiembre entonces desde septiembre no más». Y eligió: cada semana,
-- su nota.
--
-- La letra de siempre (`conductor_calificacion`) es del MES CORRIDO: se rehace
-- cada día y empieza de cero el día 1. Enseñada tal cual, el conductor vería su
-- nota caer a N/E cada principio de mes. Esta tabla es otra cosa:
--
--   · UNA FILA POR CONDUCTOR Y SEMANA, de lunes a domingo (jornadas 05→05). La
--     primera semana es la del 31/08, contada desde el 01/09/2026.
--   · EL MISMO MODELO que la letra (services/repo/calificacion.js, MODELO): las
--     mismas tres métricas, tablas, bandas y topes, sobre los siete días.
--   · SELLADA. Se calcula el lunes al mediodía, cuando la jornada del domingo
--     está cerrada para todos, y ya no cambia: lo que el conductor vio es lo que
--     hay. Por eso no se puede actualizar una fila (el disparador de abajo). Si
--     algún día hay que rehacer una semana a propósito, se borran sus filas y se
--     vuelve a sellar.
--
-- No toca `conductor_calificacion` ni su vista: el ERP sigue con la letra del mes.

BEGIN;

CREATE TABLE IF NOT EXISTS conductor_puntuacion_semana (
  id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id     BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  semana_lunes     DATE        NOT NULL,
  -- Lo que se contó de esa semana: del lunes (o del 01/09/2026, la primera) al
  -- domingo. El alta de cada uno recorta dentro del cálculo, como en la letra.
  periodo_inicio   DATE        NOT NULL,
  periodo_fin      DATE        NOT NULL,

  letra            VARCHAR(3)  NOT NULL,
  letra_por_puntos VARCHAR(1),
  tope_aplicado    BOOLEAN     NOT NULL DEFAULT FALSE,
  motivo           VARCHAR(120),           -- por qué N/E, cuando lo es

  total            NUMERIC(5, 2),
  pts_horas        SMALLINT,
  pts_utilizacion  SMALLINT,
  pts_velocidad    SMALLINT,

  -- Para el ERP, no para el portal: el conductor ve los puntos, no sus horas.
  horas_prom       NUMERIC(5, 2),
  util_prom        NUMERIC(5, 2),
  excesos_total    INTEGER,
  dias_trabajados  SMALLINT,
  dias_utilizacion SMALLINT,
  dias_telemetria  SMALLINT,

  version_modelo   VARCHAR(10) NOT NULL,
  sellado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_psem_letra   CHECK (letra IN ('A', 'B', 'C', 'D', 'N/E')),
  CONSTRAINT ck_psem_lunes   CHECK (EXTRACT(ISODOW FROM semana_lunes) = 1),
  CONSTRAINT ck_psem_periodo CHECK (periodo_inicio >= semana_lunes
                                    AND periodo_fin = semana_lunes + 6
                                    AND periodo_fin >= periodo_inicio),
  CONSTRAINT ux_psem_conductor_semana UNIQUE (conductor_id, semana_lunes)
);

CREATE INDEX IF NOT EXISTS ix_psem_semana ON conductor_puntuacion_semana (semana_lunes);

COMMENT ON TABLE conductor_puntuacion_semana IS
  'La nota de cada conductor por semana (lunes a domingo), con el modelo de la letra, sellada el lunes al mediodía y sin cambios después. La ve el conductor en su portal (db/210)';

-- SELLADA: una fila no se cambia. Borrar sí se puede (rehacer una semana a
-- propósito); actualizar, no.
CREATE OR REPLACE FUNCTION tg_puntuacion_semana_sellada() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La puntuación de la semana del % está sellada: no se cambia (si hay que rehacerla, se borra y se vuelve a sellar)',
    to_char(OLD.semana_lunes, 'DD/MM/YYYY');
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_psem_sellada ON conductor_puntuacion_semana;
CREATE TRIGGER tg_psem_sellada BEFORE UPDATE ON conductor_puntuacion_semana
  FOR EACH ROW EXECUTE FUNCTION tg_puntuacion_semana_sellada();

COMMIT;
