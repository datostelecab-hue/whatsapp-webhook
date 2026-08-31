-- ============================================================
-- 08 · DOCUMENTOS
-- ============================================================
-- Los archivos siguen viviendo en Google Drive. Lo que se trae aquí es el
-- ÍNDICE, que es lo que hoy no existe en ninguna parte.
--
-- Cómo está montado hoy y por qué no vale:
--   `services/drive.js` crea una carpeta por persona y la nombra con
--   `dni || nombre || id`. Si alguien sube el DNI escaneado antes de que el DNI
--   esté grabado, la carpeta se crea con su NOMBRE; cuando llega el número se
--   crea una SEGUNDA carpeta y los archivos de la primera quedan huérfanos sin
--   que nadie se entere. Además el sistema no sabe qué ES cada archivo, solo
--   cómo se llama: "escaneo2.pdf" puede ser un DNI o una nómina.
--
-- Con esto se puede preguntar lo que hoy es imposible: a quién le caduca el
-- permiso este mes, a quién le falta el contrato firmado, qué documentación
-- tenía esta persona el día que la dimos de alta.
--
-- El almacén queda detrás de dos columnas (`almacen` + `externo_id`), así que
-- mudarse de Drive a otro sitio es cambiar un valor, no migrar nada.

BEGIN;

-- ── Qué tipos de documento manejamos ────────────────────────────────────────
CREATE TABLE cat_tipo_documento (
  codigo        VARCHAR(30) PRIMARY KEY,
  etiqueta      VARCHAR(60) NOT NULL,
  -- 'conductor' o 'vehiculo': un permiso de conducir no es de un coche.
  ambito        VARCHAR(10) NOT NULL,
  -- Si caduca, el sistema puede avisar antes. Un contrato firmado no caduca.
  caduca        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Si sin él la ficha está incompleta. Es lo que alimenta la columna "Ficha".
  obligatorio   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Días de antelación con los que avisar del vencimiento.
  aviso_dias    SMALLINT    NOT NULL DEFAULT 30,
  orden         SMALLINT    NOT NULL DEFAULT 0,
  activo        BOOLEAN     NOT NULL DEFAULT TRUE,
  CONSTRAINT ck_tipodoc_ambito CHECK (ambito IN ('conductor','vehiculo')),
  -- Un documento que no caduca no puede tener aviso de vencimiento: avisaría
  -- de una fecha que no existe.
  CONSTRAINT ck_tipodoc_aviso CHECK (caduca OR aviso_dias = 0)
);
COMMENT ON TABLE cat_tipo_documento IS
  'Qué documentos se guardan de cada persona y de cada coche. Es un catálogo para poder añadir uno nuevo sin tocar código';

-- ── El documento ────────────────────────────────────────────────────────────
CREATE TABLE documento (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Dueño. Exactamente uno de los dos, con clave foránea de verdad: un par
  -- (tipo_entidad, entidad_id) genérico no tendría integridad ni borrado en
  -- cascada, y acabaríamos con documentos de gente que ya no existe.
  conductor_id   BIGINT      REFERENCES conductor(id) ON DELETE CASCADE,
  vehiculo_id    BIGINT      REFERENCES vehiculo(id)  ON DELETE CASCADE,

  tipo           VARCHAR(30) NOT NULL REFERENCES cat_tipo_documento(codigo),

  -- Dónde están los bytes. Hoy siempre 'drive'; el día que se mude, aquí se ve
  -- cuáles quedan por mover.
  almacen        VARCHAR(12) NOT NULL DEFAULT 'drive',
  externo_id     VARCHAR(128) NOT NULL,   -- fileId de Drive, clave de S3, lo que sea
  enlace         TEXT,                    -- webViewLink, para abrirlo sin pedirlo a la API

  nombre_archivo VARCHAR(255) NOT NULL,
  mime           VARCHAR(120),
  bytes          BIGINT,

  -- Fechas del documento en sí, no del archivo.
  fecha_emision  DATE,
  fecha_caduca   DATE,

  -- Sustitución: al subir un permiso nuevo, el anterior deja de ser el vigente
  -- pero NO se borra. Es lo que permite saber qué había en una fecha pasada.
  vigente        BOOLEAN     NOT NULL DEFAULT TRUE,
  reemplaza_a    BIGINT      REFERENCES documento(id) ON DELETE SET NULL,

  subido_por     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  subido_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  notas          TEXT,

  CONSTRAINT ck_doc_duenio CHECK (
    (conductor_id IS NOT NULL)::int + (vehiculo_id IS NOT NULL)::int = 1),
  CONSTRAINT ck_doc_fechas CHECK (fecha_caduca IS NULL OR fecha_emision IS NULL
                                  OR fecha_caduca >= fecha_emision),
  CONSTRAINT ck_doc_bytes CHECK (bytes IS NULL OR bytes >= 0),
  -- El mismo archivo no puede estar dado de alta dos veces.
  CONSTRAINT uq_doc_externo UNIQUE (almacen, externo_id)
);

-- De cada tipo solo hay UN documento vigente por dueño. Los reemplazados
-- conviven sin chocar porque el índice solo mira los vigentes.
CREATE UNIQUE INDEX uq_doc_cond_tipo_vigente
  ON documento (conductor_id, tipo) WHERE vigente AND conductor_id IS NOT NULL;
CREATE UNIQUE INDEX uq_doc_veh_tipo_vigente
  ON documento (vehiculo_id, tipo)  WHERE vigente AND vehiculo_id IS NOT NULL;

CREATE INDEX idx_doc_cond   ON documento (conductor_id) WHERE conductor_id IS NOT NULL;
CREATE INDEX idx_doc_veh    ON documento (vehiculo_id)  WHERE vehiculo_id IS NOT NULL;
-- Para "¿a quién le caduca algo este mes?", que es la pregunta que hoy no se
-- puede hacer.
CREATE INDEX idx_doc_caduca ON documento (fecha_caduca) WHERE vigente AND fecha_caduca IS NOT NULL;

COMMENT ON COLUMN documento.externo_id IS
  'Identificador OPACO en el almacén (fileId de Drive). Nunca se deduce del nombre ni del DNI: ese fue justo el error del montaje anterior';
COMMENT ON COLUMN documento.vigente IS
  'FALSE = sustituido por otro más nuevo. No se borra: es lo que deja reconstruir qué documentación había en una fecha';

-- ── Semilla ─────────────────────────────────────────────────────────────────
INSERT INTO cat_tipo_documento (codigo, etiqueta, ambito, caduca, obligatorio, aviso_dias, orden) VALUES
  ('dni',            'DNI o NIE',                'conductor', TRUE,  TRUE,  60,  1),
  ('permiso',        'Permiso de conducir',      'conductor', TRUE,  TRUE,  60,  2),
  ('vtc',            'Tarjeta VTC',              'conductor', TRUE,  TRUE,  60,  3),
  ('contrato',       'Contrato firmado',         'conductor', FALSE, TRUE,  0,   4),
  ('alta_ss',        'Alta en la Seguridad Social','conductor',FALSE, TRUE,  0,   5),
  ('cuenta',         'Certificado de cuenta',    'conductor', FALSE, FALSE, 0,   6),
  ('reconocimiento', 'Reconocimiento médico',    'conductor', TRUE,  FALSE, 30,  7),
  ('formacion',      'Certificado de formación', 'conductor', TRUE,  FALSE, 30,  8),
  ('otro_conductor', 'Otro',                     'conductor', FALSE, FALSE, 0,   99),
  ('ficha_tecnica',  'Ficha técnica',            'vehiculo',  FALSE, TRUE,  0,   1),
  ('permiso_circ',   'Permiso de circulación',   'vehiculo',  FALSE, TRUE,  0,   2),
  ('itv',            'Informe de ITV',           'vehiculo',  TRUE,  TRUE,  30,  3),
  ('seguro',         'Póliza de seguro',         'vehiculo',  TRUE,  TRUE,  30,  4),
  ('vtc_vehiculo',   'Autorización VTC',         'vehiculo',  TRUE,  TRUE,  60,  5),
  ('otro_vehiculo',  'Otro',                     'vehiculo',  FALSE, FALSE, 0,   99)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, ambito = EXCLUDED.ambito,
      caduca = EXCLUDED.caduca, obligatorio = EXCLUDED.obligatorio,
      aviso_dias = EXCLUDED.aviso_dias, orden = EXCLUDED.orden;

-- ── Vistas ──────────────────────────────────────────────────────────────────

-- Qué documentación obligatoria le falta a cada conductor. Una fila por hueco.
CREATE OR REPLACE VIEW v_documento_falta AS
SELECT c.id                       AS conductor_id,
       t.codigo                   AS tipo,
       t.etiqueta
  FROM conductor c
  CROSS JOIN cat_tipo_documento t
 WHERE c.empleo_vigente
   AND NOT c.es_centinela
   AND t.ambito = 'conductor'
   AND t.activo
   AND t.obligatorio
   AND NOT EXISTS (
     SELECT 1 FROM documento d
      WHERE d.conductor_id = c.id AND d.tipo = t.codigo AND d.vigente);

-- Lo que caduca pronto o ya caducó, de personas y de coches en la misma lista:
-- quien vigila vencimientos los quiere ver juntos.
CREATE OR REPLACE VIEW v_documento_vence AS
SELECT d.id, d.tipo, t.etiqueta, t.ambito,
       d.conductor_id, d.vehiculo_id,
       d.fecha_caduca,
       (d.fecha_caduca - CURRENT_DATE) AS dias,
       (d.fecha_caduca < CURRENT_DATE)  AS caducado
  FROM documento d
  JOIN cat_tipo_documento t ON t.codigo = d.tipo
 WHERE d.vigente
   AND d.fecha_caduca IS NOT NULL
   AND d.fecha_caduca <= CURRENT_DATE + COALESCE(NULLIF(t.aviso_dias, 0), 30);

COMMIT;
