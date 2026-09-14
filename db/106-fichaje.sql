-- ============================================================
-- 106 — El fichaje de jornada de los empleados
-- ============================================================
-- Quién entra y a qué hora, y cuándo se va. Nada más: se decidió no guardar
-- pausas (dos pulsaciones al día se olvidan mucho menos que cuatro) ni la
-- ubicación (la ley no la exige y guardar dónde está un empleado es un dato
-- personal que obliga a informar y a justificar).
--
-- ── ESTO NO ES `registro_jornada` ───────────────────────────────────────────
-- Ya existe una tabla con ese nombre y NO sirve para esto: va por `conductor_id`
-- y se DERIVA de los logs de BOLT. Es la jornada del conductor en la calle,
-- calculada por el sistema. Esta otra la escribe una persona pulsando un botón,
-- va por `usuario_id` y es de la gente de oficina. Son dos cosas distintas con
-- un nombre parecido, y mezclarlas habría sido el error caro.
--
-- ── POR QUÉ ESTO ES UN REGISTRO LEGAL ───────────────────────────────────────
-- El registro de jornada (RD 8/2019) hay que guardarlo CUATRO AÑOS y poder
-- enseñárselo a la Inspección y a la propia persona. De ahí dos decisiones:
--
--   · No se borra nada. Corregir no PISA la hora: guarda la original al lado.
--     Un registro que se puede editar sin rastro no vale delante de un
--     inspector, y es justo el momento en que hace falta que valga.
--   · Corregir queda registrado con QUIÉN y POR QUÉ. Sin motivo no se puede.
--
-- ── EL INVARIANTE VA EN LA BASE ─────────────────────────────────────────────
-- Una persona no puede tener DOS fichajes abiertos a la vez. Eso no se defiende
-- con un `if` en la aplicación: dos pulsaciones seguidas en un móvil con mala
-- cobertura llegan como dos peticiones, y el `if` las deja pasar a las dos. Lo
-- garantiza un índice único parcial, que es lo único que no se puede burlar.

BEGIN;

CREATE TABLE IF NOT EXISTS fichaje (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id    BIGINT      NOT NULL REFERENCES usuario(id) ON DELETE RESTRICT,
  -- El día al que pertenece, en hora de Madrid. Se guarda en vez de calcularlo
  -- al leer para que los listados por mes vayan por índice.
  --
  -- Es el día NATURAL, no la jornada 05:00→05:00 de los conductores: quien ficha
  -- aquí es gente de oficina y su día empieza cuando llega.
  dia           DATE        NOT NULL,
  entrada       TIMESTAMPTZ NOT NULL,
  salida        TIMESTAMPTZ,

  -- ── El rastro de las correcciones ────────────────────────────────────────
  -- Lo que había ANTES de tocarlo. NULL mientras nadie lo haya tocado.
  entrada_original TIMESTAMPTZ,
  salida_original  TIMESTAMPTZ,
  corregido_at     TIMESTAMPTZ,
  corregido_por    BIGINT REFERENCES usuario(id),
  corregido_motivo TEXT,

  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Salir antes de entrar no es un fichaje, es un error de datos.
  CONSTRAINT ck_fichaje_orden CHECK (salida IS NULL OR salida >= entrada),
  -- Si se corrigió, hay que decir por qué. Un registro legal sin motivo del
  -- cambio es media explicación.
  CONSTRAINT ck_fichaje_motivo CHECK (
    corregido_at IS NULL OR btrim(COALESCE(corregido_motivo, '')) <> '')
);

-- UNO ABIERTO COMO MUCHO, POR PERSONA. Es el invariante de verdad y por eso vive
-- aquí y no en un `if`.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fichaje_abierto
  ON fichaje (usuario_id) WHERE salida IS NULL;

-- Lo que de verdad se consulta: la jornada de alguien en un mes.
CREATE INDEX IF NOT EXISTS idx_fichaje_usuario_dia ON fichaje (usuario_id, dia DESC);
-- Y el parte del día de todo el mundo.
CREATE INDEX IF NOT EXISTS idx_fichaje_dia ON fichaje (dia DESC);

COMMENT ON TABLE fichaje IS
  'Registro de jornada de los empleados (RD 8/2019): entrada y salida pulsadas por la persona. NO es registro_jornada, que es la jornada del CONDUCTOR derivada de BOLT';
COMMENT ON COLUMN fichaje.entrada_original IS
  'La hora que habia antes de corregir. Corregir no pisa el original: un registro editable sin rastro no vale ante Inspeccion';
COMMENT ON COLUMN fichaje.dia IS
  'Dia natural en hora de Madrid al que pertenece la entrada. No es la jornada 05:00-05:00 de los conductores';

-- ── SIN PERMISO, Y ES A PROPÓSITO ───────────────────────────────────────────
-- `/fichaje` NO se añade al catálogo de permisos (services/permisos.js). Lo que
-- no está en el catálogo queda abierto a cualquiera que haya entrado, y eso es
-- justo lo que se quiere: si fichar necesitara un permiso, habría que
-- concedérselo a cada uno, y sería una forma más de que alguien no pueda fichar
-- el día que le toca. La pantalla ya decide sola qué enseñar según
-- `usuario.ficha_obligatorio`.
--
-- CORREGIR es otra cosa: no se reparte por casilla, va por rol de desarrollador
-- y punto (ver el controlador). La responsabilidad del registro recae en una
-- sola persona, y repartirla por una casilla la diluiría.

COMMIT;
