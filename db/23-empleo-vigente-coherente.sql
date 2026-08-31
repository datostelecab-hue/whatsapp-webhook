-- ============================================================
-- 23 - `empleo_vigente` DEJA DE PODER MENTIR
-- ============================================================
-- Habia dos verdades para el mismo hecho:
--
--   · `conductor_periodo_empleo` — quien tiene un periodo sin cerrar.
--   · `conductor.empleo_vigente` — una copia de eso, en un booleano.
--
-- Unas pantallas preguntaban a una y otras a la otra. Y se desincronizaban en
-- cuanto alguien cerraba un periodo sin pasar por `darDeBaja`: desde el
-- explorador de SQL, con una migracion, con un arreglo a mano. El resultado era
-- que Plantilla decia "Baja en la empresa" y la importacion de la ETT decia
-- "ya tiene contrato abierto", de la misma persona y a la vez.
--
-- La copia NO se quita: se usa en indices y en el WHERE de v_agenda, y sacarla
-- obligaria a un EXISTS en cuarenta consultas. Lo que se quita es que pueda
-- mentir: la mantiene la BASE, con un disparador, y ya no depende de que quien
-- escriba se acuerde.
--
-- Los periodos mandan. La columna es un cache, y ahora es un cache honesto.

BEGIN;

-- ── Recalcular lo que ya esta torcido ──────────────────────────────────────
UPDATE conductor c
   SET empleo_vigente = EXISTS (
         SELECT 1 FROM conductor_periodo_empleo e
          WHERE e.conductor_id = c.id AND e.baja IS NULL)
 WHERE c.empleo_vigente IS DISTINCT FROM EXISTS (
         SELECT 1 FROM conductor_periodo_empleo e
          WHERE e.conductor_id = c.id AND e.baja IS NULL);

-- ── Y que no se vuelva a torcer ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refrescar_empleo_vigente() RETURNS trigger AS $$
DECLARE
  quien BIGINT;
BEGIN
  -- En un DELETE la fila afectada viene en OLD; en el resto, en NEW. Y un UPDATE
  -- puede MOVER el periodo de una persona a otra, asi que se recalculan las dos.
  FOREACH quien IN ARRAY (
    CASE WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.conductor_id]
         WHEN TG_OP = 'INSERT' THEN ARRAY[NEW.conductor_id]
         ELSE ARRAY[NEW.conductor_id, OLD.conductor_id]
    END)
  LOOP
    UPDATE conductor c
       SET empleo_vigente = EXISTS (
             SELECT 1 FROM conductor_periodo_empleo e
              WHERE e.conductor_id = c.id AND e.baja IS NULL)
     WHERE c.id = quien;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION refrescar_empleo_vigente() IS
  'Mantiene conductor.empleo_vigente al dia pase lo que pase con los periodos. Los periodos mandan; la columna es un cache';

DROP TRIGGER IF EXISTS tg_empleo_vigente ON conductor_periodo_empleo;

CREATE TRIGGER tg_empleo_vigente
  AFTER INSERT OR UPDATE OF conductor_id, baja OR DELETE
  ON conductor_periodo_empleo
  FOR EACH ROW EXECUTE FUNCTION refrescar_empleo_vigente();

COMMENT ON COLUMN conductor.empleo_vigente IS
  'Si tiene algun periodo de empleo sin cerrar. Lo mantiene el disparador tg_empleo_vigente: NO se escribe a mano';

COMMIT;
