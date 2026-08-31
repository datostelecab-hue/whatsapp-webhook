-- ============================================================
-- 32 - EL CONTRATO: bajo que terminos trabaja cada persona
-- ============================================================
-- Hito 1. Junta al conductor con el convenio. Hasta ahora el nucleo sabia SI
-- alguien estaba de alta (conductor_periodo_empleo) pero no BAJO QUE TERMINOS:
-- que convenio le aplica, en que grupo profesional esta, y como se le mide la
-- jornada. Eso es el contrato, y de el cuelga casi todo el modulo de RRHH.
--
-- DOS COSAS SEPARADAS, A PROPOSITO:
--   · conductor_periodo_empleo responde "esta de alta?" — el alta y la baja.
--   · contrato responde "en que condiciones?" — convenio, grupo, jornada.
-- Se separan porque cambian a ritmos distintos: una persona sigue de alta el
-- dia que pasa de marco temporal a horario concreto, o el dia que asciende de
-- grupo. Eso es un contrato nuevo, no una baja y un alta.
--
-- LAS DOS COLUMNAS QUE LO MOTIVAN (spec C1):
--   · jornada_mode  MARCO_TEMPORAL   el conductor ordena su jornada (art. 18.1),
--                                    el computo es MENSUAL. Es el caso normal.
--                   HORARIO_CONCRETO horario fijo de entrada y salida. Entonces
--                                    el computo vuelve a ser diario.
--     Determina QUE se le puede reclamar y con que plantilla (art. 39, spec 5).
--   · target_policy MONTHLY_POOL     el objetivo se compara al cierre del mes.
--                   CALENDAR_DAILY   dia a dia, como la v1.
--     Va de la mano del anterior, pero se guarda aparte porque son preguntas
--     distintas y el dia de manana podrian no ir siempre juntas.

BEGIN;

CREATE TABLE contrato (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id        BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- El periodo de alta al que pertenece este contrato. Nulo tolerado para poder
  -- cargar contratos historicos antes de tener el periodo cruzado, pero lo
  -- normal es que apunte a su alta.
  periodo_empleo_id   BIGINT      REFERENCES conductor_periodo_empleo(id) ON DELETE SET NULL,

  -- QUE CONVENIO Y QUE GRUPO. La identidad del grupo es (convenio, codigo): el
  -- FK compuesto obliga a que el grupo exista en ESE convenio, no en otro.
  agreement_id        UUID        NOT NULL REFERENCES collective_agreement(agreement_id),
  grupo               VARCHAR(8)  NOT NULL,

  -- COMO SE MIDE LA JORNADA. Los valores por defecto son los del conductor de
  -- aplicacion (G3A), que es la inmensa mayoria de la plantilla.
  jornada_mode        VARCHAR(20) NOT NULL DEFAULT 'MARCO_TEMPORAL',
  target_policy       VARCHAR(20) NOT NULL DEFAULT 'MONTHLY_POOL',

  -- Vigencia del contrato. 'hasta' nulo = vigente.
  desde               DATE        NOT NULL,
  hasta               DATE,

  usuario_id          INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_contrato_rango CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ck_contrato_jornada CHECK (jornada_mode IN ('MARCO_TEMPORAL','HORARIO_CONCRETO')),
  CONSTRAINT ck_contrato_target  CHECK (target_policy IN ('MONTHLY_POOL','CALENDAR_DAILY')),

  -- El grupo tiene que ser uno del convenio que se le aplica.
  CONSTRAINT fk_contrato_grupo FOREIGN KEY (agreement_id, grupo)
    REFERENCES professional_group (agreement_id, group_code),

  -- EL CRITERIO DE ACEPTACION DEL HITO, EN UNA LINEA: una persona no puede
  -- tener dos contratos vigentes a la vez. Cambiar de condiciones es cerrar el
  -- anterior y abrir otro, con fechas que no se pisan. Lo impide la base.
  CONSTRAINT ex_contrato_solape EXCLUDE USING gist
    (conductor_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);

CREATE INDEX idx_contrato_conductor ON contrato (conductor_id, desde);
CREATE INDEX idx_contrato_vigente   ON contrato (conductor_id) WHERE hasta IS NULL;

COMMENT ON TABLE contrato IS
  'Bajo que terminos trabaja cada persona: convenio, grupo y modo de jornada, con vigencia. Uno vigente como mucho por conductor';
COMMENT ON COLUMN contrato.jornada_mode IS
  'MARCO_TEMPORAL (computo mensual, el conductor ordena su jornada) u HORARIO_CONCRETO (computo diario). Determina que se le puede reclamar';
COMMENT ON COLUMN contrato.target_policy IS
  'MONTHLY_POOL (el objetivo se compara al cierre del mes) o CALENDAR_DAILY';

-- ── Qué contrato tenía cada quién en una fecha ──────────────────────────────
-- La otra mitad del criterio: "se responde por consulta que contrato habia en
-- una fecha". Se deja como vista para no reescribir el JOIN con los nombres del
-- convenio en cada pantalla que lo necesite.
--
-- Para preguntar por HOY: ... WHERE en_fecha IS NULL usa el vigente.
-- Para una fecha pasada, se filtra por el rango en la propia consulta; la vista
-- solo ahorra el JOIN, no fija la fecha.
CREATE VIEW v_contrato AS
SELECT c.id,
       c.conductor_id,
       co.nombre                       AS conductor,
       c.grupo,
       pg.name                         AS grupo_nombre,
       c.agreement_id,
       ca.code                         AS convenio,
       c.jornada_mode,
       c.target_policy,
       c.desde,
       c.hasta,
       (c.hasta IS NULL)               AS vigente
  FROM contrato c
  JOIN conductor co            ON co.id = c.conductor_id
  JOIN collective_agreement ca ON ca.agreement_id = c.agreement_id
  JOIN professional_group pg   ON pg.agreement_id = c.agreement_id AND pg.group_code = c.grupo;

COMMENT ON VIEW v_contrato IS
  'El contrato con los nombres del convenio ya resueltos. Filtra por desde/hasta para una fecha concreta';

COMMIT;
