-- ============================================================
-- 131 - LA NOTA DEL CLIENTE, GUARDADA EN EL PADRÓN
-- ============================================================
-- `getDrivers` trae dos números por conductor que hasta hoy se tiraban: la nota
-- que le ponen los clientes y la puntuación de actividad que calcula Bolt. Se
-- llamaba a ese endpoint cada hora y los dos campos se descartaban al mapear.
--
-- Esto solo los GUARDA. No se pinta en ninguna pantalla y no entra en la
-- calificación ABCD: es para consultas e informes.
--
-- ── QUÉ SON, QUE LA API NO LO DICE ─────────────────────────────────────────
-- Los dos están en la especificación oficial como `number` nullable y SIN UNA
-- LÍNEA DE DESCRIPCIÓN. Lo que significan sale de medir los datos (23/09/2026,
-- las dos flotas, 1.576 cuentas):
--
--   bolt_rating   la nota de los clientes, en estrellas. 3,5 a 5 (mediana 4,89).
--                 La traen 247 cuentas: 222 de los 421 activos.
--   bolt_score    la puntuación de actividad de Bolt. 58 a 100 (mediana 98).
--                 La traen las 1.576.
--
-- ── POR QUÉ NUMERIC Y NO INTEGER ───────────────────────────────────────────
-- El rating llega con cuatro decimales (4,9737) y el score, hoy, entero. Pero
-- "hoy" y "entero" no es lo mismo que "siempre" y "por contrato": la API dice
-- `number` y no documenta nada, así que un SMALLINT redondearía en silencio el
-- día que llegue un 86,5. Los dos van en NUMERIC.
--
-- ── EL NULL ES UN DATO ─────────────────────────────────────────────────────
-- 199 conductores ACTIVOS no traen nota —no acumulan viajes suficientes para
-- que Bolt publique una media— además de las 1.064 cuentas desactivadas. NULL
-- aquí significa "no se sabe", no "cero" ni "mal conductor". Por eso el UPSERT
-- conserva lo anterior cuando la vuelta no trae el dato, igual que con
-- `efectivo_activo`: un hueco no desmiente lo que ya se sabía.

BEGIN;

ALTER TABLE conductor_externo
  ADD COLUMN IF NOT EXISTS bolt_rating  NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS bolt_score   NUMERIC(5,2),
  -- Cuándo cambió por última vez alguna de las dos. No es `visto_at`, que se
  -- toca en cada vuelta: esta solo se mueve cuando el número es otro, y es lo
  -- que permite contestar «¿desde cuándo está en 4,2?» sin una tabla de
  -- histórico.
  ADD COLUMN IF NOT EXISTS bolt_nota_at TIMESTAMPTZ;

COMMENT ON COLUMN conductor_externo.bolt_rating IS
  'La nota que le ponen los clientes en BOLT (getDrivers.driver_rating). NULL = aun no tiene media publicada';
COMMENT ON COLUMN conductor_externo.bolt_score IS
  'La puntuacion de actividad que calcula BOLT (getDrivers.driver_score). NULL = no se sabe';
COMMENT ON COLUMN conductor_externo.bolt_nota_at IS
  'Cuando cambio por ultima vez el rating o el score. No se toca si la vuelta trae lo mismo';

COMMIT;
