-- ============================================================
-- 251 — EL TABLERO DE TAREAS: el lugar único del trabajo pendiente
-- ============================================================
-- Ítem 1 de docs/Hoja de ruta.md, entrega 1a (16/11/2026). Una TARJETA es algo
-- que alguien tiene que hacer, con su responsable, su plazo en días hábiles y
-- su historia. Lo que decidieron Camilo e Ignacio (16/11/2026):
--
--   · UNA TAREA A MANO (o desde el chat, cuando exista) la crea cualquiera para
--     otro o para sí, y espera a que la APRUEBE quien tiene la función
--     «tareas_aprueba» (Ignacio). El plazo empieza a contar al aprobarla.
--   · CADA TICKET NUEVO CREA SU TARJETA «por asignar», y quien tiene la función
--     «tareas_asigna» (Ignacio) le pone responsable y plazo a mano. Cerrar la
--     tarjeta cierra el ticket, y al revés.
--   · NINGUNA PIDE APROBACIÓN PARA CERRARSE: pasa a «cerrada» y ya.
--   · Las colas de hoy (J, −J, fichaje y vacaciones) pasan de una vez: entrega 1c.
--
-- COMO TODO LO NUEVO (convenciones de la hoja de ruta):
--   · Se puede MEDIR (ítem 22): la fecha límite ya calculada (`vence_el`), la de
--     cumplimiento (`cerrada_at`), el responsable por id, el motivo de demora y
--     el enlace por id a lo que la originó (`tipo` + `origen_id`).
--   · NADA SE BORRA: rechazar o anular es un estado con motivo; quitar un
--     colaborador o un comentario es anularlo. Sin ON DELETE CASCADE.
--   · BAJO EL LIBRO DE AUDITORÍA (db/245) desde que nacen, y además su propia
--     historia legible (`tarea_evento`), que no se cambia ni se borra.
--
-- Los tipos de tarjeta (qué pide aprobación, qué la cierra) y quién ve qué
-- están en el código: services/tablero.js.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/251', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS tarea (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Qué es: 'manual', 'ticket' (y en 1c 'j', 'menos_j', 'correccion_fichaje',
  -- 'vacaciones'; 'mensaje' con el chat). Cada tipo lo registra su módulo.
  tipo             VARCHAR(24)  NOT NULL CHECK (tipo ~ '^[a-z][a-z_]*$'),
  -- El id de lo que la originó (el ticket, la J…): el enlace por id.
  origen_id        VARCHAR(64),
  titulo           VARCHAR(200) NOT NULL CHECK (btrim(titulo) <> ''),
  descripcion      TEXT,
  -- La página del ERP donde está lo de origen ('/ticketera?ticket=RH-…').
  enlace           VARCHAR(300) CHECK (enlace IS NULL OR enlace ~ '^/[^/]'),
  -- Con datos sensibles en su origen (una baja médica): la tarjeta solo dice el
  -- tipo y el código; lo demás se mira en el origen, con sus permisos.
  sensible         BOOLEAN      NOT NULL DEFAULT FALSE,

  estado           VARCHAR(16)  NOT NULL CHECK (estado IN
                     ('por_aprobar', 'por_asignar', 'por_hacer', 'en_curso', 'bloqueada', 'cerrada', 'rechazada', 'anulada')),
  responsable_id   INTEGER      REFERENCES usuario(id),
  creada_por       INTEGER      REFERENCES usuario(id),
  creada_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- EL PLAZO: en días hábiles (calendario de Madrid, A2) desde que empieza a
  -- contar, y la fecha límite ya calculada. El día límite es el último hábil.
  plazo_dias       SMALLINT     CHECK (plazo_dias BETWEEN 0 AND 365),
  vence_el         DATE,
  plazo_desde      TIMESTAMPTZ,

  aprobada_at      TIMESTAMPTZ,
  aprobada_por     INTEGER      REFERENCES usuario(id),
  asignada_at      TIMESTAMPTZ,
  asignada_por     INTEGER      REFERENCES usuario(id),
  bloqueo_motivo   TEXT,

  -- EL FINAL: cerrada (hecha), rechazada (no se aprobó) o anulada. Cuándo,
  -- quién y en qué quedó; si se cerró pasado el plazo, por qué.
  cerrada_at       TIMESTAMPTZ,
  cerrada_por      INTEGER      REFERENCES usuario(id),
  cierre_nota      TEXT,
  motivo_demora    TEXT,

  -- El aviso de vencida ya se dio (tarea programada tablero.vencidas).
  vencida_avisada_at TIMESTAMPTZ,
  actualizada_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT ck_tarea_final CHECK ((estado IN ('cerrada', 'rechazada', 'anulada')) = (cerrada_at IS NOT NULL)),
  CONSTRAINT ck_tarea_motivo_final CHECK (estado NOT IN ('rechazada', 'anulada') OR btrim(COALESCE(cierre_nota, '')) <> ''),
  CONSTRAINT ck_tarea_bloqueo CHECK ((estado = 'bloqueada') = (bloqueo_motivo IS NOT NULL)),
  -- Trabajándose, siempre con responsable. Por asignar, sin él. Acabada, la
  -- que tuviera (la de un ticket que se cerró mientras estaba por asignar, ninguno).
  CONSTRAINT ck_tarea_responsable CHECK (
    (estado IN ('por_hacer', 'en_curso', 'bloqueada') AND responsable_id IS NOT NULL)
    OR (estado = 'por_asignar' AND responsable_id IS NULL)
    OR estado IN ('por_aprobar', 'cerrada', 'rechazada', 'anulada')),
  CONSTRAINT ck_tarea_vence CHECK ((vence_el IS NULL) OR (plazo_desde IS NOT NULL))
);

-- Una tarjeta viva por cada cosa de origen (un ticket no tiene dos).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarea_origen ON tarea (tipo, origen_id)
  WHERE origen_id IS NOT NULL AND estado <> 'anulada';
CREATE INDEX IF NOT EXISTS ix_tarea_responsable ON tarea (responsable_id, estado);
CREATE INDEX IF NOT EXISTS ix_tarea_abiertas ON tarea (estado, vence_el)
  WHERE estado NOT IN ('cerrada', 'rechazada', 'anulada');

-- ── Quién más trabaja en ella ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarea_colaborador (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id      BIGINT       NOT NULL REFERENCES tarea(id),
  usuario_id    INTEGER      NOT NULL REFERENCES usuario(id),
  puesto_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  puesto_por    INTEGER      REFERENCES usuario(id),
  quitado_at    TIMESTAMPTZ,
  quitado_por   INTEGER      REFERENCES usuario(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tarea_colaborador ON tarea_colaborador (tarea_id, usuario_id) WHERE quitado_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_tarea_colaborador_usuario ON tarea_colaborador (usuario_id) WHERE quitado_at IS NULL;

-- ── Los comentarios ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tarea_comentario (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id        BIGINT       NOT NULL REFERENCES tarea(id),
  autor_id        INTEGER      NOT NULL REFERENCES usuario(id),
  texto           TEXT         NOT NULL CHECK (btrim(texto) <> '' AND length(texto) <= 4000),
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_tarea_comentario_anulado CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_tarea_comentario ON tarea_comentario (tarea_id, creado_at);

-- ── Su historia, legible e intocable ───────────────────────────────────────
-- Lo que se enseña en la ficha: «Ignacio la asignó a Laura con 3 días»,
-- «Laura la bloqueó: falta el justificante». El libro de auditoría guarda los
-- cambios de columnas; esto, lo que pasó en palabras del tablero.
CREATE TABLE IF NOT EXISTS tarea_evento (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tarea_id    BIGINT       NOT NULL REFERENCES tarea(id),
  tipo        VARCHAR(24)  NOT NULL CHECK (tipo ~ '^[a-z][a-z_]*$'),
  autor_id    INTEGER      REFERENCES usuario(id),
  en          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  datos       JSONB        NOT NULL DEFAULT '{}'::jsonb,
  motivo      TEXT
);
CREATE INDEX IF NOT EXISTS ix_tarea_evento ON tarea_evento (tarea_id, en);

CREATE OR REPLACE FUNCTION tarea_evento_intocable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La historia de una tarjeta no se cambia ni se borra';
END $$;
DROP TRIGGER IF EXISTS tr_tarea_evento_intocable ON tarea_evento;
CREATE TRIGGER tr_tarea_evento_intocable BEFORE UPDATE OR DELETE ON tarea_evento
  FOR EACH ROW EXECUTE FUNCTION tarea_evento_intocable();

COMMENT ON TABLE tarea IS
  'El tablero de tareas (ítem 1, db/251): cada tarjeta con su responsable, su plazo en días hábiles y su final. Nada se borra. Ver services/tablero.js.';
COMMENT ON TABLE tarea_evento IS
  'La historia de cada tarjeta, en palabras del tablero. No se cambia ni se borra (disparador).';

-- Bajo el libro ANTES de que entre ninguna fila.
SELECT auditoria_vigilar('tarea');
SELECT auditoria_vigilar('tarea_colaborador');
SELECT auditoria_vigilar('tarea_comentario');

-- ── Quién aprueba y quién asigna: Ignacio (Camilo, 16/11/2026) ──────────────
-- Son FUNCIONES (A5, services/organizacion.js): si mañana lo hace otra persona,
-- se cambia en /organizacion, sin tocar código. Por id y nombre, como db/248.
INSERT INTO usuario_funcion (usuario_id, funcion, suplente, nota, creado_por)
SELECT u.id, f.funcion, FALSE, 'Tablero de tareas, decisión del 16/11/2026', 7
  FROM (VALUES (1, 'Ignacio', 'Cafferata', 'tareas_aprueba'),
               (1, 'Ignacio', 'Cafferata', 'tareas_asigna')) AS f (id, nombre, apellidos, funcion)
  JOIN usuario u ON u.id = f.id AND u.nombre = f.nombre AND COALESCE(u.apellidos, '') = f.apellidos
 WHERE NOT EXISTS (SELECT 1 FROM usuario_funcion x
                    WHERE x.usuario_id = u.id AND x.funcion = f.funcion AND x.anulado_at IS NULL);

-- ── Desde qué ticket nacen tarjetas ────────────────────────────────────────
-- «Cada ticket nuevo crea su tarjeta»: los que entren desde hoy. Los que ya
-- están abiertos pasan de una vez con las colas (entrega 1c).
INSERT INTO config_app (clave, valor, usuario_id, actualizado_at)
SELECT 'tablero.tickets_desde_id', COALESCE(max(id), 0)::text, NULL, now() FROM ticket
ON CONFLICT (clave) DO NOTHING;

COMMIT;
