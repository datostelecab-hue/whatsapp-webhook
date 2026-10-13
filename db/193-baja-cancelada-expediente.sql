-- ============================================================
-- 193 — CANCELAR UNA BAJA PROGRAMADA DEJA EXPEDIENTE
-- ============================================================
-- Camilo, 13/10/2026: «si hay una baja programada, da también la opción de
-- poder cancelarla para que no se efectúe la baja, pero eso sí, que se guarde
-- como expediente con su respectiva observación del por qué se iba a dar de
-- baja y por qué se canceló, obligatoriamente las dos».
--
-- Una baja programada (db/191) que se cancela no se borra sin más: pasa aquí,
-- con el día que tenía previsto, POR QUÉ SE IBA A DAR DE BAJA, quién y cuándo
-- la programó, POR QUÉ SE CANCELÓ y quién y cuándo. Los dos motivos son
-- obligatorios también aquí, no solo en la pantalla. Se ve en la ficha de
-- Plantilla, en «Bajas programadas».
BEGIN;

CREATE TABLE IF NOT EXISTS conductor_baja_cancelada (
  id                 BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id       BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  periodo_id         BIGINT       REFERENCES conductor_periodo_empleo(id) ON DELETE SET NULL,
  -- El último día de contrato que tenía previsto.
  fecha              DATE         NOT NULL,
  motivo_baja        TEXT         NOT NULL CHECK (btrim(motivo_baja) <> ''),
  programada_por     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  programada_at      TIMESTAMPTZ,
  motivo_cancelacion TEXT         NOT NULL CHECK (btrim(motivo_cancelacion) <> ''),
  cancelada_por      INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  cancelada_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_baja_cancelada_conductor ON conductor_baja_cancelada (conductor_id, cancelada_at DESC);
COMMENT ON TABLE conductor_baja_cancelada IS
  'Expediente de las bajas programadas que se cancelaron: por qué se iba a dar de baja y por qué se canceló, los dos obligatorios (db/193)';

COMMIT;
