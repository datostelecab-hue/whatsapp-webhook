-- ============================================================
-- 268 — EL BANCO DE KM, POR HORAS DE VIAJE, Y LAS JUSTIFICACIONES DE KM
-- ============================================================
-- Camilo, 18/11/2026: «Vamos con otros parámetros más específicos: cada hora
-- de viaje en BOLT genera 8,8 km por fuera en el banco, con un límite de 53 km
-- al día. Hay que implementar en las justificaciones de horas también
-- justificaciones de KM, para que se le agreguen al banco de KM: esos van por
-- fuera del límite y de los km generados. Por ejemplo, si hago 3 horas de
-- viaje ese día puedo gastar 26,4 km por fuera; si tengo 50 km por fuera pero
-- con 28 justificados desde Control y justificados por William o Ángel, que
-- serán los que tengan la llave, entonces hice 22 km por fuera y me quedan
-- 4,4 km generados para la semana».
--
-- Y decidió: generan solo las horas DE VIAJE (no la espera); Control apunta la
-- justificación y la aprueba quien tiene la llave «/justificantes/km», como
-- una J; y todo el banco, desde el 26/10, se rehace con la regla nueva.
--
-- LO QUE HACE:
--   1 · km_banco_dia.horas_viaje: las horas de viaje de BOLT de ese día (de ahí
--       sale el límite: 8,8 km por hora, con tope de 53 al día, los parámetros
--       banco_km.km_hora_viaje y banco_km.tope_dia).
--   2 · km_banco_calculo.version: con qué regla se calculó cada día. El código
--       rehace solo los de una versión anterior (la tarea programada, poco a
--       poco).
--   3 · km_justificacion: los km fuera de BOLT justificados de un conductor y
--       un día. Nace pendiente; solo la aprobada resta de sus km fuera. Bajo el
--       libro de auditoría.
--
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/268', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE km_banco_dia ADD COLUMN IF NOT EXISTS horas_viaje NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (horas_viaje >= 0);
COMMENT ON COLUMN km_banco_dia.horas_viaje IS
  'Horas de viaje en BOLT ese día (db/268): generan el límite del banco (banco_km.km_hora_viaje por hora, con tope banco_km.tope_dia).';

ALTER TABLE km_banco_calculo ADD COLUMN IF NOT EXISTS version SMALLINT NOT NULL DEFAULT 1;
COMMENT ON COLUMN km_banco_calculo.version IS
  'Con qué regla se calculó el día: 1 = 17,5 km por día que tocaba (db/267); 2 = 8,8 km por hora de viaje con tope de 53 (db/268).';

CREATE TABLE IF NOT EXISTS km_justificacion (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id    BIGINT        NOT NULL REFERENCES conductor(id),
  dia             DATE          NOT NULL,
  km              NUMERIC(7,1)  NOT NULL CHECK (km > 0 AND km <= 1000),
  -- El coche, si se sabe: no hace falta para la cuenta.
  matricula       VARCHAR(16),
  motivo          TEXT          NOT NULL CHECK (btrim(motivo) <> ''),
  -- Desde dónde se apuntó: la ficha del banco de KM o /justificantes.
  origen          VARCHAR(16)   NOT NULL DEFAULT 'banco_km' CHECK (origen IN ('banco_km', 'justificantes')),
  creado_por      INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  -- Aprobada: la única que resta. Rechazada (o anulada después de aprobarla):
  -- anulado_at, con quién y por qué; manda sobre la aprobación.
  aprobado_at     TIMESTAMPTZ,
  aprobado_por    INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER       REFERENCES usuario(id) ON DELETE SET NULL,
  anulado_motivo  TEXT,
  CONSTRAINT ck_kmj_anulado CHECK ((anulado_at IS NULL) = (anulado_motivo IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_kmj_conductor_dia ON km_justificacion (conductor_id, dia) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_kmj_pendientes ON km_justificacion (dia) WHERE aprobado_at IS NULL AND anulado_at IS NULL;

COMMENT ON TABLE km_justificacion IS
  'Justificaciones de KM del banco de KM (db/268): km fuera de BOLT de un conductor y un día que no cuentan. Nace pendiente; solo la aprobada (llave /justificantes/km) resta.';

SELECT auditoria_vigilar('km_justificacion', 'id');

COMMIT;
