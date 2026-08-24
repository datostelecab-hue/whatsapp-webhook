-- ============================================================
-- 12 · INGESTA — la única puerta de entrada de datos externos
-- ============================================================
-- Regla de arquitectura: NADIE consulta a BOLT o a Mapon para pintar una
-- pantalla. Una sola función trae los datos y los deja en PostgreSQL; todo lo
-- demás lee de aquí.
--
-- Por qué importa:
--   · Una pantalla que llama a una API tarda lo que tarde esa API, y falla
--     cuando ella falla. Mapon se cae de vez en cuando por temas de pago, y con
--     esto RRHH ni se entera.
--   · Catorce módulos llamando por su cuenta son catorce formas distintas de
--     interpretar la misma respuesta, y ya hemos visto lo que pasa: la
--     auditoría y el planificador leían `getVehicles` y cada uno se quedaba con
--     cosas distintas.
--   · Y con una sola puerta, la cuota de la API se controla en un sitio.
--
-- Esta tabla es lo que permite decir "estos datos son de hace 3 minutos", que
-- es la información que sustituye a preguntarle a la API cada vez.

BEGIN;

CREATE TABLE ingesta_ejecucion (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuente      VARCHAR(20)  NOT NULL,
  -- Qué se trajo: 'padron_bolt', 'vehiculos_bolt', 'unidades_mapon'…
  tarea       VARCHAR(40)  NOT NULL,
  ok          BOOLEAN      NOT NULL,
  empezada_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  duracion_ms INTEGER,
  -- Un resumen legible de lo que entró. Sin él, una ejecución correcta no se
  -- distingue de una que no trajo nada.
  registros   INTEGER,
  detalle     JSONB,
  error       TEXT,
  CONSTRAINT ck_ingesta_fuente CHECK (fuente IN ('bolt', 'mapon')),
  -- Un fallo lleva motivo; un acierto, no.
  CONSTRAINT ck_ingesta_error CHECK (ok = (error IS NULL))
);

CREATE INDEX idx_ingesta_ultima ON ingesta_ejecucion (fuente, tarea, empezada_at DESC);
CREATE INDEX idx_ingesta_fallos ON ingesta_ejecucion (empezada_at DESC) WHERE NOT ok;

COMMENT ON TABLE ingesta_ejecucion IS
  'Cada pasada de la ingesta. Es lo que deja responder "¿de cuándo son estos datos?" sin volver a preguntar a la API';

-- ── Lo último de cada cosa, con su antigüedad ───────────────────────────────
-- Es lo que mira una pantalla para avisar de que Mapon lleva horas caído sin
-- tener que llamar a Mapon para averiguarlo.
CREATE OR REPLACE VIEW v_ingesta_estado AS
SELECT DISTINCT ON (fuente, tarea)
       fuente, tarea, ok, empezada_at, duracion_ms, registros, error,
       EXTRACT(EPOCH FROM (now() - empezada_at))::int AS hace_seg,
       -- El último ACIERTO, aunque la última pasada fallara: si Mapon lleva
       -- media hora caído, los datos siguen siendo de hace media hora, no
       -- inexistentes.
       (SELECT max(e2.empezada_at) FROM ingesta_ejecucion e2
         WHERE e2.fuente = e.fuente AND e2.tarea = e.tarea AND e2.ok) AS ultimo_acierto
  FROM ingesta_ejecucion e
 ORDER BY fuente, tarea, empezada_at DESC;

COMMENT ON VIEW v_ingesta_estado IS
  'La última pasada de cada tarea y el último acierto. Un fallo reciente no borra que los datos de antes siguen ahí';

-- ── Purga ───────────────────────────────────────────────────────────────────
-- Una pasada cada 5 minutos son ~105.000 filas al año por tarea. El histórico
-- fino no vale para nada pasada una semana: lo que interesa es "¿está al día?"
-- y "¿ha fallado mucho últimamente?".
CREATE OR REPLACE FUNCTION purgar_ingesta(dias INTEGER DEFAULT 7) RETURNS INTEGER AS $$
DECLARE borradas INTEGER;
BEGIN
  DELETE FROM ingesta_ejecucion
   WHERE empezada_at < now() - (dias || ' days')::interval
     -- Los fallos se guardan más tiempo: son los que se miran para entender
     -- qué pasó la semana pasada.
     AND (ok OR empezada_at < now() - ((dias * 4) || ' days')::interval);
  GET DIAGNOSTICS borradas = ROW_COUNT;
  RETURN borradas;
END;
$$ LANGUAGE plpgsql;

-- ── Lo que BOLT sabe de cada coche y nosotros no ────────────────────────────
-- `getVehicles` devuelve modelo, año, color, plazas, VIN y número de licencia
-- de transporte, con CERO huecos en las 112 matrículas. El código ya llamaba a
-- ese endpoint desde la auditoría y se quedaba solo con la matrícula y el uuid:
-- todo lo demás se tiraba.
--
-- El maestro de coches se reconstruyó desde el planificador, que solo tenía
-- matrícula, estado y zona. Con esto se rellenan de golpe 87 fichas.
ALTER TABLE vehiculo
  ADD COLUMN color                VARCHAR(30),
  ADD COLUMN plazas               SMALLINT,
  ADD COLUMN vin                  VARCHAR(20),
  ADD COLUMN licencia_transporte  VARCHAR(30),
  -- De dónde salió cada dato. Lo que venga de BOLT se refresca solo; lo que
  -- haya escrito una persona no se pisa.
  ADD COLUMN datos_origen         VARCHAR(12),
  ADD COLUMN datos_at             TIMESTAMPTZ;

ALTER TABLE vehiculo
  ADD CONSTRAINT ck_veh_plazas CHECK (plazas IS NULL OR plazas BETWEEN 1 AND 9),
  ADD CONSTRAINT ck_veh_origen CHECK (datos_origen IS NULL OR datos_origen IN ('bolt', 'manual'));

COMMENT ON COLUMN vehiculo.color IS
  'Tal como lo da BOLT (white, pearlwhite, gray…). Sin traducir: traducir en la base es decidir el idioma de la pantalla';
COMMENT ON COLUMN vehiculo.datos_origen IS
  'bolt = lo refresca la ingesta sola. manual = lo escribió una persona y NO se pisa';

COMMIT;
