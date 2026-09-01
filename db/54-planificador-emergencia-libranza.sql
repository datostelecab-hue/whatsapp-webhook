-- ============================================================
-- 54 - PLANIFICADOR: estado emergencia, libranza excepcional, huerfanos
-- ============================================================
-- Paso 1 del planificador dinamico. Tres piezas, todas sobre lo que ya existe:
--
--   1. UN ESTADO MAS DEL COCHE: 'E' Emergencia. Trafico mantiene coches de
--      emergencia y los mete a mano en un cuadrante cuando hacen falta. Como el
--      estado del coche YA se guarda con fecha (vehiculo_estado_hist), "pongo
--      XXXX en emergencia desde hoy" y "lo meto en un cuadrante -> pasa a
--      Operativo" salen solos, sin reescribir el pasado. Ojo: en las letras
--      viejas la 'S' era "emergencia"; aqui 'S' es Siniestro, asi que emergencia
--      es un codigo NUEVO.
--
--   2. LIBRANZA EXCEPCIONAL: un conductor cambia, SOLO por una semana, un dia de
--      libranza por uno de trabajo. El que libra el lunes y trabaja el miercoles,
--      esa semana trabaja el lunes y descansa el miercoles; la siguiente vuelve a
--      la normalidad. No es cambiar el patron (patron_libranza) -es una excepcion
--      con fecha que f_cobertura consulta por encima del patron.
--
--   3. LOS HUERFANOS: cuando un coche sale de cobertura (taller, siniestro), sus
--      conductores quedan sin coche hasta que se les recoloca en uno de
--      emergencia. La vista los saca a la luz.

BEGIN;

-- ── 1. El estado 'Emergencia' ───────────────────────────────────────────────
-- es_operativo FALSE y visible_cobertura FALSE: un coche de emergencia no cubre
-- nada mientras esta en reserva. Aparece en su propio grupo, no en el cuadrante,
-- hasta que trafico lo coloca (y ahi pasa a 'O').
INSERT INTO cat_estado_vehiculo (codigo, etiqueta, es_operativo, visible_cobertura, orden)
VALUES ('E', 'Emergencia', FALSE, FALSE, 7)
ON CONFLICT (codigo) DO NOTHING;

-- ── 2. La libranza excepcional ──────────────────────────────────────────────
CREATE TABLE libranza_excepcional (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- El dia que TRABAJA pese a librarlo por patron (la reposicion).
  dia_trabaja    DATE        NOT NULL,
  -- El dia que LIBRA pese a tocarle trabajar por patron.
  dia_libra      DATE        NOT NULL,
  motivo         VARCHAR(200),
  autorizado_por INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un swap es 1x1 y de la MISMA semana: los dos dias, a lo sumo, a 6 dias.
  CONSTRAINT ck_lexc_distintos CHECK (dia_trabaja <> dia_libra),
  CONSTRAINT ck_lexc_semana    CHECK (abs(dia_trabaja - dia_libra) <= 6),
  -- No dos excepciones que toquen el mismo dia para el mismo conductor.
  CONSTRAINT uq_lexc_trabaja UNIQUE (conductor_id, dia_trabaja),
  CONSTRAINT uq_lexc_libra   UNIQUE (conductor_id, dia_libra)
);
CREATE INDEX idx_lexc_trabaja ON libranza_excepcional (conductor_id, dia_trabaja);
CREATE INDEX idx_lexc_libra   ON libranza_excepcional (conductor_id, dia_libra);

COMMENT ON TABLE libranza_excepcional IS
  'Swap de una semana: trabaja un dia que libra por patron y libra uno que trabaja. No toca el patron; f_cobertura lo lee por encima';

-- ── f_cobertura, ahora con la excepcion por encima del patron ───────────────
-- El fijo cubre si (no libra por patron O es su dia de reposicion) Y no es su
-- dia de libranza excepcional. El correturnos, igual que antes: solo sus dias.
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
   WHERE CASE WHEN s.rol = 'CT'
           -- Un correturnos cubre SOLO los dias que tiene apuntados.
           THEN EXISTS (
             SELECT 1 FROM asignacion_dia ad
              WHERE ad.asignacion_id = a.id
                AND ad.dia_semana = EXTRACT(ISODOW FROM g.dia)::smallint)
           -- Un fijo: cubre si (no libra por patron vigente ese dia, O ese dia
           -- repone) Y ese dia no es su libranza excepcional.
           ELSE (
             ( NOT EXISTS (
                 SELECT 1
                   FROM patron_libranza pl
                   JOIN patron_libranza_dia pld ON pld.patron_id = pl.id
                  WHERE pl.conductor_id = a.conductor_id
                    AND pl.desde <= g.dia::date
                    AND (pl.hasta IS NULL OR pl.hasta >= g.dia::date)
                    AND pld.dia_semana = EXTRACT(ISODOW FROM g.dia)::smallint)
               OR EXISTS (
                 SELECT 1 FROM libranza_excepcional le
                  WHERE le.conductor_id = a.conductor_id
                    AND le.dia_trabaja = g.dia::date) )
             AND NOT EXISTS (
                 SELECT 1 FROM libranza_excepcional le
                  WHERE le.conductor_id = a.conductor_id
                    AND le.dia_libra = g.dia::date)
           )
         END
$$;

-- ── 3. Los conductores huerfanos ────────────────────────────────────────────
-- Asignacion viva a una plaza de un coche que ya NO cubre (taller, siniestro,
-- emergencia, baja): el conductor se queda sin coche y hay que recolocarlo. Se
-- mira el estado ACTUAL del coche -es una foto de "ahora", para el tablero-.
CREATE OR REPLACE VIEW v_conductor_huerfano AS
SELECT a.id                                     AS asignacion_id,
       a.conductor_id,
       btrim(co.nombre || ' ' || COALESCE(co.apellidos, '')) AS conductor,
       p.id                                     AS plaza_id,
       v.id                                     AS vehiculo_id,
       v.matricula,
       v.estado_operativo,
       cev.etiqueta                             AS estado_etiqueta,
       v.base_zona_id,
       bz.nombre                                AS zona,
       s.turno_id,
       t.etiqueta                               AS turno,
       s.rol
  FROM asignacion a
  JOIN plaza p              ON p.id = a.plaza_id AND p.baja_at IS NULL
  JOIN vehiculo v           ON v.id = p.vehiculo_id AND v.baja_at IS NULL
  JOIN cat_estado_vehiculo cev ON cev.codigo = v.estado_operativo
  JOIN cat_slot s           ON s.slot = p.slot
  JOIN turno t              ON t.id = s.turno_id
  JOIN conductor co         ON co.id = a.conductor_id
  LEFT JOIN base_zona bz    ON bz.id = v.base_zona_id
 WHERE a.hasta IS NULL
   AND a.retirada_at IS NULL
   AND cev.visible_cobertura = FALSE;

COMMENT ON VIEW v_conductor_huerfano IS
  'Conductores con asignacion viva en un coche que ya no cubre (taller, siniestro, emergencia): hay que recolocarlos en un coche de emergencia';

COMMIT;
