-- ============================================================
-- 213 · LA AUDITORÍA DE CADA REPOSTAJE CON MAPON, Y LAS GASOLINERAS
-- ============================================================
-- Camilo, 22/10/2026: «Se van a pintar las filas de la siguiente manera: con el
-- criterio del GPS con un margen de error de menos de 700 m de verde, menos de
-- 1600 m de amarillo y más de 1600 m de rojo. Para lo de la boya […] de verde
-- < 35%, de amarillo < 65% y rojo >= 65%. gasolineras_ballenoil_madrid_
-- barcelona.xlsx esos son los alias que maneja Ballenoil con sus gasolineras,
-- los nombres y las coordenadas».
--
-- Cada repostaje que llega por correo (db/212) se mira contra Mapon, en solo
-- lectura (modules/Combustible/combustible.auditoria.js):
--
--   · GPS: dónde estaba el coche a la hora del repostaje (la parada de Mapon
--     que cubre esa hora o, si no hay, su posición en ese instante) y a cuántos
--     metros de la gasolinera del correo.
--   · BOYA: cuánto subió el aforador del depósito en ese repostaje frente a los
--     litros del correo, en %.
--
-- Los colores NO se guardan: se calculan al leer con los umbrales del código
-- (combustible.semaforo.js), así que si un día cambian, cambia el histórico.
-- Aquí se guardan las medidas y, cuando falta una, el porqué.
--
-- TRES COSAS:
--
--   · gasolinera — las del proveedor con su nombre, su dirección y sus
--     coordenadas. Se cargan aquí las 143 de Ballenoil del Excel de Camilo (112
--     de Madrid, 31 de Barcelona), con la observación de precisión que trae:
--     las coordenadas las publica Ballenoil (web: 105), salen de geocodificar la
--     dirección (geocodificada: 16), son de una carretera o un número que no se
--     encuentra (aproximada: 14) o no hay (sin: 8, que solo dan el código postal
--     o nada). `proveedor` deja sitio a Petroprix.
--
--   · gasolinera_alias — el nombre de estación de un correo («COSLADA»,
--     normalizado) que alguien casó a mano con una gasolinera de la lista. Los
--     correos llaman a las gasolineras de otra forma que la lista y el ERP las
--     casa por sus palabras; cuando no puede, o duda, se pone a mano UNA vez y
--     vale para todos los correos con ese nombre.
--
--   · repostaje — la gasolinera casada, lo que dijo el GPS, lo que dijo la boya
--     y el estado de la auditoría.

BEGIN;

CREATE TABLE IF NOT EXISTS gasolinera (
  id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor      VARCHAR(20)  NOT NULL,                -- ballenoil, petroprix…
  nombre         VARCHAR(160) NOT NULL,                -- el de la lista: «Ballenoil Barcelona - Asunción»
  direccion      VARCHAR(300),
  provincia      VARCHAR(40),
  sede           VARCHAR(16)  REFERENCES cat_sede(codigo),
  lat            NUMERIC(9, 6),
  lng            NUMERIC(9, 6),
  -- De dónde salen las coordenadas: web (las publica el proveedor),
  -- geocodificada (de la dirección, OpenStreetMap), aproximada (una carretera o
  -- un número que no se encuentra) o sin (no hay).
  precision      VARCHAR(14)  NOT NULL DEFAULT 'web',
  observaciones  TEXT,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_gasolinera_precision CHECK (precision IN ('web', 'geocodificada', 'aproximada', 'sin')),
  CONSTRAINT ck_gasolinera_coordenadas CHECK ((lat IS NULL) = (lng IS NULL) AND ((precision = 'sin') = (lat IS NULL))),
  CONSTRAINT ck_gasolinera_rango CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gasolinera_nombre ON gasolinera (proveedor, nombre);

COMMENT ON TABLE gasolinera IS
  'Las gasolineras de cada proveedor con su nombre en la lista, su dirección y sus coordenadas. Las de Ballenoil vienen del Excel de Camilo del 22/10/2026 (db/213). Con ellas se mide a cuánto estaba el coche de la gasolinera del correo';
COMMENT ON COLUMN gasolinera.precision IS
  'web = coordenadas del proveedor; geocodificada = sacadas de la dirección (OpenStreetMap); aproximada = carretera o número no localizable; sin = no hay coordenadas (no se puede medir la distancia)';

CREATE TABLE IF NOT EXISTS gasolinera_alias (
  id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor      VARCHAR(20)  NOT NULL,
  estacion_clave VARCHAR(160) NOT NULL,               -- el nombre del correo normalizado (combustible.gasolinera.normalizar)
  estacion       VARCHAR(160),                        -- tal cual lo traía el correo cuando se casó
  gasolinera_id  BIGINT       NOT NULL REFERENCES gasolinera(id) ON DELETE CASCADE,
  usuario_id     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_gasolinera_alias ON gasolinera_alias (proveedor, estacion_clave);

COMMENT ON TABLE gasolinera_alias IS
  'El nombre de estación de los correos que alguien casó a mano con una gasolinera de la lista (Combustible, ficha del repostaje). Vale para todos los correos con ese nombre (db/213)';

-- ── El repostaje: la gasolinera, el GPS, la boya y la auditoría ────────────
ALTER TABLE repostaje
  ADD COLUMN IF NOT EXISTS gasolinera_id         BIGINT REFERENCES gasolinera(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gasolinera_como       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS gasolinera_candidatas BIGINT[],
  ADD COLUMN IF NOT EXISTS gps_lat               NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS gps_lng               NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS gps_at                TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_hasta             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gps_fuente            VARCHAR(8),
  ADD COLUMN IF NOT EXISTS gps_direccion         VARCHAR(300),
  ADD COLUMN IF NOT EXISTS gps_distancia_m       INTEGER,
  ADD COLUMN IF NOT EXISTS gps_cercana_id        BIGINT REFERENCES gasolinera(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gps_cercana_m         INTEGER,
  ADD COLUMN IF NOT EXISTS gps_motivo            VARCHAR(300),
  ADD COLUMN IF NOT EXISTS boya_tipo             VARCHAR(10),
  ADD COLUMN IF NOT EXISTS boya_antes            NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS boya_despues          NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS boya_salto            NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS boya_techo            NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS boya_corregida        BOOLEAN,
  ADD COLUMN IF NOT EXISTS boya_litros           NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS boya_error_pct        NUMERIC(7, 1),
  ADD COLUMN IF NOT EXISTS boya_motivo           VARCHAR(300),
  ADD COLUMN IF NOT EXISTS auditoria_intentos    SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_gasolinera_como;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_gasolinera_como
  CHECK (gasolinera_como IS NULL OR gasolinera_como IN ('exacto', 'parecido', 'alias', 'ambiguo', 'ninguna'));
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_gps_fuente;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_gps_fuente CHECK (gps_fuente IS NULL OR gps_fuente IN ('parada', 'punto'));
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_boya_tipo;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_boya_tipo CHECK (boya_tipo IS NULL OR boya_tipo IN ('litros', 'porcentaje', 'sin'));
-- db/212 dejó auditoria_estado sin CHECK a propósito, «los estados los decidirá
-- esa tanda». Son estos cuatro.
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_auditoria;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_auditoria
  CHECK (auditoria_estado IN ('pendiente', 'incompleta', 'hecha', 'sin_datos'));

-- Lo que cada pasada vuelve a auditar: los que nunca se miraron y los que se
-- quedaron a medias. Pocos, y así no se recorre la tabla entera.
DROP INDEX IF EXISTS ix_rep_auditoria;
CREATE INDEX IF NOT EXISTS ix_rep_auditar ON repostaje (repostaje_at)
  WHERE estado = 'leido' AND auditoria_estado IN ('pendiente', 'incompleta');
CREATE INDEX IF NOT EXISTS ix_rep_gasolinera ON repostaje (gasolinera_id) WHERE gasolinera_id IS NOT NULL;

COMMENT ON COLUMN repostaje.auditoria_estado IS
  'pendiente = aún no se ha mirado en Mapon (se espera 45 min tras el repostaje, para que haya lecturas de después); incompleta = se miró y falta algo que puede llegar (se vuelve a mirar, cada vez más espaciado, unos dos días); hecha = los dos criterios tienen su dato o el porqué definitivo de no tenerlo; sin_datos = pasados los reintentos, se queda con lo que hubiera';
COMMENT ON COLUMN repostaje.gasolinera_como IS
  'Cómo casó la estación del correo con la lista: exacto (mismas palabras), parecido (las de una están en la otra), alias (puesto a mano en gasolinera_alias), ambiguo (vale para varias: no se casa; gasolinera_candidatas dice cuáles) o ninguna';
COMMENT ON COLUMN repostaje.gps_fuente IS
  'De dónde sale la posición: parada = la parada de Mapon que cubre la hora del repostaje (gps_at → gps_hasta); punto = la posición de Mapon en ese instante (unit_data/history_point), si no hubo parada';
COMMENT ON COLUMN repostaje.gps_distancia_m IS
  'Metros de la posición del coche a la gasolinera casada. NULL si falta una de las dos (gps_motivo dice cuál): sin color por GPS';
COMMENT ON COLUMN repostaje.gps_cercana_id IS
  'La gasolinera de la lista más cercana a donde estaba el coche (gps_cercana_m, a cuánto). Solo informa: la auditoría nunca elige la gasolinera por el GPS';
COMMENT ON COLUMN repostaje.boya_tipo IS
  'litros = el aforador en litros enteros (Toyota, Ioniq); porcentaje = en % del depósito (Ford): sin la capacidad del depósito no se pasa a litros; sin = el coche no da el nivel del depósito en Mapon';
COMMENT ON COLUMN repostaje.boya_litros IS
  'Lo que subió el depósito según la boya, en litros: el salto (después − antes, medianas de 5 lecturas), corregido si el aforador topó en su techo (boya_corregida), o pasado de % a litros con la capacidad del depósito';
COMMENT ON COLUMN repostaje.boya_error_pct IS
  '|boya_litros − litros del correo| / litros del correo × 100. NULL si falta la boya (boya_motivo dice por qué): sin color por boya';

-- ── Las 143 gasolineras de Ballenoil (Excel del 22/10/2026) ────────────────
INSERT INTO gasolinera (proveedor, nombre, direccion, provincia, sede, lat, lng, precision, observaciones) VALUES
  ('ballenoil', 'Ballenoil Barberà del Vallès', 'Ronda Industria 38, 08025 Barcelona (Barcelona)', 'Barcelona', 'barcelona', 41.514766, 2.128258, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Barcelona - Asunción', 'Carrer de la Ciutat d''Asuncion 12B, 08030 Barcelona (Barcelona)', 'Barcelona', 'barcelona', 41.437321, 2.200953, 'web', NULL),
  ('ballenoil', 'Ballenoil Barcelona - La Trinidad', '08038 Barcelona (Barcelona)', 'Barcelona', 'barcelona', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Barcelona II - Lope de Vega', 'Carrer de Lope de Vega 139, Sant Martí, 08018 Barcelona (Barcelona)', 'Barcelona', 'barcelona', 41.405921, 2.201397, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Barcelona III - Craywinckel', 'Carrer de Craywinckel 1, Sarrià-Sant Gervasi, 08021 Barcelona (Barcelona)', 'Barcelona', 'barcelona', 41.412222, 2.139861, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Castelldefels', 'Avinguda de la Constitució 85, 08860 Castelldefels (Barcelona)', 'Barcelona', 'barcelona', 41.284305, 1.985362, 'web', NULL),
  ('ballenoil', 'Ballenoil Castelldefels II', 'Avda. de la Constitución 99, 08860 Castelldefels (Barcelona)', 'Barcelona', 'barcelona', 41.286102, 1.982417, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Cerdanyola del Vallès / Sardañola del Vallés', 'Carrer de Santa Anna 115, 08290 Cerdanyola del Vallès (Barcelona)', 'Barcelona', 'barcelona', 41.500466, 2.128012, 'web', NULL),
  ('ballenoil', 'Ballenoil Clot', '08038 Barcelona (Barcelona)', 'Barcelona', 'barcelona', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Cornellà', 'Carretera de l''Hospitalet 33, 08940 Cornellà de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.354527, 2.081115, 'web', NULL),
  ('ballenoil', 'Ballenoil Cornellà II', 'Polígono Can Fatjó, 1, 08940 Cornellà de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.355724, 2.070622, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil El Prat', 'Carretera Ca l''Alaio 3, 08820 El Prat de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.329460, 2.084100, 'web', NULL),
  ('ballenoil', 'Ballenoil Hospitalet de Llobregat', 'Carrer Miguel Hernández 116, 08908 L''Hospitalet de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.351290, 2.121059, 'web', NULL),
  ('ballenoil', 'Ballenoil Malgrat de Mar', 'Avda. Francesc Sanllehí i Bosch 11, Pol. Ind. Can Patalina, 08380 Malgrat de Mar (Barcelona)', 'Barcelona', 'barcelona', 41.656019, 2.741910, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Malgrat de Mar II', 'N-2, PK 674, 08380 Malgrat de Mar (Barcelona)', 'Barcelona', 'barcelona', 41.645912, 2.741405, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Malgrat de Mar III', 'N-2, PK 674, 08380 Malgrat de Mar (Barcelona)', 'Barcelona', 'barcelona', 41.645912, 2.741405, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud). Misma dirección publicada que Malgrat de Mar II'),
  ('ballenoil', 'Ballenoil Mataró I', 'Camí del Sant Crist 32, 08302 Mataró (Barcelona)', 'Barcelona', 'barcelona', 41.531730, 2.426940, 'web', NULL),
  ('ballenoil', 'Ballenoil Mataró II (Mataró Park)', 'Ronda dels Països Catalans 15, 08304 Mataró (Barcelona)', 'Barcelona', 'barcelona', 41.553631, 2.437743, 'web', NULL),
  ('ballenoil', 'Ballenoil Mataró III - Sant Simó', 'N-2, PK 647, nº 9, 08301 Mataró (Barcelona)', 'Barcelona', 'barcelona', 41.533048, 2.445524, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Montmeló', 'Ronda Predregar 2, 08160 Montmeló (Barcelona)', 'Barcelona', 'barcelona', 41.558184, 2.253593, 'web', NULL),
  ('ballenoil', 'Ballenoil Sabadell', 'Plaça Ramon Llull 11, 08203 Sabadell (Barcelona)', 'Barcelona', 'barcelona', 41.532154, 2.106570, 'web', NULL),
  ('ballenoil', 'Ballenoil Sabadell II', 'Paseo de Tirso de Molina 2, 08203 Sabadell (Barcelona)', 'Barcelona', 'barcelona', 41.533260, 2.118890, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Sant Boi I', 'C/ Riera Roja 27, 08830 Sant Boi de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.329900, 2.046380, 'web', NULL),
  ('ballenoil', 'Ballenoil Sant Boi II', 'Avda. Siglo XXI 49, 08830 Sant Boi de Llobregat (Barcelona)', 'Barcelona', 'barcelona', 41.320265, 2.034259, 'web', NULL),
  ('ballenoil', 'Ballenoil Santa Coloma de Gramenet', 'Carrer de Nàpols 63 (esq. Mozart 24), 08921 Santa Coloma de Gramenet (Barcelona)', 'Barcelona', 'barcelona', 41.454085, 2.217410, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Santa Margarida de Montbui', 'Carrer Córdoba 2, 08710 Santa Margarida de Montbui (Barcelona)', 'Barcelona', 'barcelona', 41.579573, 1.604659, 'web', NULL),
  ('ballenoil', 'Ballenoil Santa Perpètua - La Florida', 'N-152, PK 15,1, 08130 Santa Perpètua de Mogoda (Barcelona)', 'Barcelona', 'barcelona', 41.534324, 2.183580, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Santa Perpètua de Mogoda', 'B-140, PK 5, 08130 Santa Perpètua de Mogoda (Barcelona)', 'Barcelona', 'barcelona', 41.536596, 2.195024, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Terrassa', 'Avinguda de Madrid 15, 08227 Terrassa (Barcelona)', 'Barcelona', 'barcelona', 41.559249, 2.037499, 'web', NULL),
  ('ballenoil', 'Ballenoil Vic II', 'Passeig de la Generalitat 51, 08500 Vic (Barcelona)', 'Barcelona', 'barcelona', 41.924077, 2.253478, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Viladecans', 'Av. del Segle XXI 44, 08840 Viladecans (Barcelona)', 'Barcelona', 'barcelona', 41.317609, 2.031178, 'web', NULL),
  ('ballenoil', 'Ballenoil Albasanz', 'Calle de Albasanz 69, 28037 Madrid (Madrid)', 'Madrid', 'madrid', 40.438160, -3.624503, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcalá de Henares', 'Avenida Daganzo 5, 28806 Alcalá de Henares (Madrid)', 'Madrid', 'madrid', 40.498707, -3.392074, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcalá de Henares II', 'C. Antonio Suárez 4, 28802 Alcalá de Henares (Madrid)', 'Madrid', 'madrid', 40.475786, -3.393107, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcalá de Henares III', 'C/ Varsovia con Vía Complutense, Alcalá de Henares (Madrid)', 'Madrid', 'madrid', 40.497982, -3.341452, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcalá de Henares IV', 'M-300, PK 26,9, 28806 Alcalá de Henares (Madrid)', 'Madrid', 'madrid', 40.470644, -3.374360, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Alcobendas', 'Calle Valgrande 30, 28108 Alcobendas (Madrid)', 'Madrid', 'madrid', 40.539369, -3.653492, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcobendas II', 'Av. de Valdelaparra 3, 28100 Alcobendas (Madrid)', 'Madrid', 'madrid', 40.540031, -3.651162, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcorcón I', 'Calle Laguna 88, 28923 Alcorcón (Madrid)', 'Madrid', 'madrid', 40.332529, -3.818184, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcorcón II (El Cano)', 'Avenida del Tranvía 4 E, 28925 Alcorcón (Madrid)', 'Madrid', 'madrid', 40.393560, -3.839170, 'web', NULL),
  ('ballenoil', 'Ballenoil Alcorcón III - Virgisa', 'Calle Dublín 4, 28922 Alcorcón (Madrid)', 'Madrid', 'madrid', 40.350443, -3.841110, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Algete', 'Calle de la Tejera 4, 28119 Algete (Madrid)', 'Madrid', 'madrid', 40.589165, -3.543450, 'web', NULL),
  ('ballenoil', 'Ballenoil Antonio Machado', 'Antonio Machado, S/N, Moncloa-Aravaca, 28035 Madrid (Madrid)', 'Madrid', 'madrid', 40.470189, -3.717881, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Arganda del Rey I', 'Camino San Martín de la Vega 8, 28500 Arganda del Rey (Madrid)', 'Madrid', 'madrid', 40.303086, -3.456398, 'web', NULL),
  ('ballenoil', 'Ballenoil Arganda del Rey II (Full Oil)', 'Camino San Martín de la Vega 2, 28500 Arganda del Rey (Madrid)', 'Madrid', 'madrid', 40.303750, -3.451670, 'web', NULL),
  ('ballenoil', 'Ballenoil Arganda del Rey III', 'Avenida de Valdearganda 15, 28500 Arganda del Rey (Madrid)', 'Madrid', 'madrid', 40.314718, -3.454375, 'web', NULL),
  ('ballenoil', 'Ballenoil Arganda del Rey IV', 'Travesía de Gata 17, Arganda del Rey (Madrid)', 'Madrid', 'madrid', 40.308257, -3.475934, 'web', NULL),
  ('ballenoil', 'Ballenoil Arroyomolinos', 'C/ de Fresadores 7, 28939 Arroyomolinos (Madrid)', 'Madrid', 'madrid', 40.258046, -3.924331, 'web', NULL),
  ('ballenoil', 'Ballenoil Brunete', 'C. Real de San Sebastián 68, 28690 Brunete (Madrid)', 'Madrid', 'madrid', 40.396517, -3.993783, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Butarque', 'C/ Arroyo de la Bulera 28, 28021 Madrid (Madrid)', 'Madrid', 'madrid', 40.337600, -3.679180, 'web', NULL),
  ('ballenoil', 'Ballenoil Carabanchel', 'C/ Reus 13, 28044 Madrid (Madrid)', 'Madrid', 'madrid', 40.371686, -3.742765, 'web', NULL),
  ('ballenoil', 'Ballenoil Ciudad Lineal-Alcalá', 'C. Alcalá 415, Ciudad Lineal, 28027 Madrid (Madrid)', 'Madrid', 'madrid', 40.437576, -3.638893, 'web', NULL),
  ('ballenoil', 'Ballenoil Collado Villalba I', 'Calle Azuela 73, 28400 Collado Villalba (Madrid)', 'Madrid', 'madrid', 40.625023, -4.025606, 'web', NULL),
  ('ballenoil', 'Ballenoil Collado Villalba II', 'Calle Escofina 3, 28400 Collado Villalba (Madrid)', 'Madrid', 'madrid', 40.629393, -4.019667, 'web', NULL),
  ('ballenoil', 'Ballenoil Colmenar Viejo I', '28770 Colmenar Viejo (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Colmenar Viejo II', '28770 Colmenar Viejo (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Colmenar Viejo III', 'C. Tomillo 4, 28770 Colmenar Viejo (Madrid)', 'Madrid', 'madrid', 40.657812, -3.758466, 'web', NULL),
  ('ballenoil', 'Ballenoil Coslada I', 'Av. del Jarama 17, 28002 Coslada (Madrid)', 'Madrid', 'madrid', 40.432911, -3.535586, 'web', NULL),
  ('ballenoil', 'Ballenoil Coslada III', 'Av. de la Constitución 28, 28821 Coslada (Madrid)', 'Madrid', 'madrid', 40.420574, -3.573895, 'web', NULL),
  ('ballenoil', 'Ballenoil Daganzo de Arriba', 'Calle Franklin 1, 28814 Daganzo de Arriba (Madrid)', 'Madrid', 'madrid', 40.540870, -3.463420, 'web', NULL),
  ('ballenoil', 'Ballenoil Emilio Muñoz', 'Calle Emilio Muñoz 19, 28052 Madrid (Madrid)', 'Madrid', 'madrid', 40.432159, -3.627433, 'web', NULL),
  ('ballenoil', 'Ballenoil Fuencarral', 'M-607, PK 13, Fuencarral-El Pardo, 28049 Madrid (Madrid)', 'Madrid', 'madrid', 40.534098, -3.696111, 'web', NULL),
  ('ballenoil', 'Ballenoil Fuenlabrada I', 'Calle Aneto 1, 28944 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.279065, -3.801673, 'web', NULL),
  ('ballenoil', 'Ballenoil Fuenlabrada II', 'Calle de la Constitución 81, 28946 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.280271, -3.779236, 'web', NULL),
  ('ballenoil', 'Ballenoil Fuenlabrada IV', 'C/ de Móstoles 109, 28942 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.293198, -3.809898, 'web', NULL),
  ('ballenoil', 'Ballenoil Fuenlabrada V', '28944 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.277463, -3.794316, 'web', 'Dirección sin calle en la web; coordenadas tomadas de la ficha web'),
  ('ballenoil', 'Ballenoil Fátima', 'Av. de Ntra. Sra. de Fátima 22, 28047 Madrid (Madrid)', 'Madrid', 'madrid', 40.385549, -3.745407, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Galapagar', 'Calle Carretera de El Escorial 94, 28280 Galapagar (Madrid)', 'Madrid', 'madrid', 40.570933, -3.989713, 'web', NULL),
  ('ballenoil', 'Ballenoil Galapagar II', 'Crta. de Torrelodones 10, 28260 Galapagar (Madrid)', 'Madrid', 'madrid', 40.576835, -3.996243, 'web', NULL),
  ('ballenoil', 'Ballenoil Getafe I', 'Calle Franklin 1, 28906 Getafe (Madrid)', 'Madrid', 'madrid', 40.302845, -3.696020, 'web', NULL),
  ('ballenoil', 'Ballenoil Getafe II', 'Calle Islas Cíes 1, 28905 Getafe (Madrid)', 'Madrid', 'madrid', 40.291553, -3.756895, 'web', NULL),
  ('ballenoil', 'Ballenoil Getafe III', 'Calle Fundidores 24, 28906 Getafe (Madrid)', 'Madrid', 'madrid', 40.311758, -3.699348, 'web', NULL),
  ('ballenoil', 'Ballenoil Getafe IV', 'Ctra. A-42, PK 10300, 28905 Getafe (Madrid)', 'Madrid', 'madrid', 40.293624, -3.748000, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Griñón', 'Av. Humanes 176, 28971 Griñón (Madrid)', 'Madrid', 'madrid', 40.228899, -3.842864, 'web', NULL),
  ('ballenoil', 'Ballenoil Humanes de Madrid', 'Avd. Fuenlabrada 6, 28970 Humanes de Madrid (Madrid)', 'Madrid', 'madrid', 40.260606, -3.819953, 'web', NULL),
  ('ballenoil', 'Ballenoil Las Mercedes Fuembellida', '28013 Madrid (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Las Rejas Geriátrico', 'Madrid - Las Rejas, 28013 Madrid (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'La web solo publica municipio/código postal, sin calle: no hay coordenadas fiables'),
  ('ballenoil', 'Ballenoil Las Rozas', 'Calle del Cabo Rufino Lázaro 7, 28232 Las Rozas de Madrid (Madrid)', 'Madrid', 'madrid', 40.499554, -3.887483, 'web', NULL),
  ('ballenoil', 'Ballenoil Leganés - Arroyo Culebro', '28911 Leganés (Madrid)', 'Madrid', 'madrid', 40.331951, -3.768655, 'web', 'Dirección sin calle en la web; coordenadas tomadas de la ficha web'),
  ('ballenoil', 'Ballenoil Leganés I', 'Calle del Rey Pastor esq. Calle Puig Adam, 28914 Leganés (Madrid)', 'Madrid', 'madrid', 40.328003, -3.743618, 'web', NULL),
  ('ballenoil', 'Ballenoil Leganés II', 'Calle Ángel Nieto 2, 28914 Leganés (Madrid)', 'Madrid', 'madrid', 40.311760, -3.775650, 'web', NULL),
  ('ballenoil', 'Ballenoil Leganés III - La Fortuna', 'C/ Vizcaya 24, La Fortuna, 28917 Leganés (Madrid)', 'Madrid', 'madrid', 40.358690, -3.774510, 'web', NULL),
  ('ballenoil', 'Ballenoil Leganés IV', 'Calle del Trigo 5, 28914 Leganés (Madrid)', 'Madrid', 'madrid', 40.331540, -3.783538, 'web', NULL),
  ('ballenoil', 'Ballenoil Madrid - Aravaca', 'Calle Sagitario 2, 28023 Madrid (Madrid)', 'Madrid', 'madrid', 40.465131, -3.801584, 'web', NULL),
  ('ballenoil', 'Ballenoil Madrid - Aviación', 'Calle Sinfonía 9, 28054 Madrid (Madrid)', 'Madrid', 'madrid', 40.374195, -3.776617, 'web', NULL),
  ('ballenoil', 'Ballenoil Madrid - Barajas', 'Polígono UZP0101 Ensanche Barajas 58, 28042 Madrid (Madrid)', 'Madrid', 'madrid', 40.465370, -3.595152, 'web', NULL),
  ('ballenoil', 'Ballenoil Madrid - Las Rosas', 'Calle de Versalles 17, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.415662, -3.619416, 'web', NULL),
  ('ballenoil', 'Ballenoil Majadahonda', 'Calle Cereza 4, 28222 Majadahonda (Madrid)', 'Madrid', 'madrid', 40.456390, -3.871150, 'web', NULL),
  ('ballenoil', 'Ballenoil Mejorada del Campo', 'Calle Esla 2, 28840 Mejorada del Campo (Madrid)', 'Madrid', 'madrid', 40.389101, -3.493887, 'web', 'Marcada como inaccesible por reforma en la web'),
  ('ballenoil', 'Ballenoil Móstoles I', 'Calle Alfonso XII 20, 28934 Móstoles (Madrid)', 'Madrid', 'madrid', 40.314604, -3.868707, 'web', NULL),
  ('ballenoil', 'Ballenoil Móstoles II', 'Calle La Fragua 16, 28933 Móstoles (Madrid)', 'Madrid', 'madrid', 40.341584, -3.860089, 'web', NULL),
  ('ballenoil', 'Ballenoil Móstoles III', 'Avda. Iker Casillas esq. Benito Pérez Galdós, 28935 Móstoles (Madrid)', 'Madrid', 'madrid', 40.325800, -3.885010, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud). Marcada como inaccesible por reforma en la web'),
  ('ballenoil', 'Ballenoil Móstoles VI - Aidater I', 'Av. de Portugal 80, 28934 Móstoles (Madrid)', 'Madrid', 'madrid', 40.320849, -3.876167, 'web', NULL),
  ('ballenoil', 'Ballenoil Móstoles VII - Aidater II', 'Av. de Portugal 79, 28934 Móstoles (Madrid)', 'Madrid', 'madrid', 40.320207, -3.875533, 'web', NULL),
  ('ballenoil', 'Ballenoil Móstoles VIII', 'C/ Puerto Cotos 25, 28935 Móstoles (Madrid)', 'Madrid', 'madrid', 40.350064, -3.874544, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Navalcarnero', 'Calle Mina del Cotorro, S/N, 28600 Navalcarnero (Madrid)', 'Madrid', 'madrid', 40.290757, -3.994351, 'web', NULL),
  ('ballenoil', 'Ballenoil Navalcarnero II', 'C. de Zacarías 20, 28600 Navalcarnero (Madrid)', 'Madrid', 'madrid', 40.295108, -4.009997, 'web', NULL),
  ('ballenoil', 'Ballenoil Ofelia Nieto', 'C. de Ofelia Nieto 65, Moncloa-Aravaca, 28039 Madrid (Madrid)', 'Madrid', 'madrid', 40.459910, -3.709911, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Orovilla', 'Avenida de Orovilla 22, 28041 Madrid (Madrid)', 'Madrid', 'madrid', 40.365835, -3.692533, 'web', NULL),
  ('ballenoil', 'Ballenoil Paracuellos de Jarama', 'Camino San Miguel, Parcela 1B, 28860 Paracuellos de Jarama (Madrid)', 'Madrid', 'madrid', 40.505603, -3.530211, 'web', NULL),
  ('ballenoil', 'Ballenoil Parla I', 'C/ Toledo c/v Avda. Ronda, 28981 Parla (Madrid)', 'Madrid', 'madrid', 40.228092, -3.778615, 'web', NULL),
  ('ballenoil', 'Ballenoil Parla II', 'Calle Real 125, 28981 Parla (Madrid)', 'Madrid', 'madrid', 40.249170, -3.766760, 'web', NULL),
  ('ballenoil', 'Ballenoil Parla III', 'Av. Cerro del Rubal 7, 28983 Parla (Madrid)', 'Madrid', 'madrid', 40.237347, -3.747770, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Pelayos de la Presa', 'Pelayos de la Presa (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'Sin dirección ni coordenadas publicadas en la web (posible estación pendiente de apertura)'),
  ('ballenoil', 'Ballenoil Pinto', 'Calle Alcotanes 5, 28320 Pinto (Madrid)', 'Madrid', 'madrid', 40.253272, -3.711639, 'web', NULL),
  ('ballenoil', 'Ballenoil Pinto II', 'Ctra. San Martín de la Vega 8, Km 0,700, 28320 Pinto (Madrid)', 'Madrid', 'madrid', 40.228809, -3.643049, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Pozuelo de Alarcón', 'Carretera Majadahonda (M-515), Km 2, 28223 Pozuelo de Alarcón (Madrid)', 'Madrid', 'madrid', 40.440722, -3.840602, 'web', NULL),
  ('ballenoil', 'Ballenoil Rivas Vaciamadrid I', 'Calle de la Fundición 19, 28522 Rivas-Vaciamadrid (Madrid)', 'Madrid', 'madrid', 40.353420, -3.542090, 'web', NULL),
  ('ballenoil', 'Ballenoil Rivas Vaciamadrid II', 'Calle Cincel 2, 28522 Rivas-Vaciamadrid (Madrid)', 'Madrid', 'madrid', 40.348171, -3.542965, 'web', NULL),
  ('ballenoil', 'Ballenoil Rivas Vaciamadrid III', 'Avenida Pablo Iglesias 78, 28522 Rivas-Vaciamadrid (Madrid)', 'Madrid', 'madrid', 40.349543, -3.528763, 'web', NULL),
  ('ballenoil', 'Ballenoil Robledo de Chavela', 'Plaza de José Antonio 2, 28294 Robledo de Chavela (Madrid)', 'Madrid', 'madrid', 40.500920, -4.238100, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Ronda', 'Ronda de Segovia 37, 28005 Madrid (Madrid)', 'Madrid', 'madrid', 40.410294, -3.717470, 'web', NULL),
  ('ballenoil', 'Ballenoil San Agustín de Guadalix', 'Avda. de Madrid 47, 28750 San Agustín del Guadalix (Madrid)', 'Madrid', 'madrid', 40.690836, -3.609333, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas. Marcada como inaccesible por reforma en la web'),
  ('ballenoil', 'Ballenoil San Agustín de Guadalix II', '28750 San Agustín del Guadalix (Madrid)', 'Madrid', 'madrid', 40.678847, -3.616306, 'web', 'Dirección sin calle en la web; coordenadas tomadas de la ficha web'),
  ('ballenoil', 'Ballenoil San Sebastián de los Reyes', 'Avenida de los Pirineos 21, 28703 San Sebastián de los Reyes (Madrid)', 'Madrid', 'madrid', 40.551932, -3.610245, 'web', NULL),
  ('ballenoil', 'Ballenoil San Sebastián de los Reyes II', 'Paseo de Europa 22, 28703 San Sebastián de los Reyes (Madrid)', 'Madrid', 'madrid', 40.545859, -3.622769, 'web', NULL),
  ('ballenoil', 'Ballenoil San Sebastián de los Reyes III', 'Avenida de Tenerife 10, 28703 San Sebastián de los Reyes (Madrid)', 'Madrid', 'madrid', 40.559331, -3.622703, 'web', NULL),
  ('ballenoil', 'Ballenoil San Sebastián de los Reyes IV', 'Avda. Matapiñonera 20, 28703 San Sebastián de los Reyes (Madrid)', 'Madrid', 'madrid', 40.545841, -3.617833, 'web', NULL),
  ('ballenoil', 'Ballenoil Santa Genoveva', 'Calle de Santa Genoveva 28, 28017 Madrid (Madrid)', 'Madrid', 'madrid', 40.424537, -3.649205, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Talamanca de Jarama', 'Avenida Chopera 2, 28160 Talamanca de Jarama (Madrid)', 'Madrid', 'madrid', 40.737712, -3.509965, 'web', NULL),
  ('ballenoil', 'Ballenoil Talamanca de Jarama III', 'Ctra. M-103, PK 34,5, 28160 Talamanca de Jarama (Madrid)', 'Madrid', 'madrid', 40.745470, -3.512758, 'aproximada', 'Coordenadas aproximadas (carretera/km o número no localizable con exactitud)'),
  ('ballenoil', 'Ballenoil Torrejón IV', 'Torrejón de Ardoz (Madrid)', 'Madrid', 'madrid', NULL, NULL, 'sin', 'Sin dirección ni coordenadas publicadas en la web (posible estación pendiente de apertura)'),
  ('ballenoil', 'Ballenoil Torrejón de Ardoz', 'Calle Olmo 1, 28850 Torrejón de Ardoz (Madrid)', 'Madrid', 'madrid', 40.446854, -3.457243, 'web', NULL),
  ('ballenoil', 'Ballenoil Torrejón de Ardoz II', 'Calle Charco de los Peces 2, 28850 Torrejón de Ardoz (Madrid)', 'Madrid', 'madrid', 40.446144, -3.466167, 'web', NULL),
  ('ballenoil', 'Ballenoil Torrejón de Ardoz III', 'Calle Circunvalación 24, 28850 Torrejón de Ardoz (Madrid)', 'Madrid', 'madrid', 40.449576, -3.463016, 'web', NULL),
  ('ballenoil', 'Ballenoil Tres Cantos', 'Avenida de la Industria 44, 28760 Tres Cantos (Madrid)', 'Madrid', 'madrid', 40.614219, -3.701196, 'web', NULL),
  ('ballenoil', 'Ballenoil Valdebernardo I', 'Av. de la Democracia 41, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.400545, -3.616131, 'web', NULL),
  ('ballenoil', 'Ballenoil Valdebernardo II', 'Av. de la Democracia 62, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.399722, -3.615835, 'web', NULL),
  ('ballenoil', 'Ballenoil Valdemoro', 'Av. de las Morcilleras 1, 28341 Valdemoro (Madrid)', 'Madrid', 'madrid', 40.199851, -3.672306, 'web', NULL),
  ('ballenoil', 'Ballenoil Valdemoro II', 'Av. de Andalucía 7, 28340 Valdemoro (Madrid)', 'Madrid', 'madrid', 40.189556, -3.673523, 'geocodificada', 'Coordenadas obtenidas por geocodificación (OpenStreetMap) de la dirección; la web no las publica o son erróneas'),
  ('ballenoil', 'Ballenoil Vallecas I', 'Calle Cerro del Murmullo 9, 28031 Madrid (Madrid)', 'Madrid', 'madrid', 40.365227, -3.584586, 'web', NULL),
  ('ballenoil', 'Ballenoil Vallecas II', 'Camino del Pozo del Tío Raimundo 7, 28031 Madrid (Madrid)', 'Madrid', 'madrid', 40.373312, -3.649839, 'web', NULL),
  ('ballenoil', 'Ballenoil Vallecas III', 'Calle G 13, 28031 Madrid (Madrid)', 'Madrid', 'madrid', 40.383430, -3.629748, 'web', NULL),
  ('ballenoil', 'Ballenoil Vallecas IV', 'Camino de las Hormigueras 153, 28031 Madrid (Madrid)', 'Madrid', 'madrid', 40.375727, -3.639367, 'web', NULL),
  ('ballenoil', 'Ballenoil Vicálvaro', 'Carretera Vicálvaro a la Estación de O''Donnell, km 22, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.405176, -3.590854, 'web', NULL),
  ('ballenoil', 'Ballenoil Vicálvaro III', 'Carretera Vicálvaro a la Estación de O''Donnell 21, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.405549, -3.590601, 'web', NULL),
  ('ballenoil', 'Ballenoil Villalbilla', 'Avenida de la Urba 3, 28810 Villalbilla (Madrid)', 'Madrid', 'madrid', 40.434656, -3.280832, 'web', NULL),
  ('ballenoil', 'Ballenoil Villanueva de la Cañada', 'Calle Sierra de Guadarrama 10, 28691 Villanueva de la Cañada (Madrid)', 'Madrid', 'madrid', 40.437811, -4.010985, 'web', NULL),
  ('ballenoil', 'Ballenoil Villaverde I', 'Calle del Valle de Tobalina 24, 28021 Madrid (Madrid)', 'Madrid', 'madrid', 40.335977, -3.714985, 'web', NULL),
  ('ballenoil', 'Ballenoil Villaverde II', 'Carretera de Carabanchel a Villaverde 89, 28041 Madrid (Madrid)', 'Madrid', 'madrid', 40.353724, -3.710365, 'web', NULL),
  ('ballenoil', 'Ballenoil Villaverde III', 'Calle de la Resina 4, 28021 Madrid (Madrid)', 'Madrid', 'madrid', 40.336270, -3.694438, 'web', NULL),
  ('ballenoil', 'Ballenoil Villaverde IV', 'Calle de la Acebeda I, 28021 Madrid (Madrid)', 'Madrid', 'madrid', 40.336662, -3.719977, 'web', NULL),
  ('ballenoil', 'Ballenoil Villaviciosa de Odón', 'Avenida Quitapesares 33, 28670 Villaviciosa de Odón (Madrid)', 'Madrid', 'madrid', 40.350179, -3.895206, 'web', NULL)
ON CONFLICT (proveedor, nombre) DO NOTHING;

COMMIT;
