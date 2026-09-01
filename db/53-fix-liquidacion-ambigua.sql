-- ============================================================
-- 53 - FIX: variable "total" ambigua en f_generar_liquidacion
-- ============================================================
-- Bug de la 52. La funcion declaraba una variable `total` y al final hacia
-- `UPDATE liquidacion SET total = round(total, 2)`: ahi `total` es a la vez la
-- COLUMNA y la VARIABLE, y Postgres lo rechaza con "column reference total is
-- ambiguous". La funcion reventaba y no creaba la liquidacion.
--
-- Se renombra la variable a `v_total`. Misma cuenta, sin colision.

BEGIN;

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
  v_total NUMERIC := 0;
BEGIN
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
  DELETE FROM liquidacion_linea WHERE liquidacion_id = liq_id;

  diario := f_salario_diario(ct_id, p_fecha_baja);

  -- 1. Descuento por falta de preaviso (solo baja voluntaria).
  IF p_tipo = 'voluntaria' THEN
    faltan := GREATEST(0, 7 - p_dias_preaviso);
    IF faltan > 0 AND diario IS NOT NULL THEN
      INSERT INTO liquidacion_linea (liquidacion_id, concepto, importe, detalle)
      VALUES (liq_id, 'descuento_preaviso', round(-faltan * diario, 2),
        jsonb_build_object('dias_no_preavisados', faltan, 'salario_diario', diario));
      v_total := v_total - faltan * diario;
    END IF;
  END IF;

  -- 2. Variables devengadas cuyo pago cae DESPUES de la baja.
  SELECT COALESCE(sum(importe), 0) INTO variables FROM variable_nomina
   WHERE conductor_id = p_conductor AND importe IS NOT NULL
     AND (pago_anio * 12 + pago_mes) > (EXTRACT(YEAR FROM p_fecha_baja)::int * 12
                                       + EXTRACT(MONTH FROM p_fecha_baja)::int);
  IF variables <> 0 THEN
    INSERT INTO liquidacion_linea (liquidacion_id, concepto, importe, detalle)
    VALUES (liq_id, 'variables_pendientes', round(variables, 2),
      jsonb_build_object('nota', 'Variables devengadas y no pagadas (a mes vencido)'));
    v_total := v_total + variables;
  END IF;

  -- 3. Vacaciones no disfrutadas.
  IF ct_id IS NOT NULL AND diario IS NOT NULL THEN
    SELECT value_numeric INTO base_vac FROM agreement_parameter
     WHERE param_code = 'VACATION_WORKDAYS_PER_YEAR' ORDER BY valid_from DESC LIMIT 1;
    dias_alta := (p_fecha_baja - GREATEST(
        (SELECT desde FROM contrato WHERE id = ct_id),
        make_date(EXTRACT(YEAR FROM p_fecha_baja)::int, 1, 1))) + 1;
    derecho := COALESCE(base_vac, 22) * dias_alta::numeric
             / ((make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,12,31)
               - make_date(EXTRACT(YEAR FROM p_fecha_baja)::int,1,1)) + 1);
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
      v_total := v_total + vac_pend * diario;
    END IF;
  END IF;

  UPDATE liquidacion SET total = round(v_total, 2) WHERE id = liq_id;
  RETURN liq_id;
END;
$func$;

COMMIT;
