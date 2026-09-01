-- ============================================================
-- 58 - LA COBERTURA SUELTA A CUALQUIER AUSENTE
-- ============================================================
-- Afinado de Trafico: para CUBRIR un dia, el conductor tiene que estar con
-- nosotros ese dia. Cualquier ausencia (baja de empresa, baja medica,
-- vacaciones, permiso, suspension) deja el dia SIN CUBRIR -aparece el hueco-,
-- aunque la asignacion se conserve (la persona sigue siendo la de esa plaza, con
-- su alerta). La libranza excepcional ya se contaba aparte.
--
-- La 57 soltaba solo a quien "libera la plaza"; ahora suelta a cualquier
-- es_ausencia. La distincion "vacaciones se quita / baja medica sigue" es de la
-- pantalla (tachado vs alerta), no de la cobertura.

BEGIN;

CREATE OR REPLACE FUNCTION f_cobertura(p_desde DATE, p_hasta DATE)
RETURNS TABLE (
  dia            DATE,
  vehiculo_id    BIGINT,
  plaza_id       BIGINT,
  slot           SMALLINT,
  turno_id       SMALLINT,
  rol            VARCHAR(4),
  orden_ct       SMALLINT,
  conductor_id   BIGINT,
  asignacion_id  BIGINT
) LANGUAGE sql STABLE AS $$
  SELECT g.dia::date, p.vehiculo_id, p.id, p.slot, s.turno_id, s.rol, s.orden_ct,
         a.conductor_id, a.id
    FROM generate_series(p_desde, p_hasta, INTERVAL '1 day') AS g(dia)
    JOIN asignacion a  ON a.desde <= g.dia::date
                      AND (a.hasta IS NULL OR a.hasta >= g.dia::date)
    JOIN plaza p       ON p.id = a.plaza_id AND p.baja_at IS NULL
    JOIN cat_slot s    ON s.slot = p.slot
   WHERE (CASE WHEN s.rol = 'CT'
           THEN EXISTS (
             SELECT 1 FROM asignacion_dia ad
              WHERE ad.asignacion_id = a.id
                AND ad.dia_semana = EXTRACT(ISODOW FROM g.dia)::smallint)
           ELSE (
             ( NOT EXISTS (
                 SELECT 1
                   FROM vehiculo_descanso vd
                   JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                  WHERE vd.vehiculo_id = p.vehiculo_id
                    AND vd.desde <= g.dia::date
                    AND (vd.hasta IS NULL OR vd.hasta >= g.dia::date)
                    AND vdd.dia_semana = EXTRACT(ISODOW FROM g.dia)::smallint)
               OR EXISTS (
                 SELECT 1 FROM libranza_excepcional le
                  WHERE le.conductor_id = a.conductor_id
                    AND le.dia_trabaja = g.dia::date) )
             AND NOT EXISTS (
                 SELECT 1 FROM libranza_excepcional le
                  WHERE le.conductor_id = a.conductor_id
                    AND le.dia_libra = g.dia::date)
           )
         END)
     -- No cubre quien esta AUSENTE ese dia (cualquier es_ausencia): sale el hueco.
     AND NOT EXISTS (
       SELECT 1 FROM conductor_estado_hist h
         JOIN cat_estado_conductor ce ON ce.codigo = h.estado
        WHERE h.conductor_id = a.conductor_id
          AND ce.es_ausencia
          AND h.desde <= g.dia::date
          AND (h.hasta IS NULL OR h.hasta >= g.dia::date))
$$;

COMMIT;
