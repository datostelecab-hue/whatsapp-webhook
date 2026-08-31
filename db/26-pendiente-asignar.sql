-- ============================================================
-- 26 - PENDIENTE DE ASIGNAR, JORNADAS Y TURNOS QUE SE PUEDEN ELEGIR
-- ============================================================
-- Tres datos que estaban escritos en la pantalla y tienen que estar aqui.
--
--  1. "Pendiente de asignar" no existia como estado. Se le contestaba
--     "Pendiente" a la agencia usando 'entrevistado', que significa otra cosa:
--     que se le entrevisto, no que se le eligio y falta ponerle coche. Dos
--     hechos distintos con un solo nombre.
--
--  2. Al contratar se elige turno de una lista de CUATRO, y dos de ellos no son
--     elegibles: 'Sin turno' es un hueco, no una decision. Cual se puede elegir
--     lo dice ahora la tabla.
--
--  3. La jornada se tecleaba a mano. Son 32 o 40 — un catalogo de dos filas —,
--     y escrito a mano entra "40h", "40 h" y "cuarenta".

BEGIN;

-- ── 1. Elegido, y sin coche todavia ───────────────────────────────────────
INSERT INTO cat_estado_candidatura (codigo, etiqueta, etapa, orden, en_funnel, es_salida, obsoleto)
VALUES ('pendiente_asignar', 'Pendiente de asignar', 'seleccion', 6, TRUE, FALSE, FALSE)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, etapa = EXCLUDED.etapa, orden = EXCLUDED.orden,
  en_funnel = EXCLUDED.en_funnel, es_salida = EXCLUDED.es_salida, obsoleto = EXCLUDED.obsoleto;

-- Para la agencia es "Pendiente", igual que los demas de su grupo. Que en el
-- Excel se lea igual no lo convierte en lo mismo por dentro.
UPDATE cat_estado_candidatura SET etiqueta_ett = 'Pendiente' WHERE codigo = 'pendiente_asignar';

-- ── 2. Que turnos se pueden elegir al contratar ───────────────────────────
ALTER TABLE turno ADD COLUMN IF NOT EXISTS asignable BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN turno.asignable IS
  'Si se puede elegir al contratar. TodoTurno y "Sin turno" existen para leer datos viejos, no para decidir';

UPDATE turno SET asignable = (codigo IN ('dia', 'noche'));

-- ── 3. Las jornadas que se contratan ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_jornada (
  horas    NUMERIC(4,1) PRIMARY KEY,
  etiqueta VARCHAR(24)  NOT NULL,
  orden    INT          NOT NULL DEFAULT 0,
  activa   BOOLEAN      NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE cat_jornada IS
  'Las jornadas que se pueden contratar. Estaban escritas a mano en un formulario';

INSERT INTO cat_jornada (horas, etiqueta, orden) VALUES
  (32, '32 horas', 1),
  (40, '40 horas', 2)
ON CONFLICT (horas) DO UPDATE SET etiqueta = EXCLUDED.etiqueta, orden = EXCLUDED.orden;

COMMIT;
