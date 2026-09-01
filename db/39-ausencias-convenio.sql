-- ============================================================
-- 39 - AUSENCIAS CON EL DETALLE DEL CONVENIO
-- ============================================================
-- Hito 4. El lado de RRHH del ledger: lo que RESTA de la obligacion mensual.
-- Hasta ahora asiento_jornada solo recibia lo que SUMA (el trabajo de BOLT);
-- aqui entra lo que resta: vacaciones, IT, permisos y suspensiones.
--
-- NO SE CREA OTRA TABLA DE AUSENCIAS. Ya existe conductor_estado_hist, con su
-- EXCLUDE que impide estar en dos situaciones a la vez -- eso ya cumple el
-- criterio "vacaciones solapadas con IT generan conflicto": la base las
-- rechaza, no se resuelven solas. Lo que faltaba era el detalle del convenio, y
-- se anade a esa misma tabla. Un dato, un dueno.
--
-- TRES COSAS:
--   1. Que efecto de ledger tiene cada situacion (vacaciones -> VACATION, etc.).
--   2. El detalle que el convenio pide en una IT: si es grave y si hubo
--      hospitalizacion (art. 33, cambian el tope del complemento).
--   3. La suspension por retirada del permiso (art. 12, la correccion C5): una
--      situacion nueva, no retribuida ni computable, distinta de la disciplinaria.
--
-- Y las dos cuentas del convenio: la conversion de dias a minutos (8h/dia, art.
-- 25.c) para restar del objetivo, y el derecho a vacaciones prorrateado.

BEGIN;

-- ── 1. Cada situacion sabe su efecto en el ledger ───────────────────────────
-- El mapeo situacion -> tipo de asiento va en el catalogo, como dato. La
-- situacion que no resta (activo, pendiente) lo deja en NULL.
ALTER TABLE cat_estado_conductor
  ADD COLUMN IF NOT EXISTS ledger_tipo VARCHAR(24) REFERENCES ledger_entry_type(entry_type_code);

COMMENT ON COLUMN cat_estado_conductor.ledger_tipo IS
  'Que asiento de ledger genera esta situacion. NULL = no resta de la jornada (activo, pendiente)';

-- ── 2. Situacion nueva: suspension por retirada del permiso (art. 12, C5) ────
-- No retribuida ni computable a ningun efecto, con reserva de puesto. Libera la
-- plaza -- el coche tiene que salir con otro -- y no tiene fin previsible: dura
-- hasta que recupere el permiso o los puntos.
INSERT INTO cat_estado_conductor
  (codigo, etiqueta, es_ausencia, libera_plaza, fin_previsible, marca_bitacora, orden) VALUES
  ('suspension_permiso', 'Suspensión por retirada de permiso', TRUE, TRUE, FALSE, NULL, 8)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, es_ausencia = EXCLUDED.es_ausencia,
  libera_plaza = EXCLUDED.libera_plaza, fin_previsible = EXCLUDED.fin_previsible;

-- El mapeo de las situaciones a su efecto de ledger.
UPDATE cat_estado_conductor SET ledger_tipo = m.tipo FROM (VALUES
  ('vacaciones',         'VACATION'),
  ('baja_medica',        'SICK_LEAVE_IT'),
  ('permiso',            'PAID_LEAVE'),
  ('suspendido',         'SUSPENSION_DISC'),
  ('suspension_permiso', 'SUSPENSION_PERMISO')
) AS m(codigo, tipo) WHERE cat_estado_conductor.codigo = m.codigo;

-- ── 3. El detalle del convenio en la ausencia ───────────────────────────────
-- El permiso concreto del art. 22 (cual de los 13), y las marcas de la IT que
-- cambian el complemento del art. 33. Van en la propia fila de la ausencia
-- porque varian en cada una: una baja es grave y otra no.
ALTER TABLE conductor_estado_hist
  ADD COLUMN IF NOT EXISTS leave_type_code    VARCHAR(24) REFERENCES leave_type(leave_type_code),
  ADD COLUMN IF NOT EXISTS it_grave           BOOLEAN,
  ADD COLUMN IF NOT EXISTS it_hospitalizacion BOOLEAN,
  ADD COLUMN IF NOT EXISTS evidencia_doc_id   BIGINT;

COMMENT ON COLUMN conductor_estado_hist.leave_type_code IS
  'Para los permisos: cual de los 13 del art. 22. NULL en vacaciones, IT, suspensiones';
COMMENT ON COLUMN conductor_estado_hist.it_grave IS
  'IT: el parte marca enfermedad grave. Sube el tope del complemento a 12 meses (art. 33)';
COMMENT ON COLUMN conductor_estado_hist.it_hospitalizacion IS
  'IT: hubo hospitalizacion o intervencion. Complemento mientras dure (art. 33)';

-- ── 4. Cuantos minutos resta un dia de ausencia ─────────────────────────────
-- El convenio lo fija: 8h de promedio (art. 25.c), en el parametro
-- VACATION_DAY_EQUIV_MINUTES. NO se escribe el 480 aqui: se lee del convenio.
CREATE OR REPLACE FUNCTION f_min_por_dia_ausencia(p_agreement UUID, p_fecha DATE)
RETURNS INT
LANGUAGE plpgsql STABLE AS $func$
DECLARE m INT;
BEGIN
  SELECT value_numeric INTO m FROM agreement_parameter
   WHERE agreement_id = p_agreement AND param_code = 'VACATION_DAY_EQUIV_MINUTES'
     AND valid_from <= p_fecha AND (valid_to IS NULL OR valid_to >= p_fecha)
   ORDER BY valid_from DESC LIMIT 1;
  RETURN COALESCE(m, 480);   -- 8h si el convenio no lo dijera
END;
$func$;

-- ── 5. Derivar las ausencias de un mes al ledger (REDUCES) ───────────────────
-- Por cada dia de ausencia dentro del mes, un asiento REDUCES de 8h. La
-- reconciliacion ya los suma en su columna `reduce`. Idempotente por
-- (origen, ref_externa): rederivar un mes no duplica.
--
-- Se cuentan DIAS DE CALENDARIO de la ausencia dentro del mes. Afinar esto para
-- excluir los dias de libranza de la persona es un paso posterior, cuando se
-- cruce con el patron del planificador.
CREATE OR REPLACE FUNCTION f_derivar_ausencias(p_anio INT, p_mes INT)
RETURNS INT
LANGUAGE plpgsql AS $func$
DECLARE nuevos INT;
BEGIN
  INSERT INTO asiento_jornada
    (conductor_id, dia_operativo, tipo, minutos, origen, ref_externa)
  SELECT h.conductor_id,
         g.dia::date,
         cat.ledger_tipo,
         f_min_por_dia_ausencia(ct.agreement_id, g.dia::date),
         'sistema',
         'aus:' || h.id || ':' || to_char(g.dia::date, 'YYYY-MM-DD')
    FROM conductor_estado_hist h
    JOIN cat_estado_conductor cat ON cat.codigo = h.estado AND cat.ledger_tipo IS NOT NULL
    -- El contrato vigente ese dia, para saber que convenio le aplica.
    JOIN LATERAL (
      SELECT c.agreement_id FROM contrato c
       WHERE c.conductor_id = h.conductor_id
         AND c.desde <= (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date
         AND (c.hasta IS NULL OR c.hasta >= make_date(p_anio, p_mes, 1))
       ORDER BY c.desde DESC LIMIT 1
    ) ct ON TRUE
    -- Un dia por cada fecha de la ausencia que cae dentro del mes.
    CROSS JOIN LATERAL generate_series(
      GREATEST(h.desde, make_date(p_anio, p_mes, 1)),
      LEAST(COALESCE(h.hasta, make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day'),
            (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date),
      INTERVAL '1 day') AS g(dia)
   WHERE h.desde <= (make_date(p_anio, p_mes, 1) + INTERVAL '1 month - 1 day')::date
     AND (h.hasta IS NULL OR h.hasta >= make_date(p_anio, p_mes, 1))
  ON CONFLICT (origen, ref_externa) WHERE anulado_at IS NULL AND ref_externa IS NOT NULL
  DO NOTHING;
  GET DIAGNOSTICS nuevos = ROW_COUNT;
  RETURN nuevos;
END;
$func$;

COMMENT ON FUNCTION f_derivar_ausencias(INT, INT) IS
  'Convierte las ausencias del mes en asientos REDUCES del ledger. Un asiento de 8h por dia. Idempotente';

-- ── 6. El derecho a vacaciones del ano, prorrateado ─────────────────────────
-- 22 dias laborables al ano (VACATION_WORKDAYS_PER_YEAR), proporcional a los
-- dias de alta en el ano (art. 21). Mismo prorrateo que el objetivo: cuadra con
-- el por construccion. El derecho sale del convenio, no del codigo.
CREATE OR REPLACE FUNCTION f_vacaciones_derecho(p_contrato_id BIGINT, p_anio INT)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE AS $func$
DECLARE
  c contrato%ROWTYPE;
  base_dias NUMERIC;
  dias_anio INT := (make_date(p_anio, 12, 31) - make_date(p_anio, 1, 1)) + 1;
  dias_alta INT;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT value_numeric INTO base_dias FROM agreement_parameter
   WHERE agreement_id = c.agreement_id AND param_code = 'VACATION_WORKDAYS_PER_YEAR'
     AND valid_from <= make_date(p_anio, 1, 1)
     AND (valid_to IS NULL OR valid_to >= make_date(p_anio, 1, 1))
   ORDER BY valid_from DESC LIMIT 1;
  IF base_dias IS NULL THEN RETURN NULL; END IF;

  -- Dias de alta del contrato dentro del ano.
  dias_alta := (LEAST(COALESCE(c.hasta, make_date(p_anio, 12, 31)), make_date(p_anio, 12, 31))
              - GREATEST(c.desde, make_date(p_anio, 1, 1))) + 1;
  IF dias_alta <= 0 THEN RETURN 0; END IF;

  RETURN round(base_dias * dias_alta::numeric / dias_anio, 1);
END;
$func$;

COMMENT ON FUNCTION f_vacaciones_derecho(BIGINT, INT) IS
  'Dias de vacaciones que le corresponden a un contrato en un ano, prorrateados por dias de alta (art. 21)';

COMMIT;
