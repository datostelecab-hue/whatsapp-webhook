-- ============================================================
-- 246 — LAS TAREAS PROGRAMADAS DE NEGOCIO: cada vez, una sola vez
-- ============================================================
-- Pieza A10 de docs/Hoja de ruta.md (13/11/2026). La hoja de ruta trae tareas
-- que el ERP hace solo en su momento: el informe de pendientes de nómina «el
-- día 20; si no es hábil, el hábil anterior» (ítem 7), los vencimientos de las
-- tareas (ítem 1), las ITV a 30 días (14), las pólizas a 60 (19), las alarmas
-- de mantenimiento (20)…
--
-- Con un cron a secas pasan dos cosas que aquí no pueden pasar:
--   · EN CADA DESPLIEGUE CONVIVEN DOS PROCESOS un rato: el informe del día 20
--     saldría dos veces y crearía cada tarea dos veces.
--   · SI EL SERVIDOR ESTÁ CAÍDO A ESA HORA, la tarea no se hace nunca.
--
-- Así que cada tarea dice A QUÉ VEZ le toca («2026-12» para el informe de
-- diciembre) y esta tabla apunta cada intento. Un índice único deja una sola
-- vez EN CURSO o HECHA por tarea: el segundo proceso que llega no la empieza.
-- Una que FALLÓ no bloquea: la siguiente vuelta la reintenta. Una que se quedó
-- EN CURSO porque el proceso murió se da por ABANDONADA pasado un rato y se
-- vuelve a intentar. Lo hace services/tareasProgramadas.js, que revisa cada
-- diez minutos qué tareas tienen pendiente su vez: si el servidor estaba
-- caído, la hace en cuanto vuelve.
--
-- Nada se borra (convención 5): cada intento se queda con su resultado o su
-- error, y la tabla no admite DELETE ni TRUNCATE.

BEGIN;

CREATE TABLE IF NOT EXISTS tarea_programada_vez (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La tarea: 'nomina.pendientes_dia_20'.
  tarea        VARCHAR(64)  NOT NULL CHECK (tarea ~ '^[a-z][a-z0-9_.]*$'),
  -- Su vez: '2026-12' (una al mes), '2026-12-18' (una al día)…
  periodo      VARCHAR(40)  NOT NULL CHECK (btrim(periodo) <> ''),
  estado       VARCHAR(12)  NOT NULL DEFAULT 'en_curso'
                 CHECK (estado IN ('en_curso', 'hecha', 'fallida', 'abandonada')),
  empezada_at  TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  acabada_at   TIMESTAMPTZ,
  resultado    JSONB,        -- lo que devuelve la tarea (cuántas tareas creó…)
  error        TEXT,
  instancia    VARCHAR(120), -- qué proceso la hizo
  CONSTRAINT ck_tpv_acabada CHECK ((estado = 'en_curso') = (acabada_at IS NULL))
);

-- UNA vez en curso o hecha por tarea y periodo: lo que impide hacerla dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tpv_una_vez
  ON tarea_programada_vez (tarea, periodo) WHERE estado IN ('en_curso', 'hecha');
CREATE INDEX IF NOT EXISTS idx_tpv_tarea ON tarea_programada_vez (tarea, empezada_at DESC);

COMMENT ON TABLE tarea_programada_vez IS
  'Cada intento de una tarea programada de negocio (services/tareasProgramadas.js): una sola vez en curso o hecha por tarea y periodo, para que dos procesos no la hagan dos veces y una caída no la salte. No se borra (db/246).';

CREATE OR REPLACE FUNCTION tarea_programada_vez_sin_borrar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los intentos de las tareas programadas no se borran (db/246)';
END $$;

DROP TRIGGER IF EXISTS trg_tpv_sin_borrar ON tarea_programada_vez;
CREATE TRIGGER trg_tpv_sin_borrar BEFORE DELETE ON tarea_programada_vez
  FOR EACH ROW EXECUTE FUNCTION tarea_programada_vez_sin_borrar();
DROP TRIGGER IF EXISTS trg_tpv_sin_vaciar ON tarea_programada_vez;
CREATE TRIGGER trg_tpv_sin_vaciar BEFORE TRUNCATE ON tarea_programada_vez
  FOR EACH STATEMENT EXECUTE FUNCTION tarea_programada_vez_sin_borrar();

COMMIT;
