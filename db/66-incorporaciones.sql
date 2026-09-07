-- ============================================================
-- 66 — Incorporaciones: la alerta que no se va hasta resolverla
-- ============================================================
-- Sustituye al módulo /incorporaciones (que además escribía en el planificador
-- de HOJAS, muerto desde la migración). Cuando alguien se da de alta con una
-- VACANTE elegida (alta rápida o contratación de la ETT), nace aquí una alerta
-- 'pendiente' que Tráfico ve en el planificador y en Pendientes, y que NO
-- desaparece hasta que la acepte (auto-asignación a las plazas de la vacante,
-- en PostgreSQL) o la rechace (queda en el banquillo para colocarlo a mano).

BEGIN;

CREATE TABLE incorporacion (
  id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  vacante_id     VARCHAR(24),          -- id de la hoja VACANTES ('V…')
  origen         VARCHAR(20) NOT NULL DEFAULT 'ett',
  estado         VARCHAR(12) NOT NULL DEFAULT 'pendiente',
  -- Foto de la vacante AL MOMENTO del alta (puesto, turno, matrículas y días):
  -- si luego la hoja cambia, la alerta sigue diciendo lo que se prometió.
  detalle        JSONB,
  motivo_rechazo VARCHAR(300),
  usuario_alta   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  usuario_res    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_at    TIMESTAMPTZ,
  CONSTRAINT ck_incorporacion_estado CHECK (estado IN ('pendiente', 'aceptada', 'rechazada'))
);

CREATE INDEX idx_incorporacion_pend ON incorporacion (creado_at) WHERE estado = 'pendiente';
CREATE INDEX idx_incorporacion_cond ON incorporacion (conductor_id);

COMMIT;
