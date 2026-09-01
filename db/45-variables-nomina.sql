-- ============================================================
-- 45 - VARIABLES DE NOMINA: nocturnidad, propinas, horas extra
-- ============================================================
-- Hito 8, primera parte. Lo variable de la nomina, que se devenga un mes y se
-- paga al siguiente (a mes vencido, spec 7.3). Cada variable sabe su mes de
-- DEVENGO y su mes de PAGO, y esa separacion importa: al liquidar a alguien
-- SIEMPRE queda un mes de variables devengadas sin pagar.
--
-- TRES DIRECTAS AQUI (la cuarta, el plus de calidad, es un motor aparte):
--   · Nocturnidad (art. 25.g): minutos en 22:00-06:00. Los minutos son un hecho
--     y ya se calculan en el registro; el IMPORTE es [VL-1] y no se fija aqui.
--   · Propinas (spec 7.3): lo que BOLT dice que ha entrado de propina. Pasa
--     integro al conductor.
--   · Horas extraordinarias (art. 20): el EXCESO sobre el computo mensual, con
--     un contador anual que avisa al acercarse al limite de 80h.

BEGIN;

CREATE TABLE variable_nomina (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id   BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  tipo          VARCHAR(16) NOT NULL,   -- nocturnidad, propina, hora_extra, plus_calidad
  -- El mes en que se genera y el mes en que se paga (devengo + 1).
  devengo_anio  SMALLINT    NOT NULL,
  devengo_mes   SMALLINT    NOT NULL,
  pago_anio     SMALLINT    NOT NULL,
  pago_mes      SMALLINT    NOT NULL,
  -- La magnitud, con su unidad: minutos (nocturnidad, extra) o euros (propina).
  cantidad      NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad        VARCHAR(8)  NOT NULL,   -- MIN, EUR
  -- El importe en euros. NULL si es [VL] o si lo calcula la nomina con la tabla
  -- salarial. Las propinas van integras, asi que ahi importe = cantidad.
  importe       NUMERIC(12,2),
  detalle       JSONB,
  estado        VARCHAR(10) NOT NULL DEFAULT 'calculada',   -- calculada, aprobada, pagada
  congelado_at  TIMESTAMPTZ,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_var_tipo CHECK (tipo IN ('nocturnidad','propina','hora_extra','plus_calidad')),
  CONSTRAINT ck_var_estado CHECK (estado IN ('calculada','aprobada','pagada')),
  CONSTRAINT uq_variable UNIQUE (contrato_id, tipo, devengo_anio, devengo_mes)
);
CREATE INDEX idx_var_pago ON variable_nomina (pago_anio, pago_mes);
CREATE INDEX idx_var_conductor ON variable_nomina (conductor_id, devengo_anio, devengo_mes);

COMMENT ON TABLE variable_nomina IS
  'Lo variable de la nomina. Se devenga un mes y se paga al siguiente; por eso una liquidacion siempre arrastra un mes sin pagar';

-- El mes de pago = mes de devengo + 1, envolviendo el ano.
CREATE OR REPLACE FUNCTION f_mes_siguiente(p_anio INT, p_mes INT)
RETURNS TABLE(anio INT, mes INT)
LANGUAGE sql IMMUTABLE AS $func$
  SELECT CASE WHEN p_mes = 12 THEN p_anio + 1 ELSE p_anio END,
         CASE WHEN p_mes = 12 THEN 1 ELSE p_mes + 1 END
$func$;

-- ── Generar nocturnidad de un mes ───────────────────────────────────────────
-- Suma los minutos nocturnos del registro por conductor. Importe NULL: es
-- [VL-1], se cuantifica cuando la asesoria lo aclare.
CREATE OR REPLACE FUNCTION f_generar_nocturnidad(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT ct.id, r.conductor_id, 'nocturnidad', p_anio, p_mes,
         (f_mes_siguiente(p_anio, p_mes)).anio, (f_mes_siguiente(p_anio, p_mes)).mes,
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

-- ── Generar propinas de un mes ──────────────────────────────────────────────
-- Lo que BOLT dice que ha entrado de propina, por conductor. Va integro.
CREATE OR REPLACE FUNCTION f_generar_propinas(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT ct.id, o.conductor_id, 'propina', p_anio, p_mes,
         (f_mes_siguiente(p_anio, p_mes)).anio, (f_mes_siguiente(p_anio, p_mes)).mes,
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

-- ── Generar horas extraordinarias de un mes cerrado ─────────────────────────
-- El EXCESO de la reconciliacion (art. 20). Se toma de la FOTO CONGELADA, no de
-- la vista en vivo: las horas extra son las que valieron al cerrar, no las que
-- cambien despues (eso va por regularizacion).
CREATE OR REPLACE FUNCTION f_generar_horas_extra(p_anio INT, p_mes INT)
RETURNS INT LANGUAGE plpgsql AS $func$
DECLARE n INT;
BEGIN
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe)
  SELECT cc.contrato_id, c.conductor_id, 'hora_extra', p_anio, p_mes,
         (f_mes_siguiente(p_anio, p_mes)).anio, (f_mes_siguiente(p_anio, p_mes)).mes,
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

-- ── El contador anual de horas extra, con su aviso ──────────────────────────
-- El art. 20 limita a 80h/ano. Esta vista dice cuanto lleva cada contrato y si
-- se acerca. El limite sale del convenio, no del codigo.
CREATE VIEW v_horas_extra_anual AS
WITH lim AS (
  SELECT value_numeric * 60 AS limite_min FROM agreement_parameter
   WHERE param_code = 'OVERTIME_ANNUAL_LIMIT_HOURS' AND scope_group IS NULL
   ORDER BY valid_from DESC LIMIT 1
)
SELECT v.contrato_id, v.conductor_id, v.devengo_anio AS anio,
       sum(v.cantidad)::int                         AS extra_min,
       (SELECT limite_min FROM lim)::int             AS limite_min,
       round(sum(v.cantidad) / NULLIF((SELECT limite_min FROM lim), 0) * 100, 1) AS pct_limite,
       (sum(v.cantidad) >= (SELECT limite_min FROM lim) * 0.9) AS cerca_del_limite,
       (sum(v.cantidad) >  (SELECT limite_min FROM lim))       AS pasado_del_limite
  FROM variable_nomina v
 WHERE v.tipo = 'hora_extra'
 GROUP BY v.contrato_id, v.conductor_id, v.devengo_anio;

COMMENT ON VIEW v_horas_extra_anual IS
  'Horas extra acumuladas por contrato y ano, con el aviso al 90% del limite de 80h (art. 20)';

COMMIT;
