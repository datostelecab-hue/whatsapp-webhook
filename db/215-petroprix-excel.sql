-- ============================================================
-- 215 · LOS REPOSTAJES DE PETROPRIX POR EXCEL, QUIÉN LLEVABA EL COCHE EN EL BOT
--       Y LA BOYA QUE SOLO MIRA LO QUE FALTA
-- ============================================================
-- Camilo, 23/10/2026: «Hay malas noticias con Petroprix y es que ellos no mandan
-- correos por cada repostaje, entonces toca crear en el módulo un importador de
-- excel […] las direcciones siempre llegan exactamente como ves […] no viene
-- nombre de quién hizo el repostaje […] pero sí vamos a ver quién fue el último
-- en cogerlo en BOLT y en el bot de WhatsApp». Y, de la auditoría: «si subió
-- tanto % por encima no importa, la auditoría va por debajo».
--
-- CINCO COSAS:
--
--   · Las 30 GASOLINERAS de Petroprix que salen en su Excel (28 de la Comunidad
--     de Madrid, Guadalajara y Benalmádena), con las coordenadas decididas el
--     23/10/2026 (Scripts de análisis/petroprix-gasolineras): 29 de la web de
--     Petroprix (`web`, a 2-56 m de donde paran nuestros coches según Mapon) y
--     Parla 2 de la foto aérea, confirmada por 4 coches nuestros a 5 m
--     (`validada`). Guadalajara y Benalmádena, sin sede: cat_sede solo tiene
--     Madrid y Barcelona.
--
--   · Su TEXTO EXACTO del Excel como alias (gasolinera_alias, tipo 'texto'). La
--     celda «Gasolinera» trae el nombre, un salto de línea y la dirección con su
--     código postal, siempre escrita igual y con sus rarezas («Leganes 2 » con
--     espacio, «C\ Plasencia», «CantueÃ±a» mal codificado). Por palabras,
--     «Alcobendas» y «Alcobendas 2» se confundirían; por el texto, siempre
--     encajan. La clave es el texto con lo mínimo normalizado
--     (combustible.gasolinera.textoExacto: saltos de línea, espacios de los
--     bordes y repetidos), sin tocar la mala codificación. Los alias de antes
--     (los puestos a mano, por palabras) pasan a tipo 'palabras'.
--
--   · De dónde viene cada repostaje (`origen`: correo o excel) y QUÉ IMPORTACIÓN
--     lo trajo (`repostaje_importacion`: fichero, quién, cuándo, filas, nuevas,
--     ya estaban, con error). Y lo que trae el Excel y el correo no: el método
--     de pago, el «Vehículo» de Petroprix y la fila tal cual (el combustible va
--     a `carburante`, como el del correo).
--
--     UNA FILA DEL EXCEL ES UN REPOSTAJE, SIN CORREO. db/212 es «una fila por
--     correo», con el Message-ID o el UID del buzón como candado. Una fila del
--     Excel no tiene ni lo uno ni lo otro: entra con `origen = 'excel'`, sin
--     buzón, y su candado es `excel_clave`, la huella de su contenido (la hora
--     con segundos tal cual la escribe el Excel, la matrícula normalizada, los
--     litros y el importe). Petroprix no da un identificador y Camilo bajará
--     exportaciones que se solapan: la misma fila en dos ficheros da la misma
--     clave y no se duplica. El nombre de la gasolinera, el pago y «Vehículo» no
--     entran en la clave a propósito: si Petroprix corrige la codificación de
--     «CantueÃ±a», la fila sigue siendo la misma. `recibido_at` es, para el
--     Excel, cuándo se importó.
--
--   · QUIÉN LLEVABA EL COCHE EN EL BOT (bot_*): el turno abierto en el bot de
--     WhatsApp con esa matrícula a esa hora (fichaje_turno, db/125), o el último
--     que se cerró antes, aunque esa persona no se conectara a BOLT. Para los de
--     Petroprix (no traen nombre) y para los de Ballenoil.
--
--   · LA BOYA SOLO CUENTA LO QUE FALTA. `boya_error_pct` era |boya − litros| /
--     litros; desde aquí es el DÉFICIT: max(0, litros − boya) / litros. Si el
--     depósito subió lo pagado o más, es 0 % (verde): el aforador de algunos
--     coches marca 3-4 L de más (el 7909LRJ) y eso no es un problema de nadie.
--     Se rehace aquí desde lo medido (boya_litros y litros), que no se toca; y
--     la frase de los mínimos que ya pasaban de lo pagado («no verde») cambia,
--     porque ahora sí son verdes: como poco entró lo pagado.
--
-- No se edita ninguna migración anterior (docs/nucleo/Migraciones.md).

BEGIN;

-- ── Las gasolineras: el comentario de «validada» ────────────────────────────
-- Parla 2 no la puso «quien conoce la gasolinera»: es un punto sobre la foto
-- aérea que confirman nuestros coches. Lo mismo que db/214 dijo de Clot, más
-- ancho.
COMMENT ON COLUMN gasolinera.precision IS
  'web = coordenadas del proveedor; validada = puestas a mano (por quien conoce la gasolinera, o sobre la foto aérea) y confirmadas por donde paran nuestros coches; geocodificada = sacadas de la dirección (OpenStreetMap); aproximada = carretera o número no localizable; sin = no hay coordenadas (no se puede medir la distancia)';

-- ── Los alias: por palabras (a mano) o por el texto exacto (Petroprix) ──────
ALTER TABLE gasolinera_alias ADD COLUMN IF NOT EXISTS tipo VARCHAR(8) NOT NULL DEFAULT 'palabras';
ALTER TABLE gasolinera_alias DROP CONSTRAINT IF EXISTS ck_gasolinera_alias_tipo;
ALTER TABLE gasolinera_alias ADD CONSTRAINT ck_gasolinera_alias_tipo CHECK (tipo IN ('palabras', 'texto'));
DROP INDEX IF EXISTS ux_gasolinera_alias;
CREATE UNIQUE INDEX IF NOT EXISTS ux_gasolinera_alias ON gasolinera_alias (proveedor, tipo, estacion_clave);
COMMENT ON COLUMN gasolinera_alias.tipo IS
  'palabras = estacion_clave es el nombre normalizado por palabras (combustible.gasolinera.normalizar), puesto a mano en la ficha; texto = estacion_clave es el texto exacto de la celda del Excel (combustible.gasolinera.textoExacto), cargado en db/215';

-- ── Las 30 gasolineras de Petroprix del Excel (23/10/2026) ─────────────────
-- Las observaciones dicen de dónde sale cada punto y a cuántos metros lo
-- confirman Mapon, OpenStreetMap y el Ministerio.
INSERT INTO gasolinera (proveedor, nombre, direccion, provincia, sede, lat, lng, precision, observaciones) VALUES
  ('petroprix', 'Petroprix Vicálvaro', 'Calle Herce, 41, 28032 Madrid (Madrid)', 'Madrid', 'madrid', 40.403551, -3.61565, 'web',
   'La web de Petroprix, a 37 m del centro de las paradas de Mapon (11 repostajes de 11 coches); OSM la confirma a 31 m; el Ministerio, a 9 m de la web y a 35 m de Mapon.'),
  ('petroprix', 'Petroprix Carabanchel', 'Calle Secoya, 12, 28044 Madrid (Madrid)', 'Madrid', 'madrid', 40.370721, -3.74356, 'web',
   'La web de Petroprix, a 8 m del centro de las paradas de Mapon (10 repostajes de 10 coches); OSM la confirma a 6 m; el Ministerio, a 7 m de la web y a 4 m de Mapon.'),
  ('petroprix', 'Petroprix Alcobendas 2', 'Calle Valgrande, 11, 28108 Alcobendas (Madrid)', 'Madrid', 'madrid', 40.536616, -3.650073, 'web',
   'La web de Petroprix, a 56 m del centro de las paradas de Mapon (12 repostajes de 12 coches); OSM la confirma a 16 m; el Ministerio, a 37 m de la web y a 20 m de Mapon. Es la de la web que más lejos queda de Mapon: los 12 coches paran un poco al sureste del pin, más cerca del punto del Ministerio. Da igual para el verde de 700 m.'),
  ('petroprix', 'Petroprix Fuenlabrada - Constitución', 'Calle de la Constitución, 100, 28946 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.279974, -3.782395, 'web',
   'La web de Petroprix, a 4 m del centro de las paradas de Mapon (11 repostajes de 11 coches); OSM la confirma a 2 m; el Ministerio, a 22 m de la web y a 18 m de Mapon.'),
  ('petroprix', 'Petroprix San Sebastián de los Reyes', 'Avenida Fuente Nueva, 18, 28703 San Sebastián de los Reyes (Madrid)', 'Madrid', 'madrid', 40.54759, -3.612451, 'web',
   'La web de Petroprix, a 3 m del centro de las paradas de Mapon (12 repostajes de 12 coches); OSM la confirma a 2 m; el Ministerio, a 9 m de la web y a 8 m de Mapon. CP: el Excel y Mapon dicen 28703; el Ministerio, 28700.'),
  ('petroprix', 'Petroprix Móstoles 2', 'Calle Yolanda González, 5, 28938 Móstoles (Madrid)', 'Madrid', 'madrid', 40.311557, -3.872245, 'web',
   'La web de Petroprix, a 7 m del centro de las paradas de Mapon (11 repostajes de 11 coches); OSM la confirma a 15 m; el Ministerio, a 14 m de la web y a 7 m de Mapon.'),
  ('petroprix', 'Petroprix Madrid - Av. Aviación', 'Avenida de la Aviación, 22, 28054 Madrid (Madrid)', 'Madrid', 'madrid', 40.374453, -3.775137, 'web',
   'La web de Petroprix, a 20 m del centro de las paradas de Mapon (11 repostajes de 11 coches); OSM la confirma a 19 m; el Ministerio, a 24 m de la web y a 15 m de Mapon. El Excel y la web no traen número ni IDEESS: es la 16441 del Ministerio (Avenida Aviación, 22 28054), a 24 m de la web y en la misma calle y CP.'),
  ('petroprix', 'Petroprix Alcorcón', 'Calle Paraguay esquina Avenida de América, s/n, 28922 Alcorcón (Madrid)', 'Madrid', 'madrid', 40.358813, -3.828697, 'web',
   'La web de Petroprix, a 8 m del centro de las paradas de Mapon (12 repostajes de 12 coches); OSM la confirma a 9 m; el Ministerio, a 8 m de la web y a 8 m de Mapon. CP: el del Ministerio (28095) no es de Alcorcón; el del Excel (28922) lo confirman OSM y Mapon, que la ponen en Avenida de América, 20.'),
  ('petroprix', 'Petroprix Leganés', 'Calle Vizcaya, 17, 28917 Leganés (Madrid)', 'Madrid', 'madrid', 40.357568, -3.773839, 'web',
   'La web de Petroprix, a 13 m del centro de las paradas de Mapon (11 repostajes de 10 coches); OSM la confirma a 18 m; el Ministerio, a 17 m de la web y a 20 m de Mapon.'),
  ('petroprix', 'Petroprix Parla', 'Avenida de Ronda, s/n, 28981 Parla (Madrid)', 'Madrid', 'madrid', 40.22942, -3.782246, 'web',
   'La web de Petroprix, a 11 m del centro de las paradas de Mapon (12 repostajes de 6 coches); OSM la confirma a 10 m; el Ministerio, a 58 m de la web y a 51 m de Mapon. CP: el Excel y OSM dicen 28981; el Ministerio, 28980.'),
  ('petroprix', 'Petroprix Getafe', 'Calle Herreros, 1, 28906 Getafe (Madrid)', 'Madrid', 'madrid', 40.309293, -3.701254, 'web',
   'La web de Petroprix, a 9 m del centro de las paradas de Mapon (11 repostajes de 10 coches); OSM la confirma a 15 m; el Ministerio, a 5 m de la web y a 14 m de Mapon. CP: el Excel, OSM y Mapon dicen 28906; el Ministerio, 28909.'),
  ('petroprix', 'Petroprix Torrejón', 'Avenida de la Constitución, 287, 28850 Torrejón de Ardoz (Madrid)', 'Madrid', 'madrid', 40.467675, -3.434176, 'web',
   'La web de Petroprix, a 25 m del centro de las paradas de Mapon (10 repostajes de 10 coches); OSM la confirma a 15 m; el Ministerio, a 11 m de la web y a 16 m de Mapon.'),
  ('petroprix', 'Petroprix San Fernando de Henares 1', 'Avenida de los Artesanos, 7, 28830 San Fernando de Henares (Madrid)', 'Madrid', 'madrid', 40.443425, -3.499359, 'web',
   'La web de Petroprix, a 38 m del centro de las paradas de Mapon (10 repostajes de 10 coches); OSM la confirma a 35 m; el Ministerio, a 39 m de la web y a 6 m de Mapon.'),
  ('petroprix', 'Petroprix Alcalá de Henares', 'Calle Isaac Newton, 33, 28806 Alcalá de Henares (Madrid)', 'Madrid', 'madrid', 40.494166, -3.391144, 'web',
   'La web de Petroprix, a 20 m del centro de las paradas de Mapon (11 repostajes de 10 coches); OSM la confirma a 25 m; el Ministerio, a 19 m de la web y a 17 m de Mapon. Número: el Excel, la web y Mapon dicen 33; el Ministerio, 155. Las tres fuentes caen en el mismo sitio: es la misma estación.'),
  ('petroprix', 'Petroprix Majadahonda', 'Calle El Barbero de Sevilla, 2 (parcela 2B), 28222 Majadahonda (Madrid)', 'Madrid', 'madrid', 40.450277, -3.882061, 'web',
   'La web de Petroprix, a 16 m del centro de las paradas de Mapon (12 repostajes de 12 coches); OSM la confirma a 15 m; el Ministerio, a 52 m de la web y a 45 m de Mapon. CP: el Excel y OSM dicen 28222; el Ministerio, 28220; Mapon, 28221. Se deja el del Excel.'),
  ('petroprix', 'Petroprix Leganés 2', 'Calle Ricardo Tormo, 6, 28914 Leganés (Madrid)', 'Madrid', 'madrid', 40.315001, -3.760646, 'web',
   'La web de Petroprix, a 12 m del centro de las paradas de Mapon (10 repostajes de 10 coches); OSM la confirma a 28 m; el Ministerio, a 13 m de la web y a 23 m de Mapon.'),
  ('petroprix', 'Petroprix Rivas - Vaciamadrid', 'Calle del Cincel, 2, 28522 Rivas-Vaciamadrid (Madrid)', 'Madrid', 'madrid', 40.349126, -3.542626, 'web',
   'La web de Petroprix, a 2 m del centro de las paradas de Mapon (12 repostajes de 6 coches); OSM la confirma a 2 m; el Ministerio, a 68 m de la web y a 66 m de Mapon.'),
  ('petroprix', 'Petroprix Alcobendas', 'Calle del Marqués de la Valdavia, 132, 28100 Alcobendas (Madrid)', 'Madrid', 'madrid', 40.546704, -3.651594, 'web',
   'La web de Petroprix, a 7 m del centro de las paradas de Mapon (11 repostajes de 11 coches); OSM la confirma a 2 m; el Ministerio, a 28 m de la web y a 33 m de Mapon.'),
  ('petroprix', 'Petroprix Móstoles', 'Calle Plasencia, 29, 28935 Móstoles (Madrid)', 'Madrid', 'madrid', 40.352221, -3.875243, 'web',
   'La web de Petroprix, a 5 m del centro de las paradas de Mapon (12 repostajes de 12 coches); OSM la confirma a 5 m; el Ministerio, a 4 m de la web y a 6 m de Mapon.'),
  ('petroprix', 'Petroprix Fuenlabrada 3', 'Calle de Móstoles, 83, 28942 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.295285, -3.813196, 'web',
   'La web de Petroprix, a 32 m del centro de las paradas de Mapon (12 repostajes de 6 coches); OSM la confirma a 17 m; el Ministerio, a 13 m de la web y a 22 m de Mapon.'),
  ('petroprix', 'Petroprix Arganda del Rey', 'Avenida de Madrid, 138, 28500 Arganda del Rey (Madrid)', 'Madrid', 'madrid', 40.312461, -3.486562, 'web',
   'La web de Petroprix, a 5 m del centro de las paradas de Mapon (12 repostajes de 4 coches); OSM la confirma a 2 m; el Ministerio, a 46 m de la web y a 51 m de Mapon. Número: el Excel dice 138; el Ministerio, s/n; Mapon, 136.'),
  ('petroprix', 'Petroprix Fuenlabrada - Avda Cantueña', 'Avenida de la Cantueña, 8, 28947 Fuenlabrada (Madrid)', 'Madrid', 'madrid', 40.272078, -3.763922, 'web',
   'La web de Petroprix, a 4 m del centro de las paradas de Mapon (12 repostajes de 7 coches); OSM la confirma a 14 m; el Ministerio, a 11 m de la web y a 14 m de Mapon. El Excel trae «CantueÃ±a» mal codificado y un espacio al final, igual que la web: el importador casa con el texto tal cual.'),
  ('petroprix', 'Petroprix Valdemoro', 'Avenida de Madrid, 5, 28342 Valdemoro (Madrid)', 'Madrid', 'madrid', 40.207611, -3.684588, 'web',
   'La web de Petroprix, a 8 m del centro de las paradas de Mapon (12 repostajes de 9 coches); OSM la confirma a 21 m; el Ministerio, a 462 m de la web y a 456 m de Mapon. El Ministerio la pone 460 m al sur y con el CP 28340: está mal. La web, OSM, la foto aérea de 2025 (marquesina dentro del recinto de OSM) y 9 coches nuestros (a 8 m) dicen lo mismo. A 165 m hay otra estación que NO es de Petroprix («GASOLINERA VALDEMORO», Avenida Madrid, 6, IDEESS 13678).'),
  ('petroprix', 'Petroprix Parla 2', 'Bulevar John Deere, s/n, 28984 Parla (Madrid)', 'Madrid', 'madrid', 40.24502, -3.78464, 'validada',
   'Ninguna oficial cae sobre la gasolinera. La web pone el pin 177 m al este, en el aparcamiento de enfrente, y el Ministerio, unos 380 m al oeste, en la mediana del bulevar. OSM no la tiene. En la foto aérea de Esri del 11/09/2025 se ve la marquesina con su sombra en la esquina (en el PNOA de julio de 2023 era un solar), y las paradas de 4 coches nuestros (10 repostajes, 9 con parada) caen a 5 m, todas a menos de 13 m de su centro y con la dirección de Mapon «Polígono UE-1 M2 Sector, 2, 28984 Parla». Dos pruebas independientes a 5 m: se usa el punto de la foto (no el centro de Mapon, para no medir a los coches contra sí mismos). Precisión «validada» porque la confirman nuestros coches, no un tercero; si Camilo no la da por buena, «aproximada» (saldría con «≈»). El Ministerio la llama «Avenida John Deere, 5 28983»; el Excel y la web, «Bulevar John Deere, s/n 28984», el CP que da también Mapon.'),
  ('petroprix', 'Petroprix Collado Villalba', 'Avenida Juan Carlos I, 24 bis, 28400 Collado Villalba (Madrid)', 'Madrid', 'madrid', 40.634004, -4.004989, 'web',
   'La web de Petroprix, a 5 m del centro de las paradas de Mapon (5 repostajes de 4 coches); OSM la confirma a 1 m; el Ministerio, a 5 m de la web y a 10 m de Mapon.'),
  ('petroprix', 'Petroprix Colmenar Viejo', 'Avenida de los Reyes, 2, 28770 Colmenar Viejo (Madrid)', 'Madrid', 'madrid', 40.65689, -3.75445, 'web',
   'La web de Petroprix, a 50 m del centro de las paradas de Mapon (3 repostajes de 3 coches); OSM la confirma a 18 m; el Ministerio, a 4 m de la web y a 47 m de Mapon. Poca muestra (3 coches). Los tres pararon a 40-55 m al norte del pin, en «Av. de los Reyes, 2/2D»; el 9528MMX paró de 22:31:08 a 22:33:58 y la hora del Excel (22:36:05) le pilla ya andando, a 241 m (mirado en crudo).'),
  ('petroprix', 'Petroprix Mejorada del Campo', 'Calle Portugal, 30, 28840 Mejorada del Campo (Madrid)', 'Madrid', 'madrid', 40.387525, -3.489185, 'web',
   'La web de Petroprix, a 25 m del centro de las paradas de Mapon (2 repostajes de 1 coche); OSM la confirma a 4 m; el Ministerio, a 41 m de la web y a 29 m de Mapon. Poca muestra: 2 repostajes, los dos del 8997LDK el 01/10, parado a 25 m del pin.'),
  ('petroprix', 'Petroprix Alpedrete', 'Calle Puerta de Abajo, 57, 28430 Alpedrete (Madrid)', 'Madrid', 'madrid', 40.660619, -4.012783, 'web',
   'La web de Petroprix, a 26 m del centro de las paradas de Mapon (1 repostaje de 1 coche); OSM la confirma a 19 m; el Ministerio, a 9 m de la web y a 24 m de Mapon. Un solo repostaje (0261MFX, 17/10), parado a 26 m del pin: confirma, pero no da centro propio.'),
  ('petroprix', 'Petroprix Guadalajara', 'Calle Francisco Aritio, 97, 19004 Guadalajara (Guadalajara)', 'Guadalajara', NULL, 40.638769, -3.186263, 'web',
   'La web de Petroprix, a 9 m del centro de las paradas de Mapon (1 repostaje de 1 coche); OSM la confirma a 12 m; el Ministerio, a 6 m de la web y a 2 m de Mapon. Fuera de la Comunidad de Madrid. Un solo repostaje (0261MFX, 16/10), parado a 9 m del pin; las tres fuentes de internet, a menos de 15 m.'),
  ('petroprix', 'Petroprix Benalmádena', 'Urbanización La Leala, 22, 29631 Benalmádena (Málaga)', 'Málaga', NULL, 36.606419, -4.529226, 'web',
   'La web de Petroprix, confirmada por OSM a 8 m y por el Ministerio a 26 m. Fuera de Madrid (Málaga); Petroprix escribe «Avd  La Leala» y el Ministerio «Urbanización La Leala, 22». Mapon no la puede confirmar: el único repostaje (8512LDS, 02/10 14:19, 11,70 L pagados en efectivo) es de un coche de la sede de Barcelona que estaba parado en la Granvia de l''Hospitalet, 136 de 12:57 a 14:56 (mirado en crudo), a 779 km.')
ON CONFLICT (proveedor, nombre) DO NOTHING;

-- ── Su texto exacto del Excel, como alias: así siempre encajan ──────────────
-- La clave, con textoExacto; «estacion», la celda tal cual (con el espacio del
-- final si lo trae).
INSERT INTO gasolinera_alias (proveedor, tipo, estacion_clave, estacion, gasolinera_id)
SELECT 'petroprix', 'texto', t.clave, t.estacion, g.id
  FROM (VALUES
  ('Vicálvaro' || chr(10) || 'Calle Herce 41 28032', 'Vicálvaro' || chr(10) || 'Calle Herce 41 28032', 'Petroprix Vicálvaro'),
  ('Carabanchel' || chr(10) || 'Calle Secoya, 12 28044', 'Carabanchel' || chr(10) || 'Calle Secoya, 12 28044', 'Petroprix Carabanchel'),
  ('Alcobendas 2' || chr(10) || 'Calle Valgrande 11 28108', 'Alcobendas 2' || chr(10) || 'Calle Valgrande 11 28108', 'Petroprix Alcobendas 2'),
  ('Fuenlabrada - Constitucion' || chr(10) || 'C/ Constitucion 100 28946', 'Fuenlabrada - Constitucion' || chr(10) || 'C/ Constitucion 100 28946', 'Petroprix Fuenlabrada - Constitución'),
  ('San Sebastian de los Reyes' || chr(10) || 'Avd Fuente Nueva 18 28703', 'San Sebastian de los Reyes' || chr(10) || 'Avd Fuente Nueva 18 28703', 'Petroprix San Sebastián de los Reyes'),
  ('Móstoles 2' || chr(10) || 'C. Yolanda González, 5 28938', 'Móstoles 2' || chr(10) || 'C. Yolanda González, 5 28938', 'Petroprix Móstoles 2'),
  ('Madrid - Av. Aviación' || chr(10) || 'Avda. de la Aviación 28054', 'Madrid - Av. Aviación' || chr(10) || 'Avda. de la Aviación 28054', 'Petroprix Madrid - Av. Aviación'),
  ('Alcorcón' || chr(10) || 'C/ Paraguay Esquina Avenida de America 28922', 'Alcorcón' || chr(10) || 'C/ Paraguay Esquina Avenida de America 28922', 'Petroprix Alcorcón'),
  ('Leganés' || chr(10) || 'C/ Vizcaya, 17 28917', 'Leganés' || chr(10) || 'C/ Vizcaya, 17 28917', 'Petroprix Leganés'),
  ('Parla' || chr(10) || 'Avenida de Ronda S/N 28981', 'Parla' || chr(10) || 'Avenida de Ronda S/N 28981', 'Petroprix Parla'),
  ('Getafe' || chr(10) || 'Calle Herreros, 1 28906', 'Getafe' || chr(10) || 'Calle Herreros, 1 28906', 'Petroprix Getafe'),
  ('Torrejón' || chr(10) || 'Avenida de la Constitución 287 28850', 'Torrejón' || chr(10) || 'Avenida de la Constitución 287 28850', 'Petroprix Torrejón'),
  ('San Fernando de Henares 1' || chr(10) || 'Avenida de los Artesanos 7 28830', 'San Fernando de Henares 1' || chr(10) || 'Avenida de los Artesanos 7 28830', 'Petroprix San Fernando de Henares 1'),
  ('Alcala De Henares' || chr(10) || 'C/ Isaac Newton 33 28806', 'Alcala De Henares' || chr(10) || 'C/ Isaac Newton 33 28806', 'Petroprix Alcalá de Henares'),
  ('Majadahonda' || chr(10) || 'Calle Barbero de Sevilla, Parcela 2B 28222', 'Majadahonda' || chr(10) || 'Calle Barbero de Sevilla, Parcela 2B 28222', 'Petroprix Majadahonda'),
  ('Leganes 2' || chr(10) || 'Calle Ricardo Tormo 6 28914', 'Leganes 2 ' || chr(10) || 'Calle Ricardo Tormo 6 28914', 'Petroprix Leganés 2'),
  ('Rivas - Vaciamadrid' || chr(10) || 'C/ Cincel n2 28522', 'Rivas - Vaciamadrid' || chr(10) || 'C/ Cincel n2 28522', 'Petroprix Rivas - Vaciamadrid'),
  ('Alcobendas' || chr(10) || 'C/ Marques de la Valdavia, 132 28100', 'Alcobendas' || chr(10) || 'C/ Marques de la Valdavia, 132 28100', 'Petroprix Alcobendas'),
  ('Móstoles' || chr(10) || 'C\ Plasencia 29 28935', 'Móstoles' || chr(10) || 'C\ Plasencia 29 28935', 'Petroprix Móstoles'),
  ('Fuenlabrada 3' || chr(10) || 'Calle Móstoles, 83 28942', 'Fuenlabrada 3' || chr(10) || 'Calle Móstoles, 83 28942', 'Petroprix Fuenlabrada 3'),
  ('Arganda Del Rey' || chr(10) || 'Avenida de Madrid 138 28500', 'Arganda Del Rey' || chr(10) || 'Avenida de Madrid 138 28500', 'Petroprix Arganda del Rey'),
  ('Fuenlabrada - Avda Cantueña' || chr(10) || 'Avenida de la CantueÃ±a, 8 28947', 'Fuenlabrada - Avda Cantueña' || chr(10) || 'Avenida de la CantueÃ±a, 8 28947 ', 'Petroprix Fuenlabrada - Avda Cantueña'),
  ('Valdemoro' || chr(10) || 'Av. de Madrid, 5. 28342 Valdemoro 28342', 'Valdemoro' || chr(10) || 'Av. de Madrid, 5. 28342 Valdemoro 28342', 'Petroprix Valdemoro'),
  ('Parla 2' || chr(10) || 'Bulevar John Deere, s/n 28984', 'Parla 2' || chr(10) || 'Bulevar John Deere, s/n 28984', 'Petroprix Parla 2'),
  ('Collado Villalba' || chr(10) || 'Avd/Juan Carlos I, 24Bis 28400', 'Collado Villalba' || chr(10) || 'Avd/Juan Carlos I, 24Bis 28400', 'Petroprix Collado Villalba'),
  ('Colmenar Viejo' || chr(10) || 'Av. De los Reyes nº 2 28770', 'Colmenar Viejo' || chr(10) || 'Av. De los Reyes nº 2 28770', 'Petroprix Colmenar Viejo'),
  ('Mejorada Del Campo' || chr(10) || 'C/ Portugal 30 28840', 'Mejorada Del Campo' || chr(10) || 'C/ Portugal 30 28840', 'Petroprix Mejorada del Campo'),
  ('Alpedrete' || chr(10) || 'Calle Puerta de Abajo n57 28430', 'Alpedrete' || chr(10) || 'Calle Puerta de Abajo n57 28430', 'Petroprix Alpedrete'),
  ('Guadalajara' || chr(10) || 'C/ Francisco Aritio, 97 19004', 'Guadalajara' || chr(10) || 'C/ Francisco Aritio, 97 19004', 'Petroprix Guadalajara'),
  ('Benalmádena' || chr(10) || 'Avd La Leala 29631', 'Benalmádena' || chr(10) || 'Avd  La Leala 29631', 'Petroprix Benalmádena')
  ) AS t (clave, estacion, nombre)
  JOIN gasolinera g ON g.proveedor = 'petroprix' AND g.nombre = t.nombre
ON CONFLICT (proveedor, tipo, estacion_clave) DO NOTHING;

-- ── Las importaciones del Excel ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS repostaje_importacion (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proveedor     VARCHAR(20)  NOT NULL,                 -- petroprix
  fichero       VARCHAR(200),                          -- el nombre con el que se subió: «repostajes (14).xlsx»
  hoja          VARCHAR(60),
  huella        VARCHAR(64),                           -- SHA-256 del fichero: dice si ese mismo ya se importó
  usuario_id    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  empezada_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  terminada_at  TIMESTAMPTZ,
  filas         INTEGER      NOT NULL DEFAULT 0,       -- filas de repostajes en el fichero
  nuevas        INTEGER      NOT NULL DEFAULT 0,
  ya_estaban    INTEGER      NOT NULL DEFAULT 0,       -- la misma fila ya había entrado (excel_clave)
  con_error     INTEGER      NOT NULL DEFAULT 0,       -- no se entendieron y no entraron
  con_aviso     INTEGER      NOT NULL DEFAULT 0,       -- entraron, con algo que mirar
  desde_at      TIMESTAMPTZ,                           -- el primer y el último repostaje del fichero
  hasta_at      TIMESTAMPTZ,
  modo_pruebas  BOOLEAN      NOT NULL DEFAULT FALSE,
  error         TEXT,                                  -- se quedó a medias, y por qué
  detalle       JSONB,                                 -- las filas con error (y por qué) y los avisos por tipo
  CONSTRAINT ck_repimp_cuentas CHECK (filas >= 0 AND nuevas >= 0 AND ya_estaban >= 0 AND con_error >= 0 AND con_aviso >= 0)
);
CREATE INDEX IF NOT EXISTS ix_repimp_empezada ON repostaje_importacion (empezada_at DESC);
COMMENT ON TABLE repostaje_importacion IS
  'Una fila por Excel de repostajes importado en /combustible (Petroprix): quién, cuándo, qué fichero y qué pasó con sus filas (db/215)';

-- ── El repostaje: de dónde viene y lo que trae el Excel ─────────────────────
ALTER TABLE repostaje
  ADD COLUMN IF NOT EXISTS origen          VARCHAR(6)  NOT NULL DEFAULT 'correo',
  ADD COLUMN IF NOT EXISTS importacion_id  BIGINT      REFERENCES repostaje_importacion(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS excel_fila      INTEGER,
  ADD COLUMN IF NOT EXISTS excel_clave     VARCHAR(64),
  ADD COLUMN IF NOT EXISTS excel_crudo     JSONB,
  ADD COLUMN IF NOT EXISTS metodo_pago     VARCHAR(40),
  ADD COLUMN IF NOT EXISTS vehiculo_tipo   VARCHAR(40),
  -- Quién llevaba el coche en el bot de WhatsApp a esa hora (fichaje_turno).
  ADD COLUMN IF NOT EXISTS bot_estado         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS bot_turno_id       BIGINT  REFERENCES fichaje_turno(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_tipo           VARCHAR(8),
  ADD COLUMN IF NOT EXISTS bot_conductor_id   BIGINT  REFERENCES conductor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bot_nombre         VARCHAR(160),
  ADD COLUMN IF NOT EXISTS bot_desde          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_hasta          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_antiguedad_min INTEGER,
  ADD COLUMN IF NOT EXISTS bot_mirado_at      TIMESTAMPTZ;

-- Una fila del Excel no viene de ningún buzón.
ALTER TABLE repostaje ALTER COLUMN buzon DROP NOT NULL;
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_origen;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_origen CHECK (
  (origen = 'correo' AND buzon IS NOT NULL)
  OR (origen = 'excel' AND excel_clave IS NOT NULL));
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_bot;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_bot CHECK (bot_estado IS NULL OR bot_estado IN ('en_turno', 'ultimo', 'nadie'));
-- Cómo casó la gasolinera: dos formas nuevas, las de Petroprix.
ALTER TABLE repostaje DROP CONSTRAINT IF EXISTS ck_rep_gasolinera_como;
ALTER TABLE repostaje ADD CONSTRAINT ck_rep_gasolinera_como
  CHECK (gasolinera_como IS NULL OR gasolinera_como IN ('exacto', 'parecido', 'alias', 'texto', 'direccion', 'ambiguo', 'ninguna'));

-- El candado de las filas del Excel: la misma fila, una vez.
CREATE UNIQUE INDEX IF NOT EXISTS ux_rep_excel ON repostaje (proveedor, excel_clave) WHERE excel_clave IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_rep_importacion ON repostaje (importacion_id) WHERE importacion_id IS NOT NULL;
-- Lo que cada pasada vuelve a mirar en el bot: los que aún no se miraron.
CREATE INDEX IF NOT EXISTS ix_rep_bot_pend ON repostaje (id) WHERE estado = 'leido' AND bot_estado IS NULL;

COMMENT ON COLUMN repostaje.origen IS
  'correo = llegó por correo (Ballenoil; una fila por correo, db/212); excel = una fila del Excel de repostajes de Petroprix, importado en /combustible (importacion_id), sin buzón y con excel_clave como candado (db/215)';
COMMENT ON COLUMN repostaje.excel_clave IS
  'La huella (SHA-256) del contenido de la fila del Excel: la hora con segundos tal cual la escribe («22-10-2026 18:14:01»), la matrícula normalizada, los litros y el importe. Petroprix no da identificador y las exportaciones se solapan: la misma fila, la misma clave, una vez (ux_rep_excel)';
COMMENT ON COLUMN repostaje.excel_crudo IS
  'La fila del Excel tal cual llegó, celda a celda, para enseñarla en la ficha';
COMMENT ON COLUMN repostaje.recibido_at IS
  'Cuándo llegó: el correo, a su buzón (la cabecera); la fila del Excel, cuando se importó';
COMMENT ON COLUMN repostaje.bot_estado IS
  'Quién llevaba el coche en el bot de WhatsApp a la hora del repostaje (fichaje_turno): en_turno = había un turno (o viaje) abierto con esa matrícula; ultimo = el último que se cerró antes, como mucho 12 h antes (bot_antiguedad_min); nadie = ni uno ni otro. NULL = aún sin mirar';

-- ── La boya: solo cuenta lo que falta ───────────────────────────────────────
-- Lo medido (boya_litros) no se toca: el error se rehace desde ahí. Solo los
-- que tenían error: sin él (sin boya, en % sin capacidad, o un mínimo por
-- debajo de lo pagado, que no se compara) sigue sin él.
UPDATE repostaje
   SET boya_error_pct = LEAST(round(GREATEST(0, litros - boya_litros) / litros * 100, 1), 99999),
       actualizado_at = now()
 WHERE boya_error_pct IS NOT NULL AND boya_litros IS NOT NULL AND litros > 0;

-- Los mínimos (el aforador en su techo, sin corregir) que ya pasaban de lo
-- pagado decían «como poco ese error: amarillo o rojo, pero no verde». Con la
-- regla de ahora son verdes: como poco entró lo pagado. La frase, la de ahora.
UPDATE repostaje
   SET boya_motivo = regexp_replace(boya_motivo,
         'Subió al menos ([0-9.,]+) L, y el error es como poco del [0-9.,]+ %: con eso se puede decir amarillo o rojo, pero no verde',
         'Subió al menos \1 L, más que lo pagado: como poco entró lo pagado'),
       actualizado_at = now()
 WHERE boya_motivo ~ 'y el error es como poco del';

COMMENT ON COLUMN repostaje.boya_error_pct IS
  'Desde db/215, el DÉFICIT: max(0, litros del repostaje − boya_litros) / litros × 100, con un decimal. 0 si el depósito subió lo pagado o más (lo que sube de más no cuenta). NULL si falta la boya o si es un mínimo por debajo de lo pagado (boya_motivo dice por qué): sin color por boya. Hasta db/215 era |boya − litros| / litros';

COMMIT;
