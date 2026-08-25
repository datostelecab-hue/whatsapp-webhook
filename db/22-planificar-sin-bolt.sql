-- ============================================================
-- 22 - SE PLANIFICA SIN ESTAR EN BOLT
-- ============================================================
-- El planificador cruza AGENDA_V2 con PLANIFICADOR_V2 por ID_BOLT, que no es un
-- uuid sino el NOMBRE tal como sale en BOLT. Sin ese nombre no hay clave con la
-- que escribir, asi que quien no estuviera dado de alta en BOLT sencillamente no
-- se podia colocar en ningun coche.
--
-- Y eso no es lo que hace falta. Una persona contratada empieza el jueves tenga
-- o no cuenta en BOLT: darla de alta alli es trabajo de RRHH y se resuelve en
-- paralelo. Bloquear la planificacion por eso para el coche, no el tramite.
--
-- Asi que ID_BOLT nunca viene vacio: si no hay cuenta, se usa el nombre de la
-- persona como clave PROVISIONAL. Y se dice a las claras que es provisional, con
-- `bolt_pendiente`, para que el planificador lo avise sin impedir nada.
--
-- OJO con lo que viene despues: cuando la cuenta de BOLT aparezca, el nombre
-- real puede no coincidir con el provisional, y entonces la clave cambia. La
-- asignacion que este escrita en PLANIFICADOR_V2 con el nombre viejo hay que
-- reescribirla. Eso va con el enlace automatico por telefono, no aqui.

BEGIN;

DROP VIEW IF EXISTS v_agenda;

CREATE VIEW v_agenda AS
SELECT c.id AS conductor_id,
       c.empleo_vigente                                        AS activo,
       COALESCE(ce.etiqueta, 'Activo')                         AS estado,
       btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))     AS nombre_apellidos,
       -- La clave del planificador. NUNCA vacia:
       --
       --   1. El alias cargado desde la hoja, que coincide caracter a caracter.
       --   2. El nombre que da BOLT hoy, para quien entro despues de la carga.
       --   3. Y si no hay cuenta, el nombre de la persona como PROVISIONAL.
       --
       -- La tercera es la que permite planificar a alguien que todavia no esta
       -- en BOLT, que es lo normal en una incorporacion.
       COALESCE(ali.alias, ext.externo_nombre,
                btrim(c.nombre || ' ' || COALESCE(c.apellidos, '')))  AS id_bolt,
       -- Si esa clave es provisional. Es un AVISO, no un impedimento: RRHH tiene
       -- que darle de alta en BOLT, pero mientras tanto el coche sale.
       (ext.externo_id IS NULL)                                AS bolt_pendiente,
       c.dni_nie,
       c.naf,
       e.alta                                                  AS fecha_alta,
       e.fin_periodo_prueba,
       -- En prueba se deduce de la fecha, pero con TRES respuestas y no dos:
       -- si, no, y "no lo sabemos".
       CASE WHEN e.fin_periodo_prueba IS NULL THEN NULL
            ELSE e.fin_periodo_prueba >= CURRENT_DATE
       END                                                     AS en_prueba,
       c.recomendador,
       t.etiqueta                                              AS turno,
       CASE WHEN e.jornada_horas IS NULL THEN NULL
            ELSE e.jornada_horas::text || 'h' || CASE WHEN e.tipo = 'ett' THEN ' ETT' ELSE '' END
       END                                                     AS contrato,
       COALESCE(1 = ANY(lib.dias), FALSE) AS lib_lun,
       COALESCE(2 = ANY(lib.dias), FALSE) AS lib_mar,
       COALESCE(3 = ANY(lib.dias), FALSE) AS lib_mie,
       COALESCE(4 = ANY(lib.dias), FALSE) AS lib_jue,
       COALESCE(5 = ANY(lib.dias), FALSE) AS lib_vie,
       COALESCE(6 = ANY(lib.dias), FALSE) AS lib_sab,
       COALESCE(7 = ANY(lib.dias), FALSE) AS lib_dom,
       coche.matricula,
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
    SELECT string_agg(DISTINCT v.matricula, ' + ' ORDER BY v.matricula) AS matricula
      FROM asignacion a
      JOIN plaza p    ON p.id = a.plaza_id
      JOIN vehiculo v ON v.id = p.vehiculo_id
     WHERE a.conductor_id = c.id
       AND a.desde <= CURRENT_DATE AND (a.hasta IS NULL OR a.hasta >= CURRENT_DATE)) coche ON TRUE
   -- La agenda son los contratados AHORA. Quien causo baja sale de aqui y vive
   -- en CONDUCTORES_OUT, igual que en la hoja.
   --
   -- Sin exigir que el alta haya llegado: quien empieza el jueves se planifica
   -- hoy, que es justo para lo que sirve un planificador.
 WHERE NOT c.es_centinela
   AND c.empleo_vigente;

COMMENT ON VIEW v_agenda IS
  'AGENDA_V2 reconstruida desde PostgreSQL. ID_BOLT nunca viene vacio: sin cuenta de BOLT se usa el nombre como clave provisional, y `bolt_pendiente` lo avisa';

COMMIT;
