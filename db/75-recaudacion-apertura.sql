-- ============================================================
-- RECAUDACIÓN — el asiento de apertura
-- ============================================================
-- Al volcar el Excel que llevaban a mano entran de golpe TODAS las entregas
-- históricas: 26.394,27 € que los conductores fueron trayendo desde mayo. Ese
-- dinero entró en la caja de verdad, pero ya no está: se fue ingresando en el
-- banco y gastando durante esos meses, y hoy el cajón está a cero.
--
-- Sin un contrapeso, la pantalla diría que hay 26.000 € en un cajón vacío. Con
-- una salida de tipo 'banco' mentiría sobre a dónde fue. Así que se añade un
-- tipo propio que dice exactamente lo que es: lo que salió ANTES de que este
-- módulo existiera, sin desglosar, porque no está desglosado en ninguna parte.
--
-- Es un tipo de UN SOLO USO: no aparece en el desplegable de "Salida de caja".
-- Si alguna vez vuelve a hacer falta será por otro volcado, y entonces se
-- escribirá igual de explícito.

BEGIN;

ALTER TABLE recaudacion_movimiento DROP CONSTRAINT IF EXISTS recaudacion_movimiento_tipo_check;

ALTER TABLE recaudacion_movimiento
  ADD CONSTRAINT recaudacion_movimiento_tipo_check CHECK (tipo IN (
    'presencial', 'nomina', 'entrega',
    'salida_banco', 'salida_gastos', 'salida_caja_chica', 'salida_nomina',
    'salida_apertura'));

COMMENT ON COLUMN recaudacion_movimiento.tipo IS
  'presencial/nomina/entrega son de un conductor; las salida_* vacían la caja. salida_apertura es el traspaso del histórico: un solo uso, no sale en el desplegable';

COMMIT;
