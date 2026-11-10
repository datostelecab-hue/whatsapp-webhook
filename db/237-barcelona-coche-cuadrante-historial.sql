-- ============================================================
-- 237 — BARCELONA: EN QUÉ CUADRANTE ESTUVO CADA COCHE, CON FECHAS
-- ============================================================
-- Revisión del 10/11/2026 de la reconstrucción de los correturnos (db/236).
-- Desde db/236 el CT es una casilla del cuadrante que coge, cada día, las
-- plazas de SUS coches que libran (Camilo: «los correturnos sí o sí van a ser
-- una sola casilla cogiendo los coches que estén ahí»). Pero en qué cuadrante
-- está cada coche (sede_coche.cuadrante_id, db/234) no tenía historial: era la
-- pertenencia de HOY. Así, sacar o mover un coche REESCRIBÍA EL PASADO: los días
-- ya cerrados en que la casilla cubrió ese coche dejaban de tenerla en el plan,
-- las horas de su CT se iban a «Sin plaza» y el coche salía como «Libra» en el
-- reporte, la semana y la Visibilidad. Y el reporte de un día viejo tiene que
-- seguir cuadrando (la regla de siempre del módulo: cerrar, no borrar).
--
-- LO QUE HACE:
--
--   1 · sede_coche_cuadrante: una fila = un coche en un cuadrante durante un
--       periodo (desde, hasta). Meter o sacar un coche cierra la fila vigente la
--       víspera y abre otra desde ese día (barcelona.repo.cocheEnCuadrante).
--       Un coche no está en dos cuadrantes a la vez (exclusión gist).
--   2 · La siembra: cada coche que hoy está en un cuadrante vivo, desde el día
--       en que entró (sede_coche.actualizado_at en Madrid, la misma fecha que
--       usaba el código hasta ahora: antes de ese día no se sabe dónde estaba,
--       y sus casillas no lo cogen).
--   3 · sede_coche.cuadrante_id SE QUEDA como «el de hoy», por comodidad: lo
--       escribe la misma transacción que el historial y lo leen quienes
--       preguntan «¿dónde está hoy?» (borrar un cuadrante, meter un coche). Para
--       cualquier fecha manda el historial.
--   4 · Un aviso (RAISE NOTICE) de lo que pudo dejar la conversión de db/236 y
--       db/236 ya no puede decir (no se toca: su checksum la daría por
--       modificada): personas de una casilla que DOBLAN con una plaza fija suya
--       del mismo turno. No se arregla aquí (es decisión de quien planifica): el
--       tablero lo enseña en la casilla (`dobles`) y el Excel también.
--
-- Mientras no esté aplicada, el planificador sigue funcionando como antes (lee
-- la pertenencia de hoy y escribe solo sede_coche); al aplicarla, la siembra
-- parte de ahí.
--
-- Se puede pasar dos veces: la tabla con IF NOT EXISTS y la siembra solo para
-- los coches que aún no tienen ninguna fila.

BEGIN;

-- La exclusión mezcla `=` sobre texto con `&&` sobre rangos: btree_gist (db/03).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 1 · El historial de la pertenencia ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS sede_coche_cuadrante (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede          varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  matricula     varchar(16)  NOT NULL,
  -- Un cuadrante no se borra (se da de baja): sin ON DELETE.
  cuadrante_id  bigint       NOT NULL REFERENCES sede_cuadrante(id),
  desde         date         NOT NULL,
  hasta         date,                                -- último día en ese cuadrante; NULL = sigue
  creado_por    integer      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     timestamptz  NOT NULL DEFAULT now(),
  cerrado_por   integer      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrado_at    timestamptz,
  CONSTRAINT ck_sede_coche_cuadrante_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- UN COCHE, EN UN SOLO CUADRANTE A LA VEZ.
  CONSTRAINT ex_sede_coche_cuadrante_solape EXCLUDE USING gist (
    sede WITH =,
    matricula WITH =,
    daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS ix_sede_coche_cuadrante_rango ON sede_coche_cuadrante (sede, desde, hasta);
CREATE INDEX IF NOT EXISTS ix_sede_coche_cuadrante_cuadrante ON sede_coche_cuadrante (cuadrante_id);

COMMENT ON TABLE sede_coche_cuadrante IS
  'En qué cuadrante estuvo cada coche de OTRAS sedes (Barcelona) y cuándo: una fila = un coche en un cuadrante durante un periodo. Lo que coge una casilla de CT un día sale de los coches que estaban en su cuadrante ESE día (barcelona.plan.js): sacar o mover un coche no reescribe el pasado. db/237';
COMMENT ON COLUMN sede_coche_cuadrante.desde IS 'Primer día del coche en ese cuadrante (en Madrid).';
COMMENT ON COLUMN sede_coche_cuadrante.hasta IS 'Último día del coche en ese cuadrante. NULL = sigue en él.';
COMMENT ON COLUMN sede_coche_cuadrante.cerrado_por IS 'Quién lo sacó (o lo movió) de ese cuadrante. NULL si sigue, o si acaba porque ya había escrito lo siguiente.';

COMMENT ON TABLE sede_coche IS
  'El cuadrante de HOY de cada coche de OTRAS sedes (Barcelona), por matrícula (db/234): la copia de comodidad del historial sede_coche_cuadrante (db/237), escrita en la misma transacción. Para cualquier otra fecha manda el historial.';

-- ── 2 · La siembra, desde lo que hay hoy ────────────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO sede_coche_cuadrante (sede, matricula, cuadrante_id, desde, creado_por, creado_at)
  SELECT sc.sede, sc.matricula, sc.cuadrante_id,
         (sc.actualizado_at AT TIME ZONE 'Europe/Madrid')::date, sc.actualizado_por, sc.actualizado_at
    FROM sede_coche sc
    JOIN sede_cuadrante q ON q.id = sc.cuadrante_id AND q.baja_at IS NULL
   WHERE sc.cuadrante_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sede_coche_cuadrante h WHERE h.sede = sc.sede AND h.matricula = sc.matricula);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'db/237: % coche(s) con su cuadrante de hoy pasado(s) al historial (desde el día en que entraron).', v_n;
END $$;

-- ── 3 · ¿Dobla alguna persona de una casilla con una plaza fija suya? ───────
-- Lo que pudo dejar db/236: un CT por coche que también era fijo de otro coche
-- en el mismo turno pasa a una casilla que coge a TODOS los coches de su
-- cuadrante, y algún día le toca coger un coche mientras trabaja de fija en
-- otro. Con lo que vale hoy, por día de la semana, como el tablero
-- (barcelona.plan.doblesSemana): la plaza que coge la casilla ese día de la
-- semana (la primera, el día antes que la noche) y las fijas suyas de ese turno
-- que ese día no libran. Su propia plaza no cuenta: el día que la coge, libra.
DO $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  r     record;
  v_n   integer := 0;
BEGIN
  FOR r IN
    WITH casilla AS (
      SELECT k.id, k.sede, k.cuadrante_id, k.jornada, k.driver_uuid
        FROM sede_cuadrante_ct k
       WHERE k.driver_uuid IS NOT NULL AND k.desde <= v_hoy AND (k.hasta IS NULL OR k.hasta >= v_hoy)
    ), coge AS (
      -- Lo que coge cada casilla cada día de la semana, con los coches de su
      -- cuadrante de hoy y sus libranzas de hoy; la primera de cada día.
      SELECT DISTINCT ON (k.id, d.dia) k.id, k.sede, k.cuadrante_id, k.jornada, k.driver_uuid,
             d.dia, s.matricula, s.turno
        FROM casilla k
        JOIN sede_coche c ON c.sede = k.sede AND c.cuadrante_id = k.cuadrante_id
        JOIN sede_descanso s ON s.sede = c.sede AND s.matricula = c.matricula
                            AND s.turno IN ('dia', 'noche') AND (k.jornada = 'todoturno' OR s.turno = k.jornada)
                            AND s.desde <= v_hoy AND (s.hasta IS NULL OR s.hasta >= v_hoy)
       CROSS JOIN LATERAL unnest(s.dias) AS d(dia)
       ORDER BY k.id, d.dia, (s.turno = 'noche'), s.matricula
    )
    SELECT q.numero, g.jornada, g.driver_uuid, a.matricula, a.turno,
           COALESCE((SELECT NULLIF(btrim(ce.externo_nombre), '') FROM conductor_externo ce
                      WHERE ce.sistema = 'bolt' AND ce.externo_id = g.driver_uuid LIMIT 1), g.driver_uuid) AS nombre,
           string_agg((ARRAY['L', 'M', 'X', 'J', 'V', 'S', 'D'])[g.dia], ' ' ORDER BY g.dia) AS dias
      FROM coge g
      JOIN sede_cuadrante q ON q.id = g.cuadrante_id
      JOIN sede_asignacion a ON a.sede = g.sede AND a.driver_uuid = g.driver_uuid AND a.rol = 'fijo'
                            AND a.turno = g.turno AND a.desde <= v_hoy AND (a.hasta IS NULL OR a.hasta >= v_hoy)
     WHERE NOT EXISTS (SELECT 1 FROM sede_descanso s2
                        WHERE s2.sede = a.sede AND s2.matricula = a.matricula AND s2.turno = a.turno
                          AND s2.desde <= v_hoy AND (s2.hasta IS NULL OR s2.hasta >= v_hoy)
                          AND g.dia = ANY (s2.dias))
     GROUP BY q.numero, g.jornada, g.driver_uuid, a.matricula, a.turno
     ORDER BY q.numero, g.jornada, a.turno, a.matricula
  LOOP
    v_n := v_n + 1;
    RAISE NOTICE 'Ojo: % (CT % del C%) también es fija del % de % y los % la casilla le hace coger otro coche: dobla turno. Quítala de una de las dos en el planificador.',
      r.nombre, CASE r.jornada WHEN 'dia' THEN 'de día' WHEN 'noche' THEN 'de noche' ELSE 'todoturno' END, r.numero,
      r.matricula, CASE r.turno WHEN 'dia' THEN 'día' ELSE 'noche' END, r.dias;
  END LOOP;
  RAISE NOTICE 'db/237: % doble(s) turno(s) de personas de casilla con una fija suya (el tablero los enseña en la casilla).', v_n;
END $$;

COMMIT;
