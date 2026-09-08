-- ============================================================
-- 73 · JUSTIFICANTE — los cinco tipos DE VERDAD, y su aprobación
-- ============================================================
-- Los cinco tipos los puso Tráfico y van por QUIÉN RESPONDE de la J, no por el
-- motivo: una J de tráfico la aprueba Tráfico, una de RRHH la aprueba RRHH.
--
--   trafico    → operativa: cuadrante, cambios de última hora
--   rrhh       → la persona: médico, permisos, papeleo laboral
--   bolt       → la cuenta: suspensiones, bloqueos de la plataforma
--   taller     → el coche: taller, ITV, averías
--   companero  → la causó un compañero (cambios entre ellos, favores)
--
-- Los tipos del día 72 (taller/suspension/medico/gestion/personal) duraron un
-- día; se remapean a estos: suspension→bolt, medico y gestion→rrhh,
-- personal→trafico, taller se queda.
--
-- Y LA APROBACIÓN: la J nace PENDIENTE y el área responsable la aprueba o la
-- rechaza en el módulo /justificantes. Estados, sin columna de estado:
--   pendiente  = aprobado_at IS NULL  AND anulado_at IS NULL
--   aprobada   = aprobado_at NOT NULL AND anulado_at IS NULL
--   rechazada  = anulado_at NOT NULL (la J se anula: es el circuito que ya
--                existía, ahora con quién y por qué)
--
-- Lo anterior a hoy se aprueba DE OFICIO (aprobado_at = creado_at, sin
-- aprobador): ya está contado en reportes y bitácoras, y arrancar el módulo
-- con trescientas J viejas en la cola sería estrenarlo con deuda ajena.

BEGIN;

-- ── El remapeo de tipos ──
ALTER TABLE justificante DROP CONSTRAINT IF EXISTS ck_just_tipo;

UPDATE justificante SET tipo = 'bolt'    WHERE tipo = 'suspension';
UPDATE justificante SET tipo = 'rrhh'    WHERE tipo IN ('medico', 'gestion');
UPDATE justificante SET tipo = 'trafico' WHERE tipo = 'personal';

ALTER TABLE justificante ALTER COLUMN tipo SET DEFAULT 'trafico';
ALTER TABLE justificante
  ADD CONSTRAINT ck_just_tipo
  CHECK (tipo IN ('trafico', 'rrhh', 'bolt', 'taller', 'companero'));

-- ── La aprobación ──
ALTER TABLE justificante
  ADD COLUMN IF NOT EXISTS aprobado_at timestamptz,
  ADD COLUMN IF NOT EXISTS aprobado_por bigint REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulado_por  bigint REFERENCES usuario(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS anulado_motivo text;

UPDATE justificante SET aprobado_at = creado_at
 WHERE aprobado_at IS NULL AND anulado_at IS NULL AND creado_at < CURRENT_DATE;

-- La cola del módulo se consulta por estado y tipo constantemente.
CREATE INDEX IF NOT EXISTS idx_just_pendientes
  ON justificante (tipo, dia_operativo)
  WHERE aprobado_at IS NULL AND anulado_at IS NULL;

COMMIT;
