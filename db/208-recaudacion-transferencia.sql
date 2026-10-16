-- ============================================================
-- 208 · RECAUDACIÓN — lo que el conductor paga por TRANSFERENCIA
-- ============================================================
-- Camilo, 16/10/2026: «algunos conductores querrán dar el dinero vía
-- transferencia, por lo tanto habilita un botón al lado de "Cobrar" donde diga
-- "Transferencia" y poder colocar el monto y además el ID de la transferencia,
-- el ID de la transferencia es obligatoria y la ponemos a mano».
--
-- Un tipo de movimiento más, con los mismos signos que el descuento de nómina:
--   · NO entra en la caja: el dinero está en el banco, no en el cajón.
--   · SÍ baja lo que el conductor debe.
--
-- EL ID DE LA TRANSFERENCIA va en su propia columna, `referencia`, y no en la
-- observación, por dos cosas que defiende la base y no solo la pantalla:
--   · OBLIGATORIO en las transferencias. Es lo que se busca en el extracto del
--     banco cuando alguien dice «yo ya te lo pagué».
--   · ÚNICO entre las transferencias VIVAS. La misma transferencia apuntada dos
--     veces —al mismo conductor o a dos distintos— bajaría la deuda dos veces
--     con un solo ingreso. Se compara sin mayúsculas ni espacios («ES12 34» y
--     «es1234» son la misma). Una anulada deja libre su ID: se anula la mal
--     apuntada y se apunta bien.
--
-- Hasta aplicar esto la pantalla funciona igual que antes; lo único que no se
-- puede es apuntar una transferencia (lo dice al intentarlo).

BEGIN;

ALTER TABLE recaudacion_movimiento
  DROP CONSTRAINT IF EXISTS recaudacion_movimiento_tipo_check;

ALTER TABLE recaudacion_movimiento
  ADD CONSTRAINT recaudacion_movimiento_tipo_check CHECK (tipo IN (
    'presencial',        -- entrega en mano        caja +   debe menos
    'nomina',            -- descuento de nómina    caja =   debe menos
    'transferencia',     -- transferencia          caja =   debe menos
    'entrega',           -- devuelto al conductor  caja -   debe más
    'cambio',            -- cambio para trabajar   caja -   debe más
    'salida_banco', 'salida_gastos', 'salida_caja_chica', 'salida_nomina',
    'salida_apertura'));

ALTER TABLE recaudacion_movimiento ADD COLUMN IF NOT EXISTS referencia VARCHAR(100);

ALTER TABLE recaudacion_movimiento DROP CONSTRAINT IF EXISTS ck_recaud_transferencia_ref;
ALTER TABLE recaudacion_movimiento ADD CONSTRAINT ck_recaud_transferencia_ref CHECK (
  tipo <> 'transferencia' OR (referencia IS NOT NULL AND btrim(referencia) <> ''));

CREATE UNIQUE INDEX IF NOT EXISTS ux_recaud_transferencia_ref
  ON recaudacion_movimiento (upper(regexp_replace(referencia, '[[:space:]]', '', 'g')))
  WHERE tipo = 'transferencia' AND anulado_at IS NULL;

COMMENT ON COLUMN recaudacion_movimiento.referencia IS
  'El ID de la transferencia, escrito a mano. Obligatorio en las transferencias y único entre las vivas (sin mayúsculas ni espacios)';

COMMIT;
