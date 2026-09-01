-- ============================================================
-- 56 - EL DESCANSO VIVE EN EL COCHE (bloque del cuadrante)
-- ============================================================
-- Cambio de fondo pedido por Tráfico: la libranza se asigna SOLO desde el
-- cuadrante, de ningún otro sitio. El bloque de un cuadrante (L/M, X/J, S/D...)
-- lleva una matrícula, y esa matrícula descansa esos días; sus fijos libran lo
-- mismo por estar ahí. Antes el descanso era el patron_libranza del conductor;
-- ahora es del COCHE.
--
--   · Se BORRAN todas las libranzas viejas: se arranca de cero y se van
--     rellenando al montar los cuadrantes (acordado, es pruebas).
--   · El descanso pasa a vivir en el coche (vehiculo_descanso, con fecha).
--   · f_cobertura lee ESE descanso para el fijo. La libranza excepcional (por
--     conductor) sigue mandando por encima.
--   · v_plaza_ct_sugerida sugiere los días del CT desde el descanso del coche.

BEGIN;

-- ── 1. Arranque de cero ─────────────────────────────────────────────────────
DELETE FROM patron_libranza;   -- cascade borra patron_libranza_dia

-- ── 2. El descanso del coche (el bloque), con fecha ─────────────────────────
CREATE TABLE vehiculo_descanso (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  desde        DATE        NOT NULL,
  hasta        DATE,
  usuario_id   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_vehdesc_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Un coche no tiene dos descansos vigentes a la vez.
  CONSTRAINT ex_vehdesc_solape EXCLUDE USING gist
    (vehiculo_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
CREATE TABLE vehiculo_descanso_dia (
  descanso_id  BIGINT   NOT NULL REFERENCES vehiculo_descanso(id) ON DELETE CASCADE,
  dia_semana   SMALLINT NOT NULL,
  PRIMARY KEY (descanso_id, dia_semana),
  CONSTRAINT ck_vehdescdia CHECK (dia_semana BETWEEN 1 AND 7)
);

COMMENT ON TABLE vehiculo_descanso IS
  'Los días que descansa un coche (el bloque del cuadrante). Sus fijos libran esos días. Con fecha: no reescribe el pasado';

-- ── 3. El número del cuadrante (global, auto lo pone el backend) ────────────
ALTER TABLE cuadrante ADD COLUMN IF NOT EXISTS numero INT;

-- ── 4. f_cobertura: el fijo libra el DESCANSO DE SU COCHE ───────────────────
-- El correturnos, igual que antes (solo sus días de asignacion_dia). El fijo:
-- cubre si su coche no descansa ese día (o repone), y no es su libranza
-- excepcional.
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
         END
$$;

-- ── 5. v_plaza_ct_sugerida: los días del CT = el descanso del coche ─────────
DROP VIEW IF EXISTS v_plaza_ct_sugerida;
CREATE VIEW v_plaza_ct_sugerida AS
SELECT pl.plaza_id,
       pl.vehiculo_id,
       pl.matricula,
       pl.turno_id,
       pl.orden_ct,
       lib.dias AS dias_sugeridos
  FROM v_plaza pl
  LEFT JOIN LATERAL (
    SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
      FROM vehiculo_descanso vd
      JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
     WHERE vd.vehiculo_id = pl.vehiculo_id
       AND vd.desde <= CURRENT_DATE
       AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) lib ON TRUE
 WHERE pl.rol = 'CT';

COMMENT ON VIEW v_plaza_ct_sugerida IS
  'Los días que le tocan a un correturnos en cada plaza: los que descansa su coche (el bloque)';

COMMIT;
