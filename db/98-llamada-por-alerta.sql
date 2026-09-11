-- ============================================================
-- 98 — LA LLAMADA, POR TIPO Y CON UNA RESPUESTA POR ALERTA
-- ============================================================
-- Dos cosas que faltaban en `llamada_seguimiento`:
--
--   1. EL TIPO. Hasta ahora solo había `resultado`, y todo lo que no fuera "no
--      se conecta" caía en "Incidencia que lo impide" con el motivo de verdad
--      escrito a mano en la nota. Así no se puede contar cuántas veces al mes
--      el taller no suelta un coche a tiempo.
--
--   2. QUÉ SE PREGUNTÓ DE CADA ALERTA. Un conductor puede tener tres cosas
--      abiertas a la vez —no llega a las horas, rueda desconectado, rechaza
--      viajes— y se le llama UNA vez para preguntarle por las tres. Una sola
--      nota para las tres no sirve: al día siguiente nadie sabe qué contestó
--      sobre cuál. Por eso la respuesta va POR ALERTA, en su propia fila.
--
-- Y de aquí sale, además, el fin del parpadeo: la fila de Control late hasta
-- que TODAS sus alertas tienen su respuesta apuntada. `conductor_id` y
-- `dia_operativo` van repetidos aquí a propósito —se pueden deducir por el
-- JOIN— para que esa pregunta, que se hace en cada refresco del cockpit, sea
-- una lectura directa por índice y no un cruce.

BEGIN;

ALTER TABLE llamada_seguimiento ADD COLUMN IF NOT EXISTS tipo VARCHAR(24);
COMMENT ON COLUMN llamada_seguimiento.tipo IS
  'De dónde viene la llamada: seguimiento | taller | rrhh | trafico | alerta. NULL en las anteriores a db/98';

CREATE TABLE llamada_alerta (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  llamada_id     BIGINT       NOT NULL REFERENCES llamada_seguimiento(id) ON DELETE CASCADE,
  conductor_id   BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo  DATE         NOT NULL,
  -- El CÓDIGO de la alerta ('no_llegara', 'rueda_caido', 'rechazos'…). La
  -- etiqueta cambia sola durante el día ("faltan 2,4 h" → "faltan 3,1 h"); el
  -- código no, y por eso es él quien dice si ya se preguntó por esto.
  alerta         VARCHAR(40)  NOT NULL,
  -- Cómo se llamaba la alerta EN EL MOMENTO de preguntar. Se guarda porque el
  -- texto lleva el número que se le leyó al conductor por teléfono.
  etiqueta       VARCHAR(160),
  comentario     VARCHAR(300) NOT NULL,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Un comentario vacío no es una respuesta: sería marcar "ya pregunté" sin
  -- dejar qué contestó, que es justo lo que hace que el siguiente controlador
  -- vuelva a llamar por lo mismo.
  CONSTRAINT ck_llamada_alerta_comentario CHECK (btrim(comentario) <> '')
);

CREATE INDEX ix_llamada_alerta_cond ON llamada_alerta (conductor_id, dia_operativo);
CREATE INDEX ix_llamada_alerta_llamada ON llamada_alerta (llamada_id);

COMMENT ON TABLE llamada_alerta IS
  'Lo que contestó el conductor sobre CADA alerta abierta, en la llamada donde se le preguntó';

COMMIT;
