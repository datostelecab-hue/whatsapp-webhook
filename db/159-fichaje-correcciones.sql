-- ============================================================
-- 159 — CADA UNO PIDE LA CORRECCIÓN DE SU FICHAJE
-- ============================================================
-- Camilo, 25/09/2026: quien ficha puede corregir su propio fichaje —la hora de
-- entrada, la de salida, una jornada que se olvidó entera—, pero la corrección
-- la aprueba UNA sola persona, la que lleva el registro.
--
-- Una corrección es una PETICIÓN, no un cambio: el fichaje no se toca hasta que
-- se aprueba. Si se rechaza, se queda como estaba y quien la pidió ve por qué.
-- Así lo que pulsó la persona y lo que luego se dio por bueno quedan los dos, y
-- cada paso con su nombre: es lo que hace que el registro valga delante de una
-- inspección (RD 8/2019).
--
-- Tres casos, con la misma tabla:
--   · corregir una jornada que existe          fichaje_id = esa jornada
--   · cerrar una jornada que se quedó abierta   ídem; al pedirla se cierra con
--                                               la hora de la pulsación, como si
--                                               hubiera pulsado «Salir»
--   · pedir una jornada que no se fichó         nueva = TRUE; el fichaje se crea
--                                               al aprobarla

BEGIN;

CREATE TABLE IF NOT EXISTS fichaje_correccion (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- De quién es la jornada, que es también quien la pide: cada uno corrige lo
  -- suyo y solo lo suyo.
  usuario_id    BIGINT      NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  -- La jornada que se corrige. En una jornada NUEVA está vacía hasta que se
  -- aprueba, y entonces apunta a la que se creó.
  fichaje_id    BIGINT      REFERENCES fichaje(id) ON DELETE RESTRICT,
  nueva         BOOLEAN     NOT NULL DEFAULT FALSE,
  -- El día natural de Madrid de la entrada que se pide.
  dia           DATE        NOT NULL,
  -- Lo que se pide. Sin salida solo cabe en la jornada que sigue abierta HOY
  -- (se corrige la entrada y se sigue trabajando).
  entrada       TIMESTAMPTZ NOT NULL,
  salida        TIMESTAMPTZ,
  -- Lo que había al pedirla. El fichaje puede cambiar después (lo corrige quien
  -- lleva el registro); esto es lo que vio la persona cuando pidió el cambio.
  entrada_antes TIMESTAMPTZ,
  salida_antes  TIMESTAMPTZ,
  motivo        TEXT        NOT NULL,
  estado        VARCHAR(10) NOT NULL DEFAULT 'pendiente',
  pedida_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelta_at   TIMESTAMPTZ,
  -- Quien la aprobó o la rechazó; en una retirada, la propia persona.
  resuelta_por  BIGINT      REFERENCES usuario(id),
  -- Por qué se rechazó (obligatorio) o una nota al aprobarla (opcional).
  respuesta     TEXT,

  CONSTRAINT ck_fc_estado   CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'retirada')),
  CONSTRAINT ck_fc_orden    CHECK (salida IS NULL OR salida > entrada),
  -- Una corrección apunta a una jornada, salvo que pida una nueva.
  CONSTRAINT ck_fc_objetivo CHECK (nueva OR fichaje_id IS NOT NULL),
  -- Una jornada nueva se pide entera: entrada y salida.
  CONSTRAINT ck_fc_nueva    CHECK (NOT nueva OR salida IS NOT NULL),
  -- Aprobada una nueva, ya tiene su fichaje.
  CONSTRAINT ck_fc_creada   CHECK (NOT (nueva AND estado = 'aprobada') OR fichaje_id IS NOT NULL),
  CONSTRAINT ck_fc_motivo   CHECK (length(btrim(motivo)) >= 4 AND length(motivo) <= 500),
  -- Pendiente = sin resolver, y lo resuelto dice cuándo y quién.
  CONSTRAINT ck_fc_resuelta CHECK ((estado = 'pendiente') = (resuelta_at IS NULL)),
  CONSTRAINT ck_fc_quien    CHECK (estado = 'pendiente' OR resuelta_por IS NOT NULL),
  -- Rechazar sin decir por qué deja a la persona sin saber qué hacer.
  CONSTRAINT ck_fc_rechazo  CHECK (estado <> 'rechazada' OR length(btrim(COALESCE(respuesta, ''))) >= 4)
);

-- Una sola petición abierta por jornada (y por día, si es una jornada nueva).
-- Lo garantiza la base: dos pulsaciones seguidas en un móvil con mala cobertura
-- son dos peticiones, y un `if` las dejaría pasar a las dos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fc_pendiente_fichaje
  ON fichaje_correccion (fichaje_id) WHERE estado = 'pendiente' AND NOT nueva;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fc_pendiente_dia
  ON fichaje_correccion (usuario_id, dia) WHERE estado = 'pendiente' AND nueva;
CREATE INDEX IF NOT EXISTS idx_fc_pendientes
  ON fichaje_correccion (pedida_at) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_fc_usuario_dia ON fichaje_correccion (usuario_id, dia DESC);

COMMENT ON TABLE fichaje_correccion IS
  'Correcciones que cada uno pide de su propio fichaje. Son peticiones: el fichaje no cambia hasta que las aprueba quien tiene la llave /fichaje/revisar';

-- ── La llave de aprobar la tiene UNA sola persona ─────────────────────────────
-- '/fichaje/revisar' (corregir, confirmar horas y aprobar correcciones) no se
-- reparte: la tiene una persona y, para dársela a otra, hay que quitársela
-- antes a la primera. Lo vigila la base y no la pantalla de permisos: así no hay
-- camino —otra pantalla, un script, una migración— por el que acaben siendo dos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_permiso_fichaje_revisar
  ON usuario_permiso (clave) WHERE clave = '/fichaje/revisar';

COMMIT;
