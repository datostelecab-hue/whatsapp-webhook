-- ============================================================
-- 241 · MANTENIMIENTOS CON SUS PIEZAS, E INVENTARIO DEL TALLER
-- ============================================================
-- Camilo, 12/11/2026: «Hay que crear un módulo de "Inventario" para las cosas
-- que no tengan matrícula, como los de HERGAR. Toca también re diseñar el módulo
-- de "Mantenimientos" y en la ficha del vehículo listar sus mantenimientos, uno
-- por uno […] que se pueda sumar cosas al inventario y restar también si las
-- usamos y apuntar en qué matrícula fue y qué fecha».
--
-- Este fichero solo crea el sitio. Los datos (las facturas de Discom, iPark y
-- Hergar leídas de los PDF) van en db/242.
--
-- ── 1. Un mantenimiento lleva sus PIEZAS ─────────────────────────────────────
-- Hasta hoy un mantenimiento era una fila con km, fecha, taller y coste: valía
-- para «le toca revisión», no para decir «el 16/06 se le cambió el aceite, los
-- tres filtros y una lámpara H7». Las piezas van en `mantenimiento_pieza`, cada
-- una con su CATEGORÍA (aceite y filtros, frenos, neumáticos…), y el
-- mantenimiento guarda las categorías que tiene para filtrar sin abrir las piezas.
--
-- ── 2. De dónde sale cada mantenimiento ─────────────────────────────────────
--   manual      lo apunta el taller a mano (lo de siempre)
--   factura     sale de una reparación o un albarán de una factura de taller
--   inventario  una pieza del inventario que se ha puesto en ese coche
-- Camilo eligió que el semáforo de «le toca revisión» siga contando SOLO lo
-- apuntado a mano: lo de las facturas sale en el historial y no lo mueve
-- (taller.repo, CUENTAN + origen 'manual').
--
-- ── 3. El inventario ─────────────────────────────────────────────────────────
-- Un ARTÍCULO (lo que se compra: «FILTRO DE ACEITE TOYOTA ++», código de
-- Hergar 156ELH4512) y sus MOVIMIENTOS. El stock no se guarda: es la suma de
-- los movimientos (v_inventario_stock). Un número guardado aparte acaba
-- diciendo otra cosa que su historia, y aquí la historia es lo que se audita.
--   entrada  +   lo que llega (las facturas de Hergar, o a mano)
--   salida   −   se ha puesto en un COCHE: matrícula y fecha obligatorias
--   ajuste   ±   recuento, rotura, devolución: con el motivo obligatorio
-- Una salida crea además un mantenimiento del coche (origen 'inventario'), que
-- es lo que hace que salga en su ficha. Anular la salida lo anula también.
--
-- ── 4. Las facturas de recambios no son «NN» ───────────────────────────────
-- Una factura de Hergar trae albaranes sin matrícula porque son compras para el
-- almacén, no reparaciones de un coche. Contarlas como NN («se le reclama al
-- taller») llenaría la lista de reclamaciones de cosas que no hay que reclamar.
-- `factura_taller.para_inventario` las aparta de esa cuenta.

BEGIN;

-- ── El proveedor de recambios ───────────────────────────────────────────────
ALTER TABLE taller_proveedor
  ADD COLUMN IF NOT EXISTS tipo varchar(12) NOT NULL DEFAULT 'taller';
ALTER TABLE taller_proveedor DROP CONSTRAINT IF EXISTS ck_proveedor_tipo;
ALTER TABLE taller_proveedor
  ADD CONSTRAINT ck_proveedor_tipo CHECK (tipo IN ('taller', 'recambios'));
COMMENT ON COLUMN taller_proveedor.tipo IS
  'taller = repara coches (sus facturas van por matrícula); recambios = vende piezas para el almacén';

INSERT INTO taller_proveedor (nombre, nif, poblacion, telefono, tipo)
SELECT 'Recambios Hergar (Hermanos García López, S.A.)', 'A78009172', 'Madrid', '917423361', 'recambios'
 WHERE NOT EXISTS (SELECT 1 FROM taller_proveedor
                    WHERE upper(regexp_replace(nif, '[^A-Za-z0-9]', '', 'g')) = 'A78009172');
UPDATE taller_proveedor SET tipo = 'recambios'
 WHERE upper(regexp_replace(nif, '[^A-Za-z0-9]', '', 'g')) = 'A78009172';

-- ── Las facturas de recambios ───────────────────────────────────────────────
ALTER TABLE factura_taller
  ADD COLUMN IF NOT EXISTS para_inventario boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN factura_taller.para_inventario IS
  'Compra para el almacén (Hergar): sus líneas sin matrícula NO son NN. Lo comprado entra en el inventario (db/241)';

-- ── El mantenimiento, con su origen ─────────────────────────────────────────
ALTER TABLE mantenimiento
  ADD COLUMN IF NOT EXISTS origen           varchar(12) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS proveedor_id     bigint REFERENCES taller_proveedor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS factura_id       bigint REFERENCES factura_taller(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS factura_linea_id bigint REFERENCES factura_taller_linea(id) ON DELETE SET NULL,
  -- «REPARACIÓN 2026/000888» en Discom, «Albarán 2608320» en iPark.
  ADD COLUMN IF NOT EXISTS referencia       varchar(64),
  ADD COLUMN IF NOT EXISTS categorias       text[] NOT NULL DEFAULT '{}';

ALTER TABLE mantenimiento DROP CONSTRAINT IF EXISTS ck_mant_origen;
ALTER TABLE mantenimiento
  ADD CONSTRAINT ck_mant_origen CHECK (origen IN ('manual', 'factura', 'inventario'));

-- Los tipos de siempre más los que traen las facturas. El tipo es la categoría
-- PRINCIPAL; todas las que lleva van en `categorias`.
ALTER TABLE mantenimiento DROP CONSTRAINT IF EXISTS ck_mant_tipo;
ALTER TABLE mantenimiento
  ADD CONSTRAINT ck_mant_tipo CHECK (tipo IN
    ('revision', 'itv', 'neumaticos', 'chapa', 'averia', 'aceite', 'otro',
     'frenos', 'alumbrado', 'bateria', 'suspension', 'mecanica'));

-- Una línea de factura es UNA reparación: no puede dar dos mantenimientos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mant_factura_linea
  ON mantenimiento (factura_linea_id) WHERE factura_linea_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mant_factura ON mantenimiento (factura_id) WHERE factura_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mant_veh_fecha ON mantenimiento (vehiculo_id, fecha DESC NULLS LAST);

COMMENT ON COLUMN mantenimiento.origen IS
  'manual (a mano) | factura (de una factura de taller) | inventario (pieza del almacén puesta en el coche). El semáforo de revisión cuenta solo manual';
COMMENT ON COLUMN mantenimiento.categorias IS
  'Las categorías de sus piezas (aceite, frenos, neumaticos…), para filtrar sin abrirlas';

-- ── Las piezas de cada mantenimiento ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mantenimiento_pieza (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mantenimiento_id bigint       NOT NULL REFERENCES mantenimiento(id) ON DELETE CASCADE,
  orden            smallint     NOT NULL DEFAULT 0,
  -- Discom parte una reparación en «TRABAJO 1», «TRABAJO 2»…
  trabajo          smallint,
  codigo           varchar(48),
  descripcion      text         NOT NULL,
  cantidad         numeric(10,2),
  precio_cent      integer,
  dto              numeric(5,2),
  importe_cent     integer,
  categoria        varchar(16)  NOT NULL DEFAULT 'otro',
  CONSTRAINT ck_pieza_categoria CHECK (categoria IN
    ('aceite', 'frenos', 'neumaticos', 'alumbrado', 'bateria', 'suspension',
     'chapa', 'mecanica', 'mano_obra', 'nota', 'otro'))
);
CREATE INDEX IF NOT EXISTS ix_pieza_mant ON mantenimiento_pieza (mantenimiento_id, orden);
COMMENT ON TABLE mantenimiento_pieza IS
  'Cada línea de un mantenimiento: lo que se cambió o se hizo, con su importe SIN IVA en céntimos (db/241)';
COMMENT ON COLUMN mantenimiento_pieza.categoria IS
  'mano_obra = mano de obra y diagnosis; nota = una línea que solo informa («RECAMBIO TRAE EL CLIENTE»)';

-- ── El inventario ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_articulo (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La referencia del proveedor (Hergar: 156ELH4512). Puede faltar en lo que
  -- se dé de alta a mano.
  codigo             varchar(48),
  descripcion        text        NOT NULL,
  categoria          varchar(16) NOT NULL DEFAULT 'otro',
  proveedor_id       bigint      REFERENCES taller_proveedor(id) ON DELETE SET NULL,
  unidad             varchar(8)  NOT NULL DEFAULT 'ud',
  -- Lo que costó la última vez, SIN IVA y con el descuento aplicado.
  ultimo_precio_cent integer,
  notas              text,
  activo             boolean     NOT NULL DEFAULT true,
  usuario_id         integer     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_art_categoria CHECK (categoria IN
    ('aceite', 'frenos', 'neumaticos', 'alumbrado', 'bateria', 'suspension',
     'chapa', 'mecanica', 'otro')),
  CONSTRAINT ck_art_precio CHECK (ultimo_precio_cent IS NULL OR ultimo_precio_cent >= 0)
);
-- Una referencia, un artículo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_art_codigo
  ON inventario_articulo (upper(btrim(codigo))) WHERE codigo IS NOT NULL AND btrim(codigo) <> '';
COMMENT ON TABLE inventario_articulo IS
  'Lo que el taller tiene en el almacén, sin matrícula (Hergar). El stock sale de inventario_movimiento (db/241)';

CREATE TABLE IF NOT EXISTS inventario_movimiento (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  articulo_id     bigint        NOT NULL REFERENCES inventario_articulo(id) ON DELETE CASCADE,
  tipo            varchar(8)    NOT NULL,
  -- Con su signo: + entra, − sale. El stock es la suma.
  cantidad        numeric(10,2) NOT NULL,
  fecha           date          NOT NULL,
  vehiculo_id     bigint        REFERENCES vehiculo(id) ON DELETE SET NULL,
  -- Precio unitario SIN IVA, con el descuento aplicado.
  precio_cent     integer,
  factura_id      bigint        REFERENCES factura_taller(id) ON DELETE SET NULL,
  albaran         varchar(32),
  -- Lo que Hergar pone a la izquierda del albarán: DISCOM TALLER, PARLA…
  destino         varchar(48),
  notas           text,
  -- El mantenimiento que crea una salida en la ficha del coche.
  mantenimiento_id bigint       REFERENCES mantenimiento(id) ON DELETE SET NULL,
  usuario_id      integer       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at       timestamptz   NOT NULL DEFAULT now(),
  anulado_at      timestamptz,
  anulado_por     integer       REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo  text,
  CONSTRAINT ck_mov_tipo CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  CONSTRAINT ck_mov_signo CHECK (
       (tipo = 'entrada' AND cantidad > 0)
    OR (tipo = 'salida'  AND cantidad < 0)
    OR (tipo = 'ajuste'  AND cantidad <> 0)),
  -- Restar por uso es ponerlo en un coche: sin coche no es una salida, es un ajuste.
  CONSTRAINT ck_mov_salida_coche CHECK (tipo <> 'salida' OR vehiculo_id IS NOT NULL),
  -- Un ajuste dice por qué.
  CONSTRAINT ck_mov_ajuste_nota CHECK (tipo <> 'ajuste' OR btrim(COALESCE(notas, '')) <> ''),
  CONSTRAINT ck_mov_precio CHECK (precio_cent IS NULL OR precio_cent >= 0),
  CONSTRAINT ck_mov_anulado CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_mov_articulo ON inventario_movimiento (articulo_id, fecha DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_mov_vehiculo ON inventario_movimiento (vehiculo_id) WHERE vehiculo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_mov_factura  ON inventario_movimiento (factura_id) WHERE factura_id IS NOT NULL;
COMMENT ON TABLE inventario_movimiento IS
  'Entradas (+), salidas a un coche (−) y ajustes (±) del inventario. Se anulan, no se borran (db/241)';

-- El stock de cada artículo: la suma de lo no anulado.
CREATE OR REPLACE VIEW v_inventario_stock AS
SELECT a.id AS articulo_id,
       COALESCE(sum(m.cantidad) FILTER (WHERE m.anulado_at IS NULL), 0)                         AS stock,
       COALESCE(sum(m.cantidad) FILTER (WHERE m.anulado_at IS NULL AND m.tipo = 'entrada'), 0)  AS entradas,
       COALESCE(-sum(m.cantidad) FILTER (WHERE m.anulado_at IS NULL AND m.tipo = 'salida'), 0)  AS salidas,
       max(m.fecha) FILTER (WHERE m.anulado_at IS NULL)                                         AS ultimo_movimiento
  FROM inventario_articulo a
  LEFT JOIN inventario_movimiento m ON m.articulo_id = a.id
 GROUP BY a.id;

-- ── Quién lo ve y quién lo mueve ────────────────────────────────────────────
-- Como Inspección (db/150): mirar el inventario lo tiene quien ya mira
-- Mantenimientos, y moverlo quien ya apunta en él.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/inventario', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/inventario');

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/inventario/mover', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller/apuntar'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/inventario/mover');

COMMIT;
