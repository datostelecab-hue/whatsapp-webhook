-- ============================================================
-- ¿TIENE EL EFECTIVO ACTIVADO EN BOLT?
-- ============================================================
-- `getDrivers` trae `has_cash_payment` en cada conductor: si BOLT le deja
-- cobrar en mano. La ingesta ya pide ese padrón cada 60 minutos, pero se
-- quedaba con el nombre, el teléfono, el correo y el estado, y tiraba lo demás.
--
-- Importa por dos cosas:
--   · Quien lo tiene activado VA A generar deuda de efectivo. Verlo al lado de
--     lo que ya debe dice a quién hay que vigilar antes de que crezca.
--   · Quien lo tiene activado y YA NO TRABAJA aquí es un agujero abierto: sigue
--     pudiendo cobrar en mano dinero que es de la empresa.
--
-- Se guarda también CUÁNDO se supo, porque el dato caduca: si el padrón lleva
-- horas sin refrescarse, la pantalla tiene que poder decir "esto es de hace un
-- rato" en vez de afirmarlo como si fuera de ahora.

BEGIN;

ALTER TABLE conductor_externo
  ADD COLUMN IF NOT EXISTS efectivo_activo BOOLEAN,
  ADD COLUMN IF NOT EXISTS efectivo_at     TIMESTAMPTZ;

COMMENT ON COLUMN conductor_externo.efectivo_activo IS
  'has_cash_payment de BOLT: si tiene habilitado cobrar en efectivo. NULL = aun no se ha leido';
COMMENT ON COLUMN conductor_externo.efectivo_at IS
  'Cuando se leyo ese dato del padron de BOLT';

-- Los que lo tienen activado son pocos frente al total: el indice parcial los
-- saca sin recorrer las 1.600 cuentas.
CREATE INDEX IF NOT EXISTS idx_cext_efectivo
  ON conductor_externo (sistema, conductor_id) WHERE efectivo_activo;

COMMIT;
