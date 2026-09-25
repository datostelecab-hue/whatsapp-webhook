-- ============================================================
-- 158 — EL ESTADO DE LAS PIEZAS DE CADA COCHE
-- ============================================================
-- Camilo, 25/09/2026, para el taller: un modelo del coche en su ficha donde se
-- pinche una pieza —las ruedas, los espejos, el limpiaparabrisas…— y se diga
-- en qué estado está. Tres estados:
--
--   · Buen estado.
--   · Mal estado · Arreglar   (rojo)
--   · Mal estado · Cambio     (rojo que parpadea)
--
-- con una observación en los dos malos. Al principio todo está en buen estado,
-- y eso no se escribe: una pieza sin fila ESTÁ en buen estado. Así un coche
-- nuevo no necesita 55 filas para empezar, y el catálogo puede crecer sin
-- rellenar nada.
--
-- Cada cambio es una fila (quién, cuándo, qué, por qué): el estado de ahora es
-- la última de cada pieza. Volver a «Buen estado» también es una fila: que se
-- arregló es tan importante como que se rompió.

BEGIN;

-- ── Los estados ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_estado_pieza (
  codigo     VARCHAR(12)  PRIMARY KEY,
  etiqueta   VARCHAR(40)  NOT NULL,
  es_mal     BOOLEAN      NOT NULL,
  -- «Cambio» parpadea: es lo que hay que pedir, y tiene que verse de reojo.
  parpadea   BOOLEAN      NOT NULL DEFAULT FALSE,
  orden      SMALLINT     NOT NULL
);
INSERT INTO cat_estado_pieza (codigo, etiqueta, es_mal, parpadea, orden) VALUES
  ('bien',     'Buen estado',            FALSE, FALSE, 1),
  ('arreglar', 'Mal estado · Arreglar',  TRUE,  FALSE, 2),
  ('cambio',   'Mal estado · Cambio',    TRUE,  TRUE,  3)
ON CONFLICT (codigo) DO NOTHING;

-- ── Las piezas ──────────────────────────────────────────────────────────────
-- Un catálogo y no columnas: añadir una pieza es una fila, no una migración de
-- la tabla. `vista` dice en qué dibujo sale (el exterior o el interior con la
-- mecánica); el dibujo la busca por `codigo`.
CREATE TABLE IF NOT EXISTS cat_pieza_vehiculo (
  codigo     VARCHAR(40)  PRIMARY KEY,
  nombre     VARCHAR(80)  NOT NULL,
  grupo      VARCHAR(40)  NOT NULL,
  vista      VARCHAR(10)  NOT NULL CHECK (vista IN ('exterior', 'interior')),
  orden      SMALLINT     NOT NULL,
  activa     BOOLEAN      NOT NULL DEFAULT TRUE
);
INSERT INTO cat_pieza_vehiculo (codigo, nombre, grupo, vista, orden) VALUES
  -- Exterior · carrocería
  ('paragolpes_del', 'Paragolpes delantero',           'Carrocería', 'exterior', 10),
  ('capo',           'Capó',                           'Carrocería', 'exterior', 11),
  ('aleta_del_izq',  'Aleta delantera izquierda',      'Carrocería', 'exterior', 12),
  ('aleta_del_der',  'Aleta delantera derecha',        'Carrocería', 'exterior', 13),
  ('puerta_del_izq', 'Puerta delantera izquierda',     'Carrocería', 'exterior', 14),
  ('puerta_del_der', 'Puerta delantera derecha',       'Carrocería', 'exterior', 15),
  ('puerta_tra_izq', 'Puerta trasera izquierda',       'Carrocería', 'exterior', 16),
  ('puerta_tra_der', 'Puerta trasera derecha',         'Carrocería', 'exterior', 17),
  ('aleta_tra_izq',  'Aleta trasera izquierda',        'Carrocería', 'exterior', 18),
  ('aleta_tra_der',  'Aleta trasera derecha',          'Carrocería', 'exterior', 19),
  ('techo',          'Techo',                          'Carrocería', 'exterior', 20),
  ('maletero',       'Portón del maletero',            'Carrocería', 'exterior', 21),
  ('paragolpes_tra', 'Paragolpes trasero',             'Carrocería', 'exterior', 22),
  ('tapa_deposito',  'Tapa del depósito',              'Carrocería', 'exterior', 23),
  ('antena',         'Antena',                         'Carrocería', 'exterior', 24),
  -- Exterior · cristales
  ('parabrisas',     'Parabrisas',                     'Cristales',  'exterior', 30),
  ('luna_trasera',   'Luna trasera',                   'Cristales',  'exterior', 31),
  ('vent_del_izq',   'Ventanilla delantera izquierda', 'Cristales',  'exterior', 32),
  ('vent_del_der',   'Ventanilla delantera derecha',   'Cristales',  'exterior', 33),
  ('vent_tra_izq',   'Ventanilla trasera izquierda',   'Cristales',  'exterior', 34),
  ('vent_tra_der',   'Ventanilla trasera derecha',     'Cristales',  'exterior', 35),
  -- Exterior · luces
  ('faro_izq',       'Faro delantero izquierdo',       'Luces',      'exterior', 40),
  ('faro_der',       'Faro delantero derecho',         'Luces',      'exterior', 41),
  ('antiniebla_izq', 'Antiniebla izquierdo',           'Luces',      'exterior', 42),
  ('antiniebla_der', 'Antiniebla derecho',             'Luces',      'exterior', 43),
  ('piloto_izq',     'Piloto trasero izquierdo',       'Luces',      'exterior', 44),
  ('piloto_der',     'Piloto trasero derecho',         'Luces',      'exterior', 45),
  -- Exterior · espejos y limpiaparabrisas
  ('retrovisor_izq', 'Retrovisor izquierdo',           'Espejos',    'exterior', 50),
  ('retrovisor_der', 'Retrovisor derecho',             'Espejos',    'exterior', 51),
  ('limpia_del',     'Limpiaparabrisas delantero',     'Limpiaparabrisas', 'exterior', 55),
  ('limpia_tra',     'Limpiaparabrisas trasero',       'Limpiaparabrisas', 'exterior', 56),
  -- Exterior · ruedas (neumático y llanta)
  ('rueda_del_izq',  'Rueda delantera izquierda',      'Ruedas',     'exterior', 60),
  ('rueda_del_der',  'Rueda delantera derecha',        'Ruedas',     'exterior', 61),
  ('rueda_tra_izq',  'Rueda trasera izquierda',        'Ruedas',     'exterior', 62),
  ('rueda_tra_der',  'Rueda trasera derecha',          'Ruedas',     'exterior', 63),
  -- Exterior · el resto
  ('matricula_del',  'Matrícula delantera',            'Matrículas y escape', 'exterior', 70),
  ('matricula_tra',  'Matrícula trasera',              'Matrículas y escape', 'exterior', 71),
  ('escape',         'Tubo de escape',                 'Matrículas y escape', 'exterior', 72),
  -- Interior · habitáculo
  ('salpicadero',    'Salpicadero',                    'Habitáculo', 'interior', 100),
  ('volante',        'Volante',                        'Habitáculo', 'interior', 101),
  ('multimedia',     'Pantalla y multimedia',          'Habitáculo', 'interior', 102),
  ('climatizacion',  'Climatización',                  'Habitáculo', 'interior', 103),
  ('retrovisor_int', 'Retrovisor interior',            'Habitáculo', 'interior', 104),
  ('consola',        'Consola central y palanca',      'Habitáculo', 'interior', 105),
  ('asiento_cond',   'Asiento del conductor',          'Habitáculo', 'interior', 106),
  ('asiento_copi',   'Asiento del copiloto',           'Habitáculo', 'interior', 107),
  ('asientos_tra',   'Asientos traseros',              'Habitáculo', 'interior', 108),
  ('cinturones',     'Cinturones de seguridad',        'Habitáculo', 'interior', 109),
  ('alfombrillas',   'Alfombrillas',                   'Habitáculo', 'interior', 110),
  -- Interior · maletero
  ('suelo_maletero', 'Maletero (suelo y bandeja)',     'Maletero',   'interior', 120),
  ('rueda_repuesto', 'Rueda de repuesto o kit',        'Maletero',   'interior', 121),
  -- Interior · mecánica
  ('motor',          'Motor',                          'Mecánica',   'interior', 130),
  ('bateria',        'Batería',                        'Mecánica',   'interior', 131),
  ('radiador',       'Radiador',                       'Mecánica',   'interior', 132),
  ('liquidos',       'Niveles de líquidos',            'Mecánica',   'interior', 133),
  ('frenos_del',     'Frenos delanteros',              'Mecánica',   'interior', 134),
  ('frenos_tra',     'Frenos traseros',                'Mecánica',   'interior', 135),
  ('suspension_del', 'Suspensión delantera',           'Mecánica',   'interior', 136),
  ('suspension_tra', 'Suspensión trasera',             'Mecánica',   'interior', 137)
ON CONFLICT (codigo) DO NOTHING;

-- ── Cada cambio de estado ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehiculo_pieza_estado (
  id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT       NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  pieza        VARCHAR(40)  NOT NULL REFERENCES cat_pieza_vehiculo(codigo),
  estado       VARCHAR(12)  NOT NULL REFERENCES cat_estado_pieza(codigo),
  observacion  TEXT,
  usuario_id   INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- La observación es de los estados malos: «Buen estado» no la lleva.
  CONSTRAINT ck_vpe_obs CHECK (estado <> 'bien' OR observacion IS NULL),
  CONSTRAINT ck_vpe_obs_largo CHECK (observacion IS NULL OR length(observacion) <= 1000)
);
-- El estado de ahora: la última fila de cada pieza de un coche.
CREATE INDEX IF NOT EXISTS idx_vpe_actual ON vehiculo_pieza_estado (vehiculo_id, pieza, id DESC);

COMMENT ON TABLE vehiculo_pieza_estado IS
  'Cada cambio de estado de una pieza de un coche. El estado de ahora es la última fila; una pieza sin filas está en buen estado';

-- ── La llave ────────────────────────────────────────────────────────────────
-- Mirar el dibujo va con '/vehiculos'. Cambiar un estado es '/vehiculos/piezas',
-- y se le da a quien ya apunta en el taller o en las inspecciones.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT DISTINCT p.usuario_id, '/vehiculos/piezas', NULL::int
  FROM usuario_permiso p
 WHERE p.clave IN ('/taller/apuntar', '/inspecciones/apuntar')
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/vehiculos/piezas');

COMMIT;
