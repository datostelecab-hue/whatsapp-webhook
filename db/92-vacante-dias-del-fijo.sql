-- ============================================================
-- 92 — Los días de la plaza de un fijo
-- ============================================================
-- `vacante_plaza_dia` no es "los días que ha elegido quien monta la vacante", es
-- "los días que esa plaza cubre", y la libranza que se ofrece se calcula como lo
-- que NO cubre. Al crear una vacante de FIJO se dejaba la lista vacía —porque un
-- fijo no elige días— y el resultado era el contrario del que se quería: la
-- vacante salía anunciando «libra L M X J V S D» y «0 días» de trabajo.
--
-- El código ya deriva los días que faltan del descanso del coche:
--   · FIJO → todos los días MENOS los que descansa su coche.
--   · CT   → los que descansa el coche, que es lo que significa correturnos.
--
-- Aquí se arregla lo ya guardado con la misma regla. Solo toca las plazas que no
-- tienen ni un día apuntado: las que se guardaron bien no se rozan.

BEGIN;

INSERT INTO vacante_plaza_dia (vacante_plaza_id, dia_semana)
SELECT vp.id, d.dia
  FROM vacante_plaza vp
  JOIN vacante k  ON k.id = vp.vacante_id
  JOIN plaza p    ON p.id = vp.plaza_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
             (SELECT array_agg(vdd.dia_semana)
                FROM vehiculo_descanso vd
                JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
               WHERE vd.vehiculo_id = p.vehiculo_id
                 AND vd.desde <= CURRENT_DATE
                 AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)),
             ARRAY[]::smallint[]) AS descanso) des
  CROSS JOIN LATERAL unnest(ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]) AS d(dia)
 WHERE NOT EXISTS (SELECT 1 FROM vacante_plaza_dia x WHERE x.vacante_plaza_id = vp.id)
   AND (CASE WHEN k.rol = 'FIJO' THEN NOT (d.dia = ANY(des.descanso))
                                 ELSE d.dia = ANY(des.descanso) END)
ON CONFLICT DO NOTHING;

COMMIT;
