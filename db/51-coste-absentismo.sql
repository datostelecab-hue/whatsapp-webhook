-- ============================================================
-- 51 - EL COSTE REAL DEL ABSENTISMO (spec 6)
-- ============================================================
-- Hito 11. No cuantos dias se pierden, sino CUANTO CUESTA. Dos magnitudes que
-- NO son lo mismo y se reportan por separado:
--
--   COSTE SOPORTADO  lo que la empresa paga de su bolsillo por esa hora que no
--                    se trabaja (salario + cotizacion), cuando la hora es pagada.
--   LUCRO CESANTE    lo que esa hora HABRIA facturado y no facturo.
--
-- Una baja disciplinaria no cuesta salario (no se paga) pero si lucro cesante.
-- Unas vacaciones cuestan las dos cosas -pero son estructurales, no absentismo-.
--
-- LA DIMENSION QUE LO CONVIERTE EN HERRAMIENTA: el MODULO RESPONSABLE. Una
-- parada de taller es coste de Taller; no tener vehiculo es coste de Trafico.
-- Con eso el informe tiene destinatario: "las paradas de taller costaron 41.000
-- este trimestre" va a Taller, no a un cajon comun.

BEGIN;

-- ── El modelo de coste (sus parametros, versionados) ────────────────────────
CREATE TABLE cost_model_version (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  valid_from        DATE        NOT NULL,
  valid_to          DATE,
  -- Cotizacion empresarial sobre el salario. [VL 4]: es fiscal, no lo fija el
  -- convenio. Se pone un valor de arranque y se ajusta.
  employer_ss_pct   NUMERIC(5,2) NOT NULL DEFAULT 31.40,
  annual_hours      NUMERIC(7,2) NOT NULL DEFAULT 1776,
  overhead_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,     -- estructura imputable, opcional
  revenue_source    VARCHAR(16) NOT NULL DEFAULT 'BOLT_ACTUAL',
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_cmv_source CHECK (revenue_source IN ('BOLT_ACTUAL','MANUAL','CENTER_AVERAGE'))
);
INSERT INTO cost_model_version (valid_from) VALUES (DATE '2024-09-01');

COMMENT ON TABLE cost_model_version IS
  'Los parametros del modelo de coste: cotizacion empresarial [VL 4], base de horas, de donde sale el ingreso por hora';

-- ── Que modulo carga con el coste de cada tipo de asiento ───────────────────
ALTER TABLE ledger_entry_type
  ADD COLUMN IF NOT EXISTS modulo_responsable VARCHAR(14);

UPDATE ledger_entry_type SET modulo_responsable = m.modulo FROM (VALUES
  ('VACATION',           'estructural'),   -- coste estructural, no absentismo
  ('SICK_LEAVE_IT',      'it'),
  ('PAID_LEAVE',         'rrhh'),
  ('TRAINING_LEAVE',     'rrhh'),
  ('MANDATORY_TRAINING', 'rrhh'),
  ('UNPAID_LEAVE',       'estructural'),
  ('SUSPENSION_DISC',    'disciplinario'),
  ('SUSPENSION_PERMISO', 'rrhh'),
  ('JUST_WORKSHOP',      'taller'),
  ('JUST_TRAFFIC',       'trafico'),
  ('JUST_OPERATIONAL',   'operaciones'),
  ('JUST_HR',            'rrhh'),
  ('UNJUSTIFIED_ABSENCE','disciplinario')
) AS m(codigo, modulo) WHERE ledger_entry_type.entry_type_code = m.codigo;

COMMENT ON COLUMN ledger_entry_type.modulo_responsable IS
  'Que modulo carga con el coste de este tipo. Es lo que da destinatario al informe de absentismo';

-- ── El coste de una hora de un contrato ─────────────────────────────────────
-- (bruto anual + cotizacion) / horas anuales. El bruto sale de la tabla
-- salarial; la cotizacion, del modelo de coste. Nada en el codigo.
CREATE OR REPLACE FUNCTION f_coste_hora(p_contrato BIGINT, p_anio INT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $func$
DECLARE
  c contrato%ROWTYPE;
  bruto_mes NUMERIC;
  cmv cost_model_version%ROWTYPE;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT gross_monthly INTO bruto_mes FROM salary_table_row
   WHERE agreement_id = c.agreement_id AND professional_group = c.grupo AND year = p_anio;
  IF bruto_mes IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO cmv FROM cost_model_version
   WHERE valid_from <= make_date(p_anio, 1, 1) AND (valid_to IS NULL OR valid_to >= make_date(p_anio, 1, 1))
   ORDER BY valid_from DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- bruto anual = mensual x 12 (la prorrata de extras ya esta dentro del mensual).
  RETURN round((bruto_mes * 12) * (1 + cmv.employer_ss_pct/100 + cmv.overhead_pct/100) / cmv.annual_hours, 4);
END;
$func$;

-- ── El ingreso por hora efectiva de un conductor en un mes ──────────────────
-- Facturacion neta del mes / horas efectivas del mes. De BOLT (las ordenes) y
-- del registro. Si no trabajo, es NULL: no se puede repartir lucro sin ingreso.
CREATE OR REPLACE FUNCTION f_ingreso_hora(p_conductor BIGINT, p_anio INT, p_mes INT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $func$
DECLARE neto NUMERIC; min_efec NUMERIC;
BEGIN
  SELECT COALESCE(sum(o.neto), 0) INTO neto FROM v_ordenes_conductor o
   WHERE o.conductor_id = p_conductor
     AND o.dia >= make_date(p_anio, p_mes, 1)
     AND o.dia <  (make_date(p_anio, p_mes, 1) + INTERVAL '1 month')::date;
  SELECT COALESCE(sum(efectivo_total_min), 0) INTO min_efec FROM registro_jornada
   WHERE conductor_id = p_conductor
     AND dia >= make_date(p_anio, p_mes, 1)
     AND dia <  (make_date(p_anio, p_mes, 1) + INTERVAL '1 month')::date;
  IF min_efec <= 0 THEN RETURN NULL; END IF;
  RETURN round(neto / (min_efec / 60.0), 4);
END;
$func$;

-- ── El informe de coste del absentismo por mes ──────────────────────────────
-- Por cada tipo de ausencia/justificacion, su modulo responsable, dias, horas,
-- trabajadores, y las DOS magnitudes separadas. El coste soportado solo cuenta
-- si el asiento es pagado (is_paid); el lucro cesante, siempre.
CREATE VIEW v_coste_absentismo AS
WITH ev AS (
  SELECT a.conductor_id,
         EXTRACT(YEAR  FROM a.dia_operativo)::int AS anio,
         EXTRACT(MONTH FROM a.dia_operativo)::int AS mes,
         let.entry_type_code AS tipo,
         let.modulo_responsable AS modulo,
         let.is_paid,
         a.dia_operativo, a.minutos,
         -- El contrato vigente ese dia, para el coste hora.
         (SELECT id FROM contrato c WHERE c.conductor_id = a.conductor_id
            AND c.desde <= a.dia_operativo AND (c.hasta IS NULL OR c.hasta >= a.dia_operativo)
            ORDER BY c.desde DESC LIMIT 1) AS contrato_id
    FROM asiento_jornada a
    JOIN ledger_entry_type let ON let.entry_type_code = a.tipo
   WHERE a.anulado_at IS NULL
     AND let.obligation_effect IN ('REDUCES','COVERS')   -- ausencias y justificaciones
)
SELECT ev.anio, ev.mes, ev.modulo, ev.tipo,
       count(DISTINCT ev.conductor_id)                       AS trabajadores,
       count(DISTINCT ev.dia_operativo || ':' || ev.conductor_id) AS dias,
       round(sum(ev.minutos) / 60.0, 1)                      AS horas,
       -- COSTE SOPORTADO: solo lo pagado, a coste hora del contrato.
       round(sum(CASE WHEN ev.is_paid
              THEN ev.minutos / 60.0 * COALESCE(f_coste_hora(ev.contrato_id, ev.anio), 0)
              ELSE 0 END), 2)                                AS coste_soportado,
       -- LUCRO CESANTE: siempre, al ingreso por hora del conductor ese mes.
       round(sum(ev.minutos / 60.0 * COALESCE(f_ingreso_hora(ev.conductor_id, ev.anio, ev.mes), 0)), 2)
                                                             AS lucro_cesante
  FROM ev
 GROUP BY ev.anio, ev.mes, ev.modulo, ev.tipo;

COMMENT ON VIEW v_coste_absentismo IS
  'Coste del absentismo por mes, tipo y MODULO RESPONSABLE. Coste soportado (lo pagado) y lucro cesante (lo no facturado), separados';

COMMIT;
