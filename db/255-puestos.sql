-- ============================================================
-- 255 — LOS PUESTOS: la organización por roles, no por nombres
-- ============================================================
-- Camilo, 17/11/2026: «no lo veas tanto por nombres sino por roles: si mañana se
-- va una Karen, puede que venga otra persona y tome su rol». Hasta aquí
-- (db/248) el área, el superior y las funciones se ponían persona a persona.
-- Ahora cuelgan de un PUESTO:
--
--   · cada puesto está en un ÁREA y REPORTA A otro puesto;
--   · lleva sus FUNCIONES (quién aprueba, quién reparte, quién lleva cada cola);
--   · cada área la DIRIGE un puesto (cat_area.responsable_puesto).
--
-- A cada persona se le pone su puesto, y de él le vienen su área, su superior
-- (quien ocupe el puesto al que reporta) y sus funciones. Si alguien se va, quien
-- ocupe su puesto lo hereda todo sin tocar nada más. Lo que se pone A MANO a una
-- persona (otra área, otro superior, una función de más o de suplente) sigue
-- valiendo, como excepción encima de su puesto.
--
-- De dónde sale: los descriptivos de puesto y los ciclos de trabajo de RR. HH.,
-- Administración y Flota (11 y 12/11/2026) y lo que contestó Camilo el
-- 17/11/2026:
--   · Fernando es el CEO, sin nadie encima; Ignacio reporta a Fernando, y
--     Carlos (Barcelona) está a su altura («es como un Ignacio»).
--   · William lleva Planificación y Ángel, Control; Lorenzo es jefe de Control
--     igual que Ángel («los dos son iguales»), y Karen, Gabriel y Gabriela son
--     Control.
--   · Óscar y Camilo reportan a Ignacio. Guti hace lo de Óscar pero no usa el
--     ERP: su puesto existe, sin usuario.
--   · Laura reporta a Fernando (lo legal, el 80 %) y a Ignacio (lo laboral, el
--     20 %), y Daiane a Ignacio y a Carlos: en el ERP cada puesto reporta a uno,
--     y se pone a quien EVALÚA (Ignacio en los dos casos).
--
-- Arregla de paso a Ángel: db/248 le daba la función de supervisor buscándolo
-- como «Huarcayaculqui» y en producción es «Huarcaya», así que allí no se le
-- daba. Ahora la lleva su puesto, y aquí se le busca con los dos.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/255', true),
       set_config('telecab.usuario_id', '7', true);

-- ── El catálogo de puestos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS puesto (
  codigo        VARCHAR(30)  PRIMARY KEY CHECK (codigo ~ '^[a-z][a-z0-9_]*$'),
  nombre        VARCHAR(80)  NOT NULL CHECK (btrim(nombre) <> ''),
  area_codigo   VARCHAR(20)  NOT NULL REFERENCES cat_area(codigo),
  -- El puesto de su superior. Sin él, no reporta a nadie (el CEO).
  reporta_a     VARCHAR(30)  REFERENCES puesto(codigo),
  -- La misión, en una frase (la del descriptivo de puesto).
  mision        TEXT,
  orden         SMALLINT     NOT NULL DEFAULT 100,
  activo        BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_puesto_reporta CHECK (reporta_a IS DISTINCT FROM codigo)
);

-- Las funciones de cada puesto. Como las de una persona (usuario_funcion), se
-- quitan anulándolas con motivo: nada se borra.
CREATE TABLE IF NOT EXISTS puesto_funcion (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  puesto_codigo   VARCHAR(30)  NOT NULL REFERENCES puesto(codigo),
  funcion         VARCHAR(40)  NOT NULL CHECK (funcion ~ '^[a-z_]+$'),
  suplente        BOOLEAN      NOT NULL DEFAULT FALSE,
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  creado_por      INTEGER      REFERENCES usuario(id),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_puesto_funcion_anulada CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_puesto_funcion ON puesto_funcion (puesto_codigo, funcion) WHERE anulado_at IS NULL;

-- El puesto de cada persona, y el puesto que dirige cada área.
ALTER TABLE usuario  ADD COLUMN IF NOT EXISTS puesto_codigo      VARCHAR(30) REFERENCES puesto(codigo);
ALTER TABLE cat_area ADD COLUMN IF NOT EXISTS responsable_puesto VARCHAR(30) REFERENCES puesto(codigo);
CREATE INDEX IF NOT EXISTS ix_usuario_puesto ON usuario (puesto_codigo) WHERE puesto_codigo IS NOT NULL;

COMMENT ON TABLE puesto IS
  'Los puestos (db/255): su área, a qué puesto reportan y sus funciones. De su puesto le vienen a cada persona su área, su superior y sus funciones. Ver services/organizacion.js.';

-- Bajo el libro ANTES de sembrar (db/245).
SELECT auditoria_vigilar('puesto', 'codigo');
SELECT auditoria_vigilar('puesto_funcion');

-- ── Los puestos (primero los de arriba: cada uno reporta a uno ya puesto) ──
INSERT INTO puesto (codigo, nombre, area_codigo, reporta_a, orden, mision) VALUES
  ('ceo',                     'CEO',                                  'direccion',      NULL,                    10,
   'Dirige la empresa. Decide y paga lo legal y lo que pasa de los topes.'),
  ('direccion_operaciones',   'Dirección de operaciones',             'direccion',      'ceo',                   20,
   'Lleva la operación: aprueba y reparte el trabajo, y es la mesa de ayuda de RR. HH. y Administración.'),
  ('direccion_barcelona',     'Dirección de Barcelona',               'direccion',      'ceo',                   30,
   'Lleva la operación de Barcelona.'),
  ('rrhh_laboral',            'RR. HH. laboral y legal',              'rrhh',           'direccion_operaciones', 40,
   'Cada ausencia, permiso, baja, sanción, carta y asunto legal resuelto en plazo y registrado en el ERP.'),
  ('administracion_personal', 'Administración de personal y nómina',  'rrhh',           'direccion_operaciones', 50,
   'Cada persona de la plantilla propia dada de alta, cobrando lo que le corresponde y dada de baja bien; la nómina, el día 26.'),
  ('seleccion_ett',           'Selección y ETT',                      'rrhh',           'direccion_operaciones', 60,
   'Cubrir el cupo de conductores con gente que se quede, y llevar la ETT.'),
  ('captacion_altas',         'Captación, documentación y altas',     'rrhh',           'direccion_operaciones', 70,
   'Que cada candidato aprobado llegue al alta con el expediente completo, y quede dado de alta en Telecab y Bolt el mismo día.'),
  ('administracion',          'Administración',                       'administracion', 'direccion_operaciones', 80,
   'Efectivo, multas, combustible, reintegros, ITV y documentación de los coches, sin pérdidas ni plazos vencidos.'),
  ('jefe_planificacion',      'Jefe de planificación',                'planificacion',  'direccion_operaciones', 90,
   'El cuadrante y las horas: quién lleva cada coche y cuándo.'),
  ('jefe_control',            'Jefe de control',                      'control',        'direccion_operaciones', 100,
   'Que la flota salga y trabaje como está planificada; propone sanciones y aprueba las tarjetas.'),
  ('controlador',             'Controlador',                          'control',        'jefe_control',          110,
   'Sigue la flota en directo, llama y registra lo que pasa.'),
  ('responsable_taller',      'Responsable de taller',                'taller',         'direccion_operaciones', 120,
   'Averías, mantenimientos, siniestros y costes de cada coche.'),
  ('desarrollo',              'Desarrollo y sistemas',                'sistemas',       'direccion_operaciones', 130,
   'El ERP y sus integraciones.')
ON CONFLICT (codigo) DO NOTHING;

-- ── Qué puesto dirige cada área ────────────────────────────────────────────
UPDATE cat_area a SET responsable_puesto = x.puesto
  FROM (VALUES ('direccion', 'ceo'), ('rrhh', 'direccion_operaciones'), ('administracion', 'direccion_operaciones'),
               ('planificacion', 'jefe_planificacion'), ('control', 'jefe_control'),
               ('taller', 'responsable_taller'), ('sistemas', 'direccion_operaciones')) AS x (area, puesto)
 WHERE a.codigo = x.area AND a.responsable_puesto IS NULL;

-- ── Las funciones de cada puesto (las que db/248, db/251 y db/252 daban a
--    cada persona, ahora a su puesto) ──────────────────────────────────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente, creado_por)
SELECT x.puesto, x.funcion, x.suplente, (SELECT id FROM usuario WHERE id = 7)
  FROM (VALUES
    ('ceo', 've_todos_los_tableros', FALSE), ('ceo', 'expedientes_ver', FALSE),
    ('ceo', 'caja_receptor', TRUE), ('ceo', 'caja_testigo', FALSE),
    ('direccion_operaciones', 'supervisor', FALSE), ('direccion_operaciones', 've_todos_los_tableros', FALSE),
    ('direccion_operaciones', 'direccion', FALSE), ('direccion_operaciones', 'expedientes_ver', FALSE),
    ('direccion_operaciones', 'multas_escalado', FALSE), ('direccion_operaciones', 'caja_receptor', FALSE),
    ('direccion_operaciones', 'avisos_combustible', FALSE), ('direccion_operaciones', 'reintegros_por_encima', FALSE),
    ('direccion_operaciones', 'polizas', FALSE), ('direccion_operaciones', 'tareas_aprueba', FALSE),
    ('direccion_operaciones', 'tareas_asigna', FALSE),
    ('rrhh_laboral', 'expedientes', FALSE), ('rrhh_laboral', 'expedientes_ver', FALSE),
    ('rrhh_laboral', 'desactiva_suspension_despido', FALSE), ('rrhh_laboral', 'j_rrhh', FALSE),
    ('administracion_personal', 'nomina', FALSE), ('administracion_personal', 'cartas_consulta', FALSE),
    ('administracion_personal', 'desactiva_baja_voluntaria', FALSE),
    ('seleccion_ett', 'desactiva_fin_ett', FALSE),
    ('captacion_altas', 'cartas_consulta', FALSE),
    ('administracion', 'credenciales_combustible', FALSE), ('administracion', 'multas', FALSE),
    ('administracion', 'caja_receptor', FALSE), ('administracion', 'documentacion_vehiculos', FALSE),
    ('administracion', 'reintegros', FALSE),
    ('jefe_planificacion', 'supervisor', FALSE), ('jefe_planificacion', 'sustituciones', FALSE),
    ('jefe_planificacion', 'j_trafico', FALSE), ('jefe_planificacion', 'j_bolt', FALSE),
    ('jefe_planificacion', 'j_companero', FALSE), ('jefe_planificacion', 'menos_j', FALSE),
    ('jefe_control', 'supervisor', FALSE),
    ('responsable_taller', 'taller', FALSE), ('responsable_taller', 'j_taller', FALSE)
  ) AS x (puesto, funcion, suplente)
 WHERE NOT EXISTS (SELECT 1 FROM puesto_funcion y WHERE y.puesto_codigo = x.puesto AND y.funcion = x.funcion AND y.anulado_at IS NULL);

-- ── Quién ocupa cada puesto: por id Y por nombre, como db/248 (en otra base,
--    nadie). Solo a quien no tenga ya uno. ──────────────────────────────────
UPDATE usuario u SET puesto_codigo = x.puesto
  FROM (VALUES
    (10, 'Fernando', 'Ligues',          'ceo'),
    (1,  'Ignacio',  'Cafferata',       'direccion_operaciones'),
    (8,  'Carlos',   'Moratel',         'direccion_barcelona'),
    (4,  'Laura',    'Blanco',          'rrhh_laboral'),
    (20, 'Diana',    'C',               'administracion_personal'),
    (3,  'Victor',   '',                'seleccion_ett'),
    (17, 'Mercedes', '.',               'captacion_altas'),
    (9,  'Daiane',   'Alves',           'administracion'),
    (2,  'William',  'Reinoso',         'jefe_planificacion'),
    (31, 'Angel',    'Huarcaya',        'jefe_control'),
    (30, 'Lorenzo',  'Moratel',         'jefe_control'),
    (29, 'Karen',    'Gallego Ledezma', 'controlador'),
    (13, 'Gabriel',  'Anda',            'controlador'),
    (32, 'Gabriela', 'Amezaga',         'controlador'),
    (11, 'Oscar',    'Alvarez',         'responsable_taller'),
    (7,  'Camilo',   'Bedoya Corrales', 'desarrollo')
  ) AS x (id, nombre, apellidos, puesto)
-- Ángel: en producción es «Huarcaya» y en las copias de antes, «Huarcayaculqui»:
-- valen los dos (por eso db/248 no le daba nada en producción).
 WHERE u.id = x.id AND u.nombre = x.nombre AND u.puesto_codigo IS NULL
   AND (COALESCE(u.apellidos, '') = x.apellidos OR (x.id = 31 AND u.apellidos LIKE 'Huarcaya%'));

-- ── Lo que tenía cada persona a mano y ahora le viene de su puesto: se anula
--    con su motivo (queda en su historia; no se borra nada). ────────────────
UPDATE usuario_funcion f
   SET anulado_at = now(), anulado_por = (SELECT id FROM usuario WHERE id = 7),
       anulado_motivo = 'Pasa a su puesto (' || p.nombre || '), db/255'
  FROM usuario u
  JOIN puesto p ON p.codigo = u.puesto_codigo
 WHERE f.usuario_id = u.id AND f.anulado_at IS NULL
   AND EXISTS (SELECT 1 FROM puesto_funcion pf
                WHERE pf.puesto_codigo = u.puesto_codigo AND pf.funcion = f.funcion
                  AND pf.suplente = f.suplente AND pf.anulado_at IS NULL);

COMMIT;
