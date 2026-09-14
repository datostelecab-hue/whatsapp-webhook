-- ============================================================
-- 108 · NÓMINAS — la nómina variable, en PostgreSQL
-- ============================================================
-- El módulo vivía sobre Google Sheets: leía las horas de la hoja mensual del
-- libro de horas, el DNI y la fecha de alta de AGENDA_V2, y guardaba su config,
-- su snapshot y sus meses congelados en tres hojas más. Además, para el
-- diagnóstico, llamaba a la API de BOLT desde una ruta.
--
-- Todo eso se acabó. Ahora:
--
--   HORAS, NOCTURNAS y UTILIZACIÓN  →  fv_tramo (la ingesta de BOLT)
--   DINERO (neto/propinas/peajes)   →  v_ordenes_conductor (bolt_order)
--   DNI, jornada, ETT y FECHA DE ALTA →  conductor + conductor_periodo_empleo
--
-- y lo que el módulo GUARDA vive en estas tres tablas.
--
-- POR QUÉ YA NO HACE FALTA EL "SNAPSHOT DE DATOS CRUDOS". En las hojas había que
-- guardarse una copia de los datos del mes para poder recalcular sin volver a
-- bajar de BOLT: la descarga tardaba minutos. Aquí la fuente ES la base y está
-- siempre: recalcular es una consulta. El snapshot sobra; lo que se guarda es
-- el RESULTADO congelado, que es otra cosa.
--
-- LO CONGELADO ES INMUTABLE. Una nómina pagada no se recalcula nunca más, pase
-- lo que pase después con los datos (se enlaza una cuenta de BOLT que faltaba,
-- se corrige una fecha de alta). Por eso la fila congelada guarda los NÚMEROS,
-- no una referencia para recalcularlos, y guarda al lado la config con la que
-- se hizo: un mes cerrado tiene que poder explicarse solo.

BEGIN;

-- ── Las tarifas y parámetros editables ─────────────────────────────────────
-- Era la hoja NOMINA_CONFIG. Una fila por parámetro; los que no estén se toman
-- de los valores por defecto del código. Se guarda quién lo cambió: una tarifa
-- movida sin querer cambia lo que cobran 200 personas.
CREATE TABLE IF NOT EXISTS nomina_config (
  clave          VARCHAR(32) PRIMARY KEY,
  valor          NUMERIC(12,4) NOT NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id     INTEGER REFERENCES usuario(id) ON DELETE SET NULL
);

COMMENT ON TABLE nomina_config IS
  'Tarifas y parámetros de la nómina variable (era la hoja NOMINA_CONFIG). Lo que no esté aquí sale de los valores por defecto del código';

-- ── La nómina de un mes, congelada ─────────────────────────────────────────
-- `mes`/`ano` son los del PAGO. `mes_datos`/`ano_datos`, los del TRABAJO: la
-- nómina va a mes vencido y la de julio se calcula con junio. Se guardan los dos
-- para que nadie tenga que acordarse de la regla al mirar una nómina vieja.
CREATE TABLE IF NOT EXISTS nomina_mes (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mes           SMALLINT NOT NULL,
  ano           SMALLINT NOT NULL,
  mes_datos     SMALLINT NOT NULL,
  ano_datos     SMALLINT NOT NULL,
  dias_del_mes  SMALLINT NOT NULL,
  -- La config con la que se calculó, tal cual. Que el mes sea reproducible sin
  -- depender de que nadie haya tocado nomina_config desde entonces.
  config        JSONB    NOT NULL,
  totales       JSONB    NOT NULL,
  avisos        JSONB,
  congelada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id    INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT uq_nomina_mes UNIQUE (mes, ano),
  CONSTRAINT ck_nomina_mes CHECK (mes BETWEEN 1 AND 12 AND mes_datos BETWEEN 1 AND 12),
  CONSTRAINT ck_nomina_ano CHECK (ano BETWEEN 2024 AND 2100)
);

COMMENT ON TABLE nomina_mes IS
  'Una nómina variable congelada. mes/ano = el del PAGO; mes_datos/ano_datos = el del TRABAJO (va a mes vencido)';
COMMENT ON COLUMN nomina_mes.config IS
  'La config usada al congelar, copiada. Un mes cerrado se explica solo, sin depender de nomina_config';

-- ── Lo que cobra cada persona en esa nómina ────────────────────────────────
-- El nombre y el DNI van COPIADOS, no solo el conductor_id: si mañana se corrige
-- un nombre o alguien se borra, la nómina de julio tiene que seguir diciendo lo
-- que decía el día que se firmó.
CREATE TABLE IF NOT EXISTS nomina_fila (
  nomina_id       BIGINT  NOT NULL REFERENCES nomina_mes(id) ON DELETE CASCADE,
  conductor_id    BIGINT  REFERENCES conductor(id) ON DELETE SET NULL,
  nombre          VARCHAR(160) NOT NULL,
  dni             VARCHAR(20),
  ett             BOOLEAN NOT NULL DEFAULT FALSE,
  jornada         SMALLINT,
  primer_dia      SMALLINT,
  alta            DATE,
  -- De dónde salió el día de arranque del prorrateo: alta-anterior | alta-en-mes
  -- | primer-log (sin fecha de alta, criterio viejo).
  origen_arranque VARCHAR(16),
  horas           NUMERIC(8,2)  NOT NULL DEFAULT 0,
  horas_objetivo  NUMERIC(8,2)  NOT NULL DEFAULT 0,
  delta_horas     NUMERIC(8,2)  NOT NULL DEFAULT 0,
  util_pct        NUMERIC(5,1),
  propinas        NUMERIC(10,2) NOT NULL DEFAULT 0,
  peajes          NUMERIC(10,2) NOT NULL DEFAULT 0,
  nocturnas       NUMERIC(10,2) NOT NULL DEFAULT 0,
  mbo_fas         NUMERIC(10,2) NOT NULL DEFAULT 0,
  mbo_hs_ext      NUMERIC(10,2) NOT NULL DEFAULT 0,
  compensacion    NUMERIC(10,2) NOT NULL DEFAULT 0,
  dias_extra      NUMERIC(8,2)  NOT NULL DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_nomina_fila ON nomina_fila (nomina_id);
-- "¿Cuánto ha cobrado esta persona de variable?" es una pregunta de ficha, y sin
-- este índice recorre la tabla entera.
CREATE INDEX IF NOT EXISTS idx_nomina_fila_cond ON nomina_fila (conductor_id);

COMMENT ON TABLE nomina_fila IS
  'Lo que cobra cada persona en una nómina congelada. Nombre y DNI van copiados: el pasado no cambia porque hoy se corrija una ficha';

COMMIT;
