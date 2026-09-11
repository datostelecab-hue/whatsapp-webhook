-- ============================================================
-- 102 — MODO EVENTOS: plazas de refuerzo con fecha de caducidad
-- ============================================================
-- Cuando hay un evento en Madrid (la F1, una marcha, un concierto) hace falta
-- sacar más coches de los que el cuadrante tiene planificados, y hay que
-- hacerlo el viernes por la tarde: los CT descansan, los fijos descansan, o
-- simplemente alguien dice que no sale y hay que poner a otro YA.
--
-- Las plazas para eso YA EXISTEN desde el primer día: los slots 4 y 5 son
-- CT día 2 y CT noche 2, y están creados para los 100 coches. Lo que no había
-- era forma de abrirlas sin que se quedaran abiertas para siempre. Eso es lo
-- que añade esta migración:
--
--   · evento_operativo — el evento con DESDE y HASTA obligatorios. Mientras
--     está vivo, el planificador enseña las dos columnas de refuerzo; cuando
--     muere, desaparecen solas. Nadie tiene que acordarse de cerrarlas.
--
--   · plan_relevo — "hoy este coche NO lo lleva quien pone el cuadrante, lo
--     lleva este otro, y por esto". Es la planificación a la fuerza: se puede
--     meter a alguien en un coche que ya tiene conductor ese día, pero DEJANDO
--     CONSTANCIA de a quién se deja fuera y por qué. La cobertura lo respeta,
--     así que Control llama a quien de verdad tiene que conducir.
--
-- LO QUE NO SE GUARDA AQUÍ: cuándo vuelve el planificador a la normalidad. No
-- es un dato, es una consecuencia — el evento acaba cuando TERMINA EL ÚLTIMO
-- TURNO planificado en las plazas de refuerzo, y los turnos de noche mueren a
-- las 05:00 del día siguiente. Si la última es Laura en CT2 de noche el
-- domingo, el planificador es normal otra vez el lunes a las 05:00 aunque el
-- evento dijera "viernes, sábado y domingo". Guardar esa hora la dejaría
-- mintiendo en cuanto alguien tocara el cuadrante; se calcula al leer.

BEGIN;

CREATE TABLE IF NOT EXISTS evento_operativo (
  id             bigserial PRIMARY KEY,
  nombre         varchar(80)  NOT NULL,
  -- Obligatorios los DOS. Un evento sin fin no es un evento, es un cambio de
  -- plantilla, y eso se hace en el cuadrante y no aquí.
  desde          date         NOT NULL,
  hasta          date         NOT NULL,
  nota           varchar(300),
  usuario_id     bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      timestamptz  NOT NULL DEFAULT now(),
  -- Cancelarlo es distinto de que se acabe: acabarse se acaba solo.
  cancelado_at   timestamptz,
  cancelado_por  bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  cancelado_nota varchar(300),
  CONSTRAINT ck_evento_rango  CHECK (hasta >= desde),
  CONSTRAINT ck_evento_nombre CHECK (btrim(nombre) <> '')
);
CREATE INDEX IF NOT EXISTS idx_evento_fechas ON evento_operativo (desde, hasta)
  WHERE cancelado_at IS NULL;
COMMENT ON TABLE evento_operativo IS
  'Evento que abre las plazas de refuerzo (CT2 día y noche) unos días. Se cierra solo al terminar el último turno planificado en ellas';

-- ── LA PLANIFICACIÓN A LA FUERZA ────────────────────────────────────────────
-- Un coche solo puede llevarlo una persona por turno y día. Cuando hay que
-- meter a alguien en un día que ya tiene dueño, no se borra al dueño —su
-- asignación sigue, y la semana que viene vuelve a llevarlo— se APARTA de ESE
-- día, con nombre, motivo y firma.
CREATE TABLE IF NOT EXISTS plan_relevo (
  id               bigserial PRIMARY KEY,
  dia              date        NOT NULL,
  turno_id         smallint    NOT NULL REFERENCES turno(id),
  vehiculo_id      bigint      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  -- A quién se deja fuera ese día en ese coche.
  conductor_sale   bigint      NOT NULL REFERENCES conductor(id),
  -- Y quién conduce en su lugar. Se guarda aunque se deduzca del cuadrante:
  -- dentro de un mes el cuadrante ya no dirá lo que decía hoy.
  conductor_entra  bigint      NOT NULL REFERENCES conductor(id),
  motivo_codigo    varchar(24) NOT NULL,
  motivo           varchar(300) NOT NULL,
  evento_id        bigint      REFERENCES evento_operativo(id) ON DELETE SET NULL,
  usuario_id       bigint      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at        timestamptz NOT NULL DEFAULT now(),
  anulado_at       timestamptz,
  CONSTRAINT ck_relevo_motivo    CHECK (btrim(motivo) <> ''),
  CONSTRAINT ck_relevo_distintos CHECK (conductor_sale <> conductor_entra)
);
-- El mismo conductor no se aparta dos veces del mismo coche, turno y día.
CREATE UNIQUE INDEX IF NOT EXISTS uq_relevo_vivo
  ON plan_relevo (dia, turno_id, vehiculo_id, conductor_sale) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_relevo_dia ON plan_relevo (dia) WHERE anulado_at IS NULL;
COMMENT ON TABLE plan_relevo IS
  'Ese día, en ese coche y turno, el del cuadrante NO conduce y conduce otro. Con motivo y firma: es lo que Control necesita para llamar a quien toca';

-- ── LA COBERTURA RESPETA EL RELEVO ──────────────────────────────────────────
-- Idéntica a la de db/58 salvo por el último NOT EXISTS. Sin él, el cuadrante
-- diría una cosa y la calle otra: Control llamaría al apartado y no al que de
-- verdad tiene que estar en el coche.
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
     -- Ni quien ha sido APARTADO de ese coche ese dia (planificacion a la fuerza).
     AND NOT EXISTS (
       SELECT 1 FROM plan_relevo pr
        WHERE pr.anulado_at IS NULL
          AND pr.dia = g.dia::date
          AND pr.turno_id = s.turno_id
          AND pr.vehiculo_id = p.vehiculo_id
          AND pr.conductor_sale = a.conductor_id)
$$;

COMMIT;
