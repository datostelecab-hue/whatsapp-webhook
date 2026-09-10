-- ============================================================
-- AUDITORÍA DE FLOTA — el resultado, en PostgreSQL
-- ============================================================
-- Hasta ahora el histórico de la auditoría vivía en tres pestañas de un Google
-- Sheet, y cada consulta se leía los rangos enteros (A:S, A:N, A:B) para
-- filtrar en memoria. Eso tenía tres problemas: la hoja crece sin control, la
-- API de Sheets tiene cuota, y no se le puede preguntar nada — ni "los km fuera
-- de servicio de este coche en agosto", ni "cuánto rodó Fulano en descanso".
--
-- ── Qué se guarda, y qué NO ─────────────────────────────────────────────────
-- Se guarda el RESULTADO, no la materia prima. La traza GPS punto a punto de
-- Mapon —que es lo que permite repartir cada metro entre los estados— son unos
-- 200.000 puntos al día para 144 coches: guardarla sería multiplicar por mil el
-- tamaño de la base para responder a las mismas preguntas. Se consume al vuelo
-- durante el cálculo y lo que queda es el reparto ya hecho.
--
-- La consecuencia hay que tenerla clara: recalcular un día pasado exige volver
-- a pedirle a Mapon su traza, y Mapon solo guarda 31 días. Más allá de eso, lo
-- que hay en estas tablas es lo único que hay.
--
-- ── Por qué el conductor va en su propia tabla ──────────────────────────────
-- La hoja metía los conductores de un tramo en una celda, separados por comas.
-- Servía para leerlo, no para preguntarlo. Con una fila por conductor se puede
-- ir al revés —de la persona a los km que hizo fuera de servicio— que es la
-- mitad de las preguntas que se le hacen a este módulo.

BEGIN;

-- ── El reparto de kilómetros ────────────────────────────────────────────────
-- Un coche, un día, un tramo. Los tramos se solapan a propósito: 'completo' es
-- el día natural entero y los demás son cortes suyos (turnos y mitades), así
-- que NO se suman entre ellos. Cada uno responde a una pregunta distinta.
CREATE TABLE auditoria_km (
  dia           DATE         NOT NULL,
  tramo         VARCHAR(9)   NOT NULL,
  placa         VARCHAR(16)  NOT NULL,
  -- El coche de nuestra flota, si lo reconocemos. Puede faltar: BOLT ve
  -- matrículas que aún no están dadas de alta aquí, y perder esa línea sería
  -- justo perder la que hay que mirar.
  vehiculo_id   BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,
  vehiculo      VARCHAR(60),

  -- La distancia la pone SIEMPRE Mapon, y los cinco cubos suman km_mapon: una
  -- sola fuente para el total y para las partes, sin descuadres entre APIs.
  km_mapon      NUMERIC(9,2) NOT NULL DEFAULT 0,
  km_pasajero   NUMERIC(9,2) NOT NULL DEFAULT 0,
  km_ida        NUMERIC(9,2) NOT NULL DEFAULT 0,
  km_espera     NUMERIC(9,2) NOT NULL DEFAULT 0,
  km_descanso   NUMERIC(9,2) NOT NULL DEFAULT 0,
  km_fuera      NUMERIC(9,2) NOT NULL DEFAULT 0,

  -- Las horas por estado cazan el descanso largo aunque no ruede ni un metro.
  h_pedido      NUMERIC(7,2) NOT NULL DEFAULT 0,
  h_espera      NUMERIC(7,2) NOT NULL DEFAULT 0,
  h_descanso    NUMERIC(7,2) NOT NULL DEFAULT 0,
  h_fuera       NUMERIC(7,2) NOT NULL DEFAULT 0,

  -- Lo que BOLT dice que facturó, para contrastar con lo que midió el GPS.
  km_bolt       NUMERIC(9,2) NOT NULL DEFAULT 0,
  viajes_bolt   INTEGER      NOT NULL DEFAULT 0,

  calculado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  PRIMARY KEY (dia, tramo, placa),
  CONSTRAINT ck_audkm_tramo CHECK (tramo IN ('completo','dia','noche','manana','tarde')),
  CONSTRAINT ck_audkm_km    CHECK (km_mapon >= 0 AND km_pasajero >= 0 AND km_ida >= 0
                                   AND km_espera >= 0 AND km_descanso >= 0 AND km_fuera >= 0),
  CONSTRAINT ck_audkm_horas CHECK (h_pedido >= 0 AND h_espera >= 0 AND h_descanso >= 0 AND h_fuera >= 0)
);

-- Las dos preguntas que se hacen: "enséñame un día" y "enséñame este coche".
CREATE INDEX idx_audkm_dia   ON auditoria_km (dia DESC, tramo);
CREATE INDEX idx_audkm_placa ON auditoria_km (placa, dia DESC);
CREATE INDEX idx_audkm_veh   ON auditoria_km (vehiculo_id, dia DESC) WHERE vehiculo_id IS NOT NULL;
-- Los km "no disponibles" son la razón de ser del módulo: el índice parcial
-- saca las líneas que importan sin recorrer las que están limpias.
CREATE INDEX idx_audkm_fuera ON auditoria_km (dia DESC, (km_descanso + km_fuera))
  WHERE km_descanso + km_fuera > 0;

COMMENT ON TABLE auditoria_km IS
  'Reparto de los km GPS de Mapon segun el estado del conductor en BOLT. Un coche, un dia, un tramo. Los tramos se solapan: NO se suman entre si';
COMMENT ON COLUMN auditoria_km.km_descanso IS
  'Rodo marcandose ocupado en BOLT: no estaba disponible para la flota';
COMMENT ON COLUMN auditoria_km.km_fuera IS
  'Rodo con la app cerrada';

-- ── Quién iba dentro ────────────────────────────────────────────────────────
-- Una fila por conductor y tramo. Sale de los state logs, no del planificador:
-- es quien BOLT vio de verdad conectado con ese coche.
CREATE TABLE auditoria_km_conductor (
  dia           DATE         NOT NULL,
  tramo         VARCHAR(9)   NOT NULL,
  placa         VARCHAR(16)  NOT NULL,
  driver_uuid   VARCHAR(64)  NOT NULL,
  nombre        VARCHAR(120),
  conductor_id  BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  PRIMARY KEY (dia, tramo, placa, driver_uuid),
  FOREIGN KEY (dia, tramo, placa) REFERENCES auditoria_km (dia, tramo, placa) ON DELETE CASCADE
);
CREATE INDEX idx_audcond_driver ON auditoria_km_conductor (driver_uuid, dia DESC);
CREATE INDEX idx_audcond_cond   ON auditoria_km_conductor (conductor_id, dia DESC) WHERE conductor_id IS NOT NULL;

COMMENT ON TABLE auditoria_km_conductor IS
  'Quien conducia cada coche en cada tramo, segun los state logs de BOLT. Permite ir de la persona a sus km fuera de servicio';

-- ── Repostajes ──────────────────────────────────────────────────────────────
-- Subidas y bajadas bruscas del nivel de combustible que ve Mapon. Una bajada
-- brusca con el coche parado no es un repostaje: es lo que hay que mirar.
CREATE TABLE auditoria_repostaje (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dia           DATE         NOT NULL,
  ocurrido_at   TIMESTAMPTZ,
  orden         SMALLINT     NOT NULL DEFAULT 0,
  placa         VARCHAR(16)  NOT NULL,
  vehiculo_id   BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,
  vehiculo      VARCHAR(60),
  tipo          VARCHAR(16),
  litros        NUMERIC(8,2),
  nivel_antes   NUMERIC(6,2),
  lat           NUMERIC(10,6),
  lng           NUMERIC(10,6),
  direccion     VARCHAR(200),
  fuente        VARCHAR(16),
  calculado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Recalcular un día no puede duplicar sus repostajes.
  CONSTRAINT uq_audrep UNIQUE (dia, placa, orden)
);
CREATE INDEX idx_audrep_dia   ON auditoria_repostaje (dia DESC);
CREATE INDEX idx_audrep_placa ON auditoria_repostaje (placa, dia DESC);

-- ── Qué días están calculados ───────────────────────────────────────────────
-- Y con qué resultado. Un día que falló tiene que poder distinguirse de un día
-- que nunca se intentó: el primero se reintenta, el segundo se programa.
CREATE TABLE auditoria_dia (
  dia           DATE        PRIMARY KEY,
  calculado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok            BOOLEAN     NOT NULL DEFAULT TRUE,
  error         TEXT,
  coches        INTEGER     NOT NULL DEFAULT 0,
  segundos      INTEGER,
  CONSTRAINT ck_auddia_error CHECK (ok OR error IS NOT NULL)
);
CREATE INDEX idx_auddia_ko ON auditoria_dia (dia DESC) WHERE NOT ok;

COMMENT ON TABLE auditoria_dia IS
  'Que dias se han calculado y con que resultado. Un dia fallido se reintenta; uno que nunca se intento, se programa';

COMMIT;
