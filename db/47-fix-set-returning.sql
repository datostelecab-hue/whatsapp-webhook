-- ============================================================
-- 47 - FIX: fuera las funciones auxiliares set-returning
-- ============================================================
-- Bug de la 45 y la 46. f_mes_siguiente y f_meses_trimestre se declararon
-- RETURNS TABLE, que las hace SET-RETURNING, y usarlas en un WHERE es ilegal en
-- Postgres ("set-returning functions are not allowed in WHERE"). Por eso
-- f_generar_plus_calidad reventaba y plus_calidad se quedaba vacia.
--
-- El arreglo es tonto: la aritmetica del mes siguiente y de los meses de un
-- trimestre es una cuenta de una linea. Va EN LINEA en cada generador, y las dos
-- funciones auxiliares sobran. Se rehacen los cuatro generadores y se borran.

BEGIN;

-- ── Nocturnidad ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION f_generar_nocturnidad(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT ct.id, r.conductor_id, 'nocturnidad', p_anio, p_mes,
         CASE WHEN p_mes = 12 THEN p_anio + 1 ELSE p_anio END,
         CASE WHEN p_mes = 12 THEN 1 ELSE p_mes + 1 END,
         sum(r.nocturno_min), 'MIN', NULL
    FROM registro_jornada r
    JOIN LATERAL (SELECT id FROM contrato c WHERE c.conductor_id = r.conductor_id
                   AND c.desde <= r.dia AND (c.hasta IS NULL OR c.hasta >= r.dia)
                   ORDER BY c.desde DESC LIMIT 1) ct ON TRUE
   WHERE r.dia >= make_date(p_anio, p_mes, 1)
     AND r.dia <  (make_date(p_anio, p_mes, 1) + INTERVAL '1 month')::date
     AND COALESCE(r.nocturno_min, 0) > 0
   GROUP BY ct.id, r.conductor_id
  ON CONFLICT (contrato_id, tipo, devengo_anio, devengo_mes) DO UPDATE SET
    cantidad = EXCLUDED.cantidad, actualizado_at = now()
    WHERE variable_nomina.congelado_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

-- ── Propinas ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION f_generar_propinas(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT ct.id, o.conductor_id, 'propina', p_anio, p_mes,
         CASE WHEN p_mes = 12 THEN p_anio + 1 ELSE p_anio END,
         CASE WHEN p_mes = 12 THEN 1 ELSE p_mes + 1 END,
         round(sum(o.propina), 2), 'EUR', round(sum(o.propina), 2)
    FROM v_ordenes_conductor o
    JOIN LATERAL (SELECT id FROM contrato c WHERE c.conductor_id = o.conductor_id
                   AND c.desde <= o.dia AND (c.hasta IS NULL OR c.hasta >= o.dia)
                   ORDER BY c.desde DESC LIMIT 1) ct ON TRUE
   WHERE o.dia >= make_date(p_anio, p_mes, 1)
     AND o.dia <  (make_date(p_anio, p_mes, 1) + INTERVAL '1 month')::date
   GROUP BY ct.id, o.conductor_id
  HAVING sum(o.propina) > 0
  ON CONFLICT (contrato_id, tipo, devengo_anio, devengo_mes) DO UPDATE SET
    cantidad = EXCLUDED.cantidad, importe = EXCLUDED.importe, actualizado_at = now()
    WHERE variable_nomina.congelado_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

-- ── Horas extraordinarias ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION f_generar_horas_extra(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT cc.contrato_id, c.conductor_id, 'hora_extra', p_anio, p_mes,
         CASE WHEN p_mes = 12 THEN p_anio + 1 ELSE p_anio END,
         CASE WHEN p_mes = 12 THEN 1 ELSE p_mes + 1 END,
         cc.exceso, 'MIN', NULL
    FROM cierre_conciliacion cc
    JOIN periodo_nomina p ON p.id = cc.periodo_id AND p.anio = p_anio AND p.mes = p_mes
    JOIN contrato c ON c.id = cc.contrato_id
   WHERE cc.exceso > 0
  ON CONFLICT (contrato_id, tipo, devengo_anio, devengo_mes) DO UPDATE SET
    cantidad = EXCLUDED.cantidad, actualizado_at = now()
    WHERE variable_nomina.congelado_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

-- ── Plus de calidad ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION f_generar_plus_calidad(p_anio INT, p_trim INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE
  n INT;
  max_acc INT;
  max_pct NUMERIC;
  prev_anio INT := CASE WHEN p_trim = 1 THEN p_anio - 1 ELSE p_anio END;
  prev_trim INT := CASE WHEN p_trim = 1 THEN 4 ELSE p_trim - 1 END;
  -- Los meses, ya en escalares (sin funcion set-returning).
  mes_ini INT := (p_trim - 1) * 3 + 1;
  mes_fin INT := (p_trim - 1) * 3 + 3;
  prev_ini INT := (prev_trim - 1) * 3 + 1;
  prev_fin INT := (prev_trim - 1) * 3 + 3;
BEGIN
  SELECT value_numeric INTO max_acc FROM agreement_parameter
   WHERE param_code = 'QUALITY_MAX_SERIOUS_ACCIDENTS' ORDER BY valid_from DESC LIMIT 1;
  SELECT value_numeric INTO max_pct FROM agreement_parameter
   WHERE param_code = 'QUALITY_MAX_CANCELLATION_PCT' ORDER BY valid_from DESC LIMIT 1;

  INSERT INTO plus_calidad
    (contrato_id, conductor_id, anio, trimestre, jornada_cumplida,
     accidentes_graves, cancelacion_pct, procede, importe, justificacion)
  SELECT c.id, c.conductor_id, p_anio, p_trim,
         d.cumplida, 0, canc.pct,
         (d.cumplida AND (0 <= max_acc OR COALESCE(canc.pct, 0) <= max_pct)),
         CASE WHEN (d.cumplida AND (0 <= max_acc OR COALESCE(canc.pct, 0) <= max_pct))
              THEN str.quality_bonus_quarter END,
         jsonb_build_object(
           'jornada_cumplida', d.cumplida,
           'defecto_trim_anterior_min', d.defecto,
           'accidentes_graves', 0, 'max_accidentes', max_acc,
           'cancelacion_pct', canc.pct, 'max_cancelacion_pct', max_pct,
           'trimestre_jornada', prev_anio || '-T' || prev_trim)
    FROM contrato c
    JOIN salary_table_row str ON str.agreement_id = c.agreement_id
                             AND str.professional_group = c.grupo AND str.year = p_anio
    JOIN LATERAL (
      SELECT COALESCE(sum(v.defecto), 0) AS defecto, COALESCE(sum(v.defecto), 0) = 0 AS cumplida
        FROM v_conciliacion_mes v
       WHERE v.contrato_id = c.id AND v.anio = prev_anio
         AND v.mes BETWEEN prev_ini AND prev_fin
    ) d ON TRUE
    LEFT JOIN LATERAL (
      SELECT round(sum(o.no_terminadas)::numeric / NULLIF(sum(o.ordenes), 0) * 100, 2) AS pct
        FROM v_ordenes_conductor o
       WHERE o.conductor_id = c.conductor_id
         AND o.dia >= make_date(p_anio, mes_ini, 1)
         AND o.dia <  (make_date(p_anio, mes_fin, 1) + INTERVAL '1 month')::date
    ) canc ON TRUE
   WHERE c.grupo = 'G3A'
     AND c.desde <  (make_date(p_anio, mes_fin, 1) + INTERVAL '1 month')::date
     AND (c.hasta IS NULL OR c.hasta >= make_date(p_anio, mes_ini, 1))
  ON CONFLICT (contrato_id, anio, trimestre) DO UPDATE SET
     jornada_cumplida = EXCLUDED.jornada_cumplida,
     cancelacion_pct = EXCLUDED.cancelacion_pct,
     procede = EXCLUDED.procede, importe = EXCLUDED.importe,
     justificacion = EXCLUDED.justificacion, actualizado_at = now()
     WHERE plus_calidad.congelado_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

-- Ya no las usa nadie: fuera.
DROP FUNCTION IF EXISTS f_mes_siguiente(INT, INT);
DROP FUNCTION IF EXISTS f_meses_trimestre(INT);

COMMIT;
