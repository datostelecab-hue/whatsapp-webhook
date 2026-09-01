-- ============================================================
-- 52 - LIQUIDACIONES DE MASA (art. 11; spec 12)
-- ============================================================
-- Hito 12, el ultimo de calculo. Con 1.000 altas al ano hay ~1.000 bajas: la
-- liquidacion es un proceso de MASA, no una excepcion. Tres cosas que el propio
-- convenio contempla y que se calculan solas:
--
--   · DESCUENTO POR FALTA DE PREAVISO (art. 11). La baja voluntaria se preavisa
--     7 dias naturales. Lo no preavisado se descuenta: dias que faltaron x
--     (salario diario + prorrata de pagas extras). Solo en baja voluntaria.
--   · VARIABLES DEVENGADAS SIN PAGAR. Las variables se pagan a mes vencido, asi
--     que al cesar SIEMPRE queda al menos un mes devengado sin pagar. La
--     liquidacion las recoge obligatoriamente: no se cierra sin ellas.
--   · VACACIONES NO DISFRUTADAS. El derecho prorrateado a la fecha de baja menos
--     lo consumido, en dinero.
--
-- El salario diario sale de la tabla salarial (el bruto mensual ya lleva dentro
-- la prorrata de las extras). Nada en el codigo.

BEGIN;

CREATE TABLE liquidacion (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  contrato_id    BIGINT      REFERENCES contrato(id) ON DELETE SET NULL,
  fecha_baja     DATE        NOT NULL,
  tipo_baja      VARCHAR(24) NOT NULL,   -- voluntaria, despido, fin_contrato, no_supero_prueba
  -- El preaviso: lo exigido (7) y lo que de verdad avis'o.
  preaviso_exigido SMALLINT  NOT NULL DEFAULT 7,
  dias_preavisados SMALLINT  NOT NULL DEFAULT 0,
  estado         VARCHAR(10) NOT NULL DEFAULT 'borrador',   -- borrador, cerrada
  total          NUMERIC(12,2),
  creada_por     VARCHAR(120),
  creada_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_at     TIMESTAMPTZ,
  CONSTRAINT ck_liq_tipo CHECK (tipo_baja IN
    ('voluntaria','despido','fin_contrato','no_supero_prueba')),
  CONSTRAINT ck_liq_estado CHECK (estado IN ('borrador','cerrada')),
  CONSTRAINT uq_liq UNIQUE (conductor_id, fecha_baja)
);

COMMENT ON TABLE liquidacion IS
  'La liquidacion de una baja. Proceso de masa: ~1.000 al ano. El descuento por preaviso y las variables pendientes se calculan solos';

CREATE TABLE liquidacion_linea (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  liquidacion_id BIGINT      NOT NULL REFERENCES liquidacion(id) ON DELETE CASCADE,
  concepto       VARCHAR(28) NOT NULL,   -- descuento_preaviso, variables_pendientes, vacaciones_no_disfrutadas
  importe        NUMERIC(12,2) NOT NULL, -- positivo suma, negativo resta
  detalle        JSONB,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_liqlin ON liquidacion_linea (liquidacion_id);

COMMENT ON TABLE liquidacion_linea IS
  'Cada concepto de una liquidacion, con su importe con signo. La suma es el finiquito';

-- ── Salario diario de un contrato ───────────────────────────────────────────
-- Bruto mensual / 30. El bruto ya lleva la prorrata de las extras, asi que el
-- diario incluye "salario + parte proporcional de pagas extras" del art. 11.
CREATE OR REPLACE FUNCTION f_salario_diario(p_contrato BIGINT, p_fecha DATE)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $func$
DECLARE c contrato%ROWTYPE; bruto NUMERIC;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT gross_monthly INTO bruto FROM salary_table_row
   WHERE agreement_id = c.agreement_id AND professional_group = c.grupo
     AND year = EXTRACT(YEAR FROM p_fecha)::int;
  IF bruto IS NULL THEN RETURN NULL; END IF;
  RETURN round(bruto / 30.0, 4);
END;
$func$;

-- ── Generar la liquidacion de una baja ──────────────────────────────────────
-- Crea la liquidacion y sus lineas: preaviso, variables pendientes, vacaciones.
-- Idempotente: si ya existe (por conductor y fecha), se rehacen sus lineas.
CREATE OR REPLACE FUNCTION f_generar_liquidacion(
  p_conductor BIGINT, p_fecha_baja DATE, p_tipo VARCHAR, p_dias_preaviso INT, p_quien VARCHAR)
RETURNS BIGINT LANGUAGE plpgsql AS $func$
DECLARE
  liq_id BIGINT;
  ct_id BIGINT;
  diario NUMERIC;
  faltan INT;
  base_vac NUMERIC;
  dias_alta INT;
  derecho NUMERIC;
  consumidas INT;
  vac_pend NUMERIC;
  variables NUMERIC;
  total NUMERIC := 0;
BEGIN
  -- El contrato vigente a la fecha de baja.
  SELECT id INTO ct_id FROM contrato
   WHERE conductor_id = p_conductor AND desde <= p_fecha_baja
     AND (hasta IS NULL OR hasta >= p_fecha_baja)
   ORDER BY desde DESC LIMIT 1;

  INSERT INTO liquidacion (conductor_id, contrato_id, fecha_baja, tipo_baja,
                           dias_preavisados, creada_por)
  VALUES (p_conductor, ct_id, p_fecha_baja, p_tipo, p_dias_preaviso, p_quien)
  ON CONFLICT (conductor_id, fecha_baja) DO UPDATE SET
    tipo_baja = EXCLUDED.tipo_baja, dias_preavisados = EXCLUDED.dias_preavisados
  RETURNING id INTO liq_id;
  -- Rehacer las lineas.
  DELETE FROM liquidacion_linea WHERE liquidacion_id = liq_id;

  diario := f_salario_diario(ct_id, p_fecha_baja);

  -- 1. Descuento por falta de preaviso (solo baja voluntaria).
  IF p_tipo = 'voluntaria' THEN
    faltan := GREATEST(0, 7 - p_dias_preaviso);
    IF faltan > 0 AND diario IS NOT NULL THEN
      INSERT INTO liquidacion_linea (liquidacion_id, concepto, importe, detalle)
      VALUES (liq_id, 'descuento_preaviso', round(-faltan * diario, 2),
        jsonb_build_object('dias_no_preavisados', faltan, 'salario_diario', diario));
      total := total - faltan * diario;
    END IF;
  END IF;

  -- 2. Variables devengadas cuyo pago cae DESPUES de la baja: se pagan aqui.
  SELECT COALESCE(sum(importe), 0) INTO variables FROM variable_nomina
   WHERE conductor_id = p_conductor AND importe IS NOT NULL
     AND (pago_anio * 12 + pago_mes) > (EXTRACT(YEAR FROM p_fecha_baja)::int * 12
                                       + EXTRACT(MONTH FROM p_fecha_baja)::int);
  IF variables <> 0 THEN
    INSERT INTO liquidacion_linea (liquidacion_id, concepto, importe, detalle)
    VALUES (liq_id, 'variables_pendientes', round(variables, 2),
      jsonb_build_object('nota', 'Variables devengadas y no pagadas (a mes vencido)'));
    total := total + variables;
  END IF;

  -- 3. Vacaciones no disfrutadas: derecho prorrateado a la baja menos lo consumido.
  IF ct_id IS NOT NULL AND diario IS NOT NULL THEN
    SELECT value_numeric INTO base_vac FROM agreement_parameter
     WHERE param_code = 'VACATION_WORKDAYS_PER_YEAR' ORDER BY valid_from DESC LIMIT 1;
    dias_alta := (p_fecha_baja - GREATEST(
        (SELECT desde FROM contrato WHERE id = ct_id),
        make_date(EXTRACT(YEAR FROM p_fecha_baja)::int, 1, 1))) + 1;
    derecho := COALESCE(base_vac, 22) * dias_alta::numeric
             / ((make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,12,31)
               - make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,1,1)) + 1);
    -- Dias de vacaciones ya disfrutados este ano.
    SELECT COALESCE(sum((LEAST(COALESCE(hasta, p_fecha_baja), p_fecha_baja)
                       - GREATEST(desde, make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,1,1))) + 1), 0)
      INTO consumidas
      FROM conductor_estado_hist
     WHERE conductor_id = p_conductor AND estado = 'vacaciones'
       AND desde <= p_fecha_baja
       AND (hasta IS NULL OR hasta >= make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,1,1));
    vac_pend := round(derecho, 1) - COALESCE(consumidas, 0);
    IF vac_pend > 0 THEN
      INSERT INTO liquidacion_linea (liquidacion_id, concepto, importe, detalle)
      VALUES (liq_id, 'vacaciones_no_disfrutadas', round(vac_pend * diario, 2),
        jsonb_build_object('dias', round(vac_pend,1), 'derecho', round(derecho,1),
                           'consumidas', consumidas, 'salario_diario', diario));
      total := total + vac_pend * diario;
    END IF;
  END IF;

  UPDATE liquidacion SET total = round(total, 2) WHERE id = liq_id;
  RETURN liq_id;
END;
$func$;

COMMENT ON FUNCTION f_generar_liquidacion(BIGINT, DATE, VARCHAR, INT, VARCHAR) IS
  'Genera la liquidacion de una baja: descuento por preaviso, variables pendientes y vacaciones no disfrutadas';

-- ── Cerrar la liquidacion (control BLOQUEANTE de variables) ──────────────────
-- No se cierra si quedan variables devengadas del conductor sin recoger en la
-- liquidacion. Es el control del spec 7.3: nunca se liquida a alguien dejandose
-- variables por pagar.
CREATE OR REPLACE FUNCTION f_cerrar_liquidacion(p_id BIGINT, p_quien VARCHAR)
RETURNS VOID LANGUAGE plpgsql AS $func$
DECLARE liq liquidacion%ROWTYPE; pendientes NUMERIC; recogidas NUMERIC;
BEGIN
  SELECT * INTO liq FROM liquidacion WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la liquidacion %', p_id; END IF;
  IF liq.estado = 'cerrada' THEN RAISE EXCEPTION 'La liquidacion % ya esta cerrada', p_id; END IF;

  SELECT COALESCE(sum(importe), 0) INTO pendientes FROM variable_nomina
   WHERE conductor_id = liq.conductor_id AND importe IS NOT NULL
     AND (pago_anio * 12 + pago_mes) > (EXTRACT(YEAR FROM liq.fecha_baja)::int * 12
                                       + EXTRACT(MONTH FROM liq.fecha_baja)::int);
  SELECT COALESCE(sum(importe), 0) INTO recogidas FROM liquidacion_linea
   WHERE liquidacion_id = p_id AND concepto = 'variables_pendientes';
  IF round(pendientes, 2) <> round(recogidas, 2) THEN
    RAISE EXCEPTION 'Hay variables devengadas sin recoger (% vs %). Regenera la liquidacion antes de cerrar',
      round(pendientes, 2), round(recogidas, 2);
  END IF;

  UPDATE liquidacion SET estado = 'cerrada', cerrada_at = now() WHERE id = p_id;
END;
$func$;

COMMENT ON FUNCTION f_cerrar_liquidacion(BIGINT, VARCHAR) IS
  'Cierra una liquidacion. BLOQUEA si quedan variables devengadas sin recoger (spec 7.3)';

COMMIT;
