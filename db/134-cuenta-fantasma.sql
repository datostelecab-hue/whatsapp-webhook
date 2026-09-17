-- ============================================================
-- 134 · CUENTA FANTASMA — horas trabajadas con la cuenta de otro
-- ============================================================
-- A veces BOLT suspende la cuenta de alguien y, para que no se quede en tierra,
-- Tráfico le da una cuenta que está a nombre de otro. Esa persona sale a
-- trabajar y hace sus horas, pero el sistema se las apunta a la cuenta, no a
-- quien de verdad conducía: sus días salen en blanco, y eso le baja la media,
-- lo marca como falta y lo hunde en el reparto del cuadrante.
--
-- Tráfico SÍ sabe quién iba dentro. Esta tabla es el sitio donde decirlo.
--
-- ── Qué es una cuenta fantasma ───────────────────────────────────────────────
-- Una cuenta de BOLT SIN DUEÑO (conductor_externo.conductor_id IS NULL) que
-- durante un periodo la usó una persona concreta. No se enlaza como cuenta
-- propia —no lo es, y mañana puede usarla otro— sino por FECHAS.
--
-- El `hasta` en blanco significa que la sigue usando.
--
-- ── La regla que no puede romperse ───────────────────────────────────────────
-- Una misma cuenta no puede estar prestada a dos personas a la vez: las horas
-- de un día son de alguien, y solo de uno. Eso lo garantiza el EXCLUDE de abajo
-- y no la aplicación: si lo vigilara el código, dos pestañas abiertas a la vez
-- colarían el solape y las horas se contarían dos veces.
--
-- ── Cómo llegan las horas a su sitio ─────────────────────────────────────────
-- No se copia nada. `bitacora.horasCalculadas` resuelve, POR DÍA, de quién son
-- las horas de una cuenta: si ese día hay fantasma vigente manda el fantasma, y
-- si no, el dueño de siempre. Como `sellarHoras` reescribe el rango que se le
-- pida, enlazar una cuenta hacia atrás es volver a sellar esos días — y de ahí
-- salen solas la bitácora, la asistencia, el promedio y la nómina, que todas
-- leen `bitacora_horas`.

BEGIN;

-- Para el EXCLUDE de más abajo: hace falta comparar por igualdad (cuenta_id) y
-- por solape (el rango de fechas) en el mismo índice.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE cuenta_fantasma (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- De quién son de verdad las horas.
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- La cuenta prestada. Apunta a conductor_externo y no al uuid suelto: así la
  -- cuenta no puede desaparecer dejando un enlace apuntando a la nada.
  cuenta_id      BIGINT      NOT NULL REFERENCES conductor_externo(id) ON DELETE CASCADE,
  desde          DATE        NOT NULL,
  -- NULL = la sigue usando. Es el caso normal al enlazar a alguien que está
  -- rodando ahora mismo; se le pone fecha el día que se le devuelva la suya.
  hasta          DATE,
  -- Por qué se le prestó. No es burocracia: dentro de tres meses, cuando alguien
  -- pregunte por qué estas horas son de otro, esto es la respuesta.
  motivo         TEXT,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  creado_por     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  -- Un enlace equivocado NO se borra: se anula. Las horas que movió ya pasaron
  -- por nóminas y por el cuadrante, y hay que poder contar qué se hizo y quién.
  anulado_at     TIMESTAMPTZ,
  anulado_por    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo TEXT,
  CONSTRAINT ck_fantasma_rango CHECK (hasta IS NULL OR hasta >= desde)
);

-- UNA CUENTA, UNA PERSONA A LA VEZ.
--
-- `daterange(desde, hasta, '[]')` con `hasta` en blanco queda abierta por
-- arriba, que es justo "la sigue usando": así un enlace sin cerrar choca con
-- cualquier intento posterior sobre la misma cuenta, en vez de dejar dos
-- dueños para el mismo día.
--
-- Solo entre los VIVOS: un enlace anulado no puede impedir uno nuevo.
ALTER TABLE cuenta_fantasma
  ADD CONSTRAINT ex_fantasma_sin_solape
  EXCLUDE USING gist (
    cuenta_id WITH =,
    daterange(desde, hasta, '[]') WITH &&
  ) WHERE (anulado_at IS NULL);

CREATE INDEX idx_fantasma_conductor ON cuenta_fantasma (conductor_id) WHERE anulado_at IS NULL;
CREATE INDEX idx_fantasma_cuenta    ON cuenta_fantasma (cuenta_id)    WHERE anulado_at IS NULL;

COMMENT ON TABLE cuenta_fantasma IS
  'Periodos en los que una persona trabajó con una cuenta de BOLT que no es suya. Mueve las horas de la cuenta a la persona, por fechas. El EXCLUDE impide que la misma cuenta esté prestada a dos personas a la vez';
COMMENT ON COLUMN cuenta_fantasma.hasta IS
  'NULL = la sigue usando. Se le pone fecha el día que se le devuelva su cuenta';
COMMENT ON COLUMN cuenta_fantasma.anulado_at IS
  'Un enlace equivocado se anula, no se borra: sus horas ya pasaron por la nomina y por el cuadrante';

COMMIT;
