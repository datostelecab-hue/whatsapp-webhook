-- ============================================================
-- 203 — COCHES SIN CORRETURNOS: cada fijo con su propia libranza
-- ============================================================
-- Camilo, 15/10/2026: «Hay unos coches que no tienen correturnos y los fijos
-- descansan en días diferentes. La idea es hacer una nueva función en el coche
-- llamada "Sin correturnos": quita los correturnos (si los tiene) y oculta las
-- columnas para agregar correturnos, y deja asignarle días de libranza
-- diferentes a los dos fijos que queden. Se podrán agregar a los cuadrantes,
-- pero que diga que este coche no tiene correturnos y no se pueden agregar
-- personas en esta matrícula: será sobre todo para poder asignarles un
-- cuadrante».
--
-- Hasta hoy el fijo libraba EL DESCANSO DEL COCHE (db/56): un bloque de días
-- por matrícula, el mismo para el fijo de día y el de noche, y esos días los
-- cubre el correturnos. Un coche sin correturnos rompe las dos premisas: nadie
-- cubre los días que libra su fijo, y cada fijo libra los suyos.
--
-- Lo que cambia:
--
--   1. `vehiculo_sin_ct`: el coche sin correturnos, CON FECHA (a partir de qué
--      día). Con fecha y no un sí/no: el pasado de ese coche tuvo correturnos y
--      la cobertura de esas semanas tiene que seguir cuadrando.
--   2. `vehiculo_descanso.turno_id`: el descanso puede ser de UN turno. NULL es
--      lo de siempre (los dos turnos, el bloque del cuadrante); 1 o 2, el del
--      fijo de día o el de noche. La libranza sigue viviendo en el coche —en su
--      plaza—, no en la persona: si cambia el fijo, el nuevo libra lo mismo.
--      La exclusión pasa a ser por turno: un descanso de los dos turnos choca
--      con cualquiera; uno de día solo con otro de día.
--   3. Quien lee el descanso para un FIJO mira el de su turno o el común:
--      `f_cobertura`, `v_conductor_libranza`, `v_plaza_ct_sugerida` y
--      `v_vacante_plaza` (se reescriben con la definición que hay en la base,
--      tocando solo esa condición; las columnas no cambian).
--   4. Un disparador impide poner a nadie en una plaza de correturnos de un
--      coche sin correturnos, venga de la pantalla que venga (el tablero, el CT
--      del cuadrante, un evento, la vuelta de un apaño...).

BEGIN;

-- ── 1. El coche sin correturnos, con fecha ──────────────────────────────────
CREATE TABLE IF NOT EXISTS vehiculo_sin_ct (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  desde        DATE        NOT NULL,
  hasta        DATE,
  usuario_id   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_vehsinct_rango CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ex_vehsinct_solape EXCLUDE USING gist
    (vehiculo_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
COMMENT ON TABLE vehiculo_sin_ct IS
  'Coches sin correturnos, con fecha: no se ponen correturnos y cada fijo libra sus días (vehiculo_descanso por turno). db/203';

-- ── 2. El descanso, por turno ───────────────────────────────────────────────
ALTER TABLE vehiculo_descanso ADD COLUMN IF NOT EXISTS turno_id SMALLINT REFERENCES turno(id);
ALTER TABLE vehiculo_descanso DROP CONSTRAINT IF EXISTS ck_vehdesc_turno;
ALTER TABLE vehiculo_descanso ADD CONSTRAINT ck_vehdesc_turno CHECK (turno_id IS NULL OR turno_id IN (1, 2));
-- NULL ocupa los dos turnos (1..2); un turno, solo el suyo. Así un descanso
-- común no convive con uno de turno en las mismas fechas, y dos del mismo turno
-- tampoco.
ALTER TABLE vehiculo_descanso DROP CONSTRAINT IF EXISTS ex_vehdesc_solape;
ALTER TABLE vehiculo_descanso ADD CONSTRAINT ex_vehdesc_solape EXCLUDE USING gist (
  vehiculo_id WITH =,
  int4range(COALESCE(turno_id, 1), COALESCE(turno_id, 2), '[]') WITH &&,
  daterange(desde, hasta, '[]') WITH &&);
COMMENT ON COLUMN vehiculo_descanso.turno_id IS
  'NULL = el descanso del coche (los dos fijos, el bloque del cuadrante). 1/2 = solo el fijo de ese turno: coches sin correturnos (db/203)';

-- ── 3. f_cobertura: el fijo libra el descanso de SU turno ───────────────────
-- La de db/104 con una condición más en el descanso del fijo.
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
                    -- El común (los dos turnos) o el de SU turno (db/203).
                    AND (vd.turno_id IS NULL OR vd.turno_id = s.turno_id)
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
     AND NOT EXISTS (
       SELECT 1 FROM plan_relevo pr
        WHERE pr.anulado_at IS NULL
          AND pr.dia = g.dia::date
          AND pr.turno_id = s.turno_id
          AND pr.vehiculo_id = p.vehiculo_id
          AND pr.conductor_sale = a.conductor_id)
$$;

COMMENT ON FUNCTION f_cobertura(DATE, DATE, BOOLEAN) IS
  'Quien cubre cada coche, turno y dia. El fijo libra el descanso del coche (comun o el de su turno, db/203). Con p_incluir_ausentes=TRUE, dentro de las fechas de un evento vivo la ausencia NO quita a nadie: lo piden el cuadrante, Control, el parte y el WhatsApp. El expediente (rendimiento, asistencia, bitacora) lo llama SIEMPRE sin el interruptor';

-- ── 4. Las vistas que leen el descanso de un fijo ───────────────────────────
-- La definición viva de cada una, con la condición del turno añadida.

CREATE OR REPLACE VIEW v_conductor_libranza AS
 WITH por_plaza AS (
         SELECT a.conductor_id,
            g.n AS dia,
                CASE
                    WHEN s.rol::text = 'CT'::text THEN (EXISTS ( SELECT 1
                       FROM asignacion_dia ad
                      WHERE ad.asignacion_id = a.id AND ad.dia_semana = g.n))
                    ELSE NOT (EXISTS ( SELECT 1
                       FROM vehiculo_descanso vd
                         JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                      WHERE vd.vehiculo_id = p.vehiculo_id
                        AND (vd.turno_id IS NULL OR vd.turno_id = s.turno_id)
                        AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE) AND vdd.dia_semana = g.n))
                END AS trabaja
           FROM asignacion a
             JOIN plaza p ON p.id = a.plaza_id AND p.baja_at IS NULL
             JOIN cat_slot s ON s.slot = p.slot
             CROSS JOIN generate_series(1, 7) g(n)
          WHERE a.retirada_at IS NULL AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
        )
 SELECT conductor_id,
    array_agg(dia ORDER BY dia) FILTER (WHERE manda) AS dias_trabaja,
    array_agg(dia ORDER BY dia) FILTER (WHERE NOT manda) AS dias_libra
   FROM ( SELECT por_plaza.conductor_id,
            por_plaza.dia,
            bool_or(por_plaza.trabaja) AS manda
           FROM por_plaza
          GROUP BY por_plaza.conductor_id, por_plaza.dia) x
  GROUP BY conductor_id;

-- Lo que le toca a un correturnos: los días que libra el fijo de ese turno. En
-- un coche sin correturnos no se le puede poner a nadie (el disparador de
-- abajo), así que lo que sugiera da igual; se deja coherente.
CREATE OR REPLACE VIEW v_plaza_ct_sugerida AS
 SELECT pl.plaza_id,
    pl.vehiculo_id,
    pl.matricula,
    pl.turno_id,
    pl.orden_ct,
    lib.dias AS dias_sugeridos
   FROM v_plaza pl
     LEFT JOIN LATERAL ( SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
           FROM vehiculo_descanso vd
             JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
          WHERE vd.vehiculo_id = pl.vehiculo_id
            AND (vd.turno_id IS NULL OR vd.turno_id = pl.turno_id)
            AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) lib ON true
  WHERE pl.rol::text = 'CT'::text;

CREATE OR REPLACE VIEW v_vacante_plaza AS
 SELECT vp.id AS vacante_plaza_id,
    vp.vacante_id,
    vp.plaza_id,
    vpl.vehiculo_id,
    vpl.matricula,
    COALESCE(vpl.zona, ''::character varying) AS zona,
    vpl.rol,
    vpl.orden_ct,
    vpl.turno_id,
    vpl.turno,
    COALESCE(d.dias, ARRAY[]::smallint[]) AS dias,
    COALESCE(d.letras, ''::text) AS letras,
    COALESCE(des.dias, ARRAY[]::smallint[]) AS descanso_coche,
    a.conductor_id AS ocupa_id,
        CASE
            WHEN a.conductor_id IS NULL THEN NULL::text
            ELSE COALESCE(NULLIF(btrim(c.nombre_bolt::text), ''::text), btrim((c.nombre::text || ' '::text) || COALESCE(c.apellidos, ''::character varying)::text))
        END AS ocupa,
    a.hasta AS ocupa_hasta,
    vpl.base_zona_id,
    vpl.estado_operativo,
    vpl.es_operativo
   FROM vacante_plaza vp
     JOIN v_plaza vpl ON vpl.plaza_id = vp.plaza_id
     LEFT JOIN LATERAL ( SELECT array_agg(vpd.dia_semana ORDER BY vpd.dia_semana) AS dias,
            string_agg(
                CASE vpd.dia_semana
                    WHEN 1 THEN 'L'::text
                    WHEN 2 THEN 'M'::text
                    WHEN 3 THEN 'X'::text
                    WHEN 4 THEN 'J'::text
                    WHEN 5 THEN 'V'::text
                    WHEN 6 THEN 'S'::text
                    ELSE 'D'::text
                END, ' '::text ORDER BY vpd.dia_semana) AS letras
           FROM vacante_plaza_dia vpd
          WHERE vpd.vacante_plaza_id = vp.id) d ON true
     LEFT JOIN LATERAL ( SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
           FROM vehiculo_descanso vd
             JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
          WHERE vd.vehiculo_id = vpl.vehiculo_id
            AND (vd.turno_id IS NULL OR vd.turno_id = vpl.turno_id)
            AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) des ON true
     LEFT JOIN LATERAL ( SELECT asignacion.id,
            asignacion.conductor_id,
            asignacion.hasta
           FROM asignacion
          WHERE asignacion.plaza_id = vp.plaza_id AND asignacion.retirada_at IS NULL AND asignacion.desde <= CURRENT_DATE AND (asignacion.hasta IS NULL OR asignacion.hasta >= CURRENT_DATE)
          ORDER BY asignacion.desde DESC
         LIMIT 1) a ON true
     LEFT JOIN conductor c ON c.id = a.conductor_id;

-- ── 5. Nadie en la plaza de correturnos de un coche sin correturnos ─────────
-- Una red debajo de la pantalla: el planificador ya no lo ofrece, pero hay más
-- caminos que ponen gente en una plaza (el CT del cuadrante, un evento, la
-- vuelta de un apaño, cambiar o intercambiar coche). Cualquiera que lo intente
-- se para aquí con un mensaje que se entiende.
CREATE OR REPLACE FUNCTION tg_asignacion_sin_ct() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_mat TEXT;
BEGIN
  IF NEW.retirada_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT v.matricula INTO v_mat
    FROM plaza p
    JOIN cat_slot s        ON s.slot = p.slot AND s.rol = 'CT'
    JOIN vehiculo v        ON v.id = p.vehiculo_id
    JOIN vehiculo_sin_ct x ON x.vehiculo_id = p.vehiculo_id
                          AND daterange(x.desde, x.hasta, '[]') && daterange(NEW.desde, NEW.hasta, '[]')
   WHERE p.id = NEW.plaza_id
   LIMIT 1;
  IF v_mat IS NOT NULL THEN
    RAISE EXCEPTION 'El % no tiene correturnos: no se pueden agregar personas en sus plazas de correturnos', v_mat
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_asignacion_sin_ct ON asignacion;
CREATE TRIGGER tg_asignacion_sin_ct
  BEFORE INSERT OR UPDATE OF plaza_id, desde, hasta, retirada_at ON asignacion
  FOR EACH ROW EXECUTE FUNCTION tg_asignacion_sin_ct();

COMMIT;
