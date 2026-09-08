-- ============================================================
-- 68 · BITÁCORA — la marca de "esta jornada ya está sellada"
-- ============================================================
-- `bitacora_horas` guarda las horas de cada persona y jornada, pero un día en el
-- que NADIE trabajó no deja ninguna fila, y "sin filas" es indistinguible de
-- "todavía sin calcular". Con eso, la bitácora volvía a sellar junio entero
-- (antes de encender la ingesta no hay tramos) en CADA carga de la pantalla.
--
-- Esta tabla dice qué jornadas están cerradas y calculadas, tengan filas o no.

BEGIN;

CREATE TABLE IF NOT EXISTS bitacora_sello (
  dia_operativo DATE PRIMARY KEY,
  -- Cuántas personas quedaron con horas ese día (0 es un resultado válido).
  filas         INTEGER     NOT NULL DEFAULT 0,
  capturado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE bitacora_sello IS
  'Qué jornadas de la bitácora ya están calculadas y selladas en bitacora_horas. Un día sin nadie trabajando tiene sello con filas = 0: sellado no es lo mismo que vacío.';

COMMIT;
