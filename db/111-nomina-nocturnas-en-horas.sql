-- ============================================================
-- 111 · NÓMINAS — las nocturnas también en horas
-- ============================================================
-- La fila guardaba las nocturnas solo en EUROS, que es lo que se paga. Para el
-- fichero de la ETT hace falta el otro número: las HORAS nocturnas.
--
-- No se deduce una de la otra sin saber la tarifa y el factor con los que se
-- calculó ese mes —y esos dos son editables—, así que se guarda al lado. Es la
-- misma razón por la que la nómina congelada copia su config: un mes cerrado
-- tiene que poder explicarse solo, sin depender de lo que valga hoy un
-- parámetro.
--
-- POR QUÉ LA ETT NECESITA LAS HORAS. A quien viene por agencia lo contrata y lo
-- paga ella; nosotros le medimos el trabajo y se lo pasamos. La nocturnidad se
-- la abona la ETT con SU tarifa, no con la nuestra, así que lo que necesita
-- recibir son horas, no euros.

BEGIN;

ALTER TABLE nomina_fila
  ADD COLUMN IF NOT EXISTS nocturnas_horas NUMERIC(8,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN nomina_fila.nocturnas_horas IS
  'Horas nocturnas (22:00-06:00). La columna `nocturnas` lleva lo mismo en euros; se guardan las dos porque una no sale de la otra sin la tarifa del mes';

COMMIT;
