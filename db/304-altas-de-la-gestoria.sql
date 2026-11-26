-- ============================================================
-- 304 · LAS ALTAS NUEVAS ANTE LA GESTORÍA (plan de RR. HH., módulo 8, 26/11/2026)
-- ============================================================
-- El encargo: «dos riesgos igual de graves: trabajar sin alta y cotizar más de
-- dos días por alguien que no se presenta». Cada contrato de plantilla propia
-- que empieza desde el 27/11/2026 tiene aquí su alta ante la gestoría:
--
--   pendiente   aún no se ha pedido
--   solicitada  Diana se la ha pedido a la gestoría
--   confirmada  la gestoría la ha confirmado (con su justificante adjunto)
--   anulada     no llegó a empezar: se pidió anular el alta (o la baja)
--
-- Camilo, 26/11/2026: lo marca Diana a mano; sin el alta confirmada el bot y el
-- portal no le dejan vincular un coche (planificarle, sí: sale en rojo); la no
-- presentación se mira pasadas dos horas del inicio de su primer turno.
--
-- Las ETT no están: el alta la da la agencia. Los contratos de antes del
-- 27/11/2026 tampoco: ya trabajan, y no se les puede dejar sin coche.

BEGIN;

CREATE TABLE IF NOT EXISTS alta_gestoria (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El contrato (periodo de empleo) cuya alta es: uno por contrato.
  periodo_id      BIGINT      NOT NULL UNIQUE REFERENCES conductor_periodo_empleo(id) ON DELETE CASCADE,
  conductor_id    BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  fecha_alta      DATE        NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente',
  solicitada_at   TIMESTAMPTZ,
  solicitada_por  INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  confirmada_at   TIMESTAMPTZ,
  confirmada_por  INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  anulada_at      TIMESTAMPTZ,
  anulada_por     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  nota            TEXT,
  -- La NO PRESENTACIÓN: su primer día con turno, cuándo saltó la alerta y
  -- cuándo se escaló a Ignacio (al pasar de dos días cotizados).
  primer_dia      DATE,
  primer_turno    VARCHAR(12),
  no_presentado_at TIMESTAMPTZ,
  escalada_at     TIMESTAMPTZ,
  presentado_at   TIMESTAMPTZ,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_alta_gestoria_estado CHECK (estado IN ('pendiente', 'solicitada', 'confirmada', 'anulada'))
);
CREATE INDEX IF NOT EXISTS ix_alta_gestoria_conductor ON alta_gestoria (conductor_id);
CREATE INDEX IF NOT EXISTS ix_alta_gestoria_estado ON alta_gestoria (estado, fecha_alta);
COMMENT ON TABLE alta_gestoria IS
  'El alta ante la gestoría de cada contrato de plantilla propia desde el 27/11/2026 (módulo 8). Sin confirmar, no vincula coche';

SELECT auditoria_vigilar('alta_gestoria');

-- La carta de INCORPORACIÓN va por la cola de Firmas (db/293): el conductor
-- confirma por firma digital su fecha de incorporación.
ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_tipo;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_tipo
  CHECK (tipo IN ('finiquito', 'suspension', 'sancion', 'descuento', 'contrato', 'comunicacion', 'baja_voluntaria', 'incorporacion', 'otro'));
ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_origen;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_origen
  CHECK (origen IN ('manual', 'finiquito', 'semana', 'sancion', 'baja', 'alta'));

COMMIT;
