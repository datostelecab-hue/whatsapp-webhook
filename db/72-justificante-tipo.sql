-- ============================================================
-- 72 · JUSTIFICANTE.TIPO — los cinco tipos de J
-- ============================================================
-- La J era solo texto libre ("coche en taller", "2 HORAS ITV", "suspension"...)
-- y con texto libre no se puede agrupar: la campaña de llamadas necesita ver
-- "cuántos justificados hay y de qué clase" de un vistazo.
--
-- Cinco tipos, sacados de lo que la gente YA escribe (se miraron las
-- observaciones reales antes de elegirlos):
--   taller      → el coche: taller, ITV, avería
--   suspension  → la cuenta: suspendido en BOLT (aceptación, puntuación...)
--   medico      → la persona: médico, enfermedad puntual
--   gestion     → papeleo: administración, licencias, renovaciones
--   personal    → lo demás
--
-- El texto libre SE QUEDA (la observación sigue siendo obligatoria): el tipo
-- agrupa, la observación explica.

BEGIN;

ALTER TABLE justificante
  ADD COLUMN IF NOT EXISTS tipo varchar(20) NOT NULL DEFAULT 'personal';

ALTER TABLE justificante
  DROP CONSTRAINT IF EXISTS ck_just_tipo;
ALTER TABLE justificante
  ADD CONSTRAINT ck_just_tipo
  CHECK (tipo IN ('taller', 'suspension', 'medico', 'gestion', 'personal'));

-- Lo ya escrito se clasifica por palabras. Lo que no case con nada queda en
-- 'personal', que para el histórico es suficiente: los tipos importan de hoy
-- en adelante.
UPDATE justificante SET tipo = 'taller'
 WHERE tipo = 'personal' AND observacion ~* '(taller|itv|aver[ií]|rueda|frenos|coche)';
UPDATE justificante SET tipo = 'suspension'
 WHERE tipo = 'personal' AND observacion ~* '(suspen|cuenta|bloque)';
UPDATE justificante SET tipo = 'medico'
 WHERE tipo = 'personal' AND observacion ~* '(m[eé]dic|enferm|hospital|cita|salud)';
UPDATE justificante SET tipo = 'gestion'
 WHERE tipo = 'personal' AND observacion ~* '(adm|gesti[oó]n|papel|licencia|renov|tr[aá]mite|vtc)';

COMMIT;
