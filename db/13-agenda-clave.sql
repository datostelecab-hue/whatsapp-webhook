-- ============================================================
-- 13 - LA AGENDA CRUZA POR NOMBRE, NO POR UUID
-- ============================================================
-- Lo dijo la comparacion: 143 filas emparejadas, las 143 por nombre y las 143
-- con ID_BOLT distinto. No era ruido: la vista emitia el UUID de la cuenta de
-- BOLT donde la hoja guarda el nombre.
--
-- Y sobraban filas, 462 contra 239. La vista sacaba tambien a quien ya causo
-- baja, que en la hoja no esta en AGENDA_V2 sino en CONDUCTORES_OUT.

BEGIN;

-- Se reemplaza entera y no con CREATE OR REPLACE: cambia el tipo de una
-- columna (varchar(64) a varchar) y eso el REPLACE no lo admite.
DROP VIEW IF EXISTS v_agenda;

CREATE VIEW v_agenda AS
SELECT c.id AS conductor_id,
       c.empleo_vigente                                        AS activo,
       COALESCE(ce.etiqueta, 'Activo')                         AS estado,
       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))     AS nombre_apellidos,
       -- ID_BOLT NO es un UUID: la hoja guarda aqui el NOMBRE tal como
       -- aparece en BOLT, y el planificador lo usa de clave para cruzar
       -- AGENDA_V2 con PLANIFICADOR_V2. Emitir el UUID rompia ese cruce: las
       -- 143 filas emparejadas lo estaban POR NOMBRE, ninguna por ID.
       --
       -- Primero el alias, que se cargo DESDE la hoja y por tanto coincide
       -- caracter a caracter. El nombre que da BOLT hoy va de reserva, para
       -- quien entro despues de la carga y todavia no tiene alias.
       COALESCE(ali.alias, ext.externo_nombre)                  AS id_bolt,
       c.dni_nie,
       c.naf,
       e.alta                                                  AS fecha_alta,
       e.fin_periodo_prueba,
       -- En prueba se deduce de la fecha, pero con TRES respuestas y no dos:
       -- si, no, y "no lo sabemos".
       --
       -- El fichero de RRHH no trae el fin del periodo de prueba, asi que va a
       -- estar vacio para mucha gente hasta que lo rellenen. Devolver FALSE en
       -- ese caso seria decir que alguien contratado hace dos meses YA NO esta
       -- en prueba, que es una respuesta equivocada disfrazada de dato.
       CASE WHEN e.fin_periodo_prueba IS NULL THEN NULL
            ELSE e.fin_periodo_prueba >= CURRENT_DATE
       END                                                     AS en_prueba,
       c.recomendador,
       t.etiqueta                                              AS turno,
       -- "40h", "32h ETT"… tal como lo espera el planificador. Con ::text
       -- explícito: mezclar un número con texto en un `||` funciona, pero
       -- depender de la conversión implícita es cómo aparecen sorpresas.
       CASE WHEN e.jornada_horas IS NULL THEN NULL
            ELSE e.jornada_horas::text || 'h' || CASE WHEN e.tipo = 'ett' THEN ' ETT' ELSE '' END
       END                                                     AS contrato,
       -- Libranzas, un booleano por día (1 = lunes).
       --
       -- Con `= ANY` y no con `@>`: `dia_semana` es SMALLINT, así que el
       -- array_agg de abajo da un `smallint[]`, y `ARRAY[1]` es `integer[]`.
       -- PostgreSQL no tiene un `@>` entre esos dos tipos y la vista no llegaba
       -- a crearse. `= ANY` sí compara un entero con un smallint sin castear.
       COALESCE(1 = ANY(lib.dias), FALSE) AS lib_lun,
       COALESCE(2 = ANY(lib.dias), FALSE) AS lib_mar,
       COALESCE(3 = ANY(lib.dias), FALSE) AS lib_mie,
       COALESCE(4 = ANY(lib.dias), FALSE) AS lib_jue,
       COALESCE(5 = ANY(lib.dias), FALSE) AS lib_vie,
       COALESCE(6 = ANY(lib.dias), FALSE) AS lib_sab,
       COALESCE(7 = ANY(lib.dias), FALSE) AS lib_dom,
       coche.matricula,
       -- "lat,lng" como lo escribía la hoja.
       CASE WHEN c.lat IS NULL OR c.lng IS NULL THEN NULL
            ELSE c.lat::text || ',' || c.lng::text END         AS coordenadas,
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
    SELECT externo_id, externo_nombre FROM conductor_externo
     WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
     ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) ext ON TRUE
  LEFT JOIN LATERAL (
    SELECT alias FROM conductor_alias
     WHERE conductor_id = c.id AND tipo = 'bolt_nombre'
       AND vigente AND NOT ambiguo
     ORDER BY creado_at LIMIT 1) ali ON TRUE
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
   -- La agenda son los contratados AHORA. Quien causo baja sale de aqui y
   -- vive en CONDUCTORES_OUT, igual que en la hoja.
   --
   -- OJO: esto es solo para reproducir AGENDA_V2. La pantalla de Plantilla va
   -- por otro camino (repo/conductores.listar) y alli salen TODOS a proposito:
   -- activos, bajas medicas, vacaciones y bajas de empresa.
 WHERE NOT c.es_centinela
   AND c.empleo_vigente;

COMMENT ON VIEW v_agenda IS
  'AGENDA_V2 reconstruida desde PostgreSQL. ID_BOLT es el NOMBRE en BOLT, que es lo que guarda la hoja y lo que el planificador usa de clave. Sin las ASG_* ni BINOMIO: esas las calcula el motor';

COMMIT;
