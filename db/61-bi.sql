-- ============================================================
-- 61 · BI — la capa semántica: vistas bi_* para decidir (y para Power BI)
-- ============================================================
-- Todo lo que el negocio necesita para tomar decisiones, en tablas planas con
-- nombres de negocio, listas para dos consumidores a la vez:
--
--   · El módulo /bi del ERP (services/bi.js), que pinta los cuadros de mando.
--   · Power BI Desktop, conectado a PostgreSQL y eligiendo estas vistas como si
--     fueran tablas. Por eso los nombres son bi_dim_* (dimensiones: quién, qué,
--     cuándo) y bi_hecho_* (hechos: cuánto), que es el vocabulario de un modelo
--     en estrella, y por eso NO hay lógica en la app que no esté aquí: si Power BI
--     y la app leen lo mismo, no pueden contradecirse.
--
-- Las REGLAS DE NEGOCIO que todo lo demás ya cumple, aquí también:
--   · TIEMPO EFECTIVO = viaje + espera (fv_cat_situacion.efectivo). El descanso
--     ('busy') NO es trabajo. Está separado para que se vea, nunca sumado.
--   · Un rato pertenece al DÍA NATURAL (00:00→24:00, Madrid) en que ocurre. Un
--     tramo que cruza la medianoche se PARTE entre los dos días, no se asigna
--     entero a uno. Es el mismo criterio de Visibilidad y del informe de BOLT.
--   · El viaje se apunta al día en que TERMINA (finalizado_ts); una oferta que no
--     llegó a viaje, al día en que se creó.
--   · El turno horario (columna turno_hora) es día 05–17 / noche 17–05, igual que
--     rutas.TURNOS. Si algún día cambian los turnos, cambiar también este corte.
--
-- Los hechos gordos (horas, ingresos, km) son VISTAS MATERIALIZADAS: fv_tramo
-- tiene un cuarto de millón de filas y partirlas por día en cada consulta sería
-- lento. Se refrescan cada hora desde la app (services/bi.js refrescar) y a mano
-- con el botón de la pantalla. Las dimensiones y lo pequeño son vistas normales.

BEGIN;

-- ── DIMENSIÓN FECHA ─────────────────────────────────────────────────────────
-- Un calendario continuo para que los gráficos no tengan huecos los días sin
-- datos, y para agrupar por semana ISO o mes sin repetir la fórmula.
CREATE OR REPLACE VIEW bi_dim_fecha AS
SELECT d::date                                   AS dia,
       EXTRACT(YEAR FROM d)::int                 AS anio,
       EXTRACT(MONTH FROM d)::int                AS mes,
       to_char(d, 'YYYY-MM')                     AS anio_mes,
       to_char(d, 'TMMonth')                     AS mes_nombre,
       EXTRACT(ISOYEAR FROM d)::int              AS anio_iso,
       EXTRACT(WEEK FROM d)::int                 AS semana_iso,
       to_char(d, 'IYYY-"W"IW')                  AS anio_semana,
       EXTRACT(ISODOW FROM d)::int               AS dia_semana,        -- 1 = lunes … 7 = domingo
       to_char(d, 'TMDay')                       AS dia_semana_nombre,
       (EXTRACT(ISODOW FROM d) IN (6, 7))        AS es_finde,
       date_trunc('week',  d)::date              AS lunes_semana,
       date_trunc('month', d)::date              AS primero_mes,
       (d::date = (now() AT TIME ZONE 'Europe/Madrid')::date) AS es_hoy,
       (d::date < (now() AT TIME ZONE 'Europe/Madrid')::date) AS es_pasado
  FROM generate_series('2026-01-01'::date, '2027-12-31'::date, interval '1 day') d;

-- ── DIMENSIÓN CONDUCTOR ─────────────────────────────────────────────────────
-- Una fila por persona con todo lo que se necesita para cortar los números:
-- contrato (propia / ETT), antigüedad, zona y turno de su plaza, si está ausente
-- y por qué, y su cuenta de BOLT (bolt_uuid), que es la llave contra los hechos.
CREATE OR REPLACE VIEW bi_dim_conductor AS
SELECT c.id                                                     AS conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)     AS nombre,
       c.nombre                                                 AS nombre_pila,
       c.apellidos,
       c.empleo_vigente,
       pe.tipo                                                  AS tipo_contrato,     -- 'propia' | 'ett'
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
       z.nombre                                                 AS zona,
       ag.turno                                                 AS turno,
       v.matricula                                              AS matricula_plaza,
       cu.numero                                                AS cuadrante
  FROM conductor c
  -- El periodo de empleo que manda: el abierto si lo hay, si no el más reciente.
  LEFT JOIN LATERAL (
    SELECT * FROM conductor_periodo_empleo p
     WHERE p.conductor_id = c.id
     ORDER BY (p.baja IS NULL) DESC, p.alta DESC LIMIT 1) pe ON TRUE
  -- Su cuenta de BOLT vigente (la última vista si hubiera varias).
  LEFT JOIN LATERAL (
    SELECT x.externo_id, x.externo_nombre FROM conductor_externo x
     WHERE x.conductor_id = c.id AND x.sistema = 'bolt'
     ORDER BY (x.visto_hasta IS NULL) DESC, x.visto_at DESC NULLS LAST LIMIT 1) ce ON TRUE
  LEFT JOIN LATERAL (
    SELECT t.e164 FROM conductor_telefono t
     WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
     ORDER BY t.principal DESC, t.id LIMIT 1) tel ON TRUE
  -- Su situación HOY (vacaciones, baja médica…). Sin fila = activo.
  LEFT JOIN LATERAL (
    SELECT h.estado, h.desde FROM conductor_estado_hist h
     WHERE h.conductor_id = c.id AND h.desde <= CURRENT_DATE
       AND (h.hasta IS NULL OR h.hasta >= CURRENT_DATE)
     ORDER BY h.desde DESC LIMIT 1) est ON TRUE
  LEFT JOIN cat_estado_conductor cest ON cest.codigo = est.estado
  -- Su plaza de hoy → coche → zona y cuadrante.
  LEFT JOIN LATERAL (
    SELECT a.plaza_id FROM asignacion a
     WHERE a.conductor_id = c.id AND a.retirada_at IS NULL
       AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)
     ORDER BY a.desde DESC LIMIT 1) asg ON TRUE
  LEFT JOIN plaza      pl ON pl.id = asg.plaza_id
  LEFT JOIN vehiculo   v  ON v.id  = pl.vehiculo_id
  LEFT JOIN base_zona  z  ON z.id  = v.base_zona_id
  LEFT JOIN cuadrante  cu ON cu.id = v.cuadrante_id
  LEFT JOIN LATERAL (SELECT a.turno FROM v_agenda a WHERE a.conductor_id = c.id LIMIT 1) ag ON TRUE
 WHERE NOT c.es_centinela;

-- ── DIMENSIÓN VEHÍCULO ──────────────────────────────────────────────────────
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
       z.nombre                   AS zona,
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
  LEFT JOIN LATERAL (SELECT f.uuid FROM fv_vehiculo f WHERE f.matricula = v.matricula LIMIT 1) fv ON TRUE;

-- ── HECHO: HORAS por día natural, conductor y coche ─────────────────────────
-- Cada tramo se parte por los días que toca (Madrid) y se suma por situación. El
-- conductor puede ser NULL (coche rodando sin nadie conectado): esos segundos
-- cuentan para el coche, no para ninguna persona.
DROP MATERIALIZED VIEW IF EXISTS bi_hecho_horas_dia;
CREATE MATERIALIZED VIEW bi_hecho_horas_dia AS
WITH t AS (
  SELECT conductor_uuid, vehiculo_uuid, situacion, desde, COALESCE(hasta, now()) AS hasta
    FROM fv_tramo
   WHERE COALESCE(hasta, now()) > desde
),
d AS (
  SELECT t.*, g::date AS dia
    FROM t, generate_series((t.desde AT TIME ZONE 'Europe/Madrid')::date,
                            (t.hasta AT TIME ZONE 'Europe/Madrid')::date, interval '1 day') g
),
tr AS (
  SELECT dia, conductor_uuid, vehiculo_uuid, situacion,
         GREATEST(0, EXTRACT(EPOCH FROM (
           LEAST(hasta,  ((dia + 1)::timestamp AT TIME ZONE 'Europe/Madrid')) -
           GREATEST(desde, (dia::timestamp AT TIME ZONE 'Europe/Madrid'))))) AS seg
    FROM d
),
agg AS (
  SELECT dia, conductor_uuid, vehiculo_uuid,
         COALESCE(SUM(seg) FILTER (WHERE situacion = 'viaje'), 0)::bigint                 AS seg_viaje,
         COALESCE(SUM(seg) FILTER (WHERE situacion = 'espera'), 0)::bigint                AS seg_espera,
         COALESCE(SUM(seg) FILTER (WHERE situacion = 'descanso'), 0)::bigint              AS seg_descanso,
         COALESCE(SUM(seg) FILTER (WHERE situacion = 'desconectado'), 0)::bigint          AS seg_desconectado,
         COALESCE(SUM(seg) FILTER (WHERE situacion IN ('viaje', 'espera')), 0)::bigint    AS seg_efectivo
    FROM tr
   GROUP BY 1, 2, 3
)
SELECT agg.*,
       (dia::text || '|' || COALESCE(conductor_uuid, '-') || '|' || vehiculo_uuid) AS clave
  FROM agg
WITH DATA;
CREATE UNIQUE INDEX uq_bi_horas ON bi_hecho_horas_dia (clave);
CREATE INDEX idx_bi_horas_dia  ON bi_hecho_horas_dia (dia);
CREATE INDEX idx_bi_horas_cond ON bi_hecho_horas_dia (conductor_uuid, dia);
CREATE INDEX idx_bi_horas_veh  ON bi_hecho_horas_dia (vehiculo_uuid, dia);

-- ── HECHO: INGRESOS por día, conductor de BOLT y turno horario ──────────────
-- Un viaje 'finished' trae neto, propina y peaje. Los demás estados son OFERTAS
-- que no llegaron a viaje, y se cuentan por quién las perdió: el cliente (canceló
-- o no apareció) o el conductor (no respondió, rechazó, canceló tras aceptar).
-- Esa segunda familia es dinero que se dejó en la mesa, y por conductor.
DROP MATERIALIZED VIEW IF EXISTS bi_hecho_ingresos_dia;
CREATE MATERIALIZED VIEW bi_hecho_ingresos_dia AS
WITH o AS (
  SELECT (COALESCE(finalizado_ts, creado_ts) AT TIME ZONE 'Europe/Madrid')::date AS dia,
         driver_uuid, estado, neto, propina, peaje,
         CASE WHEN EXTRACT(HOUR FROM (COALESCE(finalizado_ts, creado_ts) AT TIME ZONE 'Europe/Madrid')) BETWEEN 5 AND 16
              THEN 'dia' ELSE 'noche' END AS turno_hora
    FROM bolt_order
),
agg AS (
  SELECT dia, driver_uuid, turno_hora,
         COUNT(*) FILTER (WHERE estado = 'finished')                                    AS viajes,
         COALESCE(SUM(neto)    FILTER (WHERE estado = 'finished'), 0)::numeric(12,2)    AS neto,
         COALESCE(SUM(propina) FILTER (WHERE estado = 'finished'), 0)::numeric(12,2)    AS propina,
         COALESCE(SUM(peaje)   FILTER (WHERE estado = 'finished'), 0)::numeric(12,2)    AS peaje,
         COUNT(*) FILTER (WHERE estado = 'client_cancelled')                            AS canc_cliente,
         COUNT(*) FILTER (WHERE estado = 'client_did_not_show')                         AS cliente_no_aparece,
         COUNT(*) FILTER (WHERE estado = 'driver_did_not_respond')                      AS sin_respuesta,
         COUNT(*) FILTER (WHERE estado = 'driver_rejected')                             AS rechazados,
         COUNT(*) FILTER (WHERE estado = 'driver_cancelled_after_accept')               AS canc_conductor,
         COUNT(*)                                                                       AS ofertas
    FROM o
   GROUP BY 1, 2, 3
)
SELECT agg.*,
       (sin_respuesta + rechazados + canc_conductor)                                    AS perdidas_conductor,
       (dia::text || '|' || COALESCE(driver_uuid, '-') || '|' || turno_hora)            AS clave
  FROM agg
WITH DATA;
CREATE UNIQUE INDEX uq_bi_ingresos  ON bi_hecho_ingresos_dia (clave);
CREATE INDEX idx_bi_ingresos_dia    ON bi_hecho_ingresos_dia (dia);
CREATE INDEX idx_bi_ingresos_driver ON bi_hecho_ingresos_dia (driver_uuid, dia);

-- ── HECHO: KM por día y coche ───────────────────────────────────────────────
-- Los km salen de los trayectos de Mapon (fv_ruta), repartidos entre las
-- situaciones de BOLT por solape con los tramos: km_bolt son los rodados en viaje
-- o espera; km_fuera, los rodados en descanso, desconectado o sin nadie conectado.
-- Un trayecto cuenta en el día en que EMPIEZA.
DROP MATERIALIZED VIEW IF EXISTS bi_hecho_km_dia;
CREATE MATERIALIZED VIEW bi_hecho_km_dia AS
WITH r AS (
  SELECT r.matricula, r.inicio, r.fin, r.metros,
         (r.inicio AT TIME ZONE 'Europe/Madrid')::date AS dia,
         veh.uuid AS vehiculo_uuid
    FROM fv_ruta r
    LEFT JOIN fv_vehiculo veh ON veh.mapon_unit = r.unit_id
   WHERE r.fin IS NOT NULL AND r.fin > r.inicio AND r.matricula IS NOT NULL
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
       (tot.metros_total / 1000.0)::numeric(10,1)                                          AS km_total,
       (COALESCE(rep.metros_bolt, 0) / 1000.0)::numeric(10,1)                              AS km_bolt,
       (GREATEST(0, tot.metros_total - COALESCE(rep.metros_bolt, 0)) / 1000.0)::numeric(10,1) AS km_fuera,
       (tot.dia::text || '|' || tot.matricula)                                             AS clave
  FROM tot
  LEFT JOIN rep ON rep.dia = tot.dia AND rep.matricula = tot.matricula
WITH DATA;
CREATE UNIQUE INDEX uq_bi_km   ON bi_hecho_km_dia (clave);
CREATE INDEX idx_bi_km_dia     ON bi_hecho_km_dia (dia);
CREATE INDEX idx_bi_km_mat     ON bi_hecho_km_dia (matricula, dia);

-- ── PLANTILLA por día: cuántos éramos, cuántos faltaban, altas y bajas ──────
-- Una persona cuenta como vigente desde su alta hasta su baja, ambos incluidos
-- (el día de la baja aún es suyo). Su ausencia de ese día sale de su historial.
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
       COUNT(*) FILTER (WHERE pe.fin_periodo_prueba >= f.dia AND pe.alta <= f.dia) AS en_prueba
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

-- ── HECHO: INCIDENCIAS del control en directo, con su gente ─────────────────
CREATE OR REPLACE VIEW bi_hecho_incidencias AS
SELECT i.id,
       i.dia_operativo                                            AS dia,
       i.tipo,
       ci.etiqueta                                                AS tipo_etiqueta,
       ci.gravedad,
       i.franja,
       v.matricula,
       dc.conductor_id,
       dc.nombre                                                  AS conductor,
       dc.tipo_contrato,
       dc.zona,
       i.abierta_at,
       i.resuelta_at,
       i.justificada_at,
       i.gestion,
       i.veces,
       (i.justificada_at IS NOT NULL)                             AS gestionada,
       EXTRACT(EPOCH FROM (COALESCE(i.resuelta_at, now()) - i.abierta_at))::int AS duracion_seg
  FROM fv_incidencia i
  JOIN fv_cat_incidencia ci ON ci.codigo = i.tipo
  JOIN fv_vehiculo v        ON v.uuid = i.vehiculo_uuid
  LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = i.conductor_uuid;

-- ── HECHO: BITÁCORA (marcas del día por persona) ────────────────────────────
CREATE OR REPLACE VIEW bi_hecho_bitacora AS
SELECT b.dia_operativo                AS dia,
       b.conductor_id,
       dc.nombre                      AS conductor,
       dc.tipo_contrato,
       b.marca,
       m.etiqueta                     AS marca_etiqueta,
       m.es_ausencia,
       m.cuenta_como_trabajado,
       b.marca_manual,
       b.trabajo_en_libranza,
       j.observacion                  AS justificacion,
       (j.horas_seg_momento / 3600.0)::numeric(5,1) AS horas_al_justificar
  FROM bitacora_dia b
  JOIN cat_marca_dia m        ON m.codigo = b.marca
  LEFT JOIN justificante j    ON j.id = b.justificante_id
  LEFT JOIN bi_dim_conductor dc ON dc.conductor_id = b.conductor_id;

-- ── FUNNEL de contratación ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW bi_funnel_candidaturas AS
SELECT c.id,
       c.creado_at::date                                          AS dia_creacion,
       to_char(c.creado_at, 'YYYY-MM')                            AS anio_mes,
       c.estado,
       e.etiqueta                                                 AS estado_etiqueta,
       e.etapa,
       e.orden                                                    AS etapa_orden,
       COALESCE(e.en_funnel, FALSE)                               AS en_funnel,
       COALESCE(e.es_salida, FALSE)                               AS es_salida,
       c.canal,
       cc.etiqueta                                                AS canal_etiqueta,
       z.nombre                                                   AS zona,
       t.etiqueta                                                 AS turno,
       c.tipo_contrato,
       c.experiencia, c.carne_vtc, c.prueba_conduccion, c.apto_medico,
       c.apto_at, c.alta_at, c.cerrado_at, c.motivo,
       CASE WHEN c.alta_at IS NOT NULL THEN (EXTRACT(EPOCH FROM (c.alta_at - c.creado_at)) / 86400)::numeric(6,1) END AS dias_hasta_alta
  FROM candidatura c
  LEFT JOIN cat_estado_candidatura e ON e.codigo = c.estado
  LEFT JOIN cat_canal_candidatura cc ON cc.codigo = c.canal
  LEFT JOIN base_zona z              ON z.id = c.base_zona_id
  LEFT JOIN turno t                  ON t.id = c.turno_id;

-- ── CONDUCTOR × MES: la ficha de rendimiento de cada persona ────────────────
-- Cruza horas e ingresos por la cuenta de BOLT. Quien no tenga cuenta enlazada
-- sale con conductor_id NULL: su dinero cuenta para la empresa pero no se le
-- puede poner nombre, y eso también es un dato (columna sin_enlazar).
CREATE OR REPLACE VIEW bi_conductor_mes AS
WITH h AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes, conductor_uuid AS bolt_uuid,
         SUM(seg_efectivo) / 3600.0 AS horas_efectivas,
         SUM(seg_viaje)    / 3600.0 AS horas_viaje,
         SUM(seg_espera)   / 3600.0 AS horas_espera,
         SUM(seg_descanso) / 3600.0 AS horas_descanso,
         COUNT(DISTINCT dia) FILTER (WHERE seg_efectivo > 0) AS dias_trabajados,
         COUNT(DISTINCT vehiculo_uuid) FILTER (WHERE seg_efectivo > 0) AS coches_distintos
    FROM bi_hecho_horas_dia WHERE conductor_uuid IS NOT NULL GROUP BY 1, 2
),
i AS (
  SELECT to_char(dia, 'YYYY-MM') AS anio_mes, driver_uuid AS bolt_uuid,
         SUM(viajes) AS viajes, SUM(neto) AS neto, SUM(propina) AS propina,
         SUM(ofertas) AS ofertas, SUM(perdidas_conductor) AS perdidas_conductor,
         SUM(sin_respuesta) AS sin_respuesta, SUM(rechazados) AS rechazados, SUM(canc_conductor) AS canc_conductor
    FROM bi_hecho_ingresos_dia WHERE driver_uuid IS NOT NULL GROUP BY 1, 2
)
SELECT COALESCE(h.anio_mes, i.anio_mes)                          AS anio_mes,
       COALESCE(h.bolt_uuid, i.bolt_uuid)                        AS bolt_uuid,
       dc.conductor_id, dc.nombre, dc.tipo_contrato, dc.zona, dc.turno, dc.empleo_vigente,
       (dc.conductor_id IS NULL)                                  AS sin_enlazar,
       fc.nombre                                                  AS nombre_bolt,
       COALESCE(h.horas_efectivas, 0)::numeric(8,1)               AS horas_efectivas,
       COALESCE(h.horas_viaje, 0)::numeric(8,1)                   AS horas_viaje,
       COALESCE(h.horas_espera, 0)::numeric(8,1)                  AS horas_espera,
       COALESCE(h.horas_descanso, 0)::numeric(8,1)                AS horas_descanso,
       COALESCE(h.dias_trabajados, 0)                             AS dias_trabajados,
       COALESCE(h.coches_distintos, 0)                            AS coches_distintos,
       COALESCE(i.viajes, 0)                                      AS viajes,
       COALESCE(i.neto, 0)                                        AS neto,
       COALESCE(i.propina, 0)                                     AS propina,
       COALESCE(i.ofertas, 0)                                     AS ofertas,
       COALESCE(i.perdidas_conductor, 0)                          AS perdidas_conductor,
       COALESCE(i.sin_respuesta, 0)                               AS sin_respuesta,
       COALESCE(i.rechazados, 0)                                  AS rechazados,
       COALESCE(i.canc_conductor, 0)                              AS canc_conductor,
       (COALESCE(i.neto, 0) / NULLIF(h.horas_efectivas, 0))::numeric(8,2)                        AS euros_hora,
       (COALESCE(i.neto, 0) / NULLIF(i.viajes, 0))::numeric(8,2)                                 AS euros_viaje,
       (COALESCE(i.viajes, 0) / NULLIF(h.horas_efectivas, 0))::numeric(6,2)                      AS viajes_hora,
       (h.horas_viaje / NULLIF(h.horas_efectivas, 0) * 100)::numeric(5,1)                        AS utilizacion_pct,
       (h.horas_efectivas / NULLIF(h.dias_trabajados, 0))::numeric(5,1)                          AS horas_por_dia,
       (COALESCE(i.perdidas_conductor, 0)::numeric / NULLIF(i.ofertas, 0) * 100)::numeric(5,1)   AS pct_perdidas_conductor
  FROM h
  FULL JOIN i ON i.anio_mes = h.anio_mes AND i.bolt_uuid = h.bolt_uuid
  LEFT JOIN bi_dim_conductor dc ON dc.bolt_uuid = COALESCE(h.bolt_uuid, i.bolt_uuid)
  LEFT JOIN fv_conductor fc     ON fc.uuid = COALESCE(h.bolt_uuid, i.bolt_uuid);

-- ── VEHÍCULO × DÍA: horas, km y el dinero que se le puede atribuir ──────────
-- BOLT no dice en qué coche fue cada viaje, así que el neto de un conductor en un
-- día se REPARTE entre los coches que llevó ese día en proporción a sus segundos
-- efectivos en cada uno. Casi siempre es un coche y el reparto es trivial.
CREATE OR REPLACE VIEW bi_vehiculo_dia AS
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

-- ── KPI × MES: la fila que resume la empresa ────────────────────────────────
CREATE OR REPLACE VIEW bi_kpi_mes AS
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
         SUM(altas) AS altas, SUM(bajas) AS bajas,
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
       p.plantilla_media, p.plantilla_propia_media, p.plantilla_ett_media, p.altas, p.bajas,
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
       (p.bajas / NULLIF(p.plantilla_media, 0) * 100)::numeric(5,1)                     AS pct_rotacion
  FROM h
  FULL JOIN i USING (anio_mes)
  FULL JOIN k USING (anio_mes)
  FULL JOIN p USING (anio_mes);

-- ── Metadatos del módulo: cuándo se refrescó cada hecho ─────────────────────
CREATE TABLE IF NOT EXISTS bi_meta (
  clave        VARCHAR(40) PRIMARY KEY,
  valor        TEXT,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO bi_meta (clave, valor) VALUES ('refresco', 'inicial') ON CONFLICT (clave) DO NOTHING;

COMMENT ON VIEW bi_kpi_mes IS 'Una fila por mes con los indicadores de la empresa: horas, ingresos, km, plantilla y sus ratios. Punto de entrada para Power BI.';
COMMENT ON MATERIALIZED VIEW bi_hecho_horas_dia IS 'Segundos por situación (viaje/espera/descanso/desconectado) por día natural, conductor y coche. Refrescar cada hora.';
COMMENT ON MATERIALIZED VIEW bi_hecho_ingresos_dia IS 'Viajes, neto y ofertas perdidas por día, conductor de BOLT y turno horario. Refrescar cada hora.';
COMMENT ON MATERIALIZED VIEW bi_hecho_km_dia IS 'Km de Mapon por día y coche, partidos en km en BOLT (viaje/espera) y fuera. Refrescar cada hora.';

COMMIT;
