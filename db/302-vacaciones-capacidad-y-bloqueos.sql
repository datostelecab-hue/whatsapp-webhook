-- ============================================================
-- 302 — LAS FECHAS BLOQUEADAS DE LAS VACACIONES (MÓDULO 2 DEL PLAN DE RR. HH.)
-- ============================================================
-- El encargo: «cupos y fechas bloqueadas». Camilo, 26/11/2026, lo concretó
-- como una CAPACIDAD (se calcula, no se guarda: modules/Vacaciones/capacidad.js):
-- entre todos tienen que hacer de media 32.000 horas al mes (Parámetros), un
-- 3 % más por cada festivo del tramo, contando lo que hace de media cada uno
-- los días que le toca trabajar; si unas vacaciones lo dejan por debajo, se
-- avisa y aplicarlas pide un motivo.
--
-- Y las fechas bloqueadas (Navidad, un evento…): las pone quien aprueba las
-- vacaciones, con su motivo; unas vacaciones que las pisan también avisan y
-- piden motivo. Se quitan con motivo (queda la fila).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/302', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS vacaciones_bloqueo (
  id              BIGSERIAL PRIMARY KEY,
  desde           DATE        NOT NULL,
  hasta           DATE        NOT NULL,
  motivo          TEXT        NOT NULL,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_vac_bloqueo_fechas CHECK (hasta >= desde),
  CONSTRAINT ck_vac_bloqueo_motivo CHECK (btrim(motivo) <> ''),
  CONSTRAINT ck_vac_bloqueo_anulado CHECK (anulado_at IS NULL OR btrim(COALESCE(anulado_motivo, '')) <> '')
);
CREATE INDEX IF NOT EXISTS ix_vac_bloqueo_fechas ON vacaciones_bloqueo (desde, hasta) WHERE anulado_at IS NULL;

COMMENT ON TABLE vacaciones_bloqueo IS
  'Módulo 2 (db/302): fechas en las que no se dan vacaciones (Navidad, eventos). Unas vacaciones que las pisan avisan y piden motivo al aplicarlas.';

SELECT auditoria_vigilar('vacaciones_bloqueo');

COMMIT;
