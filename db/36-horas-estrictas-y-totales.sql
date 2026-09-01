-- ============================================================
-- 36 - DOS MEDIDAS DE JORNADA: ESTRICTA Y TOTAL
-- ============================================================
-- Decision de negocio, no del convenio. Se guardan DOS cuentas de trabajo, y
-- las dos importan para cosas distintas:
--
--   ESTRICTA  lo que el convenio cuenta como trabajo efectivo (art. 18.6):
--             el servicio (has_order -> TE_A3) y la espera SOLO dentro del area
--             (TE_A1). Es la que manda para el defecto y el exceso legales.
--
--   TOTAL     has_order + waiting_orders SIEMPRE, este o no en area. Es la
--             realidad operativa: el tiempo conectado y disponible. La empresa
--             la cuenta entera.
--
-- La diferencia entre las dos es exactamente la espera FUERA del area, que en
-- el ledger va como supuesto TE_NO: un asiento de trabajo (suma en la total)
-- que no es efectivo a efectos del convenio (no suma en la estricta).
--
-- El defecto y el exceso se calculan sobre la ESTRICTA, porque son conceptos
-- del convenio. La total se ensena al lado, como referencia operativa.

BEGIN;

DROP VIEW IF EXISTS v_conciliacion_mes;

CREATE VIEW v_conciliacion_mes AS
WITH mov AS (
  SELECT c.id AS contrato_id,
         EXTRACT(YEAR  FROM a.dia_operativo)::int AS anio,
         EXTRACT(MONTH FROM a.dia_operativo)::int AS mes,
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'REDUCES'), 0) AS reduce,
         -- CUMPLE ESTRICTO: trabajo efectivo del convenio. Todo lo FULFILLS
         -- menos la espera fuera de area (TE_NO).
         COALESCE(sum(a.minutos) FILTER (
           WHERE a.efecto = 'FULFILLS' AND a.supuesto_te IS DISTINCT FROM 'TE_NO'), 0) AS cumple,
         -- CUMPLE TOTAL: todo lo que suma como trabajo, TE_NO incluido.
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'FULFILLS'), 0)              AS cumple_total,
         COALESCE(sum(a.minutos) FILTER (WHERE a.efecto = 'COVERS'), 0)                AS cubre
    FROM asiento_jornada a
    JOIN contrato c ON c.conductor_id = a.conductor_id
                   AND a.dia_operativo >= c.desde
                   AND (c.hasta IS NULL OR a.dia_operativo <= c.hasta)
   WHERE a.anulado_at IS NULL
   GROUP BY c.id, 2, 3
)
SELECT o.contrato_id,
       o.anio,
       o.mes,
       o.objetivo_min                                             AS bruta,
       COALESCE(m.reduce, 0)                                      AS reduce,
       GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))        AS neta,
       -- La estricta es la que cuenta para lo legal.
       COALESCE(m.cumple, 0)                                      AS cumple,
       -- La total, al lado, como referencia operativa (has_order + waiting).
       COALESCE(m.cumple_total, 0)                                AS cumple_total,
       -- La diferencia es la espera fuera de area (TE_NO): lo que se cuenta
       -- operativamente pero no computa como efectivo en el convenio.
       COALESCE(m.cumple_total, 0) - COALESCE(m.cumple, 0)        AS espera_fuera_area,
       COALESCE(m.cubre, 0)                                       AS cubre,
       -- Defecto y exceso SOBRE LA ESTRICTA (son conceptos del convenio).
       GREATEST(0, GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))
                   - COALESCE(m.cumple, 0) - COALESCE(m.cubre, 0)) AS defecto,
       GREATEST(0, COALESCE(m.cumple, 0)
                   - GREATEST(0, o.objetivo_min - COALESCE(m.reduce, 0))) AS exceso
  FROM objetivo_mensual o
  LEFT JOIN mov m ON m.contrato_id = o.contrato_id
                 AND m.anio = o.anio AND m.mes = o.mes;

COMMENT ON VIEW v_conciliacion_mes IS
  'La cuenta del mes con las dos medidas: cumple (estricto, convenio) y cumple_total (operativo). Defecto y exceso van sobre la estricta';

COMMIT;
