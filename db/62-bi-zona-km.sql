-- ============================================================
-- 62 · BI — la zona sale del cuadrante, los km de fv_vehiculo, y bajas "de verdad"
-- ============================================================
-- Tres cosas que la primera versión (db/61) no sabía:
--
--   · ZONA. vehiculo.base_zona_id está casi siempre vacío: la zona vive en el
--     CUADRANTE ("Cuadrante 24 · Getafe"). Se toma la del coche y, si no, la de
--     su cuadrante. Sin esto las dimensiones salían con zona NULL en todo.
--   · KM. fv_ruta.matricula viene vacía: la matrícula del trayecto se saca por
--     fv_vehiculo.mapon_unit = fv_ruta.unit_id, igual que hace rutas.kmPorCoche.
--     Con el filtro sobre fv_ruta.matricula la vista de km se quedaba en cero.
--   · BAJAS REALES. 124 bajas llevan motivo 'Migración inicial': son el cierre
--     administrativo de periodos viejos al migrar, no gente que se fue. Para la
--     rotación se cuentan aparte (bajas_reales) y el KPI usa esas.
--
-- Como bi_vehiculo_dia y bi_kpi_mes cuelgan de la vista de km, se sueltan y se
-- recrean: A PARTIR DE AQUÍ SU DEFINICIÓN CANÓNICA ES ESTA, no la de db/61.

BEGIN;

DROP VIEW IF EXISTS bi_kpi_mes;
DROP VIEW IF EXISTS bi_vehiculo_dia;
DROP MATERIALIZED VIEW IF EXISTS bi_hecho_km_dia;

-- ── DIMENSIONES: la zona del cuadrante cuando el coche no la trae ───────────
CREATE OR REPLACE VIEW bi_dim_vehiculo AS
SELECT v.id                       AS vehiculo_id,
       v.matricula,
       v.marca_modelo,
       v.anio,
       v.color,
       v.plazas,
       v.estado_operativo,
       ev.etiqueta                AS estado_etiqueta,
       COALESCE(ev.es_operativo, FALSE) AS es_operativo,
       (v.baja_at IS NULL)        AS activo,
       COALESCE(z.nombre, zc.nombre) AS zona,
       cu.numero                  AS cuadrante,
       v.itv_caduca,
       v.seguro_caduca,
       v.aseguradora,
       v.licencia_transporte,
       fv.uuid                    AS bolt_uuid
  FROM vehiculo v
  LEFT JOIN cat_estado_vehiculo ev ON ev.codigo = v.estado_operativo
  LEFT JOIN base_zona z            ON z.id = v.base_zona_id
  LEFT JOIN cuadrante cu           ON cu.id = v.cuadrante_id
  LEFT JOIN base_zona zc           ON zc.id = cu.base_zona_id
  LEFT JOIN LATERAL (SELECT f.uuid FROM fv_vehiculo f WHERE f.matricula = v.matricula LIMIT 1) fv ON TRUE;

CREATE OR REPLACE VIEW bi_dim_conductor AS
SELECT c.id                                                     AS conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)     AS nombre,
       c.nombre                                                 AS nombre_pila,
       c.apellidos,
       c.empleo_vigente,
       pe.tipo                                                  AS tipo_contrato,
       pe.ett_nombre,
       pe.alta,
       pe.baja,
       pe.motivo_baja,
       pe.jornada_horas,
       COALESCE(pe.fecha_antiguedad, pe.alta)                   AS fecha_antiguedad,
       CASE WHEN pe.alta IS NULL THEN NULL
            ELSE ((COALESCE(pe.baja, CURRENT_DATE) - COALESCE(pe.fecha_antiguedad, pe.alta)) / 30.44)::numeric(6,1)
       END                                                      AS antiguedad_meses,
       (pe.fin_periodo_prueba IS NOT NULL AND pe.fin_periodo_prueba >= CURRENT_DATE) AS en_prueba,
       c.localidad,
       c.provincia,
       c.sexo,
       c.nacionalidad,
       EXTRACT(YEAR FROM age(c.fecha_nacimiento))::int          AS edad,
       ce.externo_id                                            AS bolt_uuid,
       ce.externo_nombre                                        AS bolt_nombre,
       tel.e164                                                 AS telefono,
       COALESCE(est.estado, 'activo')                           AS estado_actual,
       COALESCE(cest.etiqueta, 'Activo')                        AS estado_etiqueta,
       COALESCE(cest.es_ausencia, FALSE)                        AS ausente,
       est.desde                                                AS ausente_desde,
       COALESCE(z.nombre, zc.nombre)                            AS zona,
       ag.turno                                                 AS turno,
       v.matricula                                              AS matricula_plaza,
       cu.numero                                                AS cuadrante
  FROM conductor c
  LEFT JOIN LATERAL (
    SELECT * FROM conductor_periodo_empleo p
     WHERE p.conductor_id = c.id
     ORDER BY (p.baja IS NULL) DESC, p.alta DESC LIMIT 1) pe ON TRUE
  LEFT JOIN LATERAL (
    SELECT x.externo_id, x.externo_nombre FROM conductor_externo x
     WHERE x.conductor_id = c.id AND x.sistema = 'bolt'
     ORDER BY (x.visto_hasta IS NULL) DESC, x.visto_at DESC NULLS LAST LIMIT 1) ce ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.e164 FROM conductor_telefono t
     WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
     ORDER BY t.principal DESC, t.id LIMIT 1) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT h.estado, h.desde FROM conductor_estado_hist h
     WHERE h.conductor_id = c.id AND h.desde <= CURRENT_DATE
       AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE)
     ORDER BY h.desde DESC LIMIT 1) est ON TRUE
  LEFT JOIN cat_estado_conductor cest ON cest.codigo = est.estado
  LEFT JOIN LATERAL (
    SELECT a.plaza_id FROM asignacion a
     WHERE a.conductor_id = c.id AND a.retirada_at IS NULL
       AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
     ORDER BY a.desde DESC LIMIT 1) asg ON TRUE
  LEFT JOIN plaza      pl ON pl.id = asg.plaza_id
  LEFT JOIN vehiculo   v  ON v.id  = pl.vehiculo_id
  LEFT JOIN base_zona  z  ON z.id  = v.base_zona_id
  LEFT JOIN cuadrante  cu ON cu.id = v.cuadrante_id
  LEFT JOIN base_zona  zc ON zc.id = cu.base_zona_id
  LEFT JOIN LATERAL (SELECT a.turno FROM v_agenda a WHERE a.conductor_id = c.id LIMIT 1) ag ON TRUE
 WHERE NOT c.es_centinela;

-- ── PLANTILLA por día, con las bajas reales aparte ──────────────────────────
CREATE OR REPLACE VIEW bi_plantilla_dia AS
SELECT f.dia,
       COUNT(*)                                                       AS vigentes,
       COUNT(*) FILTER (WHERE pe.tipo = 'propia')                     AS vigentes_propia,
       COUNT(*) FILTER (WHERE pe.tipo = 'ett')                        AS vigentes_ett,
       COUNT(*) FILTER (WHERE COALESCE(ce.es_ausencia, FALSE))        AS ausentes,
       COUNT(*) FILTER (WHERE eh.estado = 'baja_medica')              AS baja_medica,
       COUNT(*) FILTER (WHERE eh.estado = 'vacaciones')               AS vacaciones,
       COUNT(*) FILTER (WHERE eh.estado = 'permiso')                  AS permiso,
       COUNT(*) FILTER (WHERE eh.estado IN ('suspendido', 'suspension_permiso')) AS suspendidos,
       COUNT(*) FILTER (WHERE pe.alta = f.dia)                        AS altas,
       COUNT(*) FILTER (WHERE pe.baja = f.dia)                        AS bajas,
       COUNT(*) FILTER (WHERE pe.fin_periodo_prueba >= f.dia AND pe.alta <= f.dia) AS en_prueba,
       COUNT(*) FILTER (WHERE pe.baja = f.dia AND COALESCE(pe.motivo_baja, '') <> 'Migración inicial') AS bajas_reales
  FROM (SELECT dia FROM bi_dim_fecha WHERE es_pasado OR es_hoy) f
  JOIN conductor_periodo_empleo pe ON pe.alta <= f.dia AND (pe.baja IS NULL OR pe.baja >= f.dia)
  JOIN conductor c ON c.id = pe.conductor_id AND NOT c.es_centinela
  LEFT JOIN LATERAL (
    SELECT h.estado FROM conductor_estado_hist h
     WHERE h.conductor_id = pe.conductor_id AND h.desde <= f.dia
       AND (h.hasta IS NULL OR h.hasta >= f.dia)
     ORDER BY h.desde DESC LIMIT 1) eh ON TRUE
  LEFT JOIN cat_estado_conductor ce ON ce.codigo = eh.estado
 GROUP BY f.dia;

-- ── HECHO: KM por día y coche (la matrícula, por fv_vehiculo) ───────────────
CREATE MATERIALIZED VIEW bi_hecho_km_dia AS
WITH r AS (
  SELECT COALESCE(veh.matricula, r.matricula) AS matricula,
         r.inicio, r.fin, r.metros,
         (r.inicio AT TIME ZONE 'Europe/Madrid')::date AS dia,
         veh.uuid AS vehiculo_uuid
    FROM fv_ruta r
    LEFT JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
   WHERE r.fin IS NOT NULL AND r.fin > r.inicio
     AND COALESCE(veh.matricula, r.matricula) IS NOT NULL
),
tot AS (
  SELECT dia, matricula, SUM(metros) AS metros_total, COUNT(*) AS trayectos FROM r GROUP BY 1, 2
),
rep AS (
  SELECT r.dia, r.matricula,
         SUM(r.metros * GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(r.fin, COALESCE(t.hasta, now())) - GREATEST(r.inicio, t.desde))))
             / NULLIF(EXTRACT(EPOCH FROM (r.fin - r.inicio)), 0))
           FILTER (WHERE t.situacion IN ('viaje', 'espera')) AS metros_bolt
    FROM r
    JOIN fv_tramo t ON t.vehiculo_uuid = r.vehiculo_uuid
                   AND t.desde < r.fin AND COALESCE(t.hasta, now()) > r.inicio
   GROUP BY 1, 2
)
SELECT tot.dia, tot.matricula, tot.trayectos,
       (tot.metros_total / 1000.0)::numeric(10,1)                                             AS km_total,
       (COALESCE(rep.metros_bolt, 0) / 1000.0)::numeric(10,1)                                 AS km_bolt,
       (GREATEST(0, tot.metros_total - COALESCE(rep.metros_bolt, 0)) / 1000.0)::numeric(10,1) AS km_fuera,
       (tot.dia::text || '|' || tot.matricula)                                                AS clave
  FROM tot
  LEFT JOIN rep ON rep.dia = tot.dia AND rep.matricula = tot.matricula
WITH DATA;
CREATE UNIQUE INDEX uq_bi_km   ON bi_hecho_km_dia (clave);
CREATE INDEX idx_bi_km_dia     ON bi_hecho_km_dia (dia);
CREATE INDEX idx_bi_km_mat     ON bi_hecho_km_dia (matricula, dia);
COMMENT ON MATERIALIZED VIEW bi_hecho_km_dia IS 'Km de Mapon por día y coche, partidos en km en BOLT (viaje/espera) y fuera. Refrescar cada hora.';

-- ── VEHÍCULO × DÍA (definición canónica) ─────────────────────────────────────
CREATE VIEW bi_vehiculo_dia AS
WITH hv AS (
  SELECT h.dia, h.vehiculo_uuid, h.conductor_uuid, h.seg_efectivo, h.seg_viaje, h.seg_espera, h.seg_descanso, h.seg_desconectado,
         SUM(h.seg_efectivo) OVER (PARTITION BY h.dia, h.conductor_uuid) AS seg_efectivo_persona_dia
    FROM bi_hecho_horas_dia h
),
ing AS (
  SELECT dia, driver_uuid, SUM(neto) AS neto, SUM(viajes) AS viajes FROM bi_hecho_ingresos_dia GROUP BY 1, 2
),
rep AS (
  SELECT hv.dia, hv.vehiculo_uuid,
         SUM(hv.seg_efectivo)     AS seg_efectivo,
         SUM(hv.seg_viaje)        AS seg_viaje,
         SUM(hv.seg_espera)       AS seg_espera,
         SUM(hv.seg_descanso)     AS seg_descanso,
         SUM(hv.seg_desconectado) AS seg_desconectado,
         COUNT(DISTINCT hv.conductor_uuid) FILTER (WHERE hv.seg_efectivo > 0) AS conductores,
         SUM(COALESCE(ing.neto, 0)   * hv.seg_efectivo / NULLIF(hv.seg_efectivo_persona_dia, 0)) AS neto,
         SUM(COALESCE(ing.viajes, 0) * hv.seg_efectivo / NULLIF(hv.seg_efectivo_persona_dia, 0)) AS viajes
    FROM hv
    LEFT JOIN ing ON ing.dia = hv.dia AND ing.driver_uuid = hv.conductor_uuid
   GROUP BY 1, 2
)
SELECT rep.dia,
       fv.matricula,
       dv.vehiculo_id, dv.zona, dv.cuadrante, dv.marca_modelo, dv.estado_operativo,
       (rep.seg_efectivo / 3600.0)::numeric(6,2)     AS horas_efectivas,
       (rep.seg_viaje / 3600.0)::numeric(6,2)        AS horas_viaje,
       (rep.seg_espera / 3600.0)::numeric(6,2)       AS horas_espera,
       (rep.seg_descanso / 3600.0)::numeric(6,2)     AS horas_descanso,
       (rep.seg_desconectado / 3600.0)::numeric(6,2) AS horas_desconectado,
       rep.conductores,
       COALESCE(rep.neto, 0)::numeric(10,2)          AS neto_atribuido,
       COALESCE(rep.viajes, 0)::numeric(8,1)         AS viajes_atribuidos,
       km.km_total, km.km_bolt, km.km_fuera,
       (rep.seg_efectivo > 0)                        AS salio
  FROM rep
  JOIN fv_vehiculo fv ON fv.uuid = rep.vehiculo_uuid
  LEFT JOIN bi_dim_vehiculo dv ON dv.matricula = fv.matricula
  LEFT JOIN bi_hecho_km_dia km ON km.dia = rep.dia AND km.matricula = fv.matricula;

-- ── KPI × MES (definición canónica; la rotación usa las bajas reales) ───────
CREATE VIEW bi_kpi_mes AS
WITH h AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes,
         SUM(seg_efectivo) / 3600.0 AS horas_efectivas,
         SUM(seg_viaje)    / 3600.0 AS horas_viaje,
         SUM(seg_espera)   / 3600.0 AS horas_espera,
         SUM(seg_descanso) / 3600.0 AS horas_descanso,
         COUNT(DISTINCT conductor_uuid) FILTER (WHERE seg_efectivo > 0) AS conductores_con_horas,
         COUNT(DISTINCT vehiculo_uuid)  FILTER (WHERE seg_efectivo > 0) AS coches_con_horas,
         COUNT(DISTINCT dia) AS dias_con_datos
    FROM bi_hecho_horas_dia GROUP BY 1
),
i AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes,
         SUM(viajes) AS viajes, SUM(neto) AS neto, SUM(propina) AS propina, SUM(peaje) AS peaje,
         SUM(ofertas) AS ofertas, SUM(perdidas_conductor) AS perdidas_conductor,
         SUM(sin_respuesta) AS sin_respuesta, SUM(rechazados) AS rechazados, SUM(canc_conductor) AS canc_conductor,
         SUM(canc_cliente) AS canc_cliente, SUM(cliente_no_aparece) AS cliente_no_aparece,
         COUNT(DISTINCT driver_uuid) FILTER (WHERE viajes > 0) AS conductores_con_viajes
    FROM bi_hecho_ingresos_dia GROUP BY 1
),
k AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes, SUM(km_total) AS km_total, SUM(km_bolt) AS km_bolt, SUM(km_fuera) AS km_fuera
    FROM bi_hecho_km_dia GROUP BY 1
),
p AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes,
         ROUND(AVG(vigentes), 1) AS plantilla_media, ROUND(AVG(vigentes_propia), 1) AS plantilla_propia_media,
         ROUND(AVG(vigentes_ett), 1) AS plantilla_ett_media,
         SUM(altas) AS altas, SUM(bajas) AS bajas, SUM(bajas_reales) AS bajas_reales,
         ROUND(AVG(ausentes), 1) AS ausentes_media, ROUND(AVG(baja_medica), 1) AS baja_medica_media,
         ROUND(AVG(vacaciones), 1) AS vacaciones_media
    FROM bi_plantilla_dia GROUP BY 1
)
SELECT anio_mes,
       h.dias_con_datos,
       h.horas_efectivas::numeric(10,1), h.horas_viaje::numeric(10,1), h.horas_espera::numeric(10,1), h.horas_descanso::numeric(10,1),
       h.conductores_con_horas, h.coches_con_horas,
       i.viajes, i.neto, i.propina, i.peaje, i.ofertas,
       i.perdidas_conductor, i.sin_respuesta, i.rechazados, i.canc_conductor, i.canc_cliente, i.cliente_no_aparece,
       i.conductores_con_viajes,
       k.km_total, k.km_bolt, k.km_fuera,
       p.plantilla_media, p.plantilla_propia_media, p.plantilla_ett_media, p.altas, p.bajas, p.bajas_reales,
       p.ausentes_media, p.baja_medica_media, p.vacaciones_media,
       (i.neto / NULLIF(h.horas_efectivas, 0))::numeric(8,2)                            AS euros_hora,
       (i.neto / NULLIF(i.viajes, 0))::numeric(8,2)                                     AS euros_viaje,
       (i.viajes / NULLIF(h.horas_efectivas, 0))::numeric(6,2)                          AS viajes_hora,
       (h.horas_viaje / NULLIF(h.horas_efectivas, 0) * 100)::numeric(5,1)               AS utilizacion_pct,
       (i.perdidas_conductor::numeric / NULLIF(i.ofertas, 0) * 100)::numeric(5,1)      AS pct_perdidas_conductor,
       (i.canc_cliente::numeric / NULLIF(i.ofertas, 0) * 100)::numeric(5,1)            AS pct_canc_cliente,
       (i.viajes::numeric / NULLIF(i.ofertas, 0) * 100)::numeric(5,1)                  AS pct_conversion,
       (k.km_bolt / NULLIF(h.horas_efectivas, 0))::numeric(6,1)                         AS km_por_hora_efectiva,
       (i.neto / NULLIF(k.km_bolt, 0))::numeric(6,2)                                    AS euros_km,
       (h.horas_efectivas / NULLIF(h.coches_con_horas, 0) / NULLIF(h.dias_con_datos, 0))::numeric(5,2) AS horas_por_coche_dia,
       (i.neto / NULLIF(h.coches_con_horas, 0) / NULLIF(h.dias_con_datos, 0))::numeric(8,2)            AS euros_por_coche_dia,
       (p.ausentes_media / NULLIF(p.plantilla_media, 0) * 100)::numeric(5,1)            AS pct_absentismo,
       (p.bajas_reales / NULLIF(p.plantilla_media, 0) * 100)::numeric(5,1)              AS pct_rotacion
  FROM h
  FULL JOIN i USING (anio_mes)
  FULL JOIN k USING (anio_mes)
  FULL JOIN p USING (anio_mes);
COMMENT ON VIEW bi_kpi_mes IS 'Una fila por mes con los indicadores de la empresa: horas, ingresos, km, plantilla y sus ratios. Punto de entrada para Power BI.';

COMMIT;
