-- ============================================================
-- 49 - FIX: variable_nomina.tipo demasiado estrecha
-- ============================================================
-- Bug de la 45/48. La columna tipo se definio VARCHAR(16), pero la 48 anadio el
-- valor 'complemento_garantia' -- 20 caracteres. Al INSERTAR el complemento
-- reventaba con "value too long for type character varying(16)".
--
-- Y ensancharla no es un ALTER a secas: la vista v_horas_extra_anual (de la 45)
-- LEE esa columna, y Postgres no deja cambiar el tipo de una columna de la que
-- depende una vista. Hay que soltar la vista, ensanchar, y volver a crearla.

BEGIN;

DROP VIEW IF EXISTS v_horas_extra_anual;

ALTER TABLE variable_nomina ALTER COLUMN tipo TYPE VARCHAR(24);

-- La misma vista de la 45, recreada tal cual.
CREATE VIEW v_horas_extra_anual AS
WITH lim AS (
  SELECT value_numeric * 60 AS limite_min FROM agreement_parameter
   WHERE param_code = 'OVERTIME_ANNUAL_LIMIT_HOURS' AND scope_group IS NULL
   ORDER BY valid_from DESC LIMIT 1
)
SELECT v.contrato_id, v.conductor_id, v.devengo_anio AS anio,
       sum(v.cantidad)::int                          AS extra_min,
       (SELECT limite_min FROM lim)::int              AS limite_min,
       round(sum(v.cantidad) / NULLIF((SELECT limite_min FROM lim), 0) * 100, 1) AS pct_limite,
       (sum(v.cantidad) >= (SELECT limite_min FROM lim) * 0.9) AS cerca_del_limite,
       (sum(v.cantidad) >  (SELECT limite_min FROM lim))       AS pasado_del_limite
  FROM variable_nomina v
 WHERE v.tipo = 'hora_extra'
 GROUP BY v.contrato_id, v.conductor_id, v.devengo_anio;

COMMENT ON VIEW v_horas_extra_anual IS
  'Horas extra acumuladas por contrato y ano, con el aviso al 90% del limite de 80h (art. 20)';

COMMIT;
