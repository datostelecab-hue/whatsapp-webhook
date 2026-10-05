-- ============================================================
-- 175 — LOS PRIMEROS DÍAS DEL MES, LA LETRA DEL MES CERRADO
-- ============================================================
-- Camilo, 05/10/2026: «¿por qué aún todos tienen N/E en la letra y promedio de
-- horas?». La calificación va por MES NATURAL (del día 1 al último día cerrado)
-- y pide 5 días en el periodo (`minDiasTrabajados` en services/repo/calificacion.js);
-- por debajo es N/E. Y esta vista daba siempre el periodo MÁS RECIENTE, así que
-- en cuanto el cron calculaba el mes nuevo —el día 2— su N/E tapaba la letra del
-- mes cerrado. Cada mes, del día 1 al 5, toda la flota se quedaba sin letra ni
-- promedio en el planificador, En directo, Plantilla y la ficha. El 05/10: 214
-- personas con «lleva menos de 5 días en el periodo (4)», con septiembre ya
-- cerrado (95 A, 61 B, 29 C, 6 D).
--
-- Lo que decía la documentación —«la letra del mes cerrado es la que se pinta
-- hasta que el nuevo tenga datos»— pasa a ser verdad:
--
--   · si el periodo más reciente de alguien es N/E PORQUE EL MES ES DEMASIADO
--     JOVEN (empieza el día 1 y tiene menos de 5 días), y
--   · tiene letra del mes cerrado justo anterior (del 1 al último día, y no N/E),
--   → la vista da la del mes cerrado.
--
-- Quien no tenga letra del mes anterior sigue viendo el N/E del mes en curso, con
-- su motivo. Quien entra a mitad de mes no cambia: su N/E no es porque el mes sea
-- joven, sino porque él lo es, y el mes anterior no era suyo.
--
-- Las pantallas saben que es la del mes cerrado por sus fechas (`periodo_fin`
-- anterior al mes en curso) y lo rotulan («letra de septiembre»). Las columnas no
-- cambian: mismas, mismo orden. El 5 tiene que ir a la par que `minDiasTrabajados`.

BEGIN;

CREATE OR REPLACE VIEW v_conductor_calificacion AS
WITH ultima AS (
  SELECT DISTINCT ON (k.conductor_id)
         k.id, k.conductor_id, k.periodo_inicio, k.periodo_fin, k.letra
    FROM conductor_calificacion k
   ORDER BY k.conductor_id, k.periodo_fin DESC, k.calculado_en DESC
),
mes_cerrado AS (
  SELECT DISTINCT ON (k.conductor_id) k.conductor_id, k.id
    FROM conductor_calificacion k
    JOIN ultima u ON u.conductor_id = k.conductor_id
   WHERE u.letra = 'N/E'
     AND u.periodo_inicio = date_trunc('month', u.periodo_inicio)::date
     AND u.periodo_fin - u.periodo_inicio + 1 < 5
     AND k.periodo_fin = u.periodo_inicio - 1
     AND k.periodo_inicio = date_trunc('month', u.periodo_inicio - 1)::date
     AND k.letra <> 'N/E'
   ORDER BY k.conductor_id, k.calculado_en DESC
)
SELECT k.id,
       k.conductor_id,
       k.periodo_inicio,
       k.periodo_fin,
       k.letra,
       k.letra_por_puntos,
       k.tope_aplicado,
       k.motivo,
       k.total,
       k.pts_horas,
       k.pts_utilizacion,
       k.pts_velocidad,
       k.horas_prom,
       k.util_prom,
       k.excesos_total,
       k.dias_trabajados,
       k.dias_utilizacion,
       k.dias_telemetria,
       k.viajes_rechazados,
       k.pts_rechazos,
       k.version_modelo,
       k.calculado_en,
       COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS conductor
  FROM ultima u
  LEFT JOIN mes_cerrado m ON m.conductor_id = u.conductor_id
  JOIN conductor_calificacion k ON k.id = COALESCE(m.id, u.id)
  JOIN conductor c ON c.id = k.conductor_id;

COMMENT ON VIEW v_conductor_calificacion IS
  'La calificacion que se ensena de cada conductor: la mas reciente, salvo los primeros dias del mes (menos de 5), que es la del mes cerrado (db/175). Columnas explicitas: un SELECT * se congela al crear la vista';

COMMIT;
