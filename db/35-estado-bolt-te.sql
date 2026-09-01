-- ============================================================
-- 35 - DE UN ESTADO DE BOLT A UN SUPUESTO DE TRABAJO EFECTIVO
-- ============================================================
-- Hito 2, el corazon. La capa que normaliza lo que llega de BOLT ya no inventa
-- que es trabajo: lo dice el convenio (art. 18.6 y 18.7), y aqui se guarda como
-- DATO la traduccion de cada estado de BOLT a un supuesto TE_.
--
-- EL CAMBIO GORDO RESPECTO A LO DE HOY. El sistema viejo cuenta como trabajo
-- tanto 'has_order' como 'waiting_orders' (la constante STATE_VIAJE). El
-- convenio NO:
--
--   · has_order      -> TE_A3: desde que aceptas un servicio hasta que acaba.
--                       Computa SIEMPRE, estes donde estes. Es trabajo, seguro.
--   · waiting_orders -> conexion a la plataforma esperando. Por el art. 18.7,
--                       esto NO es trabajo por si solo. Solo cuenta como TE_A1
--                       si estas DENTRO DEL AREA y del marco temporal. Sin
--                       confirmar el area, la respuesta del convenio es que NO
--                       computa (TE_NO).
--   · busy           -> descanso. No es trabajo efectivo.
--   · inactive/offline -> desconectado.
--
-- Consecuencia: al pasar a esta regla, las horas efectivas BAJAN respecto al
-- calculo de hoy, porque la espera deja de sumar sola. Es correcto: es lo que
-- dice el convenio. Cuando se cruce la zona de Mapon (alerta in_object), la
-- espera dentro del area subira a TE_A1 y volvera a contar.
--
-- Por que en una TABLA y no en el codigo: el dia que BOLT saque un estado nuevo,
-- o que se decida contar la espera de otra forma, es una fila, no un despliegue.

BEGIN;

CREATE TABLE cat_estado_te (
  estado_bolt   VARCHAR(24) PRIMARY KEY,
  -- El supuesto que le corresponde cuando cuenta. Nulo si ese estado no es
  -- trabajo efectivo de ninguna manera (descanso, desconexion).
  supuesto_te   VARCHAR(8)  REFERENCES effective_work_case(case_code),
  -- El tipo de asiento que genera. EFFECTIVE_WORK para lo que suma; nulo para lo
  -- que no genera asiento de trabajo.
  tipo          VARCHAR(24) REFERENCES ledger_entry_type(entry_type_code),
  -- Si genera asiento de trabajo efectivo.
  cuenta        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Si SOLO cuenta cuando se confirma el area y el marco temporal (la espera).
  -- Mientras no se confirme, no genera asiento: el convenio no lo da por trabajo.
  condicionado  BOOLEAN     NOT NULL DEFAULT FALSE,
  -- El supuesto al que cae cuando esta condicionado y NO se confirma el area.
  supuesto_sin  VARCHAR(8)  REFERENCES effective_work_case(case_code),
  nota          VARCHAR(200)
);

INSERT INTO cat_estado_te (estado_bolt, supuesto_te, tipo, cuenta, condicionado, supuesto_sin, nota) VALUES
  ('has_order',      'TE_A3', 'EFFECTIVE_WORK', TRUE,  FALSE, NULL,    'En servicio: cuenta siempre (art. 18.6.a, always_counts)'),
  ('waiting_orders', 'TE_A1', 'EFFECTIVE_WORK', TRUE,  TRUE,  'TE_NO', 'Esperando: solo cuenta dentro del area y marco (art. 18.7). Sin confirmar area, NO cuenta'),
  ('busy',           NULL,    NULL,             FALSE, FALSE, NULL,    'Descanso: no es trabajo efectivo'),
  ('inactive',       NULL,    NULL,             FALSE, FALSE, NULL,    'Desconectado'),
  ('offline',        NULL,    NULL,             FALSE, FALSE, NULL,    'Desconectado')
ON CONFLICT (estado_bolt) DO UPDATE SET
  supuesto_te = EXCLUDED.supuesto_te, tipo = EXCLUDED.tipo, cuenta = EXCLUDED.cuenta,
  condicionado = EXCLUDED.condicionado, supuesto_sin = EXCLUDED.supuesto_sin, nota = EXCLUDED.nota;

COMMENT ON TABLE cat_estado_te IS
  'Traduce cada estado de BOLT a un supuesto de trabajo efectivo del convenio. Cambiar como cuenta la espera es un UPDATE';

COMMIT;
