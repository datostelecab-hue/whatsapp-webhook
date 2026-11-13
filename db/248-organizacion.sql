-- ============================================================
-- 248 — LA ORGANIZACIÓN: áreas, superiores y quién hace qué
-- ============================================================
-- Pieza A5 de docs/Hoja de ruta.md (13/11/2026). La hoja de ruta de Ignacio
-- nombra a personas para cada cosa —«la aprueba un supervisor (Ángel, William o
-- Ignacio)», «una tarea para Daiane», «avisa al responsable y a su superior»,
-- «cada responsable de área ve el suyo»— y el ERP no sabía nada de eso: un
-- usuario tenía un rol y unas llaves, ni área ni jefe.
--
--   · ÁREAS (cat_area), con su RESPONSABLE: el que ve el tablero de su área.
--   · Cada usuario, su ÁREA y, si no es el responsable de su área, quién es su
--     SUPERIOR (si no se pone, es el responsable del área).
--   · FUNCIONES (usuario_funcion): quién aprueba tarjetas, quién lleva las
--     multas, quién recibe efectivo… El catálogo de funciones vive en el código
--     (services/organizacion.js); aquí, quién tiene cada una, desde cuándo, quién
--     se la dio, y si es SUPLENTE (Fernando en la caja). Quitar una función es
--     ANULARLA con motivo: nada se borra (convención 5).
--   · Las tres, y `usuario` (rol, estado, área, superior…), BAJO EL LIBRO DE
--     AUDITORÍA (db/245): hasta hoy cambiar el rol de alguien no dejaba rastro.
--     De `usuario` no se apuntan las contraseñas, los tokens ni el último acceso.
--
-- Una LLAVE (usuario_permiso) dice qué pantallas abre alguien; una FUNCIÓN dice
-- qué le toca hacer: a quién le llega una tarea o quién aprueba. Son cosas
-- distintas y se quedan separadas.
--
-- LAS FUNCIONES DE LA HOJA DE RUTA se dan aquí a las personas que nombra, por
-- id Y por nombre (como db/168): si un id no es quien tiene que ser, no se le da
-- nada. Angie (Formentera) no tiene usuario: lo suyo queda pendiente. Las áreas y
-- los superiores NO se ponen aquí: los decide Ignacio desde /organizacion.

BEGIN;

-- La firma de esta migración en el libro: desde dónde y quién (Camilo, 7).
SELECT set_config('telecab.origen', 'migración db/248', true),
       set_config('telecab.usuario_id', '7', true);

-- ── Las áreas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_area (
  codigo          VARCHAR(20)  PRIMARY KEY CHECK (codigo ~ '^[a-z_]+$'),
  etiqueta        VARCHAR(60)  NOT NULL,
  responsable_id  INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  orden           SMALLINT     NOT NULL DEFAULT 0,
  activa          BOOLEAN      NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE cat_area IS
  'Las áreas de la oficina y su responsable (db/248): el responsable ve el tablero de su área y es el superior de quien no tenga otro.';

INSERT INTO cat_area (codigo, etiqueta, orden) VALUES
  ('direccion',      'Dirección',      1),
  ('rrhh',           'RR. HH.',        2),
  ('administracion', 'Administración', 3),
  ('planificacion',  'Planificación',  4),
  ('control',        'Control',        5),
  ('taller',         'Taller',         6),
  ('sistemas',       'Sistemas',       7)
ON CONFLICT (codigo) DO NOTHING;

-- ── El área y el superior de cada usuario ───────────────────────────────────
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS area_codigo VARCHAR(20) REFERENCES cat_area(codigo);
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS superior_id INTEGER     REFERENCES usuario(id) ON DELETE SET NULL;
DO $$ BEGIN
  ALTER TABLE usuario ADD CONSTRAINT ck_usuario_superior CHECK (superior_id IS NULL OR superior_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN usuario.superior_id IS
  'Su superior, si no es el responsable de su área (db/248). Vacío: el responsable de su área. Lo usa services/organizacion.superiorDe.';

-- ── Quién hace qué ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuario_funcion (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id      INTEGER      NOT NULL REFERENCES usuario(id),
  -- El código del catálogo de services/organizacion.js: 'supervisor', 'multas'…
  funcion         VARCHAR(40)  NOT NULL CHECK (funcion ~ '^[a-z_]+$'),
  suplente        BOOLEAN      NOT NULL DEFAULT FALSE,
  nota            TEXT,
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  creado_por      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo  TEXT,
  CONSTRAINT ck_uf_anulada CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);

-- Una persona tiene cada función una vez (la vigente); las anuladas se quedan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_funcion_vigente
  ON usuario_funcion (usuario_id, funcion) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_usuario_funcion ON usuario_funcion (funcion) WHERE anulado_at IS NULL;

COMMENT ON TABLE usuario_funcion IS
  'Quién hace qué (db/248): la función de services/organizacion.js, desde cuándo, quién la dio y si es suplente. Quitarla es anularla con motivo.';

-- ── Bajo el libro de auditoría ──────────────────────────────────────────────
SELECT auditoria_vigilar('cat_area', 'codigo');
SELECT auditoria_vigilar('usuario_funcion');
-- Del usuario no se apunta la contraseña ni sus tokens (secretos), ni lo que
-- cambia solo o a gusto de cada uno: el último acceso, el tema y las ayudas.
SELECT auditoria_vigilar('usuario', 'id',
       ARRAY['pass_hash', 'pass_correo_cifrada', 'token_reset', 'token_expira', 'ultimo_acceso', 'tema', 'ayudas']);

-- ── Las funciones que nombra la hoja de ruta ────────────────────────────────
INSERT INTO usuario_funcion (usuario_id, funcion, suplente, nota, creado_por)
SELECT u.id, f.funcion, f.suplente, 'Hoja de ruta de Ignacio (10/11/2026)', 7
  FROM (VALUES
    (1,  'Ignacio',  'Cafferata',      'supervisor',                   FALSE),
    (2,  'William',  'Reinoso',        'supervisor',                   FALSE),
    (31, 'Angel',    'Huarcayaculqui', 'supervisor',                   FALSE),
    (1,  'Ignacio',  'Cafferata',      've_todos_los_tableros',        FALSE),
    (10, 'Fernando', 'Ligues',         've_todos_los_tableros',        FALSE),
    (1,  'Ignacio',  'Cafferata',      'direccion',                    FALSE),
    (4,  'Laura',    'Blanco',         'expedientes',                  FALSE),
    (4,  'Laura',    'Blanco',         'expedientes_ver',              FALSE),
    (1,  'Ignacio',  'Cafferata',      'expedientes_ver',              FALSE),
    (10, 'Fernando', 'Ligues',         'expedientes_ver',              FALSE),
    (20, 'Diana',    'C',              'nomina',                       FALSE),
    (20, 'Diana',    'C',              'cartas_consulta',              FALSE),
    (17, 'Mercedes', '.',              'cartas_consulta',              FALSE),
    (20, 'Diana',    'C',              'desactiva_baja_voluntaria',    FALSE),
    (4,  'Laura',    'Blanco',         'desactiva_suspension_despido', FALSE),
    (3,  'Victor',   '',               'desactiva_fin_ett',            FALSE),
    (9,  'Daiane',   'Alves',          'credenciales_combustible',     FALSE),
    (9,  'Daiane',   'Alves',          'multas',                       FALSE),
    (1,  'Ignacio',  'Cafferata',      'multas_escalado',              FALSE),
    (9,  'Daiane',   'Alves',          'caja_receptor',                FALSE),
    (1,  'Ignacio',  'Cafferata',      'caja_receptor',                FALSE),
    (10, 'Fernando', 'Ligues',         'caja_receptor',                TRUE),
    (10, 'Fernando', 'Ligues',         'caja_testigo',                 FALSE),
    (1,  'Ignacio',  'Cafferata',      'avisos_combustible',           FALSE),
    (9,  'Daiane',   'Alves',          'documentacion_vehiculos',      FALSE),
    (9,  'Daiane',   'Alves',          'reintegros',                   FALSE),
    (1,  'Ignacio',  'Cafferata',      'reintegros_por_encima',        FALSE),
    (11, 'Oscar',    'Alvarez',        'taller',                       FALSE),
    (2,  'William',  'Reinoso',        'sustituciones',                FALSE),
    (1,  'Ignacio',  'Cafferata',      'polizas',                      FALSE)
  ) AS f (id, nombre, apellidos, funcion, suplente)
  JOIN usuario u ON u.id = f.id AND u.nombre = f.nombre AND COALESCE(u.apellidos, '') = f.apellidos
 WHERE NOT EXISTS (SELECT 1 FROM usuario_funcion x
                    WHERE x.usuario_id = u.id AND x.funcion = f.funcion AND x.anulado_at IS NULL);

COMMIT;
