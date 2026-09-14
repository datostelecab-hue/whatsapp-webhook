-- ============================================================
-- 110 · NÓMINAS — el recorte por utilización mínima
-- ============================================================
-- La hora extra se paga por CONDUCIR de más, no por estar conectado de más.
--
-- Las horas efectivas son viaje + espera: el servicio y el tiempo esperando
-- pedidos. Quien pasa el mes con la app abierta y poca carrera acumula horas
-- igual que quien no para, y con el cálculo anterior cobraba extras por ello.
-- El caso que lo destapó: 211,4 h en el mes, 35,4 de exceso sobre el objetivo…
-- y un 52,7 % de utilización. De sus 211 horas, 100 fueron espera.
--
-- LA REGLA. Todo el mundo tiene que llegar a una utilización mínima (65 %). A
-- quien no llega se le quitan horas DE ESPERA —nunca de viaje— hasta que la
-- alcance, y la diferencia contra el objetivo se mide sobre lo que queda.
--
--   utilización = viaje ÷ (viaje + espera)
--
--   se busca la X que cumple   viaje ÷ (viaje + espera − X) = mínimo
--   despejando:                X = (viaje + espera) − viaje ÷ mínimo
--
-- Dos propiedades que la hacen segura, y que están comprobadas sobre los datos
-- reales de agosto de 2026 (87 personas afectadas, 1.139 h retiradas):
--
--   · X NUNCA pasa de la espera que esa persona tiene. Sale de la propia
--     fórmula: X ≤ espera equivale a viaje ≤ viaje ÷ mínimo, que es cierto
--     siempre que el mínimo sea menor que 1. O sea: no se le puede quitar ni un
--     minuto de viaje a nadie, por mal que esté su utilización.
--   · Después del recorte todos quedan EXACTAMENTE en el mínimo, ni más ni
--     menos. Quien ya llegaba no pierde nada.
--
-- El mínimo es un parámetro editable (`utilMinima` en nomina_config), como el
-- resto de tarifas: subirlo o bajarlo no es un despliegue.
--
-- La cifra retirada se guarda en la fila porque hay que poder enseñarla: a quien
-- le baja la nómina por esto merece ver cuántas horas se le han quitado y por
-- qué, y sin la columna la única explicación posible sería "sale así".

BEGIN;

ALTER TABLE nomina_fila
  ADD COLUMN IF NOT EXISTS horas_espera_quitadas NUMERIC(8,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN nomina_fila.horas_espera_quitadas IS
  'Horas de ESPERA retiradas para llevar a esa persona a la utilizacion minima. Cero si ya llegaba. Nunca puede pasar de la espera que tuvo: no se recorta viaje';

COMMIT;
