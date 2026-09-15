-- ============================================================
-- 113 - LA LIBRANZA SALE DEL CUADRANTE, NO DE UNA TABLA VACÍA
-- ============================================================
-- `patron_libranza` tiene CERO filas y las va a seguir teniendo: nadie apunta a
-- mano qué días libra cada persona, porque eso ya lo dice el cuadrante. Y sin
-- embargo `v_agenda` la leía, así que los 215 conductores salían de la base
-- "sin librar ningún día".
--
-- Eso es lo que impedía encender AGENDA_ORIGEN=postgres: la libranza no es un
-- campo más, es LO QUE DICE QUIÉN TRABAJA QUÉ DÍA. Con la agenda de PostgreSQL
-- tal y como estaba, la cobertura, el control de horas y los reportes habrían
-- puesto a toda la plantilla trabajando los siete días.
--
-- ── LA REGLA, EN UNA LÍNEA ──────────────────────────────────────────────────
--
--   Libra el día en que NINGUNA de sus plazas le hace trabajar.
--
-- Y qué le hace trabajar depende del papel que tenga en cada plaza:
--
--   · FIJO  sale todos los días que sale su coche → libra el DESCANSO DEL COCHE
--   · CT    sale los días que le pusieron y solo esos → libra los otros
--
-- Alguien puede estar en DOS plazas (un correturnos que cubre dos coches): por
-- eso es "ninguna de sus plazas" y no "su plaza". Y quien no tiene plaza no
-- aparece: sin coche no se libra, se está en el banquillo, que no es lo mismo.
--
-- ── POR QUÉ UNA VISTA Y NO REPETIR LA CONSULTA ──────────────────────────────
-- Esta regla ya estaba escrita a mano dentro de `conductores.repo` para la
-- pantalla de Plantilla, y funciona. El problema de tenerla dos veces es que el
-- día que cambie —y va a cambiar: los eventos abren plazas de refuerzo— una de
-- las dos se queda atrás en silencio, y entonces Plantilla y la agenda dicen
-- cosas distintas de la misma persona. Aquí vive una vez.

BEGIN;

-- ── Los días que TRABAJA cada conductor, y los que libra ───────────────────
CREATE OR REPLACE VIEW v_conductor_libranza AS
WITH por_plaza AS (
  SELECT a.conductor_id,
         g.n AS dia,
         -- ¿Le hace trabajar ESTA plaza este día?
         CASE WHEN s.rol = 'CT'
              -- El CT: solo los días que le pusieron en la asignación.
              THEN EXISTS (SELECT 1 FROM asignacion_dia ad
                            WHERE ad.asignacion_id = a.id AND ad.dia_semana = g.n)
              -- El fijo: todos menos los de descanso de su coche.
              ELSE NOT EXISTS (
                     SELECT 1
                       FROM vehiculo_descanso vd
                       JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
                      WHERE vd.vehiculo_id = p.vehiculo_id
                        AND vd.desde <= CURRENT_DATE
                        AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)
                        AND vdd.dia_semana = g.n)
         END AS trabaja
    FROM asignacion a
    JOIN plaza p     ON p.id = a.plaza_id AND p.baja_at IS NULL
    JOIN cat_slot s  ON s.slot = p.slot
    CROSS JOIN generate_series(1, 7) AS g(n)
   WHERE a.retirada_at IS NULL
     AND a.desde <= CURRENT_DATE
     AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
)
SELECT conductor_id,
       array_agg(dia ORDER BY dia) FILTER (WHERE manda)     AS dias_trabaja,
       array_agg(dia ORDER BY dia) FILTER (WHERE NOT manda) AS dias_libra
  FROM (
    SELECT conductor_id, dia, bool_or(trabaja) AS manda
      FROM por_plaza
     GROUP BY conductor_id, dia
  ) x
 GROUP BY conductor_id;

COMMENT ON VIEW v_conductor_libranza IS
  'Qué días trabaja y cuáles libra cada conductor, derivado del cuadrante: el fijo libra el descanso de su coche, el CT los días que no le pusieron. Sin plaza no sale';

-- ── La agenda, con la libranza de verdad ───────────────────────────
-- SE PARTE DE LA DEFINICIÓN QUE HAY EN LA BASE y se cambian DOS cosas: las siete
-- expresiones `lib_*` y un JOIN. Reescribir la vista entera a mano era pedir un
-- fallo —son 28 columnas, con nombres que no son los que uno supone
-- (`tel_emergencia`, no `telefono_emergencia`) y un `coche.matricula` que
-- concatena las dos matrículas de quien lleva dos—.
--
-- `patron_libranza` se sigue mirando PRIMERO: si algún día alguien apunta un
-- patrón a mano, ese manda sobre el cuadrante. Hoy no hay ninguno, pero quitar
-- la puerta sería decidir por quien venga detrás.
-- CREATE OR REPLACE, NO DROP: de `v_agenda` cuelgan cuatro vistas de BI
-- (`bi_dim_conductor` y las tres que la usan), y tirarla obligaría a un CASCADE
-- que se las llevaría por delante. Vale porque las 28 columnas no cambian —ni
-- de nombre, ni de tipo, ni de orden—: lo único distinto es de dónde salen siete
-- de ellas.
CREATE OR REPLACE VIEW v_agenda AS
SELECT c.id AS conductor_id,
    c.empleo_vigente AS activo,
    COALESCE(ce.etiqueta, 'Activo'::character varying) AS estado,
    btrim((c.nombre::text || ' '::text) || COALESCE(c.apellidos, ''::character varying)::text) AS nombre_apellidos,
    COALESCE(ali.alias, ext.externo_nombre, btrim((c.nombre::text || ' '::text) || COALESCE(c.apellidos, ''::character varying)::text)::character varying) AS id_bolt,
    ext.externo_id IS NULL AS bolt_pendiente,
    c.dni_nie,
    c.naf,
    e.alta AS fecha_alta,
    e.fin_periodo_prueba,
        CASE
            WHEN e.fin_periodo_prueba IS NULL THEN NULL::boolean
            ELSE e.fin_periodo_prueba >= CURRENT_DATE
        END AS en_prueba,
    c.recomendador,
    t.etiqueta AS turno,
        CASE
            WHEN e.jornada_horas IS NULL THEN NULL::text
            ELSE (e.jornada_horas::text || 'h'::text) ||
            CASE
                WHEN e.tipo::text = 'ett'::text THEN ' ETT'::text
                ELSE ''::text
            END
        END AS contrato,
    COALESCE(1 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_lun,
    COALESCE(2 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_mar,
    COALESCE(3 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_mie,
    COALESCE(4 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_jue,
    COALESCE(5 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_vie,
    COALESCE(6 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_sab,
    COALESCE(7 = ANY (COALESCE(lib.dias, cua.dias_libra)), false) AS lib_dom,
    coche.matricula,
        CASE
            WHEN c.lat IS NULL OR c.lng IS NULL THEN NULL::text
            ELSE (c.lat::text || ','::text) || c.lng::text
        END AS coordenadas,
    c.direccion AS direccion_completa,
    tel.e164 AS telefono,
    c.tel_emergencia,
    c.observaciones,
    s.hasta_previsto AS reincorporacion
   FROM conductor c
     LEFT JOIN conductor_periodo_empleo e ON e.conductor_id = c.id AND e.baja IS NULL
     LEFT JOIN conductor_estado_hist s ON s.conductor_id = c.id AND s.desde <= CURRENT_DATE AND (s.hasta IS NULL OR s.hasta >= CURRENT_DATE)
     LEFT JOIN cat_estado_conductor ce ON ce.codigo::text = s.estado::text
     LEFT JOIN conductor_turno_hist th ON th.conductor_id = c.id AND th.desde <= CURRENT_DATE AND (th.hasta IS NULL OR th.hasta >= CURRENT_DATE)
     LEFT JOIN turno t ON t.id = th.turno_id
     LEFT JOIN LATERAL ( SELECT conductor_externo.externo_id,
            conductor_externo.externo_nombre
           FROM conductor_externo
          WHERE conductor_externo.conductor_id = c.id AND conductor_externo.sistema::text = 'bolt'::text AND conductor_externo.visto_hasta IS NULL
          ORDER BY (conductor_externo.estado_externo::text = 'active'::text) DESC, conductor_externo.visto_desde DESC
         LIMIT 1) ext ON true
     LEFT JOIN LATERAL ( SELECT conductor_alias.alias
           FROM conductor_alias
          WHERE conductor_alias.conductor_id = c.id AND conductor_alias.tipo::text = 'bolt_nombre'::text AND conductor_alias.vigente AND NOT conductor_alias.ambiguo
          ORDER BY conductor_alias.creado_at
         LIMIT 1) ali ON true
     LEFT JOIN LATERAL ( SELECT conductor_telefono.e164
           FROM conductor_telefono
          WHERE conductor_telefono.conductor_id = c.id AND conductor_telefono.vigente_hasta IS NULL
          ORDER BY conductor_telefono.principal DESC, conductor_telefono.id
         LIMIT 1) tel ON true
     LEFT JOIN LATERAL ( SELECT array_agg(d.dia_semana) AS dias
           FROM patron_libranza pl
             JOIN patron_libranza_dia d ON d.patron_id = pl.id
          WHERE pl.conductor_id = c.id AND pl.desde <= CURRENT_DATE AND (pl.hasta IS NULL OR pl.hasta >= CURRENT_DATE)) lib ON true
     LEFT JOIN LATERAL ( SELECT string_agg(DISTINCT v.matricula::text, ' + '::text ORDER BY (v.matricula::text)) AS matricula
           FROM asignacion a
             JOIN plaza p ON p.id = a.plaza_id
             JOIN vehiculo v ON v.id = p.vehiculo_id
          WHERE a.conductor_id = c.id AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)) coche ON true
     LEFT JOIN v_conductor_libranza cua ON cua.conductor_id = c.id
  WHERE NOT c.es_centinela AND c.empleo_vigente;

COMMENT ON VIEW v_agenda IS
  'Las filas de AGENDA_V2 reconstruidas desde PostgreSQL. La libranza sale del cuadrante (v_conductor_libranza); un patron a mano, si lo hubiera, manda sobre ella';

COMMIT;
