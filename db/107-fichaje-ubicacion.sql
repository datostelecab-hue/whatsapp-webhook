-- ============================================================
-- 107 — Dónde estaban al fichar
-- ============================================================
-- Se guarda la ubicación de la entrada y la de la salida. DOS puntos y no uno:
-- se entra en un sitio y se sale de otro más veces de las que parece.
--
-- ── ES DATO PERSONAL ────────────────────────────────────────────────────────
-- Guardar dónde está un empleado es un dato personal. Hay que informarles por
-- escrito de que se recoge, para qué y cuánto se guarda. Eso no lo arregla el
-- código; queda escrito aquí para que nadie lo descubra tarde.
--
-- ── NUNCA BLOQUEA EL FICHAJE ────────────────────────────────────────────────
-- El registro de jornada es obligatorio (RD 8/2019). Si el navegador deniega el
-- permiso, el GPS no coge o el móvil está en modo avión, esa persona NO puede
-- quedarse sin fichar: el fichaje se guarda igual con `ubicacion_estado` en
-- 'denegada' o 'error'. Así el hueco SE VE y se puede reclamar, en vez de
-- perder el registro que la ley obliga a tener.
--
-- Y un detalle que sorprende: la geolocalización del navegador solo funciona
-- sobre HTTPS (o en localhost). En Render lo es; si algún día se sirve por HTTP
-- plano, todas las ubicaciones llegarían como 'error' sin que nadie toque nada.

BEGIN;

ALTER TABLE fichaje
  -- Coordenadas. NUMERIC y no float: una coordenada es un dato que se compara y
  -- se enseña, y el float arrastra decimales de basura al redondear.
  ADD COLUMN IF NOT EXISTS entrada_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS entrada_lng        NUMERIC(9,6),
  -- Cuánto se fía el dispositivo de esa posición, en metros. Importa: 2.000 m
  -- de precisión es la antena de móvil, no el GPS, y no dice gran cosa.
  ADD COLUMN IF NOT EXISTS entrada_precision  INTEGER,
  ADD COLUMN IF NOT EXISTS entrada_ubicacion  VARCHAR(12) NOT NULL DEFAULT 'sin_pedir',
  ADD COLUMN IF NOT EXISTS salida_lat         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS salida_lng         NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS salida_precision   INTEGER,
  ADD COLUMN IF NOT EXISTS salida_ubicacion   VARCHAR(12) NOT NULL DEFAULT 'sin_pedir';

-- Los cuatro estados posibles, y ninguno más:
--   ok         llegó la posición
--   denegada   la persona dijo que no al navegador
--   error      el navegador lo intentó y no pudo (sin GPS, sin cobertura, HTTP)
--   sin_pedir  fichajes creados a mano por el desarrollador al corregir
ALTER TABLE fichaje
  DROP CONSTRAINT IF EXISTS ck_fichaje_ubi_entrada,
  ADD  CONSTRAINT ck_fichaje_ubi_entrada
       CHECK (entrada_ubicacion IN ('ok', 'denegada', 'error', 'sin_pedir')),
  DROP CONSTRAINT IF EXISTS ck_fichaje_ubi_salida,
  ADD  CONSTRAINT ck_fichaje_ubi_salida
       CHECK (salida_ubicacion IN ('ok', 'denegada', 'error', 'sin_pedir'));

-- Si dice 'ok', que traiga coordenadas. Un 'ok' sin posición es una mentira
-- silenciosa, y de esas no se entera nadie hasta que hace falta el dato.
ALTER TABLE fichaje
  DROP CONSTRAINT IF EXISTS ck_fichaje_ubi_entrada_coords,
  ADD  CONSTRAINT ck_fichaje_ubi_entrada_coords
       CHECK (entrada_ubicacion <> 'ok' OR (entrada_lat IS NOT NULL AND entrada_lng IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_fichaje_ubi_salida_coords,
  ADD  CONSTRAINT ck_fichaje_ubi_salida_coords
       CHECK (salida_ubicacion <> 'ok' OR (salida_lat IS NOT NULL AND salida_lng IS NOT NULL));

COMMENT ON COLUMN fichaje.entrada_ubicacion IS
  'ok | denegada | error | sin_pedir. NUNCA bloquea el fichaje: el registro de jornada es obligatorio y no puede perderse porque falle un GPS';
COMMENT ON COLUMN fichaje.entrada_precision IS
  'Metros de incertidumbre que declara el dispositivo. Por encima de ~500 m no es GPS, es la antena';

COMMIT;
