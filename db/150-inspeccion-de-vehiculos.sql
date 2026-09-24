-- ============================================================
-- 150 — INSPECCIÓN DE VEHÍCULOS (taller)
-- ============================================================
-- El primer submódulo de taller que pidió Camilo el 24/09/2026. La base es el
-- Excel del taller «Inspección de Vehículos — Taller Telecab · Tibus
-- elementos»: una fila por coche con dieciséis elementos revisados (matrículas,
-- pegatinas, documentación, carteles, vinilo, botiquín, ruedas, triángulos, V16,
-- chaleco), los vencimientos de la ITV y de las pegatinas VTC, unas
-- observaciones y el resultado.
--
-- ── LOS ELEMENTOS SON FILAS, NO COLUMNAS ───────────────────────────────────
-- En el Excel eran dieciséis columnas. Aquí son un CATÁLOGO: el día que se
-- revise algo más —el extintor, la mampara— es una fila nueva, no una
-- migración que añada una columna y toque todas las pantallas. Y un elemento
-- que no se revisó simplemente no tiene fila: «sin revisar» no es un estado
-- que haya que inventar.
--
-- ── CADA INSPECCIÓN ES UNA FILA, Y NO SE PISA ──────────────────────────────
-- El Excel es una foto: la última inspección de cada coche, y la anterior
-- desaparece al escribir encima. Aquí cada inspección queda, con su fecha y
-- quién la apuntó, y la del coche es la más reciente. Una mal apuntada se
-- ANULA con su motivo; no se borra.
--
-- ── LA FECHA PUEDE FALTAR ──────────────────────────────────────────────────
-- El Excel no dice cuándo se inspeccionó cada coche. Inventarla —poner la del
-- día de la importación— haría creer que esos coches se revisaron ese día. Así
-- que lo importado lleva la fecha vacía y `origen = 'excel'`; lo que se apunte
-- desde la pantalla lleva su fecha.

BEGIN;

-- ── Qué se revisa ──────────────────────────────────────────────────────────
-- `cabecera_excel` es el título de la columna en el Excel del taller: con eso
-- se importa, y si un día cambia el Excel se cambia aquí y no en el código.
CREATE TABLE IF NOT EXISTS cat_elemento_inspeccion (
  codigo          VARCHAR(40)  PRIMARY KEY,
  etiqueta        VARCHAR(120) NOT NULL,
  grupo           VARCHAR(40)  NOT NULL,
  orden           SMALLINT     NOT NULL,
  activo          BOOLEAN      NOT NULL DEFAULT TRUE,
  cabecera_excel  VARCHAR(160)
);

INSERT INTO cat_elemento_inspeccion (codigo, etiqueta, grupo, orden, cabecera_excel) VALUES
  ('matricula_delantera',   'Matrícula delantera',                    'Identificación', 1,  'Matrícula delantera'),
  ('matricula_trasera',     'Matrícula trasera',                      'Identificación', 2,  'Matrícula trasera'),
  ('pegatina_vtc_delantera','Pegatina VTC delantera',                 'Identificación', 3,  'Pegatina VTC delantera'),
  ('pegatina_vtc_trasera',  'Pegatina VTC trasera',                   'Identificación', 4,  'Pegatina VTC trasera'),
  ('pegatina_itv',          'Pegatina ITV',                           'Identificación', 5,  'Pegatina ITV'),
  ('etiqueta_dgt',          'Etiqueta medioambiental DGT',            'Identificación', 6,  'Etiqueta medioambiental DGT'),
  ('tarjeta_transporte',    'Tarjeta de transporte (interior)',       'Documentación',  7,  'Tarjeta de transporte (interior)'),
  ('permiso_circulacion',   'Permiso de circulación (interior)',      'Documentación',  8,  'Permiso de circulación (interior)'),
  ('cartel_camaras',        'Cartel informativo pasajeros (cámaras)', 'Carteles',       9,  'Cartel informativo pasajeros (CAMARAS)'),
  ('cartel_reclamaciones',  'Cartel informativo pasajeros (hojas de reclamación)', 'Carteles', 10, 'Cartel informativo pasajeros (HOJAS DE RECLAMACION)'),
  ('logotipo_vinilo',       'Logotipo / vinilo exterior',             'Imagen',         11, 'Logotipo / vinilo exterior'),
  ('botiquin',              'Botiquín (presente y sellado)',          'Seguridad',      12, 'Botiquín (presente y sellado)'),
  ('ruedas',                'Ruedas',                                 'Seguridad',      13, 'RUEDAS'),
  ('triangulos',            'Triángulos de emergencia',               'Seguridad',      14, 'Triángulos de emergencia'),
  ('v16',                   'V16',                                    'Seguridad',      15, 'V16'),
  ('chaleco',               'Chaleco reflectante',                    'Seguridad',      16, 'Chaleco reflectante')
ON CONFLICT (codigo) DO NOTHING;

-- ── Cómo puede estar cada uno ──────────────────────────────────────────────
-- Los cuatro que usa el Excel. `es_fallo` es lo que cuenta como algo que hay
-- que arreglar: «no se requiere en normativa» no lo es.
CREATE TABLE IF NOT EXISTS cat_estado_elemento (
  codigo    VARCHAR(20) PRIMARY KEY,
  etiqueta  VARCHAR(60) NOT NULL,
  tono      VARCHAR(12) NOT NULL,
  es_fallo  BOOLEAN     NOT NULL,
  orden     SMALLINT    NOT NULL
);

INSERT INTO cat_estado_elemento (codigo, etiqueta, tono, es_fallo, orden) VALUES
  ('correcto',    'Correcto',                    'green', FALSE, 1),
  ('deteriorado', 'Deteriorado',                 'warn',  TRUE,  2),
  ('falta',       'Falta',                       'red',   TRUE,  3),
  ('no_aplica',   'No se requiere en normativa', 'muted', FALSE, 4)
ON CONFLICT (codigo) DO NOTHING;

-- ── El resultado de la inspección ──────────────────────────────────────────
-- El Excel solo trae «Apto — Todo en orden» (o nada). Los otros dos son los que
-- cierran el abanico: sin ellos, un coche con el chaleco roto tendría que salir
-- «apto» o sin resultado.
CREATE TABLE IF NOT EXISTS cat_resultado_inspeccion (
  codigo    VARCHAR(20) PRIMARY KEY,
  etiqueta  VARCHAR(60) NOT NULL,
  tono      VARCHAR(12) NOT NULL,
  orden     SMALLINT    NOT NULL
);

INSERT INTO cat_resultado_inspeccion (codigo, etiqueta, tono, orden) VALUES
  ('apto',     'Apto — Todo en orden',   'green', 1),
  ('apto_obs', 'Apto con observaciones', 'warn',  2),
  ('no_apto',  'No apto',                'red',   3)
ON CONFLICT (codigo) DO NOTHING;

-- ── La inspección ──────────────────────────────────────────────────────────
-- Los vencimientos van como MES y AÑO porque así se leen en la pegatina y así
-- los apunta el taller. La pegatina VTC trasera solo trae el año en el Excel,
-- y por eso su mes puede faltar.
CREATE TABLE IF NOT EXISTS inspeccion_vehiculo (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id         BIGINT NOT NULL REFERENCES vehiculo(id),
  fecha               DATE,
  marca               VARCHAR(60),
  modelo              VARCHAR(60),
  itv_mes             SMALLINT CHECK (itv_mes BETWEEN 1 AND 12),
  itv_anio            SMALLINT CHECK (itv_anio BETWEEN 2000 AND 2100),
  vtc_delantera_mes   SMALLINT CHECK (vtc_delantera_mes BETWEEN 1 AND 12),
  vtc_delantera_anio  SMALLINT CHECK (vtc_delantera_anio BETWEEN 2000 AND 2100),
  vtc_trasera_mes     SMALLINT CHECK (vtc_trasera_mes BETWEEN 1 AND 12),
  vtc_trasera_anio    SMALLINT CHECK (vtc_trasera_anio BETWEEN 2000 AND 2100),
  observaciones       TEXT,
  resultado           VARCHAR(20) REFERENCES cat_resultado_inspeccion(codigo),
  origen              VARCHAR(12) NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'excel')),
  -- Lo que se leyó del Excel, resumido: reimportar el mismo Excel no duplica
  -- nada, y uno nuevo solo añade inspección a los coches que cambiaron.
  huella              VARCHAR(64),
  apuntado_por        BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at          TIMESTAMPTZ,
  anulado_por         BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo      TEXT,
  -- Lo apuntado a mano lleva su fecha; lo del Excel puede no llevarla.
  CONSTRAINT ck_insp_fecha_manual CHECK (origen <> 'manual' OR fecha IS NOT NULL),
  -- Anular exige decir por qué.
  CONSTRAINT ck_insp_anulada CHECK (anulado_at IS NULL OR btrim(COALESCE(anulado_motivo, '')) <> '')
);

CREATE INDEX IF NOT EXISTS idx_insp_vehiculo
  ON inspeccion_vehiculo (vehiculo_id, creado_at DESC) WHERE anulado_at IS NULL;

CREATE TABLE IF NOT EXISTS inspeccion_elemento (
  inspeccion_id  BIGINT      NOT NULL REFERENCES inspeccion_vehiculo(id) ON DELETE CASCADE,
  elemento       VARCHAR(40) NOT NULL REFERENCES cat_elemento_inspeccion(codigo),
  estado         VARCHAR(20) NOT NULL REFERENCES cat_estado_elemento(codigo),
  PRIMARY KEY (inspeccion_id, elemento)
);

COMMENT ON TABLE inspeccion_vehiculo IS
  'Inspecciones de vehículos del taller (db/150). Una fila por inspección, la del coche es la más reciente no anulada. Lo importado del Excel del taller lleva origen excel y puede no tener fecha.';
COMMENT ON TABLE inspeccion_elemento IS
  'El estado de cada elemento revisado en una inspección. Un elemento sin fila es que no se revisó (db/150).';

-- ── Quién la ve y quién la apunta ──────────────────────────────────────────
-- Llave nueva, como Mantenimientos: MIRAR la tiene quien ya mira Mantenimientos,
-- APUNTAR quien ya apunta en él. Sin esto, nadie la tendría hasta que alguien
-- la repartiera a mano.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/inspecciones', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/inspecciones');

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/inspecciones/apuntar', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller/apuntar'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/inspecciones/apuntar');

COMMIT;
