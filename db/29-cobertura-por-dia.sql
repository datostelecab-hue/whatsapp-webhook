-- ============================================================
-- 29 - QUIEN CUBRE QUE DIA
-- ============================================================
-- El planificador V2 leia la hoja: una fila por coche, seis nombres de BOLT y
-- unos dias escritos como "L M X". De ahi salia todo, y de ahi venian todos sus
-- limites — no se podia planificar por fechas, ni saber quien cubrio el martes
-- pasado, ni mover a nadie sin reescribir texto.
--
-- Lo que hace falta ya estaba en el esquema desde el principio:
--
--   · `asignacion` tiene DESDE y HASTA, con exclusion por rangos: la base ya
--     impide que dos personas ocupen la misma plaza en fechas que se pisan.
--   · `asignacion_dia` guarda que dias cubre un correturno.
--   · `patron_libranza` guarda que dias libra un fijo.
--
-- Lo que faltaba era juntarlo: LA REGLA de quien cubre que dia. Va aqui, en una
-- funcion, y no repartida por el JavaScript de dos pantallas.
--
--   Un FIJO cubre todos los dias MENOS los que libra.
--   Un CORRETURNOS cubre SOLO los dias que tiene apuntados.
--
-- Y el correturnos coge dos dias por coche, que son justo los que libra el fijo
-- de esa misma plaza. De ahi sale `v_plaza_ct_sugerida`: la sugerencia no se
-- inventa, se deduce.

BEGIN;

-- ── Cuantos dias a la semana hace un correturnos ───────────────────────────
-- 32 horas son 4 dias; 40 horas, 6. Coger mas es manual, pero el estandar es
-- este y decide cuantos coches necesita cada uno: a dos dias por coche, un
-- correturnos de 40 horas cubre tres matriculas.
ALTER TABLE cat_jornada ADD COLUMN IF NOT EXISTS dias_ct SMALLINT;

COMMENT ON COLUMN cat_jornada.dias_ct IS
  'Dias a la semana que hace un correturnos con esta jornada. A dos dias por coche, dice cuantas matriculas necesita';

UPDATE cat_jornada SET dias_ct = CASE WHEN horas >= 40 THEN 6 ELSE 4 END;

-- ── Las plazas, con su coche y su significado ──────────────────────────────
CREATE OR REPLACE VIEW v_plaza AS
SELECT p.id                                   AS plaza_id,
       p.vehiculo_id,
       v.matricula,
       v.estado_operativo,
       ev.es_operativo,
       ev.visible_cobertura,
       v.base_zona_id,
       bz.nombre                              AS zona,
       p.slot,
       s.turno_id,
       t.codigo                               AS turno_codigo,
       t.etiqueta                             AS turno,
       s.rol,
       s.orden_ct,
       p.orden_pantalla
  FROM plaza p
  JOIN vehiculo v              ON v.id = p.vehiculo_id AND v.baja_at IS NULL
  JOIN cat_slot s              ON s.slot = p.slot
  JOIN turno t                 ON t.id = s.turno_id
  JOIN cat_estado_vehiculo ev  ON ev.codigo = v.estado_operativo
  LEFT JOIN base_zona bz       ON bz.id = v.base_zona_id
 WHERE p.baja_at IS NULL;

COMMENT ON VIEW v_plaza IS
  'Las plazas vivas con su coche, su turno y su rol ya resueltos. Sustituye a las posiciones 0..5 de la hoja';

-- ── LA REGLA: quien cubre que dia ──────────────────────────────────────────
-- Una fila por dia CUBIERTO. Lo que no sale aqui es un hueco, y se sabe cual
-- restando contra las plazas: por eso se puede contar en DIAS y no en plazas,
-- que es lo que hacia falta. Un correturno vacio no es un hueco entero.
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
           -- Un fijo cubre todos MENOS los que libra, con el patron que
           -- estuviera vigente ESE dia y no el de hoy.
           ELSE NOT EXISTS (
             SELECT 1
               FROM patron_libranza pl
               JOIN patron_libranza_dia pld ON pld.patron_id = pl.id
              WHERE pl.conductor_id = a.conductor_id
                AND pl.desde <= g.dia::date
                AND (pl.hasta IS NULL OR pl.hasta >= g.dia::date)
                AND pld.dia_semana = EXTRACT(ISODOW FROM g.dia)::smallint)
         END
$$;

COMMENT ON FUNCTION f_cobertura(DATE, DATE) IS
  'Una fila por dia cubierto entre las dos fechas. Un fijo cubre todos menos los que libra; un correturnos solo los suyos. Lo que no sale es hueco';

-- ── Que dias le tocan a un correturnos en esta plaza ───────────────────────
-- Los que libra el fijo del mismo coche y turno. No hay que elegirlos: se
-- deducen, y solo se tocan a mano cuando alguien coge dias de mas.
CREATE OR REPLACE VIEW v_plaza_ct_sugerida AS
SELECT pl.plaza_id,
       pl.vehiculo_id,
       pl.matricula,
       pl.turno_id,
       pl.orden_ct,
       fijo.conductor_id                       AS fijo_conductor_id,
       lib.dias                                AS dias_sugeridos
  FROM v_plaza pl
  LEFT JOIN LATERAL (
    SELECT a.conductor_id
      FROM v_plaza f
      JOIN asignacion a ON a.plaza_id = f.plaza_id
                       AND a.desde <= CURRENT_DATE
                       AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
     WHERE f.vehiculo_id = pl.vehiculo_id
       AND f.turno_id = pl.turno_id
       AND f.rol = 'FIJO'
     LIMIT 1) fijo ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(pld.dia_semana ORDER BY pld.dia_semana) AS dias
      FROM patron_libranza p
      JOIN patron_libranza_dia pld ON pld.patron_id = p.id
     WHERE p.conductor_id = fijo.conductor_id
       AND p.desde <= CURRENT_DATE
       AND (p.hasta IS NULL OR p.hasta >= CURRENT_DATE)) lib ON TRUE
 WHERE pl.rol = 'CT';

COMMENT ON VIEW v_plaza_ct_sugerida IS
  'Que dias le tocan a un correturnos en cada plaza: los que libra el fijo de ese coche y turno';

COMMIT;
