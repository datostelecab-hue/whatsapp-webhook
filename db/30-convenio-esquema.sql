-- ============================================================
-- 30 - EL CONVENIO COMO CONFIGURACION
-- ============================================================
-- Hito 0. Las once tablas donde vive el Convenio Colectivo VTC de la Comunidad
-- de Madrid (BOCM num. 202, 24/08/2024). Ningun importe, ninguna hora y ninguna
-- regla de este convenio puede estar escrita en el codigo: todo se lee de aqui,
-- con vigencia. El seed 'seed_convenio_vtc_madrid.sql' las deja cargadas.
--
-- POR QUE CON VIGENCIA Y NO A SECAS. El convenio caduca el 31/12/2026 y se
-- prorroga con un +1% automatico si no se denuncia. Cambiar la franja de
-- nocturnidad o un salario tiene que ser un INSERT con una fecha nueva, no un
-- despliegue. Por eso cada valor lleva 'valid_from'/'valid_to' y la base impide
-- que el mismo parametro tenga dos valores en fechas que se pisan.
--
-- Y POR QUE VARIOS CONVENIOS A LA VEZ. Si la empresa abre centro en otra
-- comunidad, el convenio es otro. La identidad de un grupo, un parametro o una
-- tabla salarial es (convenio + codigo), nunca el codigo suelto: dos convenios
-- pueden tener los dos un grupo "G3A" que valga cosas distintas.
--
-- Esta migracion SOLO crea el esquema. No mete un solo dato: eso es el seed, que
-- va detras. Asi el esquema se puede revisar sin el ruido de 60 INSERT.

BEGIN;

-- El seed usa rangos de fechas con exclusion; hace falta btree_gist para poder
-- mezclar la igualdad de un texto con el solape de un daterange en un EXCLUDE.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- 1. CONVENIO
-- El convenio como entidad. Todo lo demas cuelga de aqui por 'agreement_id'.
CREATE TABLE IF NOT EXISTS collective_agreement (
  agreement_id              UUID         PRIMARY KEY,
  code                      VARCHAR(40)  NOT NULL UNIQUE,
  name                      TEXT         NOT NULL,
  scope_region              VARCHAR(12)  NOT NULL,     -- ES-MD, ES-CT, ...
  valid_from                DATE         NOT NULL,
  valid_to                  DATE,                       -- nulo = sin fin conocido
  -- El +1% de la prorroga (art. 5.3). Se guarda como factor: 1.00 = +1%. Es un
  -- DATO, no una constante del codigo: el dia que se aplique, se genera una
  -- version nueva de cada tabla salarial multiplicando por esto.
  auto_renewal_increase_pct NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  source_publication        TEXT,
  notes                     TEXT,
  CONSTRAINT ck_agr_rango CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE collective_agreement IS
  'El convenio como entidad. Soporta varios a la vez, uno por region';

-- ------------------------------------------------- 2. GRUPOS PROFESIONALES
-- G1 Mandos, G2 Coordinacion, G3A Conductores de aplicacion, etc. (art. 15).
-- La identidad es (convenio + codigo): dos convenios pueden llamar "G3A" a
-- cosas distintas, asi que el codigo solo no vale como clave.
CREATE TABLE IF NOT EXISTS professional_group (
  group_id     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_code   VARCHAR(8)   NOT NULL,
  agreement_id UUID         NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  name         TEXT         NOT NULL,
  article_ref  VARCHAR(24),
  CONSTRAINT uq_group UNIQUE (agreement_id, group_code)
);

COMMENT ON TABLE professional_group IS
  'Grupos profesionales del art. 15. Identidad por (convenio, codigo)';

-- ------------------------------------------------------- 3. PARAMETROS
-- TODO el apartado 2 del convenio vive aqui: jornada, vacaciones, nocturnidad,
-- antiguedad, plazos... cada uno una fila con su vigencia.
--
-- El valor puede ser numero, texto o JSON. La mayoria son numeros (con su
-- unidad al lado: MINUTES, PERCENT, EUR...), pero se dejan las tres puertas
-- abiertas para lo que no sea un numero limpio.
CREATE TABLE IF NOT EXISTS agreement_parameter (
  param_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agreement_id  UUID         NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  param_code    VARCHAR(48)  NOT NULL,
  value_numeric NUMERIC(14,4),
  value_text    TEXT,
  value_json    JSONB,
  unit          VARCHAR(16),                 -- MINUTES, HOURS, PERCENT, EUR, DAYS...
  article_ref   VARCHAR(24),
  -- Ambito opcional: un parametro puede valer solo para un grupo (p. ej. el
  -- limite diario de 8h es de G3A). Nulo = para todos. NO lleva clave ajena a
  -- proposito: es un ambito, no una pertenencia, y a veces trae valores como
  -- 'G3' que agrupan varios grupos reales.
  scope_group   VARCHAR(8),
  valid_from    DATE         NOT NULL,
  valid_to      DATE,
  notes         TEXT,
  CONSTRAINT ck_par_rango CHECK (valid_to IS NULL OR valid_to >= valid_from),
  -- NADA SE SOBRESCRIBE. El mismo parametro, para el mismo ambito, no puede
  -- tener dos valores en fechas que se pisan. Corregir es meter una fila nueva
  -- con vigencia nueva, no editar la vieja. Lo impide la base.
  --
  -- COALESCE en el ambito porque dos NULL no chocan en un EXCLUDE, y dos
  -- parametros globales con el mismo codigo y fechas solapadas SI son un error.
  CONSTRAINT ex_par_vigencia EXCLUDE USING gist (
    param_code WITH =,
    (COALESCE(scope_group, 'ALL')) WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);

COMMENT ON TABLE agreement_parameter IS
  'Cada valor del convenio con su vigencia. Cambiar uno es un INSERT, no un despliegue';

-- ------------------------------------------------------- 4. TABLAS SALARIALES
-- Una fila por (convenio, ano, grupo). El seed trae 2024, 2025 y 2026; el 2027
-- lo generara un job aplicando el +1% cuando se confirme que no hubo denuncia.
--
-- Los nombres de columna son los del SEED (permanence_*, no seniority_*): el
-- documento de spec los llama de otra forma, pero manda lo que se ejecuta.
CREATE TABLE IF NOT EXISTS salary_table_row (
  row_id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agreement_id         UUID         NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  year                 SMALLINT     NOT NULL,
  professional_group   VARCHAR(8)   NOT NULL,
  base_salary          NUMERIC(10,2) NOT NULL,
  prorata              NUMERIC(10,2),
  gross_monthly        NUMERIC(10,2),
  permanence_3m        NUMERIC(10,2),
  permanence_6m        NUMERIC(10,2),
  quality_bonus_quarter NUMERIC(10,2),
  overtime_hour_price  NUMERIC(10,2),
  CONSTRAINT uq_salary UNIQUE (agreement_id, year, professional_group),
  -- El grupo tiene que existir en ese mismo convenio.
  CONSTRAINT fk_salary_group FOREIGN KEY (agreement_id, professional_group)
    REFERENCES professional_group (agreement_id, group_code)
);

COMMENT ON TABLE salary_table_row IS
  'Tabla salarial por ano y grupo. La prorroga del +1% es una version mas';

-- --------------------------------------------------- 5. SUPUESTOS DE TRABAJO EFECTIVO
-- Los cuatro supuestos del art. 18.6 que definen que ES trabajo efectivo, mas
-- el 18.7 que dice lo que NO lo es. Esto sustituye a las heuristicas de la v1:
-- la capa que normaliza lo que llega de BOLT etiqueta cada tramo con uno de
-- estos codigos.
CREATE TABLE IF NOT EXISTS effective_work_case (
  case_code          VARCHAR(8)  PRIMARY KEY,
  agreement_id       UUID        NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  article_ref        VARCHAR(24),
  description        TEXT        NOT NULL,
  -- Que hace falta para poder afirmar este supuesto.
  requires_area      BOOLEAN     NOT NULL DEFAULT FALSE,   -- geocerca del area
  requires_timeframe BOOLEAN     NOT NULL DEFAULT FALSE,   -- marco temporal
  -- TE_A3 y TE_C computan siempre, esten donde esten.
  always_counts      BOOLEAN     NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE effective_work_case IS
  'Los supuestos de trabajo efectivo del art. 18.6-18.7. Con que se etiqueta cada tramo';

-- ------------------------------------------------- 6. TIPOS DE ASIENTO DE JORNADA
-- El catalogo de lo que puede pasarle a un dia: trabajo, ausencia,
-- justificacion o residuo derivado. Cada tipo dice como afecta a la obligacion
-- (FULFILLS cumple, REDUCES resta, COVERS cubre, NEUTRAL ni una cosa ni otra) y
-- con que precedencia se ordena cuando varios caen el mismo dia.
CREATE TABLE IF NOT EXISTS ledger_entry_type (
  entry_type_code       VARCHAR(24) PRIMARY KEY,
  category              VARCHAR(16) NOT NULL,   -- WORK, ABSENCE, JUSTIFICATION, DERIVED
  obligation_effect     VARCHAR(12) NOT NULL,   -- FULFILLS, REDUCES, COVERS, NEUTRAL
  is_paid               BOOLEAN     NOT NULL,
  counts_as_worked_time BOOLEAN     NOT NULL,
  requires_approval     BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_evidence     BOOLEAN     NOT NULL DEFAULT FALSE,
  precedence            SMALLINT    NOT NULL DEFAULT 50,
  article_ref           VARCHAR(24),
  notes                 TEXT,
  CONSTRAINT ck_let_cat CHECK (category IN ('WORK','ABSENCE','JUSTIFICATION','DERIVED')),
  CONSTRAINT ck_let_eff CHECK (obligation_effect IN ('FULFILLS','REDUCES','COVERS','NEUTRAL'))
);

COMMENT ON TABLE ledger_entry_type IS
  'Que puede pasarle a un dia y como afecta a la obligacion de jornada';

-- --------------------------------------------- 7. CATALOGO DE PERMISOS (art. 22)
-- Los trece permisos retribuidos, con su duracion y su unidad (dias naturales,
-- laborables, horas al ano, minutos al dia...). La unidad importa tanto como el
-- numero: 15 "dias" del permiso de matrimonio son NATURALES, los demas no.
CREATE TABLE IF NOT EXISTS leave_type (
  leave_type_code     VARCHAR(24) PRIMARY KEY,
  agreement_id        UUID        NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  name                TEXT        NOT NULL,
  duration_value      NUMERIC(6,2),               -- nulo = "tiempo indispensable"
  duration_unit       VARCHAR(20) NOT NULL,       -- CALENDAR_DAYS, WORKDAYS, MINUTES_PER_DAY...
  article_ref         VARCHAR(24),
  requires_evidence   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- La regla general del art. 22: se empieza a disfrutar el primer dia laborable
  -- despues del hecho causante.
  starts_next_workday BOOLEAN     NOT NULL DEFAULT FALSE,
  counted_in_workdays BOOLEAN     NOT NULL DEFAULT TRUE,
  notes               TEXT
);

COMMENT ON TABLE leave_type IS
  'Los permisos retribuidos del art. 22. La unidad de la duracion es tan importante como el numero';

-- ------------------------------------------- 8. REGIMEN DISCIPLINARIO
-- El escalado por inasistencia y las demas conductas detectables (art. 39). El
-- sistema PROPONE la calificacion; nunca la impone. 'requires_human_decision'
-- lo deja escrito: casi todas la exigen.
CREATE TABLE IF NOT EXISTS disciplinary_rule (
  rule_code               VARCHAR(16) PRIMARY KEY,
  agreement_id            UUID        NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  severity                VARCHAR(12) NOT NULL,   -- LEVE, GRAVE, MUY_GRAVE
  article_ref             VARCHAR(24),
  trigger_metric          VARCHAR(48) NOT NULL,   -- unjustified_absence_days, service_rejections...
  operator                VARCHAR(8),             -- =, >=, BETWEEN, MANUAL
  threshold               NUMERIC(8,2),
  -- El segundo extremo de un BETWEEN. La regla REJ_4_6 es "entre 4 y 6": sin
  -- esta columna, el 6 no cabe en ningun sitio y la regla no se puede evaluar.
  threshold_max           NUMERIC(8,2),
  window_unit             VARCHAR(12),            -- MONTH, QUARTER, SEMESTER, EVENT
  -- La sancion es un RANGO y sus extremos NO son homogeneos: pueden ser un
  -- numero de dias ('2', '31') o una medida con nombre ('WRITTEN_WARNING'). Por
  -- eso son texto, no entero: el convenio mezcla amonestacion con dias.
  sanction_min            VARCHAR(40),
  sanction_max            VARCHAR(40),
  sanction_unit           VARCHAR(40),
  auto_detect             BOOLEAN     NOT NULL DEFAULT FALSE,
  requires_human_decision BOOLEAN     NOT NULL DEFAULT TRUE,
  notes                   TEXT,
  CONSTRAINT ck_dis_sev CHECK (severity IN ('LEVE','GRAVE','MUY_GRAVE'))
);

COMMENT ON TABLE disciplinary_rule IS
  'Faltas detectables del art. 39. El sistema propone la calificacion, la decide una persona';

-- ------------------------------------------------------------------ 9. DIETAS
CREATE TABLE IF NOT EXISTS per_diem_rate (
  rate_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agreement_id UUID         NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  rate_code    VARCHAR(24)  NOT NULL,
  scope        VARCHAR(16)  NOT NULL,   -- NATIONAL, INTERNATIONAL, LOCAL
  amount       NUMERIC(8,2) NOT NULL,
  article_ref  VARCHAR(24),
  notes        TEXT,
  CONSTRAINT uq_perdiem UNIQUE (agreement_id, rate_code)
);

COMMENT ON TABLE per_diem_rate IS
  'Dietas del art. 27. Solo fuera de la Comunidad de Madrid, salvo la local de G3B';

-- --------------------------------------------------------------- 10. SEGUROS
CREATE TABLE IF NOT EXISTS insurance_coverage (
  coverage_id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agreement_id  UUID         NOT NULL REFERENCES collective_agreement(agreement_id) ON DELETE CASCADE,
  coverage_code VARCHAR(40)  NOT NULL,
  amount        NUMERIC(12,2) NOT NULL,
  article_ref   VARCHAR(24),
  notes         TEXT,
  CONSTRAINT uq_insurance UNIQUE (agreement_id, coverage_code)
);

COMMENT ON TABLE insurance_coverage IS
  'Coberturas de los arts. 31 y 32';

-- ------------------------------------------- 11. PLANTILLAS DE NOTIFICACION
-- El catalogo de comunicaciones al conductor (registro de jornada,
-- requerimientos, avisos). La REDACCION la valida la asesoria: por eso el seed
-- las carga DESACTIVADAS ('active = FALSE') y no salen hasta aprobarse.
--
-- Aqui va solo el catalogo. El motor de envio, la evidencia y las respuestas
-- son de un hito posterior; esta tabla es la que ese motor leera.
CREATE TABLE IF NOT EXISTS notification_template (
  template_id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code                    VARCHAR(40) NOT NULL,
  version                 SMALLINT    NOT NULL DEFAULT 1,
  channel                 VARCHAR(12) NOT NULL,   -- EMAIL, POSTAL, BUROFAX, IN_APP
  subject_tpl             TEXT,
  body_tpl                TEXT,
  attachment_types        TEXT[],
  requires_ack            BOOLEAN     NOT NULL DEFAULT FALSE,
  legal_reference         TEXT,
  applies_to_jornada_mode VARCHAR(20) NOT NULL DEFAULT 'ANY',   -- ANY, MARCO_TEMPORAL, HORARIO_CONCRETO
  requires_human_approval BOOLEAN     NOT NULL DEFAULT FALSE,
  approved_by             VARCHAR(120),
  approved_at             TIMESTAMPTZ,
  active                  BOOLEAN     NOT NULL DEFAULT FALSE,
  notes                   TEXT,
  CONSTRAINT uq_tpl UNIQUE (code, version)
);

COMMENT ON TABLE notification_template IS
  'Catalogo de comunicaciones al conductor. Se cargan desactivadas hasta que la asesoria valida la redaccion';

COMMIT;
