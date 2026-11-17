-- ============================================================
-- 263 — LAS VACACIONES DE LA OFICINA
-- ============================================================
-- Camilo, 17/11/2026: «Vamos ahora con el módulo de vacaciones pero para los de
-- la empresa, los que estén dentro de Telecab y tengan su fecha de alta, todos
-- podrán verlas, pero el que pone las fechas de alta es … el que tenga los
-- permisos de usuarios». Decidió:
--   · cada uno ve las suyas; quien tiene la llave de Usuarios y permisos, las
--     de todos, y pone las fechas de alta;
--   · se piden desde el simulador, con sus dos días de libranza, y las aprueba
--     o rechaza quien tiene esa llave; hasta entonces no restan;
--   · generan 0,084 por cada día del horario de la oficina (de lunes a viernes,
--     Parámetros), aunque sea festivo o esté de vacaciones, con un tope de 1,84
--     al mes (parámetro oficina.vacaciones.tope_mes).
-- Ver modules/VacacionesOficina.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/263', true),
       set_config('telecab.usuario_id', '7', true);

-- ── La fecha de alta de cada persona de la oficina ─────────────────────────
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS fecha_alta DATE;
COMMENT ON COLUMN usuario.fecha_alta IS
  'Desde cuándo trabaja en Telecab (db/263): desde aquí genera vacaciones. La pone quien tiene la llave de Usuarios y permisos.';

-- ── Sus vacaciones: pedidas, aprobadas, rechazadas o anuladas ──────────────
CREATE TABLE IF NOT EXISTS oficina_vacacion (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     INTEGER      NOT NULL REFERENCES usuario(id),
  desde          DATE         NOT NULL,
  hasta          DATE         NOT NULL,
  -- Los dos días de la semana que libra en esas vacaciones (1 = lunes … 7 =
  -- domingo): no gastan vacaciones. Los elige al pedirlas.
  libra_dias     SMALLINT[]   NOT NULL,
  nota           TEXT,
  estado         VARCHAR(10)  NOT NULL DEFAULT 'pedida' CHECK (estado IN ('pedida', 'aprobada', 'rechazada', 'anulada')),
  pedida_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  pedida_por     INTEGER      REFERENCES usuario(id),
  -- Quien la aprobó, la rechazó o la anuló, cuándo y por qué.
  resuelta_at    TIMESTAMPTZ,
  resuelta_por   INTEGER      REFERENCES usuario(id),
  resuelta_nota  TEXT,
  CONSTRAINT ck_oficina_vacacion_fechas CHECK (hasta >= desde AND hasta - desde <= 365),
  CONSTRAINT ck_oficina_vacacion_libra CHECK (
    array_length(libra_dias, 1) = 2 AND libra_dias <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[] AND libra_dias[1] <> libra_dias[2]),
  CONSTRAINT ck_oficina_vacacion_resuelta CHECK ((estado = 'pedida') = (resuelta_at IS NULL)),
  CONSTRAINT ck_oficina_vacacion_motivo CHECK (estado NOT IN ('rechazada', 'anulada') OR btrim(COALESCE(resuelta_nota, '')) <> '')
);
CREATE INDEX IF NOT EXISTS ix_oficina_vacacion_usuario ON oficina_vacacion (usuario_id, desde);
CREATE INDEX IF NOT EXISTS ix_oficina_vacacion_pedidas ON oficina_vacacion (pedida_at) WHERE estado = 'pedida';

COMMENT ON TABLE oficina_vacacion IS
  'Las vacaciones de la gente de la oficina (db/263): se piden y las aprueba quien tiene la llave de Usuarios y permisos. Se anulan, no se borran.';

SELECT auditoria_vigilar('oficina_vacacion');

COMMIT;
