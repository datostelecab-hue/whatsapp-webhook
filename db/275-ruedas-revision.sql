-- ============================================================
-- 275 — RUEDAS: LAS REVISIONES, CON SU OBSERVACIÓN
-- ============================================================
-- Camilo, 23/11/2026: «vamos ahora con el mantenimiento de ruedas, en la cual
-- se pueda inputar también la última revisión, no mantenimiento sino revisión
-- con su respectiva observación».
--
-- Una revisión NO es un cambio de ruedas: no reinicia la cuenta de los 30.000
-- km (modules/Vehiculos/ruedas.service.js). Es mirar cómo están y apuntar lo
-- visto («dibujo a 3 mm, delanteras gastadas por dentro»). Por eso va aparte y
-- no en `mantenimiento`, donde un apunte a mano de neumáticos SÍ es un cambio.
--
-- Nada se borra: una revisión mal apuntada se anula, con su motivo.
-- Tabla nueva: se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/275', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS ruedas_revision (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id     BIGINT       NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  fecha           DATE         NOT NULL,
  km              INTEGER      CHECK (km IS NULL OR km >= 0),
  observacion     TEXT         NOT NULL CHECK (btrim(observacion) <> ''),
  creado_por      INTEGER      REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER      REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_ruedas_revision_anulada CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_ruedas_revision_vehiculo ON ruedas_revision (vehiculo_id, fecha DESC, id DESC) WHERE anulado_at IS NULL;

COMMENT ON TABLE ruedas_revision IS
  'Revisiones de ruedas con su observación (db/275). No son cambios: no reinician los 30.000 km. Se anulan, no se borran.';

SELECT auditoria_vigilar('ruedas_revision');

COMMIT;
