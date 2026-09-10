-- ============================================================
-- 91 — La zona de un coche es la de su cuadrante
-- ============================================================
-- `v_plaza.zona` salía de `vehiculo.base_zona_id`, y esa columna está VACÍA en
-- los 95 coches de la flota: la zona se decide al meter el coche en un cuadrante
-- y vive en `cuadrante.base_zona_id`. Resultado: la vista devolvía zona en
-- blanco para todo el mundo, y quien la necesitaba se la volvía a calcular por
-- su cuenta —el generador de vacantes lo hace explícitamente— o se quedaba sin
-- ella, que es lo que le pasaba al planificador al ordenar por zona.
--
-- Se arregla donde estaba mal, no en cada consumidor: la zona del coche es la
-- suya si alguien se la puso a mano, y si no, la de su cuadrante.

BEGIN;

CREATE OR REPLACE VIEW v_plaza AS
SELECT p.id AS plaza_id,
       p.vehiculo_id,
       v.matricula,
       v.estado_operativo,
       ev.es_operativo,
       ev.visible_cobertura,
       COALESCE(v.base_zona_id, cu.base_zona_id)      AS base_zona_id,
       COALESCE(bz.nombre, cbz.nombre)                AS zona,
       p.slot,
       s.turno_id,
       t.codigo   AS turno_codigo,
       t.etiqueta AS turno,
       s.rol,
       s.orden_ct,
       p.orden_pantalla,
       v.cuadrante_id,
       cu.nombre  AS cuadrante,
       cu.numero  AS cuadrante_num
  FROM plaza p
  JOIN vehiculo v            ON v.id = p.vehiculo_id AND v.baja_at IS NULL
  JOIN cat_slot s            ON s.slot = p.slot
  JOIN turno t               ON t.id = s.turno_id
  JOIN cat_estado_vehiculo ev ON ev.codigo::text = v.estado_operativo::text
  LEFT JOIN base_zona bz     ON bz.id = v.base_zona_id
  LEFT JOIN cuadrante cu     ON cu.id = v.cuadrante_id AND cu.baja_at IS NULL
  LEFT JOIN base_zona cbz    ON cbz.id = cu.base_zona_id
 WHERE p.baja_at IS NULL;

COMMENT ON VIEW v_plaza IS
  'Cada plaza con su coche, turno, rol y zona. La zona es la del coche si la tiene y, si no, la de su cuadrante';

-- Y la plaza de una vacante hereda esa misma zona, en vez de repetir el cálculo.
CREATE OR REPLACE VIEW v_vacante_plaza AS
SELECT vp.id                         AS vacante_plaza_id,
       vp.vacante_id,
       vp.plaza_id,
       vpl.vehiculo_id,
       vpl.matricula,
       COALESCE(vpl.zona, '')        AS zona,
       vpl.rol,
       vpl.orden_ct,
       vpl.turno_id,
       vpl.turno,
       COALESCE(d.dias, ARRAY[]::smallint[])   AS dias,
       COALESCE(d.letras, '')                  AS letras,
       COALESCE(des.dias, ARRAY[]::smallint[]) AS descanso_coche,
       a.conductor_id                          AS ocupa_id,
       CASE WHEN a.conductor_id IS NULL THEN NULL
            ELSE COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                          btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) END AS ocupa,
       a.hasta                                 AS ocupa_hasta,
       -- Las columnas nuevas van al final: CREATE OR REPLACE VIEW no deja
       -- reordenar las que ya estaban, solo añadir detrás.
       vpl.base_zona_id,
       vpl.estado_operativo,
       vpl.es_operativo
  FROM vacante_plaza vp
  JOIN v_plaza vpl ON vpl.plaza_id = vp.plaza_id
  LEFT JOIN LATERAL (
    SELECT array_agg(vpd.dia_semana ORDER BY vpd.dia_semana) AS dias,
           string_agg(CASE vpd.dia_semana WHEN 1 THEN 'L' WHEN 2 THEN 'M' WHEN 3 THEN 'X'
                                          WHEN 4 THEN 'J' WHEN 5 THEN 'V' WHEN 6 THEN 'S'
                                          ELSE 'D' END, ' ' ORDER BY vpd.dia_semana) AS letras
      FROM vacante_plaza_dia vpd WHERE vpd.vacante_plaza_id = vp.id) d ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
      FROM vehiculo_descanso vd
      JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
     WHERE vd.vehiculo_id = vpl.vehiculo_id
       AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) des ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, conductor_id, hasta FROM asignacion
     WHERE plaza_id = vp.plaza_id AND retirada_at IS NULL
       AND desde <= CURRENT_DATE AND (hasta IS NULL OR hasta >= CURRENT_DATE)
     ORDER BY desde DESC LIMIT 1) a ON TRUE
  LEFT JOIN conductor c ON c.id = a.conductor_id;

COMMIT;
