-- ============================================================
-- 27 - POR QUE NO PASA
-- ============================================================
-- De una entrevista de la ETT salen TRES cosas y no quince:
--
--   · Contratado, con fecha de alta.
--   · Pendiente de asignar.
--   · No pasa, y entonces hay que decir por que.
--
-- Ese "por que" es lo que se le devuelve a la agencia como justificante, y hasta
-- ahora era texto libre o directamente nada: en el Excel salia siempre "No pasa
-- la entrevista", dijera lo que dijera la realidad.
--
-- Va en un catalogo y no en una lista dentro de la pantalla por dos razones. La
-- primera es que cada motivo IMPLICA un estado —no presentarse no es lo mismo
-- que no pasar la entrevista, y la agencia los lee distinto—, y eso es una regla
-- que no puede vivir en un formulario. La segunda es que asi se puede contar:
-- "cuantos no se presentan" es la pregunta que se hace de verdad cuando hay que
-- decidir si esta ETT sirve, y con el motivo en prosa no se responde nunca.

BEGIN;

CREATE TABLE IF NOT EXISTS cat_motivo_descarte (
  codigo     VARCHAR(32) PRIMARY KEY,
  etiqueta   VARCHAR(80) NOT NULL,
  -- El estado al que lleva. Lo decide el motivo, no quien rellena el formulario.
  estado     VARCHAR(24) NOT NULL REFERENCES cat_estado_candidatura(codigo),
  -- Si hace falta escribir ademas de elegir. Solo 'otro' lo pide.
  pide_texto BOOLEAN     NOT NULL DEFAULT FALSE,
  orden      INT         NOT NULL DEFAULT 0,
  activo     BOOLEAN     NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE cat_motivo_descarte IS
  'Por que un candidato no pasa. Cada motivo lleva a su estado: no presentarse no es lo mismo que no pasar la entrevista';

INSERT INTO cat_motivo_descarte (codigo, etiqueta, estado, pide_texto, orden) VALUES
  -- El primero porque es el que se usa casi siempre.
  ('no_presento',   'No se presentó a la entrevista', 'no_presentado', FALSE, 1),
  ('no_supera',     'No supera la entrevista',        'descartado',    FALSE, 2),
  ('rechaza',       'Rechaza la oferta',              'descartado',    FALSE, 3),
  ('no_requisitos', 'No cumple los requisitos',       'descartado',    FALSE, 4),
  ('ilocalizable',  'No contesta',                    'descartado',    FALSE, 5),
  ('otro',          'Otro motivo',                    'descartado',    TRUE,  9)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, estado = EXCLUDED.estado,
  pide_texto = EXCLUDED.pide_texto, orden = EXCLUDED.orden;

-- ── El motivo, ademas de en prosa, codificado ─────────────────────────────
-- `motivo` sigue siendo lo que se lee: la etiqueta y, si la hay, la explicacion.
-- `motivo_codigo` es lo que se cuenta.
ALTER TABLE candidatura ADD COLUMN IF NOT EXISTS motivo_codigo VARCHAR(32)
  REFERENCES cat_motivo_descarte(codigo) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cand_motivo ON candidatura (motivo_codigo)
  WHERE motivo_codigo IS NOT NULL;

COMMENT ON COLUMN candidatura.motivo_codigo IS
  'El motivo elegido del catalogo. `motivo` guarda como se lee; esto guarda como se cuenta';

COMMIT;
