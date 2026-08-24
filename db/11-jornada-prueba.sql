-- ============================================================
-- 11 · JORNADA Y PERIODO DE PRUEBA
-- ============================================================
-- Lo último que le falta a PostgreSQL para poder reconstruir AGENDA_V2 entera y
-- que los 24 módulos que hoy leen la hoja dejen de hacerlo.
--
-- De las 33 columnas de la agenda: 22 ya salen del esquema, 7 las calcula el
-- motor (las ASG_*) y BINOMIO también — se escribe pero no se lee nunca, es una
-- caché. Quedaban estas dos, y las dos son del PERIODO DE EMPLEO, no de la
-- persona: alguien pasa de 32h a 40h sin dejar de ser el mismo, y el periodo de
-- prueba es de ese contrato concreto.
--
--   CONTRATO ("40h ETT")  = jornada_horas + el `tipo` que ya existe
--   FIN_PERIODO_PRUEBA    = fin_periodo_prueba
--   EN_PRUEBA             = se DEDUCE de la fecha, no se guarda aparte:
--                           guardar un "sí/no" junto a la fecha que lo decide
--                           es garantizar que un día se contradigan.

BEGIN;

ALTER TABLE conductor_periodo_empleo
  ADD COLUMN jornada_horas      SMALLINT,
  ADD COLUMN fin_periodo_prueba DATE;

-- La jornada solo admite lo que admite el desplegable del planificador. Si
-- mañana hay contratos de 20h, se amplía aquí y en un sitio más, no en veinte.
ALTER TABLE conductor_periodo_empleo
  ADD CONSTRAINT ck_empleo_jornada
    CHECK (jornada_horas IS NULL OR jornada_horas IN (20, 25, 30, 32, 35, 40));

-- El periodo de prueba no puede acabar antes de empezar el contrato.
ALTER TABLE conductor_periodo_empleo
  ADD CONSTRAINT ck_empleo_prueba
    CHECK (fin_periodo_prueba IS NULL OR fin_periodo_prueba >= alta);

COMMENT ON COLUMN conductor_periodo_empleo.jornada_horas IS
  'Horas semanales del contrato. Con `tipo` forma el CONTRATO de la agenda: 40h, 32h ETT…';
COMMENT ON COLUMN conductor_periodo_empleo.fin_periodo_prueba IS
  'Último día de prueba. "En prueba" NO se guarda: se deduce comparando con la fecha de hoy';

CREATE INDEX idx_empleo_prueba ON conductor_periodo_empleo (fin_periodo_prueba)
  WHERE baja IS NULL AND fin_periodo_prueba IS NOT NULL;

-- ── La agenda, reconstruida ─────────────────────────────────────────────────
-- Una fila por conductor con TODO lo que la hoja AGENDA_V2 daba. Es la pieza
-- que permite que `leerCrudo()` deje de ir a Google sin tocar los 24 módulos
-- que dependen de ella: el motor sigue recibiendo lo mismo.
--
-- Las columnas ASG_* y BINOMIO no están: las calcula el motor y escribirlas
-- aquí sería inventar un dato que él mismo va a sobrescribir.
CREATE OR REPLACE VIEW v_agenda AS
SELECT c.id AS conductor_id,
       c.empleo_vigente                                        AS activo,
       COALESCE(ce.etiqueta, 'Activo')                         AS estado,
       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))     AS nombre_apellidos,
       ext.externo_id                                          AS id_bolt,
       c.dni_nie,
       c.naf,
       e.alta                                                  AS fecha_alta,
       e.fin_periodo_prueba,
       -- En prueba se deduce: si la fecha no ha pasado, sigue en prueba.
       (e.fin_periodo_prueba IS NOT NULL
          AND e.fin_periodo_prueba >= CURRENT_DATE)            AS en_prueba,
       c.recomendador,
       t.etiqueta                                              AS turno,
       -- "40h", "32h ETT"… tal como lo espera el planificador.
       CASE WHEN e.jornada_horas IS NULL THEN NULL
            ELSE e.jornada_horas || 'h' || CASE WHEN e.tipo = 'ett' THEN ' ETT' ELSE '' END
       END                                                     AS contrato,
       -- Libranzas, un booleano por día (1 = lunes).
       COALESCE(lib.dias @> ARRAY[1], FALSE) AS lib_lun,
       COALESCE(lib.dias @> ARRAY[2], FALSE) AS lib_mar,
       COALESCE(lib.dias @> ARRAY[3], FALSE) AS lib_mie,
       COALESCE(lib.dias @> ARRAY[4], FALSE) AS lib_jue,
       COALESCE(lib.dias @> ARRAY[5], FALSE) AS lib_vie,
       COALESCE(lib.dias @> ARRAY[6], FALSE) AS lib_sab,
       COALESCE(lib.dias @> ARRAY[7], FALSE) AS lib_dom,
       coche.matricula,
       -- "lat,lng" como lo escribía la hoja.
       CASE WHEN c.lat IS NULL OR c.lng IS NULL THEN NULL
            ELSE c.lat || ',' || c.lng END                     AS coordenadas,
       c.direccion                                             AS direccion_completa,
       tel.e164                                                AS telefono,
       c.tel_emergencia,
       c.observaciones,
       s.hasta_previsto                                        AS reincorporacion
  FROM conductor c
  LEFT JOIN conductor_periodo_empleo e
         ON e.conductor_id = c.id AND e.baja IS NULL
  LEFT JOIN conductor_estado_hist s
         ON s.conductor_id = c.id
        AND s.desde <= CURRENT_DATE AND (s.hasta IS NULL OR s.hasta >= CURRENT_DATE)
  LEFT JOIN cat_estado_conductor ce ON ce.codigo = s.estado
  LEFT JOIN conductor_turno_hist th
         ON th.conductor_id = c.id
        AND th.desde <= CURRENT_DATE AND (th.hasta IS NULL OR th.hasta >= CURRENT_DATE)
  LEFT JOIN turno t ON t.id = th.turno_id
  LEFT JOIN LATERAL (
    SELECT externo_id FROM conductor_externo
     WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
     ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
  LEFT JOIN LATERAL (
    SELECT e164 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(d.dia_semana) AS dias
      FROM patron_libranza pl
      JOIN patron_libranza_dia d ON d.patron_id = pl.id
     WHERE pl.conductor_id = c.id
       AND pl.desde <= CURRENT_DATE AND (pl.hasta IS NULL OR pl.hasta >= CURRENT_DATE)) lib ON TRUE
  LEFT JOIN LATERAL (
    -- La matrícula "principal": si tiene varias plazas, la primera por placa.
    SELECT string_agg(DISTINCT v.matricula, ' + ' ORDER BY v.matricula) AS matricula
      FROM asignacion a
      JOIN plaza p    ON p.id = a.plaza_id
      JOIN vehiculo v ON v.id = p.vehiculo_id
     WHERE a.conductor_id = c.id
       AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)) coche ON TRUE
 WHERE NOT c.es_centinela;

COMMENT ON VIEW v_agenda IS
  'AGENDA_V2 reconstruida desde PostgreSQL. Sin las ASG_* ni BINOMIO: esas las calcula el motor y escribirlas aquí sería inventarlas';

COMMIT;
