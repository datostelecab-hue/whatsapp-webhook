-- ============================================================
-- TALLER — mantenimiento por kilómetros
-- ============================================================
-- Para decir "a este coche le toca revisión" hacen falta tres cosas, y hasta
-- hoy no teníamos ninguna guardada:
--
--   1. El ODÓMETRO de ahora. Está en Mapon, en can.odom (el del cuadro, leído
--      del CAN bus). Lo escribe la sincronización en vehiculo.km_odometro_m.
--      Pero solo lo dan 78 de los 88 coches: el resto lleva un GPS que no lee
--      el CAN, y ahí no hay odómetro que valga.
--   2. El KM DE LA ÚLTIMA REVISIÓN. Lo lleva el taller en un Excel.
--   3. Cada CUÁNTO toca. Hoy son 15.000 km para todos.
--
-- Este fichero crea las tres piezas que faltan.
--
-- ── Por qué un ancla y no un campo más ───────────────────────────────────────
-- Para los coches sin CAN, el odómetro hay que leerlo del cuadro a mano. Pero
-- una lectura a mano envejece: al día siguiente ya no vale. Lo que no envejece
-- es la lectura MÁS el recorrido desde entonces, y el recorrido sí lo sabe
-- Mapon con su `mileage` (los km del dispositivo desde que se instaló, que no
-- sirven como odómetro pero sí como cuentakilómetros parcial):
--
--     km de hoy = km del ancla + (mileage de hoy − mileage del ancla)
--
-- Por eso el ancla guarda las DOS cifras a la vez. Se lee el cuadro una vez y
-- el sistema mantiene la cuenta solo, sin que nadie vuelva a mirar el coche.
--
-- ── Por qué la fecha del mantenimiento puede ir vacía ────────────────────────
-- El fichero que lleva el taller tiene los km de cada revisión pero NO la fecha.
-- Exigir la fecha significaría o no cargar ese histórico o inventarse fechas.
-- Para el control por km lo que manda es el km, así que se pide uno de los dos.

BEGIN;

-- ── 0. El cuentakilómetros parcial del GPS ───────────────────────────────────
-- `mileage` de Mapon NO es el odómetro (son los km desde que se instaló el
-- dispositivo), pero es lo que hace que un ancla no caduque. Se guarda para
-- todos los coches, tengan CAN o no.
ALTER TABLE vehiculo
  ADD COLUMN IF NOT EXISTS km_gps_m BIGINT;

COMMENT ON COLUMN vehiculo.km_gps_m IS
  'mileage de Mapon en METROS: km del DISPOSITIVO desde que se instalo. NO es el odometro del coche';

-- ── 1. Cada cuánto toca revisión ─────────────────────────────────────────────
-- Por defecto lo dice el código (15.000). Aquí solo van las excepciones: un
-- coche con otro plan de mantenimiento, o uno que por su estado hay que mirar
-- más de cerca.
ALTER TABLE vehiculo
  ADD COLUMN IF NOT EXISTS km_revision_cada INTEGER;

COMMENT ON COLUMN vehiculo.km_revision_cada IS
  'Intervalo de revision de ESTE coche en km. NULL = el general del modulo (15.000)';

ALTER TABLE vehiculo
  ADD CONSTRAINT ck_veh_revision_cada
  CHECK (km_revision_cada IS NULL OR km_revision_cada BETWEEN 1000 AND 200000);

-- ── 2. El ancla del odómetro ─────────────────────────────────────────────────
CREATE TABLE odometro_ancla (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  km           INTEGER     NOT NULL,
  leido_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- El `mileage` de Mapon en el momento de leer el cuadro. Sin esto el ancla
  -- solo vale para ese día; con esto vale para siempre.
  gps_m        BIGINT,
  usuario_id   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  nota         TEXT,
  CONSTRAINT ck_ancla_km CHECK (km >= 0 AND km <= 2000000),
  CONSTRAINT ck_ancla_gps CHECK (gps_m IS NULL OR gps_m >= 0)
);
CREATE INDEX idx_ancla_veh ON odometro_ancla (vehiculo_id, leido_at DESC);

COMMENT ON TABLE odometro_ancla IS
  'Lecturas del cuadro hechas a mano, para los coches cuyo GPS no lee el CAN. Vale la ULTIMA de cada coche';
COMMENT ON COLUMN odometro_ancla.gps_m IS
  'mileage de Mapon (metros) cuando se leyo el cuadro. km de hoy = km + (mileage de hoy - este)';

-- ── 3. El historial de mantenimientos ────────────────────────────────────────
-- Nace pensada para el control por km, pero con `tipo` para que la ITV, la
-- chapa y las averías no necesiten otra tabla cuando lleguen.
CREATE TABLE mantenimiento (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT       NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  tipo         VARCHAR(12)  NOT NULL,
  fecha        DATE,
  km           INTEGER,
  taller       VARCHAR(80),
  coste_cent   INTEGER,
  descripcion  TEXT,
  usuario_id   INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at   TIMESTAMPTZ,
  anulado_por  INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo TEXT,
  CONSTRAINT ck_mant_tipo CHECK (tipo IN
    ('revision','itv','neumaticos','chapa','averia','aceite','otro')),
  -- Sin km NI fecha no es un mantenimiento: es una nota.
  CONSTRAINT ck_mant_algo   CHECK (km IS NOT NULL OR fecha IS NOT NULL),
  CONSTRAINT ck_mant_km     CHECK (km IS NULL OR (km >= 0 AND km <= 2000000)),
  CONSTRAINT ck_mant_coste  CHECK (coste_cent IS NULL OR coste_cent >= 0),
  CONSTRAINT ck_mant_anulado CHECK ((anulado_at IS NULL) = (anulado_por IS NULL))
);
CREATE INDEX idx_mant_veh   ON mantenimiento (vehiculo_id, tipo, km DESC NULLS LAST);
CREATE INDEX idx_mant_fecha ON mantenimiento (fecha DESC NULLS LAST);

COMMENT ON TABLE mantenimiento IS
  'Cada paso por taller. Para el control por km manda `km`; `fecha` puede faltar porque el Excel del taller no la trae';
COMMENT ON COLUMN mantenimiento.coste_cent IS
  'CENTIMOS, como en recaudacion. Sin decimales que se pierdan por el camino';
COMMENT ON COLUMN mantenimiento.km IS
  'Odometro del CUADRO en ese momento, no el contador del GPS';

-- ── 4. El odómetro de cada día ───────────────────────────────────────────────
-- vehiculo.km_odometro_m se PISA en cada sincronización: no había forma de
-- saber cuánto rueda un coche sin preguntárselo a Mapon coche por coche (144
-- llamadas). Con una foto diaria, el ritmo sale de una consulta y además se va
-- formando el histórico que hoy no existe.
--
-- Una fila por coche y día: 95 al día, 35.000 al año. No hace falta podarla.
CREATE TABLE vehiculo_km_dia (
  vehiculo_id  BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  dia          DATE        NOT NULL,
  km           INTEGER     NOT NULL,
  gps_m        BIGINT,
  visto_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehiculo_id, dia),
  CONSTRAINT ck_kmdia_km CHECK (km >= 0)
);
CREATE INDEX idx_kmdia_dia ON vehiculo_km_dia (dia DESC);

COMMENT ON TABLE vehiculo_km_dia IS
  'Foto diaria del odometro. La ULTIMA lectura de cada dia gana. De aqui sale el ritmo (km/dia) sin llamar a Mapon';

-- ── 5. El odómetro, resuelto en UN sitio ─────────────────────────────────────
-- La regla de "cuántos km lleva este coche" no puede vivir repartida entre la
-- pantalla, el cron y los informes: cada copia se desviaria por su lado. Vive
-- aqui, y todo lo demas lee de aqui.
--
--   · Si el GPS lee el CAN            → ese es el odometro, y punto.
--   · Si no, pero hay ancla y GPS     → ancla + lo que ha recorrido desde ella.
--   · Si solo hay ancla               → el ancla tal cual, y `visto_at` dira
--                                       lo vieja que es.
--   · Si no hay nada                  → NULL. Un odometro inventado es peor
--                                       que ninguno.
CREATE OR REPLACE VIEW v_vehiculo_odometro AS
SELECT v.id AS vehiculo_id,
       (CASE
          WHEN v.km_odometro_m IS NOT NULL THEN v.km_odometro_m / 1000
          WHEN a.km IS NOT NULL AND v.km_gps_m IS NOT NULL AND a.gps_m IS NOT NULL
            THEN a.km + GREATEST(v.km_gps_m - a.gps_m, 0) / 1000
          WHEN a.km IS NOT NULL THEN a.km
        END)::INTEGER AS km,
       (CASE
          WHEN v.km_odometro_m IS NOT NULL THEN 'can'
          WHEN a.km IS NOT NULL AND v.km_gps_m IS NOT NULL AND a.gps_m IS NOT NULL THEN 'ancla'
          WHEN a.km IS NOT NULL THEN 'ancla_fija'
        END) AS fuente,
       COALESCE(v.km_odometro_at, a.leido_at) AS visto_at,
       a.leido_at AS ancla_at,
       a.km       AS ancla_km
  FROM vehiculo v
  LEFT JOIN LATERAL (
    SELECT km, gps_m, leido_at FROM odometro_ancla
     WHERE vehiculo_id = v.id ORDER BY leido_at DESC LIMIT 1
  ) a ON TRUE;

COMMENT ON VIEW v_vehiculo_odometro IS
  'El odometro de cada coche y de donde sale (can / ancla / ancla_fija). Unica fuente: nadie recalcula esto por su cuenta';

COMMIT;
