-- ============================================================
-- 298 — LOS DESCUENTOS EN NÓMINA (MÓDULO 4.2 DEL PLAN DE RR. HH.)
-- ============================================================
-- El encargo (4.2): efectivo pendiente de Recaudación («Aplicar descuento en
-- nómina»: solo se descuenta lo marcado; al cerrar la nómina la deuda queda
-- saldada en Recaudación), kilómetros fuera de la aplicación, negligencias de
-- Taller (siniestro con importe, fotos y fecha) y sustracción de combustible
-- (nunca automático, con visto bueno de Legal). Modelo: DescuentoPendiente
-- (conductor, origen, importe, evidencia, estado, periodo, saldo restante).
-- Ningún descuento sin aprobación entra en la nómina.
--
-- Camilo, 26/11/2026:
--   · Los km salen del BANCO DE KM: el exceso de cada semana cerrada, a un
--     precio por km (Parámetros, 1 € por defecto).
--   · Quién aprueba: una LLAVE, '/descuentos/aprobar', que se da a quien se
--     quiera desde Usuarios. Proponer es otra, '/descuentos/proponer'.
--   · Sin tope: RR. HH. aplaza a mano (entero o una parte), con su saldo.
--   · Conceptos de A3: efectivo 753, km 758, siniestro 751, combustible y
--     otros 754 (Parámetros).
--
-- `descuento_nomina`: lo que se le descontará a alguien. Estados:
--   pendiente (por aprobar) → aprobado → aplicado (descontado entero)
--                                      → aplazado (le queda saldo: sigue en el
--                                        mes siguiente)
--   y anulado (con motivo).
-- `periodo` es el mes de nómina en que se descuenta ('AAAA-MM': la del 26 al 25).
-- `descuento_aplicacion`: cada vez que se descuenta algo (al cerrar un mes).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/298', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS descuento_nomina (
  id               BIGSERIAL PRIMARY KEY,
  conductor_id     BIGINT        NOT NULL REFERENCES conductor(id),
  origen           VARCHAR(12)   NOT NULL,
  origen_id        TEXT,
  concepto         VARCHAR(4)    NOT NULL,
  importe          NUMERIC(10,2) NOT NULL CHECK (importe > 0),
  saldo            NUMERIC(10,2) NOT NULL CHECK (saldo >= 0),
  -- Lo que se descuenta este mes, si es menos que el saldo (lo demás se aplaza al cerrar).
  a_descontar      NUMERIC(10,2) CHECK (a_descontar IS NULL OR a_descontar > 0),
  periodo          VARCHAR(7)    NOT NULL,
  fecha            DATE          NOT NULL,
  motivo           TEXT          NOT NULL,
  evidencia        JSONB,
  estado           VARCHAR(10)   NOT NULL DEFAULT 'pendiente',
  visto_legal      TEXT,
  nota             TEXT,
  aprobado_at      TIMESTAMPTZ,
  aprobado_por     INTEGER REFERENCES usuario(id),
  cerrado_at       TIMESTAMPTZ,
  cerrado_por      INTEGER REFERENCES usuario(id),
  creado_por       INTEGER REFERENCES usuario(id),
  creado_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_descuento_origen CHECK (origen IN ('efectivo', 'km', 'siniestro', 'combustible', 'otro')),
  CONSTRAINT ck_descuento_estado CHECK (estado IN ('pendiente', 'aprobado', 'aplicado', 'aplazado', 'anulado')),
  CONSTRAINT ck_descuento_periodo CHECK (periodo ~ '^\d{4}-\d{2}$'),
  CONSTRAINT ck_descuento_saldo CHECK (saldo <= importe),
  -- El combustible no se aprueba sin el visto bueno de Legal (el encargo).
  CONSTRAINT ck_descuento_combustible CHECK (origen <> 'combustible' OR estado IN ('pendiente', 'anulado') OR btrim(COALESCE(visto_legal, '')) <> '')
);

-- El que viene solo (los km de una semana) no nace dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_descuento_origen ON descuento_nomina (origen, origen_id) WHERE origen_id IS NOT NULL AND estado <> 'anulado';
CREATE INDEX IF NOT EXISTS ix_descuento_periodo ON descuento_nomina (periodo, estado);
CREATE INDEX IF NOT EXISTS ix_descuento_conductor ON descuento_nomina (conductor_id);

COMMENT ON TABLE descuento_nomina IS
  'Módulo 4.2 (db/298): lo que se descuenta en nómina (efectivo, km, siniestro, combustible, otro). Pendiente hasta que lo aprueba quien tiene /descuentos/aprobar; al cerrar el mes, aplicado o aplazado con su saldo.';

CREATE TABLE IF NOT EXISTS descuento_aplicacion (
  id            BIGSERIAL PRIMARY KEY,
  descuento_id  BIGINT        NOT NULL REFERENCES descuento_nomina(id),
  periodo       VARCHAR(7)    NOT NULL,
  importe       NUMERIC(10,2) NOT NULL CHECK (importe > 0),
  -- El movimiento «nómina» de Recaudación que saldó la deuda (los de efectivo).
  movimiento_id BIGINT,
  usuario_id    INTEGER REFERENCES usuario(id),
  creado_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_descuento_aplicacion ON descuento_aplicacion (descuento_id);

SELECT auditoria_vigilar('descuento_nomina');
SELECT auditoria_vigilar('descuento_aplicacion');

-- ── Las llaves: mirar y proponer, Diana e Ignacio. Aprobar, a quien se quiera (Usuarios). ──
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/descuentos'), (20, 'Diana', '/descuentos/proponer'),
               (1, 'Ignacio', '/descuentos'), (1, 'Ignacio', '/descuentos/proponer')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
