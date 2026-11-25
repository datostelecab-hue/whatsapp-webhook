-- ============================================================
-- 292 — UNA BAJA ENCIMA DE UNAS VACACIONES: LA BAJA MANDA Y RR. HH. DECIDE
-- ============================================================
-- Módulo 2 del plan de RR. HH. y nóminas. El encargo: «Solapes con bajas
-- médicas: si una baja coincide con vacaciones aprobadas, el ERP no cambia nada
-- solo: muestra una alerta en Vacaciones con el conductor, los días solapados y
-- la baja, para que Diana decida si devuelve esos días al saldo (a confirmar
-- con legal). Al resolverla, el saldo se recalcula y queda registrado».
--
-- La base no deja dos situaciones el mismo día. Hasta hoy, «Añadir ausencia»
-- daba error y «Cambiar situación» recortaba las vacaciones sin decir nada.
-- Decidido por Camilo el 25/11/2026: LA BAJA MANDA Y DIANA DECIDE. La baja se
-- carga y recorta (o parte en dos) las vacaciones que pisa; los días que pisa
-- quedan aquí, pendientes:
--   · devueltos   vuelven al saldo (es lo que ya pasa al recortarlas);
--   · mantenidos  siguen contando como vacaciones disfrutadas en el saldo.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/292', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS vacaciones_solape (
  id                BIGSERIAL PRIMARY KEY,
  conductor_id      BIGINT       NOT NULL REFERENCES conductor(id),
  baja_id           BIGINT REFERENCES conductor_estado_hist(id) ON DELETE SET NULL,
  -- Las vacaciones como estaban antes de recortarlas.
  vacaciones_desde  DATE         NOT NULL,
  vacaciones_hasta  DATE,
  ticket_id         BIGINT,
  libra_dias        SMALLINT[],
  -- Los días que pisa la baja.
  desde             DATE         NOT NULL,
  hasta             DATE         NOT NULL,
  estado            VARCHAR(10)  NOT NULL DEFAULT 'pendiente',
  nota              TEXT,
  resuelta_at       TIMESTAMPTZ,
  resuelta_por      INTEGER REFERENCES usuario(id),
  creado_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_vac_solape_estado CHECK (estado IN ('pendiente', 'devueltos', 'mantenidos')),
  CONSTRAINT ck_vac_solape_rango CHECK (hasta >= desde),
  CONSTRAINT ck_vac_solape_cierre CHECK ((estado = 'pendiente') = (resuelta_at IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_vac_solape_conductor ON vacaciones_solape (conductor_id, estado);

COMMENT ON TABLE vacaciones_solape IS
  'Módulo 2 (db/292): los días de vacaciones que pisó una baja médica. La baja manda (recorta las vacaciones) y RR. HH. decide si se devuelven al saldo o se mantienen como disfrutados.';

SELECT auditoria_vigilar('vacaciones_solape');

COMMIT;
