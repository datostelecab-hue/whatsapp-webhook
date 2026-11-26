-- ============================================================
-- 300 — EL CATÁLOGO DE CONCEPTOS DE A3 Y LAS LÍNEAS DEL MES (MÓDULO 4)
-- ============================================================
-- El encargo: «el catálogo de conceptos y las líneas, cada una con su
-- origen». Lo que se escribe en el lienzo de A3NOM (la plantilla de
-- importación «Conceptos» que manda la gestoría: un trabajador por fila, una
-- columna por concepto, «066 - PACTO PR (I)»).
--
-- Camilo, 26/11/2026:
--   · De la variable del mes (/nominas): el MBO (el mayor de los dos) → 066,
--     la nocturnidad → 053, las propinas → 519 y los peajes → 607.
--   · De Descuentos en nómina (db/298): cada descuento con su concepto (753,
--     758, 751, 754).
--   · Lo demás se apunta a mano, con motivo.
--   · En Gestoría, pestaña «Variables»; lo gestiona quien gestiona la
--     gestoría ('/gestoria/gestionar').
--
-- `nomina_concepto`: el catálogo. `cabecera` es el texto exacto de la columna
-- del lienzo (se busca por el código, no por la letra). `origen` dice de dónde
-- sale: una pieza de la variable (una sola por pieza), 'descuento' o 'manual'.
-- `nomina_linea`: lo que se le paga o descuenta a alguien en un mes de nómina
-- ('AAAA-MM', la del 26 al 25) por un concepto. Las que salen del ERP se
-- rehacen al «Preparar»; las de a mano se anulan con motivo.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/300', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS nomina_concepto (
  -- `id` para el libro de auditoría (auditoria_vigilar); se busca por el código.
  id          BIGSERIAL    PRIMARY KEY,
  codigo      VARCHAR(4)   NOT NULL UNIQUE,
  nombre      TEXT         NOT NULL,
  cabecera    TEXT         NOT NULL,
  tipo        VARCHAR(10)  NOT NULL,
  origen      VARCHAR(24)  NOT NULL DEFAULT 'manual',
  orden       INTEGER      NOT NULL DEFAULT 100,
  activo      BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_concepto_codigo CHECK (codigo ~ '^\d{1,4}$'),
  CONSTRAINT ck_concepto_tipo CHECK (tipo IN ('devengo', 'deduccion')),
  CONSTRAINT ck_concepto_origen CHECK (origen IN ('variable_mbo', 'variable_nocturnidad', 'variable_propinas', 'variable_peajes', 'descuento', 'manual'))
);
-- Cada pieza de la variable va a un solo concepto.
CREATE UNIQUE INDEX IF NOT EXISTS uq_concepto_variable ON nomina_concepto (origen) WHERE origen LIKE 'variable_%';

COMMENT ON TABLE nomina_concepto IS
  'Módulo 4 (db/300): los conceptos de A3NOM del lienzo de importación, con de dónde sale cada uno (variable del mes, descuentos o a mano).';

INSERT INTO nomina_concepto (codigo, nombre, cabecera, tipo, origen, orden) VALUES
  ('066', 'Pacto productividad (MBO)',   '066 - PACTO PR (I)', 'devengo',   'variable_mbo',          10),
  ('753', 'Descuento devolución efectivo', '753 - DTO EFEC (I)', 'deduccion', 'descuento',           20),
  ('519', 'Propinas',                     '519 - Propinas (I)', 'devengo',   'variable_propinas',     30),
  ('059', 'Dietas',                       '059 - DIETAS   (I)', 'devengo',   'manual',                40),
  ('039', 'Horas',                        '039 - Horas de (I)', 'devengo',   'manual',                50),
  ('607', 'Peaje y parking',              '607 - PEAJE/PA (I)', 'devengo',   'variable_peajes',       60),
  ('751', 'Descuento franquicia',         '751 - DTO FRAN (I)', 'deduccion', 'descuento',             70),
  ('752', 'Penalización',                 '752 - PENALIZA (I)', 'deduccion', 'manual',                80),
  ('754', 'Descuento',                    '754 - DESCUENT (I)', 'deduccion', 'descuento',             90),
  ('609', 'Notas de gasto',               '609 - NOTAS DE (I)', 'devengo',   'manual',               100),
  ('015', 'Plus de calidad',              '015 - P.Calida (I)', 'devengo',   'manual',               110),
  ('012', 'Festivos',                     '012 - Festivos (I)', 'devengo',   'manual',               120),
  ('053', 'Nocturnidad',                  '053 - Nocturni (I)', 'devengo',   'variable_nocturnidad', 130),
  ('145', 'Regularización',               '145 - REGULARI (I)', 'devengo',   'manual',               140),
  ('790', 'Descuento por absentismo',     '790 - Dto.Abs. (I)', 'deduccion', 'manual',               150),
  ('008', 'Plus de actividad',            '008 - P.Activi (I)', 'devengo',   'manual',               160),
  ('758', 'Descuento vehículo',           '758 - DTO VEHÍ (I)', 'deduccion', 'descuento',            170)
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS nomina_linea (
  id              BIGSERIAL PRIMARY KEY,
  periodo         VARCHAR(7)    NOT NULL,
  conductor_id    BIGINT        NOT NULL REFERENCES conductor(id),
  concepto        VARCHAR(4)    NOT NULL REFERENCES nomina_concepto(codigo),
  importe         NUMERIC(10,2) NOT NULL CHECK (importe <> 0),
  origen          VARCHAR(10)   NOT NULL,
  -- Lo que explica la cifra: «FAS» u «horas extra», «2 descuentos»…
  detalle         TEXT,
  motivo          TEXT,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_linea_periodo CHECK (periodo ~ '^\d{4}-\d{2}$'),
  CONSTRAINT ck_linea_origen CHECK (origen IN ('variable', 'descuento', 'manual')),
  CONSTRAINT ck_linea_manual CHECK (origen <> 'manual' OR btrim(COALESCE(motivo, '')) <> ''),
  CONSTRAINT ck_linea_anulada CHECK (anulado_at IS NULL OR btrim(COALESCE(anulado_motivo, '')) <> '')
);
CREATE INDEX IF NOT EXISTS ix_linea_periodo ON nomina_linea (periodo, concepto) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_linea_conductor ON nomina_linea (conductor_id);

COMMENT ON TABLE nomina_linea IS
  'Módulo 4 (db/300): lo que se escribe en el lienzo de A3 de cada mes de nómina, una línea por persona y concepto, con su origen (variable, descuento o a mano).';

SELECT auditoria_vigilar('nomina_concepto');
SELECT auditoria_vigilar('nomina_linea');

COMMIT;
