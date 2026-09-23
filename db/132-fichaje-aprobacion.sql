-- ============================================================
-- 132 — LAS HORAS DEL FICHAJE HAY QUE CONFIRMARLAS
-- ============================================================
-- Hasta hoy el fichaje era la palabra de quien pulsaba: lo que marcaba el botón
-- era la jornada, y nadie la miraba. Eso vale mientras nadie cuente con esas
-- horas, y deja de valer en cuanto cuentan.
--
-- A partir de aquí un fichaje CERRADO nace `pendiente` y alguien lo confirma.
-- Quien confirma es quien tiene la llave '/fichaje/revisar' (services/permisos),
-- y esa llave nace SIN DUEÑO a propósito: se da persona a persona.
--
-- ── POR QUÉ DOS COLUMNAS Y NO UN 'estado' ──────────────────────────────────
-- Un `estado` de texto habría que mantenerlo a mano en cada UPDATE y se puede
-- quedar mintiendo (aprobado con la salida en NULL). Aquí el estado se DEDUCE y
-- no se puede contradecir:
--
--   salida IS NULL                      → abierta, todavía está trabajando
--   aprobado_at IS NULL                 → pendiente de confirmar
--   aprobado_at IS NOT NULL             → confirmada, y se sabe por quién
--
-- ── APROBAR NO ES PARA SIEMPRE ─────────────────────────────────────────────
-- Corregir las horas BORRA la aprobación (lo hace el repositorio en el mismo
-- UPDATE). Si no, se aprobaría una jornada de 8 h, se editaría a 12 y el sello
-- seguiría ahí diciendo que alguien las dio por buenas. Un sello que sobrevive
-- a lo que sella no es un sello.

BEGIN;

ALTER TABLE fichaje
  ADD COLUMN IF NOT EXISTS aprobado_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aprobado_por BIGINT REFERENCES usuario(id);

-- Una jornada ABIERTA no se puede dar por buena: todavía no se sabe cuánto
-- duró. Y una aprobación sin nombre no vale para nada ante una reclamación.
ALTER TABLE fichaje DROP CONSTRAINT IF EXISTS ck_fichaje_aprobado;
ALTER TABLE fichaje ADD CONSTRAINT ck_fichaje_aprobado CHECK (
  aprobado_at IS NULL OR (aprobado_por IS NOT NULL AND salida IS NOT NULL));

-- Lo que de verdad se consulta: la cola de lo que falta por confirmar.
CREATE INDEX IF NOT EXISTS idx_fichaje_pendiente
  ON fichaje (dia DESC) WHERE salida IS NOT NULL AND aprobado_at IS NULL;

COMMENT ON COLUMN fichaje.aprobado_at IS
  'Cuando se confirmaron estas horas. NULL con salida puesta = pendiente de confirmar. Corregir las horas lo vuelve a poner en NULL';
COMMENT ON COLUMN fichaje.aprobado_por IS
  'Quien las confirmo. Es el que tiene la llave /fichaje/revisar, no el que ficho';

COMMIT;
