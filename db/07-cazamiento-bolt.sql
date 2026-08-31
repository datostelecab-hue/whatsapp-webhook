-- ============================================================
-- TELECAB — CAZAMIENTO ENTRE NUESTRO SISTEMA Y BOLT
-- ============================================================
-- Cambio de enfoque (agosto 2026): el NOMBRE deja de ser un mecanismo de
-- identidad. Ya no se intenta adivinar quién es quién comparando nombres; el
-- enlace lo hace una persona desde la interfaz, y el sistema solo se encarga de
-- mantener las dos listas al día:
--
--   · ID DE BOLT LIBRE — una cuenta que existe en BOLT y todavía no está
--     enlazada con ningún conductor nuestro. Aparece sola en la consulta que
--     corre cada media hora.
--
--   · PENDIENTE DE ASIGNAR ID DE BOLT — un conductor nuestro que aún no tiene
--     cuenta enlazada. Puede estar contratado y planificado igualmente: es el
--     caso de los ETT, que entran antes de existir en BOLT.
--
-- Para que una cuenta pueda estar "libre", `conductor_id` pasa a admitir NULL.
-- Una fila sin conductor es exactamente eso: una cuenta vista en BOLT que nadie
-- ha reclamado todavía.

BEGIN;

ALTER TABLE conductor_externo
  ALTER COLUMN conductor_id DROP NOT NULL,
  -- Datos de la propia cuenta, para que quien enlace tenga con qué decidir:
  -- el nombre por sí solo no basta, pero el teléfono suele cantar.
  ADD COLUMN externo_telefono VARCHAR(20),
  ADD COLUMN externo_email    VARCHAR(160),
  -- Cuándo se vio por última vez en la consulta periódica. Sirve para detectar
  -- cuentas que han desaparecido de BOLT sin pasar por 'deactivated'.
  ADD COLUMN visto_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Quién hizo el enlace y cuándo. Un enlace equivocado se deshace, pero hay
  -- que saber quién lo hizo.
  ADD COLUMN enlazado_at      TIMESTAMPTZ,
  ADD COLUMN enlazado_por     INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  -- El enlace se hace a mano, salvo que venga de la migración.
  ADD COLUMN origen_enlace    VARCHAR(12) NOT NULL DEFAULT 'manual',
  ADD CONSTRAINT ck_cext_origen CHECK (origen_enlace IN ('manual','migracion','automatico'));

-- Los enlaces que ya existían venían de la carga inicial: se marcan como tales
-- ANTES de exigir la coherencia, o la comprobación rechazaría filas correctas.
UPDATE conductor_externo
   SET enlazado_at = COALESCE(enlazado_at, visto_desde), origen_enlace = 'migracion'
 WHERE conductor_id IS NOT NULL AND enlazado_at IS NULL;

-- Si hay conductor, tiene que haber fecha de enlace; y al revés.
ALTER TABLE conductor_externo
  ADD CONSTRAINT ck_cext_enlace CHECK ((conductor_id IS NULL) = (enlazado_at IS NULL));

COMMENT ON COLUMN conductor_externo.conductor_id IS
  'NULL = cuenta vista en el sistema externo que todavia no esta enlazada con nadie. Es un "ID de BOLT libre"';

CREATE INDEX idx_cext_libres ON conductor_externo (sistema, estado_externo)
  WHERE conductor_id IS NULL;

-- ── Las dos listas que necesita la interfaz ─────────────────────────────────

-- Cuentas de BOLT sin dueño. Solo las ACTIVAS: las desactivadas son historia y
-- llenarían el desplegable de gente que se fue hace años.
CREATE VIEW v_bolt_libres AS
SELECT e.id, e.externo_id AS driver_uuid,
       e.externo_nombre   AS nombre_en_bolt,
       e.externo_telefono, e.externo_email,
       e.estado_externo, e.visto_desde, e.visto_at
FROM conductor_externo e
WHERE e.sistema = 'bolt'
  AND e.conductor_id IS NULL
  AND e.estado_externo = 'active';
COMMENT ON VIEW v_bolt_libres IS
  'IDs de BOLT libres: cuentas activas que nadie ha reclamado. Es lo que alimenta el desplegable de asignacion';

-- Conductores nuestros sin cuenta de BOLT enlazada.
CREATE VIEW v_conductor_sin_bolt AS
SELECT c.id AS conductor_id,
       COALESCE(c.apellidos || ', ', '') || c.nombre AS quien,
       c.dni_nie,
       (SELECT t.e164 FROM conductor_telefono t
         WHERE t.conductor_id = c.id AND t.vigente_hasta IS NULL
         ORDER BY t.principal DESC LIMIT 1) AS telefono,
       c.empleo_vigente,
       EXISTS (SELECT 1 FROM conductor_periodo_empleo p
                WHERE p.conductor_id = c.id AND p.tipo = 'ett' AND p.baja IS NULL) AS es_ett
FROM conductor c
WHERE NOT c.es_centinela
  AND NOT EXISTS (SELECT 1 FROM conductor_externo e
                   WHERE e.conductor_id = c.id AND e.sistema = 'bolt');
COMMENT ON VIEW v_conductor_sin_bolt IS
  'Pendientes de asignar ID de BOLT. Pueden estar contratados y planificados igualmente: los ETT entran antes de existir en BOLT';

COMMIT;
