-- ============================================================
-- 64 — Llamadas de seguimiento desde Control
-- ============================================================
-- El "telefonito" de Control · En directo: cada pulsación deja constancia de que
-- se llamó a un conductor (quién llamó, cuándo, en qué turno y con qué resultado).
-- Es la traza para el reporte ("sí lo llamé") y para que dos operadores no se
-- pisen. Se espeja además en la hoja CALL_CENTER, pero la verdad vive aquí.

BEGIN;

CREATE TABLE llamada_seguimiento (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  usuario_id    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  origen        VARCHAR(20)  NOT NULL DEFAULT 'control',
  -- El día OPERATIVO (la jornada de 05 a 05), no el natural: una llamada a la
  -- 01:30 pertenece a la noche que empezó la víspera.
  dia_operativo DATE         NOT NULL,
  turno         VARCHAR(10),
  resultado     VARCHAR(60),
  nota          VARCHAR(300),
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_llamada_seg_cond ON llamada_seguimiento (conductor_id, creado_at DESC);
CREATE INDEX idx_llamada_seg_dia  ON llamada_seguimiento (dia_operativo DESC);

COMMIT;
