-- ============================================================
-- 33 - EL OBJETIVO MENSUAL DE JORNADA
-- ============================================================
-- Hito 3, primera pieza. Cuantos minutos de trabajo efectivo debe una persona
-- cada mes. Es contra lo que se compara al cierre para saber si hay defecto de
-- jornada o exceso (horas extra).
--
-- LA CORRECCION C1 DEL SPEC, EN LA BASE. El convenio distribuye la jornada
-- anual (1776 h) de forma irregular EN COMPUTO MENSUAL (art. 18.1). Asi que el
-- objetivo no es diario: es un numero por mes, y el mes se compara entero. La
-- deteccion de anomalias sigue siendo diaria (solapes, trabajo en IT, exceso de
-- 8h), pero el CONTRA QUE se compara el residuo es mensual.
--
-- COMO SE REPARTE. Prorrateo por dias naturales:
--
--   objetivo_min(mes) = base_anual_horas * 60 * dias_de_alta_en_el_mes
--                                              / dias_del_anio
--
-- Neutral, auditable y sensible a la longitud del mes: enero pesa mas que
-- febrero, y la suma de los doce meses de un ano completo da la jornada anual.
-- Un alta a mitad de mes prorratea sola porque "dias de alta" ya lo recoge.
--
-- DE DONDE SALE EL 1776. NO esta escrito aqui: se lee de agreement_parameter
-- (ANNUAL_EFFECTIVE_HOURS) del convenio que le aplica a ESA persona, vigente en
-- ESE mes. El dia que el convenio cambie la jornada anual, el objetivo cambia
-- solo. Esa es toda la gracia del Hito 0.

BEGIN;

-- ── Dias de un mes que cubre un rango [desde, hasta] ────────────────────────
-- La interseccion de la vigencia de un contrato con un mes concreto. Si el
-- contrato empezo el 8 de julio, en julio cuenta del 8 al 31 = 24 dias.
CREATE OR REPLACE FUNCTION f_dias_alta_mes(
  p_desde DATE, p_hasta DATE, p_anio INT, p_mes INT
) RETURNS INT
LANGUAGE plpgsql IMMUTABLE AS $func$
DECLARE
  ini DATE := make_date(p_anio, p_mes, 1);
  fin DATE := (make_date(p_anio, p_mes, 1) + INTERVAL '1 month' - INTERVAL '1 day')::date;
  a   DATE := GREATEST(p_desde, ini);
  b   DATE := LEAST(COALESCE(p_hasta, fin), fin);
BEGIN
  IF b < a THEN RETURN 0; END IF;      -- el rango no toca este mes
  RETURN (b - a) + 1;                  -- ambos extremos incluidos
END;
$func$;

COMMENT ON FUNCTION f_dias_alta_mes(DATE, DATE, INT, INT) IS
  'Dias de un mes cubiertos por [desde, hasta]. Nulo en hasta = sigue vigente';

-- ── El objetivo de un contrato en un mes ────────────────────────────────────
-- Lee la base anual del convenio del propio contrato y prorratea. Devuelve NULL
-- si no encuentra la base o el contrato: mejor un hueco visible que un cero que
-- parece un objetivo de verdad.
CREATE OR REPLACE FUNCTION f_objetivo_min(
  p_contrato_id BIGINT, p_anio INT, p_mes INT
) RETURNS INT
LANGUAGE plpgsql STABLE AS $func$
DECLARE
  c           contrato%ROWTYPE;
  primero     DATE := make_date(p_anio, p_mes, 1);
  base_horas  NUMERIC;
  dias_anio   INT := (make_date(p_anio, 12, 31) - make_date(p_anio, 1, 1)) + 1;  -- 365 o 366
  dias_alta   INT;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- La jornada anual del convenio que le aplica, vigente ese mes. Global
  -- (scope_group NULL): la jornada de 1776 h no distingue grupo.
  SELECT value_numeric INTO base_horas
    FROM agreement_parameter
   WHERE agreement_id = c.agreement_id
     AND param_code   = 'ANNUAL_EFFECTIVE_HOURS'
     AND scope_group IS NULL
     AND valid_from <= primero
     AND (valid_to IS NULL OR valid_to >= primero)
   ORDER BY valid_from DESC
   LIMIT 1;
  IF base_horas IS NULL THEN RETURN NULL; END IF;

  dias_alta := f_dias_alta_mes(c.desde, c.hasta, p_anio, p_mes);
  IF dias_alta = 0 THEN RETURN 0; END IF;

  -- base_horas es NUMERIC, asi que toda la cuenta es NUMERIC: no hay division
  -- entera que se coma los decimales antes de redondear.
  RETURN round(base_horas * 60 * dias_alta::numeric / dias_anio);
END;
$func$;

COMMENT ON FUNCTION f_objetivo_min(BIGINT, INT, INT) IS
  'Minutos de trabajo que debe un contrato en un mes. Prorrateo por dias de alta, con la base anual del convenio';

-- ── La tabla: un objetivo materializado por contrato y mes ──────────────────
-- Se guarda, no se calcula al vuelo, por dos razones del propio convenio:
--   · Se COMUNICA por anticipado (publicado_at). Lo comunicado no puede cambiar
--     a posteriori sin que se note.
--   · Al cerrar el mes se CONGELA. El objetivo con el que se cerro una nomina
--     es parte de esa nomina y no se recalcula nunca.
CREATE TABLE objetivo_mensual (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id         BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  anio                SMALLINT    NOT NULL,
  mes                 SMALLINT    NOT NULL,
  objetivo_min        INTEGER     NOT NULL,
  -- Como se obtuvo. El prorrateo por calendario es el normal; MANUAL para un
  -- ajuste con motivo, PLAN_COLECTIVO para un reparto pactado distinto.
  derivacion          VARCHAR(24) NOT NULL DEFAULT 'PRORRATEO_CALENDARIO',
  -- Con que se calculo, guardado para poder reproducirlo aunque el convenio
  -- cambie despues. Un objetivo tiene que poder explicarse a quien lo recibe.
  base_horas_anuales  NUMERIC(7,2) NOT NULL,
  dias_alta           INTEGER     NOT NULL,
  dias_anio           SMALLINT    NOT NULL,
  -- La comunicacion anticipada al conductor (art. 18.1: el reparto se comunica).
  publicado_at        TIMESTAMPTZ,
  publicado_por       INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  -- Cuando se congelo al cerrar el mes. La FK al periodo de nomina se anade con
  -- el Hito 7; por ahora basta la marca de que ya no se toca.
  congelado_at        TIMESTAMPTZ,
  creado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_obj_mes CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT ck_obj_deriv CHECK (derivacion IN ('PRORRATEO_CALENDARIO','MANUAL','PLAN_COLECTIVO')),
  CONSTRAINT uq_objetivo UNIQUE (contrato_id, anio, mes)
);
CREATE INDEX idx_objetivo_mes ON objetivo_mensual (anio, mes);

COMMENT ON TABLE objetivo_mensual IS
  'El objetivo de jornada de cada contrato y mes. Se materializa porque se comunica antes y se congela al cierre';

-- ── Generar los objetivos de un mes ─────────────────────────────────────────
-- Crea el objetivo de todos los contratos activos en ese mes. Idempotente y NO
-- SOBRESCRIBE: si ya hay una fila (publicada, congelada o ajustada a mano), la
-- respeta. Para rehacer una, se borra antes a proposito.
CREATE OR REPLACE FUNCTION f_generar_objetivos(p_anio INT, p_mes INT)
RETURNS INT
LANGUAGE plpgsql AS $func$
DECLARE
  creados INT;
BEGIN
  INSERT INTO objetivo_mensual
    (contrato_id, anio, mes, objetivo_min, base_horas_anuales, dias_alta, dias_anio)
  SELECT c.id, p_anio, p_mes,
         f_objetivo_min(c.id, p_anio, p_mes),
         (SELECT value_numeric FROM agreement_parameter
            WHERE agreement_id = c.agreement_id AND param_code = 'ANNUAL_EFFECTIVE_HOURS'
              AND scope_group IS NULL
              AND valid_from <= make_date(p_anio, p_mes, 1)
              AND (valid_to IS NULL OR valid_to >= make_date(p_anio, p_mes, 1))
            ORDER BY valid_from DESC LIMIT 1),
         f_dias_alta_mes(c.desde, c.hasta, p_anio, p_mes),
         (make_date(p_anio, 12, 31) - make_date(p_anio, 1, 1)) + 1
    FROM contrato c
    -- Solo los que estan activos algun dia de ese mes.
   WHERE f_dias_alta_mes(c.desde, c.hasta, p_anio, p_mes) > 0
     AND f_objetivo_min(c.id, p_anio, p_mes) IS NOT NULL
  ON CONFLICT (contrato_id, anio, mes) DO NOTHING;
  GET DIAGNOSTICS creados = ROW_COUNT;
  RETURN creados;
END;
$func$;

COMMENT ON FUNCTION f_generar_objetivos(INT, INT) IS
  'Crea el objetivo mensual de cada contrato activo en el mes. Idempotente, no pisa lo ya generado';

COMMIT;
