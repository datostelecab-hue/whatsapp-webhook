-- ============================================================
-- 21 - LA TANDA ES LO QUE PIDE LA AGENCIA, NO UNA FECHA
-- ============================================================
-- Hasta ahora la "tanda" se calculaba agrupando por el dia de la entrevista. Se
-- rompia en tres sitios reales:
--
--   · Dos solicitudes distintas que citaran gente el mismo dia se mezclaban en
--     una, y al responder se le devolvian a la agencia las dos juntas.
--   · Una solicitud repartida en dos jornadas parecia dos tandas — de ahi salio
--     el parche del rango "desde/hasta".
--   · Quien viniera sin cita no pertenecia a ninguna.
--
-- Y lo de fondo: el SEGUNDO envio tiene que saber exactamente quien iba en el
-- primero, y agrupando por fecha eso no se puede garantizar.
--
-- Asi que la solicitud existe. Una tabla pegada = una solicitud.

BEGIN;

-- ── El vocabulario de la agencia, en la base ────────────────────────────────
-- La traduccion de nuestros estados a los cuatro que ella maneja estaba escrita
-- en JavaScript. Es un DATO, no una regla: cambia si mañana la agencia pide otra
-- palabra, y no deberia hacer falta tocar codigo para eso.
--
-- NULL significa SIN DECIDIR, y eso impide generar el Excel: la tanda se manda
-- entera, y una fila en blanco deja a esa persona en tierra de nadie.
ALTER TABLE cat_estado_candidatura ADD COLUMN IF NOT EXISTS etiqueta_ett VARCHAR(20);

COMMENT ON COLUMN cat_estado_candidatura.etiqueta_ett IS
  'Como se le dice este estado a la ETT. NULL = sin decidir, y bloquea el envio';

UPDATE cat_estado_candidatura SET etiqueta_ett = CASE codigo
  WHEN 'no_presentado'  THEN 'No se presentó'
  WHEN 'descartado'     THEN 'No pasa'
  WHEN 'rechazado_bolt' THEN 'No pasa'
  WHEN 'rechazado_rrhh' THEN 'No pasa'
  WHEN 'no_alta'        THEN 'No pasa'
  WHEN 'no_prueba'      THEN 'No pasa'
  -- Elegido y todavia sin puesto. "Pendiente" para la agencia es pendiente de
  -- ASIGNAR, no de entrevista.
  WHEN 'entrevistado'   THEN 'Pendiente'
  WHEN 'rec_medico'     THEN 'Pendiente'
  WHEN 'listo_rrhh'     THEN 'Pendiente'
  WHEN 'aprobado_bolt'  THEN 'Pendiente'
  WHEN 'pendiente_pin'  THEN 'Pendiente'
  WHEN 'alta'           THEN 'Pendiente'
  WHEN 'asignado'       THEN 'Pendiente'
  -- preseleccion y coord_entrevista se quedan en NULL a proposito: eso no es
  -- una decision, es que nadie ha decidido todavia.
  ELSE NULL
END;

-- ── La solicitud ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS solicitud_ett (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Cuando la manda la agencia. Por omision, el dia que se pega.
  recibida_at DATE         NOT NULL DEFAULT CURRENT_DATE,
  -- Para reconocerla: el asunto del correo, "semana 32", lo que sea.
  referencia  VARCHAR(120),
  notas       TEXT,
  -- Cuando se cerro: ya no queda nadie pendiente de asignar. Se sella a mano al
  -- mandar el ultimo envio, y sirve para no volver a ofrecerla.
  cerrada_at  TIMESTAMPTZ,
  usuario_id  INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solicitud_ett_fecha ON solicitud_ett (recibida_at DESC);

COMMENT ON TABLE solicitud_ett IS
  'Una tabla pegada de la agencia. Es la unidad de respuesta: el Excel se genera por solicitud, no por fecha de entrevista';

ALTER TABLE candidatura ADD COLUMN IF NOT EXISTS solicitud_id BIGINT
  REFERENCES solicitud_ett(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cand_solicitud ON candidatura (solicitud_id);

COMMENT ON COLUMN candidatura.solicitud_id IS
  'De que tabla pegada salio. NULL en las que no vienen de la ETT';

-- ── Lo que hay que saber de cada solicitud ─────────────────────────────────
-- Los tres numeros que deciden si se puede mandar y si queda algo por hacer:
--
--   sin_decidir  — nadie ha decidido. IMPIDEN generar el Excel.
--   pendientes   — elegidos sin puesto. Obligan a un segundo envio, pero no
--                  impiden el primero.
--   contratados  — con fecha de alta, que es lo que significa "planificado".
CREATE OR REPLACE VIEW v_solicitud_ett AS
SELECT s.id, s.recibida_at, s.referencia, s.notas, s.cerrada_at, s.creado_at,
       count(k.id)::int                                              AS candidatos,
       count(*) FILTER (WHERE k.inicio_previsto IS NOT NULL)::int     AS contratados,
       count(*) FILTER (WHERE k.inicio_previsto IS NULL
                          AND e.etiqueta_ett = 'Pendiente')::int      AS pendientes,
       count(*) FILTER (WHERE k.inicio_previsto IS NULL
                          AND e.etiqueta_ett IS NULL)::int            AS sin_decidir,
       count(*) FILTER (WHERE k.inicio_previsto IS NULL
                          AND e.etiqueta_ett IN ('No pasa', 'No se presentó'))::int AS descartados,
       min(k.entrevista_at)                                          AS primera_cita,
       max(k.entrevista_at)                                          AS ultima_cita
  FROM solicitud_ett s
  LEFT JOIN candidatura k             ON k.solicitud_id = s.id
  LEFT JOIN cat_estado_candidatura e  ON e.codigo = k.estado
 GROUP BY s.id, s.recibida_at, s.referencia, s.notas, s.cerrada_at, s.creado_at;

COMMENT ON VIEW v_solicitud_ett IS
  'Cada tabla pegada con sus numeros: cuantos sin decidir (bloquean el envio), cuantos pendientes de asignar y cuantos contratados';

-- ── La candidatura, con su solicitud y su palabra para la agencia ──────────
-- Se rehace entera: las columnas nuevas van en medio.
DROP VIEW IF EXISTS v_candidatura;

CREATE VIEW v_candidatura AS
SELECT k.id,
       k.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.nombre, c.apellidos, c.dni_nie, c.dni_tipo, c.email,
       c.fecha_nacimiento, c.sexo, c.estado_civil, c.nacionalidad,
       c.naf, c.centro_codigo,
       c.via_tipo, c.via_nombre, c.via_numero, c.escalera, c.piso, c.puerta,
       c.direccion, c.codigo_postal, c.localidad, c.provincia,
       c.tel_emergencia, c.observaciones,
       CASE WHEN c.lat IS NULL OR c.lng IS NULL THEN NULL
            ELSE c.lat::text || ', ' || c.lng::text END      AS coordenadas,
       (c.iban_cifrado IS NOT NULL)                          AS tiene_iban,
       tel.e164                                             AS telefono,
       k.estado,
       e.etiqueta                                           AS estado_etiqueta,
       -- Como se le dice a la agencia. NULL = sin decidir.
       e.etiqueta_ett,
       e.etapa,
       ep.etiqueta                                          AS etapa_etiqueta,
       e.en_funnel, e.es_salida, e.orden                    AS estado_orden,
       k.canal,
       ca.etiqueta                                          AS canal_etiqueta,
       k.experiencia, k.carne_vtc, k.prueba_conduccion, k.apto_medico,
       k.vacante_ref, k.turno_id, t.etiqueta                AS turno,
       k.base_zona_id, bz.nombre                            AS zona,
       k.inicio_previsto, k.jornada_horas, k.tipo_contrato,
       k.entrevista_at, k.jornada_ett, k.turno_ett,
       -- De que tabla pegada salio.
       k.solicitud_id, sol.referencia                       AS solicitud_referencia,
       sol.recibida_at                                      AS solicitud_recibida,
       k.responsable, k.notas, k.motivo, k.num_hijos, k.tipo_carnet,
       k.creado_at, k.apto_at, k.alta_at, k.habilitado_at, k.asignado_at,
       k.cerrado_at, k.deteccion_at,
       k.excel_alta, k.pin_ballenoil, k.obs_ballenoil,
       c.empleo_vigente
  FROM candidatura k
  JOIN conductor c              ON c.id = k.conductor_id
  JOIN cat_estado_candidatura e ON e.codigo = k.estado
  JOIN cat_etapa_candidatura ep ON ep.codigo = e.etapa
  LEFT JOIN cat_canal_candidatura ca ON ca.codigo = k.canal
  LEFT JOIN turno t             ON t.id = k.turno_id
  LEFT JOIN base_zona bz        ON bz.id = k.base_zona_id
  LEFT JOIN solicitud_ett sol   ON sol.id = k.solicitud_id
  LEFT JOIN LATERAL (
    SELECT e164 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE;

COMMENT ON VIEW v_candidatura IS
  'El embudo con la persona ya resuelta, su solicitud de origen y la palabra que le corresponde de cara a la agencia';

COMMIT;
