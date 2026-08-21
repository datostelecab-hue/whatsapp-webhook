-- ============================================================
-- TELECAB — PLANIFICACIÓN (PostgreSQL 15+)
-- ============================================================
-- Turnos, plazas, asignaciones y libranzas: donde se juntan conductores y
-- coches. Aquí vive el DÍA OPERATIVO, que no es el día natural.
--
-- Dos herramientas de PostgreSQL que cambian el diseño respecto al de MySQL:
--
--  1. RANGOS Y EXCLUSIÓN. En vez de un disparador que compruebe solapes a mano,
--     se declara `EXCLUDE USING gist (... daterange(desde, hasta) WITH &&)`.
--     La base RECHAZA por sí sola que un conductor ocupe la misma plaza en
--     fechas que se pisan. No hay forma de saltárselo, ni desde la aplicación
--     ni con un INSERT a mano. `daterange(desde, NULL)` significa "hasta
--     siempre", así que el periodo abierto no necesita fecha centinela.
--
--  2. GENERATE_SERIES + AT TIME ZONE para materializar el calendario del día
--     operativo. El cambio de hora deja de ser un caso especial.

BEGIN;

-- Necesaria para poder mezclar '=' sobre enteros con '&&' sobre rangos.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Turnos ──────────────────────────────────────────────────────────────────

CREATE TABLE turno (
  id        SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo    VARCHAR(12) NOT NULL,
  etiqueta  VARCHAR(20) NOT NULL,
  activo    BOOLEAN     NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_turno_codigo UNIQUE (codigo)
);
COMMENT ON TABLE turno IS
  'Identidad del turno, SIN horas: la hora de corte va versionada en turno_version';

CREATE TABLE turno_version (
  id                SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  turno_id          SMALLINT NOT NULL REFERENCES turno(id),
  hora_corte_local  SMALLINT NOT NULL,
  desde             DATE     NOT NULL,
  hasta             DATE,
  usuario_id        INTEGER  REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_tver_hora CHECK (hora_corte_local BETWEEN 0 AND 23),
  CONSTRAINT ck_tver_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Un turno no puede tener dos cortes vigentes a la vez en ninguna fecha.
  CONSTRAINT ex_tver_solape EXCLUDE USING gist
    (turno_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
COMMENT ON TABLE turno_version IS
  'Hora de corte del día operativo CON VIGENCIA. Cambiarla ya no reescribe el pasado: los meses anteriores se siguen calculando con el corte que estaba vigente entonces';

-- ── El calendario del día operativo ─────────────────────────────────────────
-- Se materializa una vez y se consulta siempre. Calcular el corte al vuelo a
-- partir de una hora local es ambiguo dos días al año, cuando cambia la hora.
CREATE TABLE turno_dia_operativo (
  turno_version_id  SMALLINT    NOT NULL REFERENCES turno_version(id) ON DELETE CASCADE,
  dia               DATE        NOT NULL,
  inicio_utc        TIMESTAMPTZ NOT NULL,
  fin_utc           TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (turno_version_id, dia),
  CONSTRAINT ck_tdo_orden CHECK (fin_utc > inicio_utc)
);
CREATE INDEX idx_tdo_rango ON turno_dia_operativo (turno_version_id, inicio_utc, fin_utc);
-- Para "¿a qué día operativo pertenece este instante?" en una sola consulta.
CREATE INDEX idx_tdo_busca ON turno_dia_operativo USING gist
  (turno_version_id, tstzrange(inicio_utc, fin_utc, '[)'));
COMMENT ON TABLE turno_dia_operativo IS
  'Para cada versión de turno y día, el instante UTC exacto en que empieza y acaba su día operativo. Resuelve el cambio de hora de una vez por todas';

CREATE TABLE conductor_turno_hist (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  turno_id      SMALLINT    NOT NULL REFERENCES turno(id),
  desde         DATE        NOT NULL,
  hasta         DATE,
  origen        VARCHAR(15) NOT NULL DEFAULT 'manual',
  usuario_id    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_cturno_origen CHECK (origen IN ('manual','planificador','migracion')),
  CONSTRAINT ck_cturno_rango CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ex_cturno_solape EXCLUDE USING gist
    (conductor_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX idx_cturno_fecha ON conductor_turno_hist (desde, hasta, turno_id);
COMMENT ON TABLE conductor_turno_hist IS
  'Turno OPERATIVO del conductor con vigencia. Va aparte del contrato porque Tráfico lo cambia a menudo y no es un dato contractual. Un cambio re-reparte TODAS sus horas del periodo';

-- ── Plazas: las 6 posiciones de cada coche ──────────────────────────────────

CREATE TABLE cat_slot (
  slot       SMALLINT PRIMARY KEY,
  turno_id   SMALLINT NOT NULL REFERENCES turno(id),
  rol        VARCHAR(4) NOT NULL,
  orden_ct   SMALLINT,
  CONSTRAINT ck_slot_rol CHECK (rol IN ('FIJO','CT')),
  -- Un FIJO no lleva número de correturno; un CT sí.
  CONSTRAINT ck_slot_ct CHECK ((rol = 'CT') = (orden_ct IS NOT NULL)),
  CONSTRAINT uq_slot_sem UNIQUE (turno_id, rol, orden_ct)
);
COMMENT ON TABLE cat_slot IS
  'Las 6 posiciones del bloque de cada coche y qué significan. Sustituye a las posiciones 0..5 del planificador';

CREATE TABLE plaza (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id     BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  slot            SMALLINT    NOT NULL REFERENCES cat_slot(slot),
  orden_pantalla  SMALLINT    NOT NULL DEFAULT 0,
  baja_at         TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_plaza_viva ON plaza (vehiculo_id, slot) WHERE baja_at IS NULL;
CREATE INDEX idx_plaza_veh ON plaza (vehiculo_id) WHERE baja_at IS NULL;
COMMENT ON TABLE plaza IS
  'Las 6 plazas de cada coche, con identidad propia. El turno y el rol se leen por JOIN con cat_slot';

-- ── Asignaciones ────────────────────────────────────────────────────────────

CREATE TABLE asignacion (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plaza_id         BIGINT      NOT NULL REFERENCES plaza(id) ON DELETE CASCADE,
  conductor_id     BIGINT      NOT NULL REFERENCES conductor(id),
  desde            DATE        NOT NULL,
  hasta            DATE,
  desde_declarado  DATE,
  retirada_at      TIMESTAMPTZ,
  usuario_id       INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_asig_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Dos conductores NO pueden ocupar la misma plaza en fechas que se pisan.
  -- Lo impide la base, no la aplicación: no hay forma de colarlo.
  CONSTRAINT ex_asig_plaza EXCLUDE USING gist
    (plaza_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX idx_asig_vig  ON asignacion (plaza_id, desde, hasta);
CREATE INDEX idx_asig_cond ON asignacion (conductor_id, desde, hasta);
COMMENT ON COLUMN asignacion.desde_declarado IS
  'Fecha que dijo Tráfico, si difiere de la real. Se guarda para poder auditar el desfase';

CREATE TABLE asignacion_dia (
  asignacion_id  BIGINT   NOT NULL REFERENCES asignacion(id) ON DELETE CASCADE,
  dia_semana     SMALLINT NOT NULL,
  PRIMARY KEY (asignacion_id, dia_semana),
  CONSTRAINT ck_asigdia CHECK (dia_semana BETWEEN 1 AND 7)
);
CREATE INDEX idx_asigdia_dia ON asignacion_dia (dia_semana);
COMMENT ON TABLE asignacion_dia IS
  'Días que cubre un correturno (1=lunes). Cambiar los días CIERRA la asignación y abre otra: reescribirlos falsearía la cobertura de las semanas pasadas';

-- ── Libranzas ───────────────────────────────────────────────────────────────

CREATE TABLE patron_libranza (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  desde         DATE        NOT NULL,
  hasta         DATE,
  usuario_id    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_patron_rango CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ex_patron_solape EXCLUDE USING gist
    (conductor_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
COMMENT ON TABLE patron_libranza IS
  'Cabecera del patrón semanal de libranza: un cambio es UNA fila, no siete columnas. Solo el patrón; las libranzas realmente disfrutadas van en la bitácora';

CREATE TABLE patron_libranza_dia (
  patron_id   BIGINT   NOT NULL REFERENCES patron_libranza(id) ON DELETE CASCADE,
  dia_semana  SMALLINT NOT NULL,
  PRIMARY KEY (patron_id, dia_semana),
  CONSTRAINT ck_patrondia CHECK (dia_semana BETWEEN 1 AND 7)
);

-- ── Bitácora ────────────────────────────────────────────────────────────────

CREATE TABLE cat_marca_dia (
  codigo                  CHAR(1)     PRIMARY KEY,
  etiqueta                VARCHAR(40) NOT NULL,
  es_ausencia             BOOLEAN     NOT NULL DEFAULT FALSE,
  cuenta_como_trabajado   BOOLEAN     NOT NULL DEFAULT FALSE,
  horas_equivalentes_seg  INTEGER,
  color_hex               CHAR(7),
  CONSTRAINT ck_marca_color CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE justificante (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id         BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo        DATE         NOT NULL,
  horas_seg_momento    INTEGER,
  observacion          VARCHAR(500) NOT NULL,
  escrito_en_bitacora  BOOLEAN      NOT NULL DEFAULT FALSE,
  usuario_id           INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at           TIMESTAMPTZ
);
-- Un solo justificante vivo por conductor y día; los anulados no estorban.
CREATE UNIQUE INDEX uq_just_vivo ON justificante (conductor_id, dia_operativo) WHERE anulado_at IS NULL;
CREATE INDEX idx_just_fecha ON justificante (dia_operativo);

CREATE TABLE bitacora_dia (
  conductor_id         BIGINT   NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo        DATE     NOT NULL,
  marca                CHAR(1)  REFERENCES cat_marca_dia(codigo),
  marca_manual         BOOLEAN  NOT NULL DEFAULT FALSE,
  trabajo_en_libranza  BOOLEAN  NOT NULL DEFAULT FALSE,
  justificante_id      BIGINT   REFERENCES justificante(id) ON DELETE SET NULL,
  -- La campaña va de junio a mayo: antes de junio, cuenta para el año anterior.
  campania             SMALLINT GENERATED ALWAYS AS (
                         EXTRACT(YEAR FROM dia_operativo)::int
                         - CASE WHEN EXTRACT(MONTH FROM dia_operativo) < 6 THEN 1 ELSE 0 END
                       ) STORED,
  recalculado_at       TIMESTAMPTZ,
  PRIMARY KEY (conductor_id, dia_operativo)
);
CREATE INDEX idx_bit_fecha    ON bitacora_dia (dia_operativo, marca);
CREATE INDEX idx_bit_campania ON bitacora_dia (campania, conductor_id);
COMMENT ON TABLE bitacora_dia IS
  'Lo PROPIO e irrecuperable del día: la marca, si la puso una persona y si trabajó en su libranza. NO guarda horas: esas se leen del cálculo';

COMMIT;
