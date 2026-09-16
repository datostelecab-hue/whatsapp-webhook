-- ============================================================
-- 132 - LAS FACTURAS DEL TALLER, Y DE QUÉ SEDE ES CADA COCHE
-- ============================================================
-- Dos cosas que van juntas porque las dos contestan a la misma persona: Óscar
-- lleva el taller de MADRID, y necesita saber qué coches son suyos y cuánto
-- lleva gastado en cada uno.
--
-- ── 1 · LA SEDE ─────────────────────────────────────────────────────────────
--
-- `base_zona` ya existía y mezclaba dos preguntas distintas: los barrios desde
-- los que se opera (Usera, Canillejas, Getafe…) y una ciudad entera, Barcelona,
-- metida en la misma lista y marcada como inactiva. Con un solo campo hay que
-- elegir: o sabes que un coche está en Barcelona, o sabes que está en Usera.
--
-- Son dos cosas y necesitan dos campos. `sede` dice de qué operación es el
-- coche —lo que separa lo de Óscar de lo del jefe— y `base_zona_id` sigue
-- diciendo desde dónde sale dentro de esa operación.
--
-- Todos a Madrid de salida porque es lo que hay hoy: el sistema se usa en
-- Madrid y a Barcelona se llevaron unos pocos esta semana. Esos se corrigen uno
-- a uno con el dato de Mapon, no a ojo.
--
-- ── 2 · LAS FACTURAS ────────────────────────────────────────────────────────
--
-- Mirando las facturas de verdad (iPark, MotorLine, DISCOM) sale una cosa que
-- decide toda la forma de esto: UNA FACTURA NO ES DE UN COCHE.
--
--   · iPark manda una factura al mes con VARIOS albaranes dentro, cada uno con
--     su matrícula y su kilometraje.
--   · MotorLine manda una factura por coche.
--   · Y DISCOM factura material a granel —un bidón de aceite de 200 litros—
--     que no es de ningún coche en particular.
--
-- Por eso la matrícula NO está en la factura sino en sus líneas, y una línea
-- puede no tener coche. Eso es el "NN": el gasto existe, la factura existe, y
-- lo que falta es que el taller diga a qué coche se lo hizo. Se guarda así a
-- propósito, a la vista y sumando, porque desde septiembre de 2026 se les ha
-- exigido que la matrícula venga siempre: a partir de ahí, un NN no es un hueco
-- normal sino algo que hay que reclamar.
--
-- El PDF va con su propia factura y NO por la tabla `documento`: allí
-- `ck_doc_duenio` obliga a que todo papel sea de UNA persona o de UN coche, y
-- una factura de iPark no es ni lo uno ni lo otro. Además `documento` está
-- pensado para papeles obligatorios que caducan (ITV, seguro, permiso), y una
-- factura ni caduca ni es obligatoria: forzarla ahí sería romper una regla que
-- protege algo de verdad para ahorrarse una columna.

BEGIN;

-- ── 1 · SEDE ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cat_sede (
  codigo   varchar(16) PRIMARY KEY,
  etiqueta varchar(64) NOT NULL,
  orden    smallint    NOT NULL DEFAULT 0,
  activa   boolean     NOT NULL DEFAULT true
);

INSERT INTO cat_sede (codigo, etiqueta, orden) VALUES
  ('madrid',    'Madrid',    1),
  ('barcelona', 'Barcelona', 2)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE vehiculo
  ADD COLUMN IF NOT EXISTS sede varchar(16) NOT NULL DEFAULT 'madrid'
    REFERENCES cat_sede(codigo);

CREATE INDEX IF NOT EXISTS ix_vehiculo_sede ON vehiculo (sede) WHERE baja_at IS NULL;

COMMENT ON COLUMN vehiculo.sede IS
  'De qué operación es el coche (madrid/barcelona). Distinto de base_zona_id, que es el barrio desde el que sale dentro de esa operación.';

-- ── 2 · LOS TALLERES ────────────────────────────────────────────────────────
-- Tabla y no texto libre: la pregunta "cuánto llevo gastado en iPark este año"
-- no se puede contestar si el mismo taller está escrito de cuatro maneras.

CREATE TABLE IF NOT EXISTS taller_proveedor (
  id         bigserial PRIMARY KEY,
  nombre     varchar(160) NOT NULL,
  nif        varchar(24),
  poblacion  varchar(120),
  telefono   varchar(32),
  notas      text,
  activo     boolean NOT NULL DEFAULT true,
  creado_at  timestamptz NOT NULL DEFAULT now()
);

-- El NIF identifica de verdad; el nombre lo escribe cada uno como quiere.
CREATE UNIQUE INDEX IF NOT EXISTS uq_taller_nif
  ON taller_proveedor (upper(regexp_replace(nif, '[^A-Za-z0-9]', '', 'g')))
  WHERE nif IS NOT NULL AND btrim(nif) <> '';

-- Los cuatro que ya facturan, sacados de las facturas reales de 2026.
INSERT INTO taller_proveedor (nombre, nif, poblacion, telefono) VALUES
  ('iPark Estaciones y Servicios de Movilidad', 'A01516640', 'Las Rozas de Madrid', '917333964'),
  ('DISCOM AUTO 2025, S.L.',                    'B22522130', 'Alcobendas',          '916625350'),
  ('MotorLine25, S.L.',                         'B21799945', 'Parla',               '662135480')
ON CONFLICT DO NOTHING;

-- ── 3 · LA FACTURA ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS factura_taller (
  id            bigserial PRIMARY KEY,
  proveedor_id  bigint      NOT NULL REFERENCES taller_proveedor(id),
  numero        varchar(64) NOT NULL,
  fecha         date        NOT NULL,
  -- En céntimos, como el resto del sistema: en euros con decimales, sumar
  -- doscientas líneas acaba sacando céntimos de la nada.
  base_cent     integer,
  iva_cent      integer,
  total_cent    integer     NOT NULL,
  sede          varchar(16) NOT NULL DEFAULT 'madrid' REFERENCES cat_sede(codigo),
  -- El PDF, con su propio sitio (ver la cabecera).
  almacen         varchar(16),
  externo_id      varchar(128),
  enlace          text,
  nombre_archivo  varchar(255),
  mime            varchar(96),
  bytes           integer,
  notas         text,
  usuario_id    bigint REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     timestamptz NOT NULL DEFAULT now(),
  -- Una factura no se borra: se anula y se dice por qué. Es contabilidad.
  anulado_at    timestamptz,
  anulado_por   bigint REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo text,
  CONSTRAINT ck_fact_total  CHECK (total_cent >= 0),
  CONSTRAINT ck_fact_anulada CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);

-- El mismo taller no puede mandar dos veces la misma factura. Las anuladas no
-- estorban: si una se metió mal, se anula y se vuelve a meter con su número.
CREATE UNIQUE INDEX IF NOT EXISTS uq_factura_taller_numero
  ON factura_taller (proveedor_id, upper(btrim(numero)))
  WHERE anulado_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_factura_taller_fecha ON factura_taller (fecha DESC);

-- ── 4 · LAS LÍNEAS: UNA POR COCHE (o NN) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS factura_taller_linea (
  id            bigserial PRIMARY KEY,
  factura_id    bigint  NOT NULL REFERENCES factura_taller(id) ON DELETE CASCADE,
  -- NULL a propósito = "NN": la factura no dice de qué coche es. Ver cabecera.
  vehiculo_id   bigint  REFERENCES vehiculo(id) ON DELETE SET NULL,
  -- La matrícula TAL COMO VIENE EN EL PAPEL, aunque no la reconozcamos. Sin
  -- esto, una matrícula mal tecleada por el taller se convierte en un NN mudo y
  -- se pierde la única pista para reclamársela.
  matricula_texto varchar(16),
  albaran       varchar(64),
  fecha         date,
  km            integer,
  concepto      text,
  importe_cent  integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_fact_linea_km CHECK (km IS NULL OR km >= 0)
);

CREATE INDEX IF NOT EXISTS ix_fact_linea_factura  ON factura_taller_linea (factura_id);
CREATE INDEX IF NOT EXISTS ix_fact_linea_vehiculo ON factura_taller_linea (vehiculo_id)
  WHERE vehiculo_id IS NOT NULL;
-- Para la lista de "gastos sin matrícula", que es la que hay que reclamar.
CREATE INDEX IF NOT EXISTS ix_fact_linea_nn ON factura_taller_linea (factura_id)
  WHERE vehiculo_id IS NULL;

COMMIT;
