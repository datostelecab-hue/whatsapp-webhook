-- ============================================================
-- 17 - EL EMBUDO DE SELECCION
-- ============================================================
-- La hoja TICKETS tiene 60 columnas. Mas de la mitad son nombre, apellidos, DNI,
-- direccion, codigo postal, NAF, IBAN, telefono y documentos: cosas de la
-- PERSONA, que ya tienen su tabla desde la primera migracion.
--
-- Aqui no se copian. Un candidato crea su fila en `conductor` desde el primer
-- momento, sin periodo de empleo — que es exactamente lo que significa "todavia
-- no trabaja aqui". Sus documentos van a `documento`, su telefono a
-- `conductor_telefono`, y cuando se le contrata solo hay que abrirle un
-- `conductor_periodo_empleo`. Nada se copia de un sitio a otro.
--
-- Lo que queda en esta tabla es SOLO el proceso: por donde va, quien lo lleva,
-- que se ha comprobado y cuando paso cada hito.
--
-- Efecto secundario que vale por si solo: si alguien que ya trabajo aqui vuelve
-- a apuntarse, el choque de DNI (uq_cond_dni) salta en PRESELECCION y no al
-- final, cuando ya se ha entrevistado a un duplicado.

BEGIN;

-- ── Las etapas: por que departamento va ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_etapa_candidatura (
  codigo   VARCHAR(16)  PRIMARY KEY,
  etiqueta VARCHAR(40)  NOT NULL,
  orden    SMALLINT     NOT NULL DEFAULT 0
);

INSERT INTO cat_etapa_candidatura (codigo, etiqueta, orden) VALUES
  ('seleccion',      'Selección',      1),
  ('bolt',           'BOLT',           2),
  ('rrhh',           'RRHH',           3),
  ('administracion', 'Administración', 4),
  ('trafico',        'Tráfico',        5)
ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta, orden = EXCLUDED.orden;

-- ── Los estados ─────────────────────────────────────────────────────────────
-- Cada estado pertenece a UNA etapa, asi que la etapa no se guarda en la
-- candidatura: se lee de aqui. Guardar las dos permitiria que se contradijeran,
-- y en la hoja se contradecian.
--
-- `en_funnel` marca los que forman el recorrido de Seleccion, en `orden`. Los
-- demas son salidas o estados de otros departamentos.
--
-- `obsoleto` es para los que ya no se usan pero siguen puestos en fichas
-- antiguas: sin ellos esas fichas no se podrian ni leer.
CREATE TABLE IF NOT EXISTS cat_estado_candidatura (
  codigo    VARCHAR(24)  PRIMARY KEY,
  etiqueta  VARCHAR(48)  NOT NULL,
  etapa     VARCHAR(16)  NOT NULL REFERENCES cat_etapa_candidatura(codigo),
  orden     SMALLINT     NOT NULL DEFAULT 0,
  en_funnel BOOLEAN      NOT NULL DEFAULT FALSE,
  es_salida BOOLEAN      NOT NULL DEFAULT FALSE,
  obsoleto  BOOLEAN      NOT NULL DEFAULT FALSE
);

INSERT INTO cat_estado_candidatura (codigo, etiqueta, etapa, orden, en_funnel, es_salida, obsoleto) VALUES
  ('preseleccion',     'Preselección',                    'seleccion',      1, TRUE,  FALSE, FALSE),
  ('coord_entrevista', 'Coordinación de entrevista',      'seleccion',      2, TRUE,  FALSE, FALSE),
  ('entrevistado',     'Entrevistado',                    'seleccion',      3, TRUE,  FALSE, FALSE),
  ('rec_medico',       'Reconocimiento médico',           'seleccion',      4, TRUE,  FALSE, FALSE),
  -- Retirado en agosto de 2026: del reconocimiento medico se pasa directo a RRHH.
  ('relevamiento',     'Relevamiento de datos',           'seleccion',      5, FALSE, FALSE, TRUE),
  ('descartado',       'Descartado',                      'seleccion',     90, FALSE, TRUE,  FALSE),
  ('rechazado_rrhh',   'Rechazado RRHH',                  'seleccion',     91, FALSE, FALSE, FALSE),
  -- Ya no se espera la aprobacion de BOLT; se conserva para leer fichas viejas.
  ('pendiente_bolt',   'Pendiente en BOLT',               'bolt',          10, FALSE, FALSE, TRUE),
  ('aprobado_bolt',    'Aprobado en BOLT',                'rrhh',          11, FALSE, FALSE, FALSE),
  ('rechazado_bolt',   'Rechazado en BOLT',               'seleccion',     92, FALSE, FALSE, FALSE),
  ('listo_rrhh',       'Listo para RRHH',                 'rrhh',          12, FALSE, FALSE, FALSE),
  ('no_alta',          'Alta no realizada',               'rrhh',          93, FALSE, TRUE,  FALSE),
  ('pendiente_pin',    'Pendiente de alta en Ballenoil',  'administracion',13, FALSE, FALSE, FALSE),
  ('alta',             'Alta procesada - habilitado',     'trafico',       14, FALSE, FALSE, FALSE),
  ('asignado',         'Asignado',                        'trafico',       15, FALSE, FALSE, FALSE),
  ('no_prueba',        'No supera periodo de prueba',     'trafico',       94, FALSE, TRUE,  FALSE),
  ('baja',             'Baja empresa',                    'trafico',       95, FALSE, TRUE,  FALSE),
  ('ausente',          'Ausente notificado',              'trafico',       96, FALSE, TRUE,  FALSE),
  ('despido',          'Despido procedente',              'trafico',       97, FALSE, TRUE,  FALSE)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, etapa = EXCLUDED.etapa, orden = EXCLUDED.orden,
  en_funnel = EXCLUDED.en_funnel, es_salida = EXCLUDED.es_salida, obsoleto = EXCLUDED.obsoleto;

-- ── De donde llega la gente ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_canal_candidatura (
  codigo   VARCHAR(24)  PRIMARY KEY,
  etiqueta VARCHAR(48)  NOT NULL,
  activo   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO cat_canal_candidatura (codigo, etiqueta) VALUES
  ('infojobs',      'InfoJobs'),            ('linkedin',    'LinkedIn'),
  ('indeed',        'Indeed'),              ('milanuncios', 'Milanuncios'),
  ('referido',      'Referido'),            ('jobtoday_hh', 'JobToday (HH)'),
  ('infojobs_hh',   'InfoJobs (HH)'),       ('publicacion', 'Publicación'),
  ('wallapop',      'Wallapop'),            ('bolsa_ett',   'Bolsa de Empleo (ETT)'),
  ('jobtoday',      'JobToday'),            ('nextdoor',    'Nextdoor'),
  ('redes',         'Redes Sociales'),      ('otro',        'Otro')
ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta;

-- ── La candidatura ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidatura (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  estado        VARCHAR(24) NOT NULL REFERENCES cat_estado_candidatura(codigo),
  canal         VARCHAR(24) REFERENCES cat_canal_candidatura(codigo) ON DELETE SET NULL,

  -- Lo que se comprueba durante el proceso. NULL = todavia no se ha mirado, que
  -- no es lo mismo que "no": por eso son nulables y no llevan DEFAULT FALSE.
  experiencia       BOOLEAN,
  carne_vtc         BOOLEAN,
  prueba_conduccion BOOLEAN,
  apto_medico       BOOLEAN,

  -- El puesto que se cubre. `vacante_ref` apunta a la hoja de vacantes mientras
  -- ese modulo siga ahi; cuando se migre pasara a ser una clave foranea.
  vacante_ref   VARCHAR(40),
  turno_id      SMALLINT    REFERENCES turno(id) ON DELETE SET NULL,
  base_zona_id  SMALLINT    REFERENCES base_zona(id) ON DELETE SET NULL,

  responsable   VARCHAR(80),
  notas         TEXT,
  motivo        VARCHAR(255),   -- del descarte, del rechazo o de la baja
  num_hijos     SMALLINT,
  tipo_carnet   VARCHAR(10),

  -- Los hitos. Son fechas propias y no un historial de estados, porque algunas
  -- se BORRAN: devolver una ficha a Seleccion limpia `apto_at`, y un historial
  -- no sabe expresar eso. Quien hizo cada cambio lo guarda `cambio_campo`.
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  apto_at       TIMESTAMPTZ,   -- Seleccion lo declara apto y pasa a RRHH
  alta_at       TIMESTAMPTZ,   -- RRHH proceso el alta en la Seguridad Social
  habilitado_at TIMESTAMPTZ,   -- desde cuando puede trabajar
  asignado_at   TIMESTAMPTZ,   -- Trafico le dio coche y turno
  cerrado_at    TIMESTAMPTZ,   -- descarte, baja o rechazo
  deteccion_at  TIMESTAMPTZ,   -- cuando el padron lo encontro ya en BOLT

  -- Cosas de Administracion que viajaban en el ticket.
  excel_alta    VARCHAR(40),
  pin_ballenoil VARCHAR(20),
  obs_ballenoil VARCHAR(255),

  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una sola candidatura VIVA por persona: dos procesos abiertos a la vez para el
-- mismo conductor es siempre un error de captura, no dos candidaturas.
-- Las cerradas no estorban: quien se presento, no paso y vuelve un año despues,
-- tiene dos, y eso es historia legitima.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cand_viva ON candidatura (conductor_id)
  WHERE cerrado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cand_estado ON candidatura (estado);
CREATE INDEX IF NOT EXISTS idx_cand_conductor ON candidatura (conductor_id);

COMMENT ON TABLE candidatura IS
  'El proceso de seleccion, SOLO el proceso. Los datos de la persona viven en conductor, sus documentos en documento y su telefono en conductor_telefono';
COMMENT ON COLUMN candidatura.vacante_ref IS
  'Id de la vacante en la hoja. Pasara a foranea cuando se migre el modulo de vacantes';

-- ── Lo que lee la pantalla ──────────────────────────────────────────────────
-- La candidatura con la persona ya resuelta, para no cruzar nada en JavaScript.
CREATE OR REPLACE VIEW v_candidatura AS
SELECT k.id,
       k.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.nombre, c.apellidos, c.dni_nie, c.email,
       tel.e164                                             AS telefono,
       k.estado,
       e.etiqueta                                           AS estado_etiqueta,
       e.etapa,
       ep.etiqueta                                          AS etapa_etiqueta,
       e.en_funnel, e.es_salida, e.orden                    AS estado_orden,
       k.canal,
       ca.etiqueta                                          AS canal_etiqueta,
       k.experiencia, k.carne_vtc, k.prueba_conduccion, k.apto_medico,
       k.vacante_ref, k.turno_id, t.etiqueta                AS turno,
       k.base_zona_id, bz.nombre                            AS zona,
       k.responsable, k.notas, k.motivo, k.num_hijos, k.tipo_carnet,
       k.creado_at, k.apto_at, k.alta_at, k.habilitado_at, k.asignado_at,
       k.cerrado_at, k.deteccion_at,
       k.excel_alta, k.pin_ballenoil, k.obs_ballenoil,
       -- Si esta persona ya tiene contrato abierto. Una candidatura viva de
       -- alguien que ya trabaja aqui es algo que hay que mirar.
       c.empleo_vigente
  FROM candidatura k
  JOIN conductor c              ON c.id = k.conductor_id
  JOIN cat_estado_candidatura e ON e.codigo = k.estado
  JOIN cat_etapa_candidatura ep ON ep.codigo = e.etapa
  LEFT JOIN cat_canal_candidatura ca ON ca.codigo = k.canal
  LEFT JOIN turno t             ON t.id = k.turno_id
  LEFT JOIN base_zona bz        ON bz.id = k.base_zona_id
  LEFT JOIN LATERAL (
    SELECT e164 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE;

COMMENT ON VIEW v_candidatura IS
  'El embudo con la persona ya resuelta: sustituye a cruzar la hoja TICKETS en JavaScript';

-- ── Documentos que faltan: a una PERSONA, no solo a un empleado ─────────────
-- `v_documento_falta` llevaba `WHERE c.empleo_vigente`, que estaba bien mientras
-- en la base solo hubiera empleados. Ahora hay candidatos, que por definicion no
-- tienen contrato: la vista los daba por completos y habrian pasado a RRHH sin
-- DNI y sin reconocimiento medico, sin que nadie lo viera.
--
-- La regla de "que documentos son obligatorios" se escribe UNA vez, aqui. La de
-- siempre pasa a leer de esta y quedarse con los contratados.
CREATE OR REPLACE VIEW v_documento_falta_persona AS
SELECT c.id       AS conductor_id,
       t.codigo   AS tipo,
       t.etiqueta AS etiqueta
  FROM conductor c
  CROSS JOIN cat_tipo_documento t
 WHERE NOT c.es_centinela
   AND t.ambito = 'conductor'
   AND t.activo
   AND t.obligatorio
   AND NOT EXISTS (
     SELECT 1 FROM documento d
      WHERE d.conductor_id = c.id AND d.tipo = t.codigo AND d.vigente);

COMMENT ON VIEW v_documento_falta_persona IS
  'Documentos obligatorios que le faltan a cualquier persona de la base, trabaje aqui o no. Es la definicion buena; v_documento_falta es esta misma limitada a quien esta contratado';

DROP VIEW IF EXISTS v_documento_falta;

CREATE VIEW v_documento_falta AS
SELECT f.conductor_id, f.tipo, f.etiqueta
  FROM v_documento_falta_persona f
  JOIN conductor c ON c.id = f.conductor_id
 WHERE c.empleo_vigente;

COMMENT ON VIEW v_documento_falta IS
  'Lo que le falta a quien SI esta contratado. Alimenta los avisos de RRHH';

-- ── Los documentos que pide Seleccion y no estaban en el catalogo ───────────
-- El embudo recoge siete: las dos caras del DNI, las dos del carne, el
-- certificado bancario, la vida laboral y el de delitos sexuales. En el
-- catalogo faltaban cuatro.
--
-- Las caras van como TIPOS DISTINTOS y no como una columna "cara" del documento.
-- Parece mas feo, pero es lo que hace que la comprobacion funcione: con un solo
-- tipo "dni", subir solo el frente ya lo daria por entregado, y el reverso es
-- justo el que se olvida.
--
-- El certificado de delitos sexuales caduca (tres meses de validez habitual);
-- las caras de un documento caducan cuando caduca el documento, asi que heredan
-- el aviso de su tipo principal.
-- ANTES o DESPUES de contratar.
--
-- "Obligatorio" no bastaba. El contrato firmado y el alta en la Seguridad Social
-- son obligatorios, pero NO pueden existir antes de contratar a nadie: no hay
-- contrato que firmar hasta que se le contrata. Sin esta distincion, exigir la
-- documentacion completa para pasar a RRHH bloquearia el 100% de las altas
-- pidiendo un papel que solo existe despues.
ALTER TABLE cat_tipo_documento ADD COLUMN IF NOT EXISTS previo_alta BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN cat_tipo_documento.previo_alta IS
  'Si se exige ANTES de contratar. El contrato y el alta en la SS son obligatorios pero posteriores: no existen hasta que hay contratacion';

-- Se reescribe el orden de TODOS los de conductor, no solo el de los nuevos: si
-- los reversos van sueltos al final, aparecen lejos de su documento y quien
-- sube papeles tiene que ir a buscarlos. Cada reverso, detras de su frente.
INSERT INTO cat_tipo_documento
  (codigo, etiqueta, ambito, caduca, obligatorio, aviso_dias, orden, previo_alta) VALUES
  ('dni',             'DNI o NIE',                      'conductor', TRUE,  TRUE, 60,  1, TRUE),
  -- El reverso NO caduca por su cuenta: es la otra cara del mismo documento,
  -- y su caducidad es la del frente. Marcarlo como caducable obligaria a
  -- escribir dos veces la misma fecha, y la restriccion exige aviso 0.
  ('dni_reverso',     'DNI o NIE (reverso)',            'conductor', FALSE, TRUE,  0,  2, TRUE),
  ('permiso',         'Permiso de conducir',            'conductor', TRUE,  TRUE, 60,  3, TRUE),
  ('permiso_reverso', 'Permiso de conducir (reverso)',  'conductor', FALSE, TRUE,  0,  4, TRUE),
  ('vtc',             'Tarjeta VTC',                    'conductor', TRUE,  TRUE, 60,  5, TRUE),
  ('vida_laboral',    'Vida laboral o certificado SS',  'conductor', FALSE, TRUE,  0,  6, TRUE),
  ('penales',         'Certificado de delitos sexuales','conductor', TRUE,  TRUE, 30,  7, TRUE),
  -- El certificado bancario ya era obligatorio para Seleccion; ahora la base
  -- dice lo mismo que el proceso.
  ('cuenta',          'Certificado de cuenta',          'conductor', FALSE, TRUE,  0,  8, TRUE),
  ('reconocimiento',  'Reconocimiento médico',          'conductor', TRUE,  FALSE, 30, 9, TRUE),
  ('formacion',       'Certificado de formación',       'conductor', TRUE,  FALSE, 30, 10, TRUE),
  -- Estos dos NO pueden existir antes de contratar.
  ('contrato',        'Contrato firmado',               'conductor', FALSE, TRUE,  0, 11, FALSE),
  ('alta_ss',         'Alta en la Seguridad Social',    'conductor', FALSE, TRUE,  0, 12, FALSE)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, caduca = EXCLUDED.caduca,
  obligatorio = EXCLUDED.obligatorio, aviso_dias = EXCLUDED.aviso_dias,
  orden = EXCLUDED.orden, previo_alta = EXCLUDED.previo_alta;

COMMIT;
