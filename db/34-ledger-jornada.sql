-- ============================================================
-- 34 - EL LEDGER DE JORNADA: un asiento por hecho
-- ============================================================
-- Hito 3, segunda pieza. El libro donde entra TODO lo que le pasa a la jornada
-- de una persona: cada hora trabajada, cada dia de vacaciones, cada
-- justificacion. Un asiento por hecho, con su origen, su version y su EFECTO.
--
-- POR QUE UN LIBRO Y NO UNA CELDA. Hasta ahora una hora era un numero en una
-- casilla que se reescribia. Aqui no se reescribe nada: un hecho es una fila y
-- las correcciones son filas nuevas. De ahi sale toda la trazabilidad — se
-- puede llegar desde cualquier total del mes hasta el hecho de origen.
--
-- EL EFECTO VA EN EL ASIENTO, NO SOLO EN EL CATALOGO. El tipo dice como afecta
-- a la obligacion (cumple, resta, cubre, neutro), pero eso se COPIA al asiento
-- cuando entra. Si manana el convenio recalifica un tipo, los asientos viejos
-- conservan el efecto que tenian: la nomina de marzo no cambia porque en junio
-- se cambie una regla. Es la regla de oro "el pasado no se reescribe", en la
-- estructura.
--
-- LA RECONCILIACION SE CALCULA POR DIA Y SE COMPARA POR MES. El asiento es
-- diario -asi se ven solapes, trabajo en IT, exceso de 8h-, pero el residuo se
-- contrasta contra el objetivo MENSUAL (art. 18.1). La vista del final es esa
-- cuenta: NETA = BRUTA - REDUCE, y de ahi DEFECTO y EXCESO.

BEGIN;

CREATE TABLE asiento_jornada (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo  DATE        NOT NULL,
  -- Que clase de hecho es. El catalogo (ledger_entry_type) viene del convenio.
  tipo           VARCHAR(24) NOT NULL REFERENCES ledger_entry_type(entry_type_code),
  -- El efecto COPIADO del tipo al entrar. Lo rellena el disparador de abajo si
  -- no se pasa, y se queda congelado aunque el catalogo cambie despues.
  efecto         VARCHAR(12) NOT NULL,
  -- La magnitud del hecho, en minutos. Puede ser 0 en marcas que solo senalan
  -- algo (una recogida de vehiculo, un fichaje) sin sumar tiempo por si mismas.
  minutos        INTEGER     NOT NULL DEFAULT 0,
  -- Para el trabajo efectivo: cual de los supuestos del art. 18.6 lo justifica.
  -- Nulo en lo que no es trabajo efectivo.
  supuesto_te    VARCHAR(8)  REFERENCES effective_work_case(case_code),
  -- De donde viene el hecho y en que version de esos datos. La version sube
  -- cuando el origen corrige algo ya ingerido.
  origen         VARCHAR(20) NOT NULL,
  version        INTEGER     NOT NULL DEFAULT 1,
  -- El id del hecho en su origen (la sesion de BOLT, el justificante...). Es lo
  -- que permite reingerir sin duplicar: ver el indice unico de mas abajo.
  ref_externa    VARCHAR(80),
  nota           TEXT,
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Append-only al estilo de la casa (como justificante): no se borra, se anula.
  -- La correccion de un hecho es anular el asiento y meter otro, nunca editarlo.
  anulado_at     TIMESTAMPTZ,
  anulado_por    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_asiento_efecto CHECK (efecto IN ('FULFILLS','REDUCES','COVERS','NEUTRAL')),
  CONSTRAINT ck_asiento_min CHECK (minutos >= 0),
  CONSTRAINT ck_asiento_origen CHECK (origen IN ('bolt','manual','justificacion','sistema','importacion'))
);

CREATE INDEX idx_asiento_cond_dia ON asiento_jornada (conductor_id, dia_operativo) WHERE anulado_at IS NULL;
CREATE INDEX idx_asiento_dia ON asiento_jornada (dia_operativo) WHERE anulado_at IS NULL;

-- IDEMPOTENCIA DE LA INGESTA. El mismo hecho de origen no puede entrar dos
-- veces vivo. Reingerir un mes de BOLT no duplica nada: el que ya esta se
-- reconoce por (origen, ref_externa). Solo aplica a lo que tiene referencia; lo
-- manual sin referencia puede repetirse a proposito.
CREATE UNIQUE INDEX uq_asiento_ref ON asiento_jornada (origen, ref_externa)
  WHERE anulado_at IS NULL AND ref_externa IS NOT NULL;

COMMENT ON TABLE asiento_jornada IS
  'El libro de jornada: un asiento por hecho, con origen, version y efecto. Append-only: se anula, no se borra';
COMMENT ON COLUMN asiento_jornada.efecto IS
  'Copia del efecto del tipo al entrar. Congelado: si el catalogo cambia, el asiento viejo conserva el suyo';

-- ── El efecto se copia del catálogo al entrar ───────────────────────────────
-- Si el asiento entra sin efecto, se toma el del tipo. Asi quien inserta no
-- tiene que saberselo, y queda grabado el que regia ESE dia.
CREATE OR REPLACE FUNCTION tg_asiento_efecto() RETURNS TRIGGER
LANGUAGE plpgsql AS $func$
BEGIN
  IF NEW.efecto IS NULL THEN
    SELECT obligation_effect INTO NEW.efecto
      FROM ledger_entry_type WHERE entry_type_code = NEW.tipo;
  END IF;
  RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_asiento_efecto
  BEFORE INSERT ON asiento_jornada
  FOR EACH ROW EXECUTE FUNCTION tg_asiento_efecto();

-- ── La reconciliación del mes ───────────────────────────────────────────────
-- Junta el objetivo (materializado en objetivo_mensual) con lo que dice el
-- libro, y saca las cinco cifras que importan. Cada asiento se imputa al
-- contrato que estaba vigente el dia del hecho.
--
--   BRUTA   el objetivo del mes
--   REDUCE  vacaciones, IT, permisos, suspensiones (efecto REDUCES)
--   NETA    max(0, BRUTA - REDUCE)      lo que de verdad hay que cumplir
--   CUMPLE  trabajo efectivo (FULFILLS)
--   CUBRE   justificaciones de taller, trafico, operativa, RRHH (COVERS)
--   DEFECTO max(0, NETA - CUMPLE - CUBRE)   lo que falta
--   EXCESO  max(0, CUMPLE - NETA)           horas extra (art. 20)
CREATE VIEW v_conciliacion_mes AS
WITH mov AS (
  SELECT c.id AS contrato_id,
         EXTRACT(YEAR  FROM a.dia_operativo)::int AS anio,
         EXTRACT(MONTH FROM a.dia_operativo)::int AS mes,
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'REDUCES'),  0) AS reduce,
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'FULFILLS'), 0) AS cumple,
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'COVERS'),   0) AS cubre
    FROM asiento_jornada a
    JOIN contrato c ON c.conductor_id = a.conductor_id
                   AND a.dia_operativo >= c.desde
                   AND (c.hasta IS NULL OR a.dia_operativo <= c.hasta)
   WHERE a.anulado_at IS NULL
   GROUP BY c.id, 2, 3
)
SELECT o.contrato_id,
       o.anio,
       o.mes,
       o.objetivo_min                                             AS bruta,
       COALESCE(m.reduce, 0)                                      AS reduce,
       GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))        AS neta,
       COALESCE(m.cumple, 0)                                      AS cumple,
       COALESCE(m.cubre, 0)                                       AS cubre,
       GREATEST(0, GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))
                   - COALESCE(m.cumple, 0) - COALESCE(m.cubre, 0)) AS defecto,
       GREATEST(0, COALESCE(m.cumple, 0)
                   - GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))) AS exceso
  FROM objetivo_mensual o
  LEFT JOIN mov m ON m.contrato_id = o.contrato_id
                 AND m.anio = o.anio AND m.mes = o.mes;

COMMENT ON VIEW v_conciliacion_mes IS
  'La cuenta del mes: BRUTA, REDUCE, NETA, CUMPLE, CUBRE, DEFECTO, EXCESO. Se calcula por dia (el asiento) y se compara por mes (el objetivo)';

COMMIT;
