-- ============================================================
-- 249 — LOS ADJUNTOS: un fichero de cualquier cosa, en un solo sitio
-- ============================================================
-- Pieza A6 de docs/Hoja de ruta.md (13/11/2026). Hasta hoy cada módulo guardaba
-- sus ficheros a su manera: `documento` (solo de un conductor o de un coche, en
-- Drive), `ticket.adjuntos` (JSON), `whatsapp_adjunto` (los bytes dentro de la
-- base) y las facturas del taller. El chat interno, las multas, las cartas, los
-- expedientes y los vídeos de los siniestros necesitan lo mismo, y no caben en
-- el Drive de 15 GB.
--
--   · UNA TABLA para los adjuntos de CUALQUIER dueño: el dueño es un tipo
--     ('tarea', 'mensaje', 'siniestro'…) y su id. El tipo lo registra en el
--     código el módulo dueño (services/adjuntos.js), que es quien decide quién
--     puede verlos y quién adjuntar. Sin clave ajena a propósito: el dueño puede
--     ser de cualquier tabla, y aquí no se borra nada.
--   · LOS BYTES NO VAN AQUÍ: van al almacén (Cloudflare R2, decidido por Camilo
--     el 13/11/2026). Aquí, dónde están (`almacen` + `ruta`), cómo se llamaba el
--     fichero, su tipo, su tamaño y su huella (sha256).
--   · La `ruta` no lleva nombres ni DNI: es una fecha y un identificador al azar.
--   · Quitar un adjunto es ANULARLO con motivo: el fichero se queda en el
--     almacén y la fila aquí (convención 5).
--   · BAJO EL LIBRO DE AUDITORÍA (db/245) desde que nace, antes de que entre
--     ninguna fila (en db/248, las áreas se sembraron antes y su alta no quedó).
--
-- Lo que ya estaba guardado (documentos de Drive, adjuntos de WhatsApp) se queda
-- donde está: se mudará cuando se toque cada módulo (Camilo, 13/11/2026).

BEGIN;

SELECT set_config('telecab.origen', 'migración db/249', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS adjunto (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- De quién es: el tipo lo registra su módulo en services/adjuntos.js.
  dueno_tipo      VARCHAR(40)   NOT NULL CHECK (dueno_tipo ~ '^[a-z][a-z0-9_]*$'),
  dueno_id        VARCHAR(64)   NOT NULL CHECK (dueno_id <> ''),
  -- Dónde están los bytes: 'r2' (Cloudflare) o 'disco' (solo en local y en las pruebas).
  almacen         VARCHAR(12)   NOT NULL CHECK (almacen ~ '^[a-z0-9]+$'),
  ruta            VARCHAR(300)  NOT NULL,
  nombre          VARCHAR(255)  NOT NULL,
  mime            VARCHAR(120)  NOT NULL,
  bytes           BIGINT        NOT NULL CHECK (bytes >= 0),
  sha256          CHAR(64)      NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  creado_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  creado_por      INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo  TEXT,
  CONSTRAINT ck_adjunto_anulado CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);

-- Un fichero del almacén es de un solo adjunto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_adjunto_ruta ON adjunto (almacen, ruta);
-- Los de un dueño, que es como se piden siempre.
CREATE INDEX IF NOT EXISTS ix_adjunto_dueno ON adjunto (dueno_tipo, dueno_id, creado_at);

COMMENT ON TABLE adjunto IS
  'Los adjuntos de cualquier dueño (db/249, pieza A6): los bytes en el almacén (R2), aquí dónde están, su nombre, tipo, tamaño y huella. Quitar es anular con motivo. Ver services/adjuntos.js.';
COMMENT ON COLUMN adjunto.ruta IS
  'Dónde está en el almacén: adjuntos/AAAA/MM/<al azar>. Sin nombres ni DNI.';

-- Bajo el libro ANTES de que entre ninguna fila.
SELECT auditoria_vigilar('adjunto');

COMMIT;
