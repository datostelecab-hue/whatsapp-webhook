-- ============================================================
-- 244 — LOS FESTIVOS DE LA OFICINA: los días que no son hábiles
-- ============================================================
-- Hoja de ruta de Ignacio, convención 3: «Días y horas hábiles los calcula el
-- sistema. Calendario laboral de Madrid y de Barcelona, con festivos
-- configurables. Hora hábil = dentro del horario de oficina configurado». Pieza
-- A2 de docs/Hoja de ruta.md (13/11/2026).
--
-- `festivo` (db/197) NO se toca. Es de Vacaciones: los 12 festivos nacionales y
-- de la Comunidad de Madrid, los del convenio, y cada uno suma días a quien lo
-- trabajó. Los locales de la ciudad se dejaron fuera a propósito (db/197), y
-- sellarFestivos no mira el ámbito: meter San Isidro ahí regalaría días de
-- vacaciones a los conductores que lo trabajaron.
--
-- La oficina tiene además los suyos, y van aquí, por sede. El calendario de una
-- sede lo junta services/calendario.js:
--   · los nacionales de `festivo`, para todas las sedes;
--   · los de la Comunidad de Madrid de `festivo` (ámbito 'madrid'), para Madrid;
--   · los de esta tabla para esa sede.
-- El horario de la oficina es un parámetro (oficina.madrid.horario, db/243).
--
-- Camilo, 13/11/2026: los de Madrid capital, sí («Añadir Madrid capital»);
-- Barcelona, más adelante. La tabla ya lleva la sede: el día que haga falta, los
-- de Cataluña y Barcelona ciudad entran aquí con sede 'barcelona'.
--
-- Fechas del Ayuntamiento de Madrid (fiestas locales de cada año; en 2025 la
-- Almudena, domingo 9, se pasó al lunes 10). Los de 2027 no se cargan aún: la
-- Comunidad tampoco está cargada en `festivo` para 2027 y se hará todo junto.

BEGIN;

CREATE TABLE IF NOT EXISTS festivo_oficina (
  sede     VARCHAR(16)  NOT NULL REFERENCES cat_sede(codigo),
  fecha    DATE         NOT NULL,
  nombre   VARCHAR(80)  NOT NULL,
  -- 'local' (la ciudad) o 'autonomico' (para una sede de otra comunidad, como
  -- Barcelona: sus autonómicos no son los de `festivo`, que son de Madrid).
  ambito   VARCHAR(12)  NOT NULL CHECK (ambito IN ('local', 'autonomico')),
  norma    VARCHAR(160) NOT NULL,
  creado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sede, fecha)
);

COMMENT ON TABLE festivo_oficina IS
  'Festivos de la oficina que no son los del convenio de `festivo` (db/197): los locales de cada ciudad y los autonómicos de otras comunidades, por sede. Los junta services/calendario.js con los de `festivo` para los días hábiles (db/244). No los lee Vacaciones.';

INSERT INTO festivo_oficina (sede, fecha, nombre, ambito, norma) VALUES
  ('madrid', DATE '2025-05-15', 'San Isidro Labrador',                         'local', 'Fiestas locales 2025 del Ayuntamiento de Madrid'),
  ('madrid', DATE '2025-11-10', 'Nuestra Señora de la Almudena (trasladada)',  'local', 'Fiestas locales 2025 del Ayuntamiento de Madrid'),
  ('madrid', DATE '2026-05-15', 'San Isidro Labrador',                         'local', 'Fiestas locales 2026 del Ayuntamiento de Madrid'),
  ('madrid', DATE '2026-11-09', 'Nuestra Señora de la Almudena',               'local', 'Fiestas locales 2026 del Ayuntamiento de Madrid')
ON CONFLICT (sede, fecha) DO NOTHING;

COMMIT;
