-- ============================================================
-- 256 — EL CHAT INTERNO, entrega 2a: canales, directos, hilos y menciones
-- ============================================================
-- Ítem 2 de la hoja de ruta: «reemplazar Slack por un chat dentro del ERP, con
-- sus mismas funciones, para que la comunicación y las tareas vivan en el mismo
-- sistema». Solo para la oficina. Va en cuatro entregas; esta (2a) trae los
-- canales públicos y privados, los mensajes directos (de 1 a 1 y de grupo), el
-- tiempo real, los no leídos, las menciones y los hilos.
--
-- Lo que decidió Camilo el 17/11/2026:
--   · Los 16 canales públicos de Slack, ABIERTOS A TODA LA OFICINA, también
--     #4-bajas-medicas, #6-nominas, #9-rrhh y #16-efectivo (como pidió Ignacio).
--   · TODA LA OFICINA DENTRO de todos los públicos desde el primer día (los ve
--     en su lista y le cuentan los no leídos). Quien llegue después, entra solo.
--   · Crean, archivan y renombran canales los puestos de Dirección y Desarrollo:
--     la función de Organización «chat_canales».
--   · Los privados de Slack, con quien los pidió: #datos (Camilo),
--     #martes-10am (Ignacio) y #escalaciones-lorenzo (Lorenzo). Su gente se
--     añade desde el chat.
--
-- Nada se borra (convención 5): salir de un canal o archivarlo es una marca con
-- fecha; editar y anular un mensaje (entrega 2b) quedan en el libro.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/256', true),
       set_config('telecab.usuario_id', '7', true);

-- ── Los canales: públicos, privados y directos ─────────────────────────────
CREATE TABLE IF NOT EXISTS chat_canal (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo               VARCHAR(10)  NOT NULL CHECK (tipo IN ('publico', 'privado', 'directo')),
  -- Los públicos y privados, con nombre ('1-general-telecab'); los directos no.
  nombre             VARCHAR(80)  CHECK (nombre IS NULL OR nombre ~ '^[a-z0-9][a-z0-9_-]*$'),
  tema               VARCHAR(250),
  descripcion        TEXT,
  -- Un directo es de un grupo fijo de personas: sus ids, en orden ('3,7,9').
  clave_directo      VARCHAR(400),
  creado_por         INTEGER      REFERENCES usuario(id),
  creado_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  archivado_at       TIMESTAMPTZ,
  archivado_por      INTEGER      REFERENCES usuario(id),
  ultimo_mensaje_at  TIMESTAMPTZ,
  CONSTRAINT ck_chat_canal_nombre CHECK ((tipo = 'directo') = (nombre IS NULL)),
  CONSTRAINT ck_chat_canal_directo CHECK ((tipo = 'directo') = (clave_directo IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_canal_nombre ON chat_canal (nombre) WHERE nombre IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_canal_directo ON chat_canal (clave_directo) WHERE clave_directo IS NOT NULL;

-- ── Quién está en cada canal, y hasta dónde ha leído ───────────────────────
CREATE TABLE IF NOT EXISTS chat_miembro (
  canal_id         BIGINT       NOT NULL REFERENCES chat_canal(id),
  usuario_id       INTEGER      NOT NULL REFERENCES usuario(id),
  desde_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anadido_por      INTEGER      REFERENCES usuario(id),
  -- El último mensaje que ha visto (el id más alto del canal, hilos incluidos).
  ultimo_leido_id  BIGINT       NOT NULL DEFAULT 0,
  -- Salir o que le quiten: una marca, no un borrado.
  salido_at        TIMESTAMPTZ,
  salido_por       INTEGER      REFERENCES usuario(id),
  PRIMARY KEY (canal_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_chat_miembro_usuario ON chat_miembro (usuario_id) WHERE salido_at IS NULL;

-- ── Los mensajes, con su hilo ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_mensaje (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  canal_id             BIGINT       NOT NULL REFERENCES chat_canal(id),
  autor_id             INTEGER      REFERENCES usuario(id),
  -- La respuesta de un hilo apunta a su mensaje de arriba (un solo nivel, como Slack).
  padre_id             BIGINT       REFERENCES chat_mensaje(id),
  texto                TEXT         NOT NULL CHECK (btrim(texto) <> '' AND length(texto) <= 8000),
  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- El de arriba de un hilo: cuántas respuestas tiene y la última.
  respuestas           INTEGER      NOT NULL DEFAULT 0,
  ultima_respuesta_at  TIMESTAMPTZ,
  -- Editar y anular llegan en la 2b; las columnas, ya.
  editado_at           TIMESTAMPTZ,
  anulado_at           TIMESTAMPTZ,
  anulado_por          INTEGER      REFERENCES usuario(id),
  anulado_motivo       TEXT,
  CONSTRAINT ck_chat_mensaje_anulado CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_chat_mensaje_canal ON chat_mensaje (canal_id, id) WHERE padre_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_chat_mensaje_hilo ON chat_mensaje (padre_id, id) WHERE padre_id IS NOT NULL;

-- ── Las menciones: a una persona o a todo el canal (@canal) ────────────────
CREATE TABLE IF NOT EXISTS chat_mencion (
  mensaje_id   BIGINT   NOT NULL REFERENCES chat_mensaje(id),
  usuario_id   INTEGER  REFERENCES usuario(id),
  -- @canal: a todos los del canal.
  todos        BOOLEAN  NOT NULL DEFAULT FALSE,
  CONSTRAINT ck_chat_mencion CHECK (todos <> (usuario_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_mencion ON chat_mencion (mensaje_id, COALESCE(usuario_id, 0));
CREATE INDEX IF NOT EXISTS ix_chat_mencion_usuario ON chat_mencion (usuario_id) WHERE usuario_id IS NOT NULL;

COMMENT ON TABLE chat_canal IS 'El chat interno (ítem 2, db/256): canales públicos, privados y directos. Ver modules/Chat.';
COMMENT ON TABLE chat_mensaje IS 'Los mensajes del chat interno, con su hilo (padre_id). Se anulan, no se borran.';

-- Bajo el libro de auditoría (db/245) antes de sembrar: crear, archivar,
-- entrar y salir de canales, y (2b) editar y anular mensajes.
SELECT auditoria_vigilar('chat_canal');
SELECT auditoria_vigilar('chat_mensaje');

-- ── Quién crea canales: los puestos de Dirección y Desarrollo ──────────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente, creado_por)
SELECT x.puesto, 'chat_canales', FALSE, (SELECT id FROM usuario WHERE id = 7)
  FROM (VALUES ('ceo'), ('direccion_operaciones'), ('direccion_barcelona'), ('desarrollo')) AS x (puesto)
  JOIN puesto p ON p.codigo = x.puesto
 WHERE NOT EXISTS (SELECT 1 FROM puesto_funcion y WHERE y.puesto_codigo = x.puesto AND y.funcion = 'chat_canales' AND y.anulado_at IS NULL);

-- ── Los canales de Slack, con su nombre de siempre ─────────────────────────
INSERT INTO chat_canal (tipo, nombre, creado_por)
SELECT 'publico', x.nombre, (SELECT id FROM usuario WHERE id = 7)
  FROM (VALUES ('1-general-telecab'), ('2-altas-de-empresas'), ('3-bajas-de-empresa'), ('4-bajas-medicas'),
               ('5-cambios-turnos-contratos'), ('6-nominas'), ('7-vacaciones'), ('8-seleccion-vacantes'), ('9-rrhh'),
               ('10-planificacion-de-trafico'), ('11-control-de-trafico'), ('12-gestion-de-flota'),
               ('13-insidencias-coches-conductores'), ('14-taller-soporte'), ('15-administracion'), ('16-efectivo')) AS x (nombre)
ON CONFLICT DO NOTHING;

-- Los privados, con quien los pidió (por id y nombre, como db/248: en otra base, sin nadie).
INSERT INTO chat_canal (tipo, nombre, creado_por)
SELECT 'privado', x.nombre,
       (SELECT u.id FROM usuario u WHERE u.id = x.id AND u.nombre = x.quien)
  FROM (VALUES ('datos', 7, 'Camilo'), ('martes-10am', 1, 'Ignacio'), ('escalaciones-lorenzo', 30, 'Lorenzo')) AS x (nombre, id, quien)
ON CONFLICT DO NOTHING;
INSERT INTO chat_miembro (canal_id, usuario_id, anadido_por)
SELECT c.id, c.creado_por, c.creado_por
  FROM chat_canal c
 WHERE c.tipo = 'privado' AND c.nombre IN ('datos', 'martes-10am', 'escalaciones-lorenzo') AND c.creado_por IS NOT NULL
ON CONFLICT DO NOTHING;

-- Toda la oficina, dentro de todos los públicos (quien llegue después entra solo).
INSERT INTO chat_miembro (canal_id, usuario_id)
SELECT c.id, u.id
  FROM chat_canal c
  CROSS JOIN usuario u
  JOIN rol r ON r.id = u.rol_id
 WHERE c.tipo = 'publico' AND u.estado <> 'bloqueado' AND r.codigo <> 'conductor'
ON CONFLICT DO NOTHING;

COMMIT;
