-- ============================================================
-- 121 - LOS TICKETS DE SOPORTE, EN LA MISMA TICKETERA
-- ============================================================
-- «Soporte técnico» es la otra ticketera del sistema: cualquiera abre un ticket
-- —un fallo, una mejora, una duda— y el desarrollador los gestiona. Vivía en su
-- propia hoja `TICKETS_IT`, con su propio esquema, sus propios estados y su
-- propia pantalla.
--
-- ── POR QUÉ ENTRA EN LA TABLA `ticket` Y NO EN UNA SUYA ─────────────────────
-- Porque es la misma cosa: alguien pide algo, alguien se hace cargo, queda un
-- rastro de qué se hizo. Teniendo dos tablas habría dos formas de contestar
-- «¿cuánto tardamos en atender?», dos historiales con distinto formato y dos
-- pantallas que mantener en paralelo — que es exactamente de donde venimos.
--
-- Lo que cambia por área son los SUBTIPOS, y eso ya estaba previsto: el área IT
-- trae los suyos (fallo, requerimiento, mejora, consulta) igual que RRHH trae
-- vacaciones y permisos.
--
-- ── LOS ESTADOS SE TRADUCEN, NO SE AÑADEN ───────────────────────────────────
-- La hoja usaba Nuevo / En curso / Resuelto / Descartado. Se mapean a los que
-- ya hay: pendiente, en_curso, ejecutado y no_procede. Añadir dos estados más
-- que significan lo mismo que dos que ya existen es como se llega a un
-- desplegable de doce opciones donde nadie sabe cuál elegir.
--
-- ── Y TRES COLUMNAS NUEVAS ──────────────────────────────────────────────────
-- Un ticket de soporte lo abre alguien CON CUENTA (no un conductor), puede
-- llevar pantallazos, y el desarrollador apunta en él. Las tres valen para
-- cualquier ticket, no solo para los de IT.

BEGIN;

INSERT INTO cat_ticket_area (codigo, etiqueta, prefijo, orden) VALUES
  ('IT', 'Soporte técnico', 'IT', 6)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO cat_ticket_subtipo (codigo, etiqueta, area_codigo, afecta_planning, estado_abre, orden) VALUES
  ('IT_BUG',           'Fallo',         'IT', FALSE, NULL, 20),
  ('IT_REQUERIMIENTO', 'Requerimiento', 'IT', FALSE, NULL, 21),
  ('IT_MEJORA',        'Mejora',        'IT', FALSE, NULL, 22),
  ('IT_CONSULTA',      'Consulta',      'IT', FALSE, NULL, 23),
  ('IT_OTRO',          'Otro',          'IT', FALSE, NULL, 24)
ON CONFLICT (codigo) DO NOTHING;

ALTER TABLE ticket
  -- Quién lo abre cuando es alguien del personal. `conductor_id` es para el que
  -- lo pide por el formulario; esto es para el que lo pide desde dentro. Son
  -- dos cosas distintas y por eso son dos columnas: hay gente que es las dos.
  ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  -- Pantallazos y documentos. Van a Drive; aquí se guarda a qué apuntan.
  ADD COLUMN IF NOT EXISTS adjuntos   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Lo que apunta quien lo atiende MIENTRAS lo atiende. No es la resolución
  -- —esa se escribe al cerrar— ni las observaciones de quien lo pide.
  ADD COLUMN IF NOT EXISTS notas      TEXT;

CREATE INDEX IF NOT EXISTS idx_ticket_usuario ON ticket (usuario_id, creado_at DESC);

COMMENT ON COLUMN ticket.usuario_id IS
  'Quien lo abre desde dentro (soporte). Distinto de conductor_id, que es quien lo pide por el formulario';
COMMENT ON COLUMN ticket.adjuntos IS
  'Enlaces a Drive de pantallazos y documentos';

COMMIT;
