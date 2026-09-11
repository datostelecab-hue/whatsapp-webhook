-- ============================================================
-- 104 — En un evento, el estado del conductor no lo quita del plan
-- ============================================================
-- Regla de Tráfico (db/58): cualquier ausencia —baja médica, vacaciones,
-- permiso— deja el día SIN CUBRIR, aunque la persona siga teniendo su plaza.
-- Eso está bien para el día a día: si alguien está de baja, no se cuenta con él.
--
-- En un EVENTO no. Ahí el plan no sale del cuadrante: sale de llamar uno a uno y
-- que digan que sí. Si alguien de vacaciones ha confirmado que viene el sábado,
-- tiene que contar como que sale, salir en el parte y recibir su WhatsApp. El
-- estado en la ficha es de otra cosa.
--
-- PERO NO PARA TODO. `f_cobertura` la leen tres familias de cosas muy distintas:
--
--   · LO OPERATIVO (el cuadrante, Control, el parte de turnos, el WhatsApp):
--     aquí sí, porque la pregunta es "¿quién tiene que estar en la calle?".
--   · EL EXPEDIENTE (rendimiento y su letra ABCD, asistencia, bitácora, reporte
--     de horas, auditoría de los lunes): aquí NO, ni de broma. Contar como "le
--     tocaba salir" a alguien de baja médica le hundiría la letra y le pintaría
--     una falta por estar de baja.
--
-- Por eso NO se cambia la regla: se añade un interruptor. `incluir_ausentes` es
-- FALSE por omisión, así que todo lo que ya llamaba a esta función sigue viendo
-- exactamente lo mismo, y solo lo operativo pide TRUE.
--
-- Se borra la versión de dos argumentos y se crea una de tres con valor por
-- defecto: si se dejaran las dos, una llamada con dos argumentos sería ambigua y
-- PostgreSQL la rechazaría. Ninguna vista depende de ella (comprobado).

BEGIN;

DROP FUNCTION IF EXISTS f_cobertura(DATE, DATE);

CREATE OR REPLACE FUNCTION f_cobertura(
  p_desde DATE,
  p_hasta DATE,
  p_incluir_ausentes BOOLEAN DEFAULT FALSE
)
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
     --
     -- Salvo que se pida lo contrario Y ese dia caiga dentro de un evento vivo:
     -- entonces manda lo que se planifico, porque lo que se planifico se
     -- confirmo por telefono uno a uno. Las dos condiciones, no una: con el
     -- interruptor solo, un dia normal se colaria un ausente.
     AND (
       NOT EXISTS (
         SELECT 1 FROM conductor_estado_hist h
           JOIN cat_estado_conductor ce ON ce.codigo = h.estado
          WHERE h.conductor_id = a.conductor_id
            AND ce.es_ausencia
            AND h.desde <= g.dia::date
            AND (h.hasta IS NULL OR h.hasta >= g.dia::date))
       OR (p_incluir_ausentes AND EXISTS (
         SELECT 1 FROM evento_operativo e
          WHERE e.cancelado_at IS NULL AND e.restaurado_at IS NULL
            AND g.dia::date BETWEEN e.desde AND e.hasta))
     )
     -- Ni quien ha sido APARTADO de ese coche ese dia (planificacion a la fuerza).
     AND NOT EXISTS (
       SELECT 1 FROM plan_relevo pr
        WHERE pr.anulado_at IS NULL
          AND pr.dia = g.dia::date
          AND pr.turno_id = s.turno_id
          AND pr.vehiculo_id = p.vehiculo_id
          AND pr.conductor_sale = a.conductor_id)
$$;

COMMENT ON FUNCTION f_cobertura(DATE, DATE, BOOLEAN) IS
  'Quien cubre cada coche, turno y dia. Con p_incluir_ausentes=TRUE, dentro de las fechas de un evento vivo la ausencia NO quita a nadie: lo piden el cuadrante, Control, el parte y el WhatsApp. El expediente (rendimiento, asistencia, bitacora) lo llama SIEMPRE sin el interruptor';

COMMIT;
