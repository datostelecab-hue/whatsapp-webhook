-- ============================================================
-- 126 - EL CAMBIO QUE SE LE DA AL CONDUCTOR PARA TRABAJAR
-- ============================================================
-- Un conductor necesita suelto para devolverle a los clientes que pagan en
-- efectivo. Se lo da la casa: sale del cajón, va en su bolsillo, y vuelve con la
-- recaudación.
--
-- Hasta ahora no había forma de apuntarlo. Se podía usar «Devuelto al
-- conductor», que tiene los mismos signos —sale dinero, sube lo que debe— pero
-- significa otra cosa: eso deshace un ingreso SUYO, y esto le presta dinero
-- NUESTRO. Mezclarlos haría imposible contestar «¿cuánto cambio tenemos en la
-- calle?», que es justo la pregunta por la que este movimiento existe.
--
-- ── LO QUE HACE ────────────────────────────────────────────────────────────
--   · RESTA de la caja: ese dinero ya no está en el cajón.
--   · SUMA a lo que ese conductor debe, POR ENCIMA de lo que diga BOLT.
--
-- Esa segunda parte importa: BOLT no sabe nada de este dinero. La cifra de BOLT
-- es lo que cobró en la calle; el cambio lo ponemos nosotros, así que su
-- pendiente pasa a ser mayor que el de BOLT y esa diferencia es exactamente el
-- cambio que lleva encima.

BEGIN;

ALTER TABLE recaudacion_movimiento
  DROP CONSTRAINT IF EXISTS recaudacion_movimiento_tipo_check;

ALTER TABLE recaudacion_movimiento
  ADD CONSTRAINT recaudacion_movimiento_tipo_check CHECK (tipo IN (
    'presencial',        -- entrega en mano        caja +   debe menos
    'nomina',            -- descuento de nómina    caja =   debe menos
    'entrega',           -- devuelto al conductor  caja -   debe más
    'cambio',            -- cambio para trabajar   caja -   debe más
    'salida_banco', 'salida_gastos', 'salida_caja_chica', 'salida_nomina',
    'salida_apertura'));

COMMENT ON COLUMN recaudacion_movimiento.tipo IS
  'Qué clase de movimiento. Cada uno lleva su signo de caja y su signo de deuda en TIPOS (recaudacion.repo)';

COMMIT;
