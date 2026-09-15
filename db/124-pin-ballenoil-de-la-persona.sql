-- ============================================================
-- 124 - EL PIN DE BALLENOIL ES DE LA PERSONA, NO DEL PAPELEO
-- ============================================================
-- El PIN de la tarjeta de combustible vivía en `candidatura`, porque ahí lo
-- puso la hoja de la que vino: era una columna más del ticket de selección.
--
-- Pero no es un dato del proceso de selección, es un dato de la persona:
--
--   · Administración se lo asigna a CUALQUIER conductor, tenga candidatura o
--     no. La pantalla lo dice desde siempre —«PIN a cualquier conductor»— y con
--     el PIN colgando de la candidatura eso no se podía guardar en ninguna
--     parte: quien entró antes de que existiera el embudo no tiene ficha de
--     candidatura donde escribirlo.
--
--   · El PIN CAMBIA con el tiempo y se reenvía. Nada de eso tiene que ver con
--     cómo entró esa persona hace ocho meses.
--
--   · Y quien pasa dos veces por selección tendría dos PINes distintos para la
--     misma tarjeta.
--
-- Se mueve a `conductor`. La vista `v_candidatura` sigue enseñando las mismas
-- dos columnas con los mismos nombres —ahora por JOIN— para que nada de lo que
-- la lee tenga que cambiar.
--
-- No se copia nada porque no hay nada: las 36 candidaturas tienen el PIN vacío.
-- Ese camino nunca se llegó a usar (ver el commit del tramo final).

BEGIN;

ALTER TABLE conductor
  ADD COLUMN IF NOT EXISTS pin_ballenoil VARCHAR(40),
  ADD COLUMN IF NOT EXISTS obs_ballenoil TEXT;

-- Por si en producción sí hubiera alguno: se lleva lo que haya antes de soltar
-- la columna. Aquí no mueve nada; en el servidor, si lo hay, lo salva.
UPDATE conductor c
   SET pin_ballenoil = x.pin, obs_ballenoil = COALESCE(c.obs_ballenoil, x.obs)
  FROM (SELECT DISTINCT ON (conductor_id) conductor_id,
               pin_ballenoil AS pin, obs_ballenoil AS obs
          FROM candidatura
         WHERE btrim(COALESCE(pin_ballenoil, '')) <> ''
         ORDER BY conductor_id, actualizado_at DESC) x
 WHERE x.conductor_id = c.id AND c.pin_ballenoil IS NULL;

-- La vista, con las dos columnas en el mismo sitio de siempre pero leídas de la
-- persona. Se recrea entera porque cambiar el origen de una columna no lo hace
-- CREATE OR REPLACE; no depende nada de ella (comprobado).
DROP VIEW IF EXISTS v_candidatura;

ALTER TABLE candidatura
  DROP COLUMN IF EXISTS pin_ballenoil,
  DROP COLUMN IF EXISTS obs_ballenoil;

CREATE VIEW v_candidatura AS
SELECT k.id, k.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre)   AS quien,
       c.nombre, c.apellidos, c.dni_nie, c.dni_tipo, c.email, c.fecha_nacimiento,
       c.sexo, c.estado_civil, c.nacionalidad, c.naf, c.centro_codigo,
       c.via_tipo, c.via_nombre, c.via_numero, c.escalera, c.piso, c.puerta,
       c.direccion, c.codigo_postal, c.localidad, c.provincia,
       c.tel_emergencia, c.observaciones,
       CASE WHEN c.lat IS NOT NULL AND c.lng IS NOT NULL
            THEN c.lat::text || ',' || c.lng::text END        AS coordenadas,
       (c.iban_cifrado IS NOT NULL)                           AS tiene_iban,
       tel.e164                                               AS telefono,
       k.estado, e.etiqueta AS estado_etiqueta, e.etiqueta_ett,
       e.etapa, ep.etiqueta AS etapa_etiqueta,
       e.en_funnel, e.es_salida, e.orden AS estado_orden,
       k.canal, ca.etiqueta AS canal_etiqueta,
       k.experiencia, k.carne_vtc, k.prueba_conduccion, k.apto_medico,
       k.vacante_ref, k.turno_id, t.etiqueta AS turno,
       k.base_zona_id, bz.nombre AS zona,
       k.inicio_previsto, k.jornada_horas, k.tipo_contrato, k.entrevista_at,
       k.jornada_ett, k.turno_ett,
       k.solicitud_id, sol.referencia AS solicitud_referencia,
       sol.recibida_at AS solicitud_recibida,
       k.responsable, k.notas, k.motivo, k.num_hijos, k.tipo_carnet,
       k.creado_at, k.apto_at, k.alta_at, k.habilitado_at, k.asignado_at,
       k.cerrado_at, k.deteccion_at, k.excel_alta,
       -- DE LA PERSONA. Mismo nombre de columna que antes: quien lea la vista no
       -- tiene que enterarse de que se ha movido.
       c.pin_ballenoil, c.obs_ballenoil,
       c.empleo_vigente
  FROM candidatura k
  JOIN conductor c ON c.id = k.conductor_id
  JOIN cat_estado_candidatura e ON e.codigo = k.estado
  JOIN cat_etapa_candidatura ep ON ep.codigo = e.etapa
  LEFT JOIN cat_canal_candidatura ca ON ca.codigo = k.canal
  LEFT JOIN turno t ON t.id = k.turno_id
  LEFT JOIN base_zona bz ON bz.id = k.base_zona_id
  LEFT JOIN solicitud_ett sol ON sol.id = k.solicitud_id
  LEFT JOIN LATERAL (
    SELECT conductor_telefono.e164
      FROM conductor_telefono
     WHERE conductor_telefono.conductor_id = c.id
       AND conductor_telefono.vigente_hasta IS NULL
     ORDER BY conductor_telefono.principal DESC, conductor_telefono.id
     LIMIT 1) tel ON TRUE;

COMMENT ON VIEW v_candidatura IS
  'La candidatura con los datos de la persona ya pegados. El PIN de Ballenoil sale de conductor desde db/124';
COMMENT ON COLUMN conductor.pin_ballenoil IS
  'PIN de la tarjeta de combustible. De la PERSONA: se le asigna tenga candidatura o no, y cambia con el tiempo';

COMMIT;
