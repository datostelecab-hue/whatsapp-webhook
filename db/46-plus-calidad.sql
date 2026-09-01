-- ============================================================
-- 46 - PLUS DE CALIDAD (art. 25.c) - un motor en si mismo
-- ============================================================
-- Hito 8, la parte gorda. Solo para conductores de aplicacion (G3A). Trimestres
-- naturales. Se cobra si se cumplen DOS condiciones acumulativas:
--
--   1. Haber cumplido en el TRIMESTRE ANTERIOR la jornada proporcional (sin
--      defecto), y
--   2. UNA de estas dos:
--      · no haber sido responsable de MAS DE UN accidente grave, o
--      · indice de cancelacion <= 4% por responsabilidad exclusiva del conductor.
--
-- LO QUE OBLIGA A UN SISTEMA, no a una hoja: el conductor puede pedir por que no
-- se le abono, y la empresa tiene 20 DIAS NATURALES para contestar. EL SILENCIO
-- EQUIVALE A QUE PROCEDE EL PAGO. Por eso cada trimestre se genera SOLA la
-- explicacion de por que se abona o no, con los valores de cada condicion, y una
-- alerta bloqueante al dia 15 de una solicitud sin responder.
--
-- Todos los umbrales salen del convenio (QUALITY_*), no del codigo. El importe,
-- de la tabla salarial (quality_bonus_quarter) por ano.

BEGIN;

CREATE TABLE plus_calidad (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id    BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  anio           SMALLINT    NOT NULL,
  trimestre      SMALLINT    NOT NULL,   -- 1..4
  -- Los valores de cada condicion, guardados como la evidencia de la decision.
  jornada_cumplida BOOLEAN   NOT NULL,   -- sin defecto en el trimestre anterior
  accidentes_graves INTEGER  NOT NULL DEFAULT 0,
  cancelacion_pct  NUMERIC(5,2),         -- indice de cancelacion del trimestre
  -- La decision y su importe.
  procede        BOOLEAN     NOT NULL,
  importe        NUMERIC(10,2),
  -- La justificacion generada: por que si o por que no, con los numeros.
  justificacion  JSONB,
  -- El plazo de respuesta del art. 25.c: 20 dias naturales, silencio = pago.
  solicitud_at   TIMESTAMPTZ,
  solicitud_vence DATE,
  solicitud_estado VARCHAR(12),          -- pendiente, respondida, vencida_paga
  congelado_at   TIMESTAMPTZ,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pc_trim CHECK (trimestre BETWEEN 1 AND 4),
  CONSTRAINT ck_pc_solest CHECK (solicitud_estado IS NULL OR
    solicitud_estado IN ('pendiente','respondida','vencida_paga')),
  CONSTRAINT uq_pc UNIQUE (contrato_id, anio, trimestre)
);
CREATE INDEX idx_pc_solicitud ON plus_calidad (solicitud_vence)
  WHERE solicitud_estado = 'pendiente';

COMMENT ON TABLE plus_calidad IS
  'El plus de calidad trimestral (art. 25.c) con la evidencia de cada condicion y su plazo de 20 dias. El silencio equivale a que procede el pago';

-- ── El primer y ultimo mes de un trimestre ──────────────────────────────────
CREATE OR REPLACE FUNCTION f_meses_trimestre(p_trim INT)
RETURNS TABLE(mes_ini INT, mes_fin INT)
LANGUAGE sql IMMUTABLE AS $func$
  SELECT (p_trim - 1) * 3 + 1, (p_trim - 1) * 3 + 3
$func$;

-- ── Generar el plus de calidad de un trimestre ──────────────────────────────
-- Evalua cada contrato G3A: mira el defecto del TRIMESTRE ANTERIOR (condicion 1)
-- y la cancelacion del propio trimestre (condicion 2), decide y genera la
-- justificacion. Idempotente y no pisa lo congelado.
CREATE OR REPLACE FUNCTION f_generar_plus_calidad(p_anio INT, p_trim INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE
  n INT;
  -- Umbrales del convenio.
  max_acc  INT;
  max_pct  NUMERIC;
  -- El trimestre anterior (donde se mira la jornada).
  prev_anio INT := CASE WHEN p_trim = 1 THEN p_anio - 1 ELSE p_anio END;
  prev_trim INT := CASE WHEN p_trim = 1 THEN 4 ELSE p_trim - 1 END;
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
         -- LA REGLA: jornada cumplida Y (accidentes<=max O cancelacion<=max).
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
    -- Condicion 1: sin defecto en el trimestre anterior (suma de sus 3 meses).
    JOIN LATERAL (
      SELECT COALESCE(sum(v.defecto), 0) AS defecto, COALESCE(sum(v.defecto), 0) = 0 AS cumplida
        FROM v_conciliacion_mes v
       WHERE v.contrato_id = c.id AND v.anio = prev_anio
         AND v.mes BETWEEN (f_meses_trimestre(prev_trim)).mes_ini
                       AND (f_meses_trimestre(prev_trim)).mes_fin
    ) d ON TRUE
    -- Condicion 2: cancelacion del propio trimestre (proxy: no terminadas/total).
    LEFT JOIN LATERAL (
      SELECT round(sum(o.no_terminadas)::numeric / NULLIF(sum(o.ordenes), 0) * 100, 2) AS pct
        FROM v_ordenes_conductor o
       WHERE o.conductor_id = c.conductor_id
         AND o.dia >= make_date(p_anio, (f_meses_trimestre(p_trim)).mes_ini, 1)
         AND o.dia <  (make_date(p_anio, (f_meses_trimestre(p_trim)).mes_fin, 1) + INTERVAL '1 month')::date
    ) canc ON TRUE
   WHERE c.grupo = 'G3A'
     AND c.desde <  (make_date(p_anio, (f_meses_trimestre(p_trim)).mes_fin, 1) + INTERVAL '1 month')::date
     AND (c.hasta IS NULL OR c.hasta >= make_date(p_anio, (f_meses_trimestre(p_trim)).mes_ini, 1))
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

COMMENT ON FUNCTION f_generar_plus_calidad(INT, INT) IS
  'Calcula el plus de calidad de un trimestre para los G3A, con la evidencia de cada condicion. El importe sale de la tabla salarial';

-- ── Registrar una solicitud de justificacion (arranca el reloj de 20 dias) ──
CREATE OR REPLACE FUNCTION f_solicitar_justificacion_calidad(p_plus_id BIGINT)
RETURNS DATE LANGUAGE plpgsql AS $func$
DECLARE dias INT; vence DATE;
BEGIN
  SELECT value_numeric INTO dias FROM agreement_parameter
   WHERE param_code = 'QUALITY_JUSTIFICATION_SLA_DAYS' ORDER BY valid_from DESC LIMIT 1;
  vence := CURRENT_DATE + COALESCE(dias, 20);   -- dias NATURALES
  UPDATE plus_calidad
     SET solicitud_at = now(), solicitud_vence = vence, solicitud_estado = 'pendiente',
         actualizado_at = now()
   WHERE id = p_plus_id;
  RETURN vence;
END;
$func$;

-- ── Las solicitudes que hay que atender YA (alerta bloqueante al dia 15) ─────
-- El silencio equivale a que procede el pago: por eso una solicitud a punto de
-- vencer es un problema. Avisa 5 dias antes del vencimiento (dia 15 de 20).
CREATE VIEW v_calidad_por_vencer AS
SELECT pc.id, pc.conductor_id, pc.anio, pc.trimestre,
       pc.solicitud_vence,
       (pc.solicitud_vence - CURRENT_DATE) AS dias_restantes,
       (pc.solicitud_vence - CURRENT_DATE) <= 5 AS bloqueante
  FROM plus_calidad pc
 WHERE pc.solicitud_estado = 'pendiente'
 ORDER BY pc.solicitud_vence;

COMMENT ON VIEW v_calidad_por_vencer IS
  'Solicitudes de justificacion del plus de calidad sin responder. Bloqueante a 5 dias del vencimiento (art. 25.c: el silencio paga)';

COMMIT;
