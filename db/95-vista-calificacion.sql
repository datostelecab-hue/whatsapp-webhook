-- ============================================================
-- 95 — La vista de calificación, con la columna nueva
-- ============================================================
-- `v_conductor_calificacion` se creó con `SELECT k.*` en db/93, y eso NO es
-- dinámico: PostgreSQL resuelve el asterisco al crear la vista y congela la
-- lista de columnas. Al añadir `dias_telemetria` en db/94, la vista siguió
-- devolviendo las de antes y quien la leía se encontraba con que la columna "no
-- existe" — pese a estar en la tabla.
--
-- Se recrea, y esta vez con las columnas escritas una a una: así el día que se
-- añada otra se verá que hay que tocar esto, en vez de descubrirlo al leer.

BEGIN;

DROP VIEW IF EXISTS v_conductor_calificacion;

CREATE VIEW v_conductor_calificacion AS
SELECT DISTINCT ON (k.conductor_id)
       k.id, k.conductor_id, k.periodo_inicio, k.periodo_fin,
       k.letra, k.letra_por_puntos, k.tope_aplicado, k.motivo,
       k.total, k.pts_horas, k.pts_utilizacion, k.pts_velocidad,
       k.horas_prom, k.util_prom, k.excesos_total,
       k.dias_trabajados, k.dias_utilizacion, k.dias_telemetria,
       k.viajes_rechazados, k.pts_rechazos,
       k.version_modelo, k.calculado_en,
       COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) AS conductor
  FROM conductor_calificacion k
  JOIN conductor c ON c.id = k.conductor_id
 ORDER BY k.conductor_id, k.periodo_fin DESC, k.calculado_en DESC;

COMMENT ON VIEW v_conductor_calificacion IS
  'La calificacion mas reciente de cada conductor. Columnas explicitas: un SELECT * se congela al crear la vista';

COMMIT;
