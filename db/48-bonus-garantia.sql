-- ============================================================
-- 48 - BONUS Y GARANTIA DE CONVENIO (art. 26; spec 7)
-- ============================================================
-- Hito 9. El convenio permite pactar un sistema de productividad que sustituya
-- conceptos salariales, PERO garantizando como minimo las cantidades del
-- convenio (art. 26). Tres cosas obligatorias, y la tercera es el corazon:
--
--   1. PACTO firmado por trabajador. Sin pacto vigente, el bonus es una mejora
--      voluntaria, no un sustituto de nada.
--   2. Regla de bonus declarativa y versionada, con su ejecucion guardada como
--      evidencia (por que cobro lo que cobro).
--   3. COMPARADOR DE GARANTIA MINIMA. En cada cierre, para cada trabajador, se
--      compara lo que el bonus paga con el minimo del convenio. Si paga menos,
--      se genera SOLO un complemento por la diferencia. Es un control
--      BLOQUEANTE del cierre.
--
-- NO COMPENSABLES: el plus de permanencia, el de calidad y la antiguedad no se
-- pueden absorber con el bonus (arts. 25.b/c/d). Entran en el minimo garantizado.

BEGIN;

-- El bonus y el complemento son variables de nomina mas.
ALTER TABLE variable_nomina DROP CONSTRAINT IF EXISTS ck_var_tipo;
ALTER TABLE variable_nomina ADD CONSTRAINT ck_var_tipo CHECK (tipo IN
  ('nocturnidad','propina','hora_extra','plus_calidad','bonus','complemento_garantia'));

-- ── El pacto de productividad ───────────────────────────────────────────────
CREATE TABLE pacto_productividad (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id   BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  documento_id  BIGINT,                     -- el documento firmado
  desde         DATE        NOT NULL,
  -- Desistimiento del trabajador con 60 dias de preaviso (art. 26).
  hasta         DATE,
  preaviso_dias SMALLINT    NOT NULL DEFAULT 60,
  -- Que conceptos absorbe el bonus. Los no compensables NUNCA entran aqui.
  alcance       JSONB,
  usuario_id    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pacto_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Un pacto vigente como mucho por contrato en cada fecha.
  CONSTRAINT ex_pacto_solape EXCLUDE USING gist
    (contrato_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);

COMMENT ON TABLE pacto_productividad IS
  'El acuerdo firmado de productividad (art. 26). Sin pacto vigente, el bonus es mejora voluntaria, no sustituto de convenio';

-- ── La regla de bonus, declarativa y versionada ─────────────────────────────
CREATE TABLE regla_bonus (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code           VARCHAR(40) NOT NULL,
  version        SMALLINT    NOT NULL DEFAULT 1,
  activa_desde   DATE        NOT NULL,
  -- La definicion: elegibilidad, factores con su peso, tramos, tope, prorrateo.
  -- Declarativa: cambiar el bonus es una version nueva, no tocar codigo.
  definicion     JSONB       NOT NULL,
  requiere_pacto BOOLEAN     NOT NULL DEFAULT TRUE,
  requiere_aprob BOOLEAN     NOT NULL DEFAULT TRUE,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_regla_bonus UNIQUE (code, version)
);

COMMENT ON TABLE regla_bonus IS
  'La regla de bonus como dato versionado: factores, pesos, tramos. Cambiarla es una version nueva';

-- ── La ejecucion del bonus: la evidencia de cada calculo ────────────────────
-- Guarda el valor de cada metrica, el peso aplicado y el resultado. Es lo que
-- permite contestar a un conductor por que cobro lo que cobro.
CREATE TABLE ejecucion_bonus (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id   BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  regla_code    VARCHAR(40) NOT NULL,
  regla_version SMALLINT    NOT NULL,
  anio          SMALLINT    NOT NULL,
  mes           SMALLINT    NOT NULL,
  metricas      JSONB,                      -- valor de cada factor
  resultado     NUMERIC(10,2) NOT NULL DEFAULT 0,   -- el bonus en euros
  estado        VARCHAR(10) NOT NULL DEFAULT 'calculada',
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_ejec_bonus UNIQUE (contrato_id, regla_code, anio, mes)
);

COMMENT ON TABLE ejecucion_bonus IS
  'Cada calculo de bonus con el valor de sus metricas. Para poder explicar por que cobro lo que cobro';

-- ── Antiguedad del conductor, en meses ──────────────────────────────────────
-- Desde su primer alta (fecha_antiguedad si la hay, si no la primera alta).
CREATE OR REPLACE FUNCTION f_antiguedad_meses(p_conductor BIGINT, p_fecha DATE)
RETURNS INT LANGUAGE plpgsql STABLE AS $func$
DECLARE ini DATE;
BEGIN
  SELECT COALESCE(min(fecha_antiguedad), min(alta)) INTO ini
    FROM conductor_periodo_empleo WHERE conductor_id = p_conductor;
  IF ini IS NULL OR ini > p_fecha THEN RETURN 0; END IF;
  RETURN (EXTRACT(YEAR FROM age(p_fecha, ini)) * 12
        + EXTRACT(MONTH FROM age(p_fecha, ini)))::int;
END;
$func$;

-- ── El minimo garantizado por el convenio en un mes ─────────────────────────
-- Bruto mensual + plus de permanencia (por antiguedad >3/>6 meses) + antiguedad
-- (por tramos de anos). Los tres NO COMPENSABLES: son el suelo que el bonus
-- tiene que respetar. Todo de la tabla salarial y del convenio.
CREATE OR REPLACE FUNCTION f_convenio_minimo_mes(p_contrato BIGINT, p_anio INT, p_mes INT)
RETURNS NUMERIC LANGUAGE plpgsql STABLE AS $func$
DECLARE
  c contrato%ROWTYPE;
  str salary_table_row%ROWTYPE;
  primero DATE := make_date(p_anio, p_mes, 1);
  meses INT; anios INT;
  permanencia NUMERIC := 0;
  pct NUMERIC := 0;
  antiguedad NUMERIC := 0;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO str FROM salary_table_row
   WHERE agreement_id = c.agreement_id AND professional_group = c.grupo AND year = p_anio;
  IF NOT FOUND THEN RETURN NULL; END IF;

  meses := f_antiguedad_meses(c.conductor_id, primero);
  anios := meses / 12;

  -- Plus de permanencia: >6 meses el de 6, >3 el de 3 (art. 25.b).
  IF meses > 6 THEN permanencia := COALESCE(str.permanence_6m, 0);
  ELSIF meses > 3 THEN permanencia := COALESCE(str.permanence_3m, 0);
  END IF;

  -- Antiguedad por tramos (art. 25.d), sobre base + permanencia.
  pct := CASE WHEN anios >= 20 THEN 27 WHEN anios >= 15 THEN 20
              WHEN anios >= 10 THEN 13 WHEN anios >= 5 THEN 6 ELSE 0 END;
  antiguedad := (str.base_salary + permanencia) * pct / 100.0;

  RETURN round(COALESCE(str.gross_monthly, str.base_salary) + permanencia + antiguedad, 2);
END;
$func$;

COMMENT ON FUNCTION f_convenio_minimo_mes(BIGINT, INT, INT) IS
  'El suelo del convenio de un mes: bruto + permanencia + antiguedad. Lo que el bonus tiene que garantizar (art. 26)';

-- ── El comparador de garantia: control BLOQUEANTE del cierre ─────────────────
-- Por cada contrato con pacto vigente y un bonus ese mes, compara el bonus con
-- el minimo. Si el bonus paga menos, crea el complemento por la diferencia. Que
-- cree alguno es lo que BLOQUEA el cierre hasta que se revise.
CREATE OR REPLACE FUNCTION f_garantia_convenio(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe, detalle)
  SELECT e.contrato_id, e.conductor_id, 'complemento_garantia', p_anio, p_mes,
         CASE WHEN p_mes = 12 THEN p_anio + 1 ELSE p_anio END,
         CASE WHEN p_mes = 12 THEN 1 ELSE p_mes + 1 END,
         round(m.minimo - e.resultado, 2), 'EUR', round(m.minimo - e.resultado, 2),
         jsonb_build_object('minimo_convenio', m.minimo, 'bonus', e.resultado,
                            'motivo', 'El bonus deja al trabajador por debajo del convenio (art. 26)')
    FROM ejecucion_bonus e
    JOIN pacto_productividad pp ON pp.contrato_id = e.contrato_id
                               AND pp.desde <= make_date(p_anio, p_mes, 1)
                               AND (pp.hasta IS NULL OR pp.hasta >= make_date(p_anio, p_mes, 1))
    JOIN LATERAL (SELECT f_convenio_minimo_mes(e.contrato_id, p_anio, p_mes) AS minimo) m ON TRUE
   WHERE e.anio = p_anio AND e.mes = p_mes
     AND m.minimo IS NOT NULL
     AND e.resultado < m.minimo
  ON CONFLICT (contrato_id, tipo, devengo_anio, devengo_mes) DO UPDATE SET
    cantidad = EXCLUDED.cantidad, importe = EXCLUDED.importe,
    detalle = EXCLUDED.detalle, actualizado_at = now()
    WHERE variable_nomina.congelado_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$func$;

COMMENT ON FUNCTION f_garantia_convenio(INT, INT) IS
  'Control bloqueante: si el bonus deja a alguien por debajo del convenio, crea el complemento de garantia por la diferencia (art. 26)';

COMMIT;
