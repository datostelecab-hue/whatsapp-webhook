-- ============================================================
-- 163 — RECAUDACIÓN: LA APERTURA, CORREGIDA
-- ============================================================
-- Camilo, 25/09/2026: «mira qué salió de la caja para que dé negativo» y, visto
-- el porqué, «dale, arregla la apertura».
--
-- La caja marcaba −540,05 € y no faltaba dinero. El traspaso del Excel (09/09)
-- trajo dos entregas con fecha 15/09, seis días en el futuro —la carga fue por
-- SQL y no pasó por la regla de «no se apunta dinero con fecha futura»—:
--
--   id 138 · Redy Emmeli Pinza Rivadeneira ···· 500,00 €
--   id  99 · Enrique Sancristobal Edoko ······· 384,40 €
--
-- La apertura (id 146) se calculó con TODO lo importado, estas dos incluidas:
-- 26.394,27 € = 25.553,32 de entregas vivas hasta el 08/09 + 884,40 de estas
-- dos − 43,45 de devoluciones. El 15/09 Ignacio las anuló (no eran efectivo en
-- mano: los 384,40 € de Enrique salen exactos en los descuentos de nómina de
-- septiembre, db/162). Anuladas dejan de sumar como entrada, pero la apertura
-- las seguía restando: la caja se quedaba 884,40 € por debajo de lo real.
--
-- LA APERTURA NO SE PISA. Es dinero: se ANULA la vieja, con quién y por qué, y
-- se apunta otra de 25.509,87 € (26.394,27 − 884,40), con la misma fecha. Queda
-- el rastro de las dos. Con ella la caja pasa a +344,35 €: lo entrado desde el
-- 09/09 (14.659,35 €) menos lo salido desde entonces (14.315 €).
--
-- Lo firma Camilo (usuario 7), que es quien lo ordena.
--
-- SOLO SI TODO ESTÁ COMO SE DIAGNOSTICÓ: la apertura 146 viva y con su importe,
-- y las dos entregas anuladas. Si algo no cuadra (o en una base sin estos datos)
-- no hace nada, y la comprobación de la pantalla lo seguirá diciendo.

BEGIN;

WITH vieja AS (
  UPDATE recaudacion_movimiento
     SET anulado_at     = now(),
         anulado_por    = 7,
         anulado_motivo = 'Corregida (db/163): restaba 884,40 € de dos entregas del Excel con fecha 15/09 (ids 99 y 138) que Ignacio anuló el 15/09. La sustituye la apertura de 25.509,87 €'
   WHERE id = 146
     AND tipo = 'salida_apertura'
     AND importe = 26394.27
     AND anulado_at IS NULL
     AND (SELECT count(*) FROM recaudacion_movimiento
           WHERE id IN (99, 138) AND tipo = 'presencial' AND anulado_at IS NOT NULL) = 2
  RETURNING fecha
)
INSERT INTO recaudacion_movimiento (fecha, tipo, importe, observacion, usuario_id)
SELECT fecha, 'salida_apertura', 25509.87,
       'Traspaso de apertura (corregido el 25/09/2026): lo recaudado hasta el 08/09 ya se ingresó y se gastó; la caja arranca a cero. Sin las entregas 99 y 138, anuladas',
       7
  FROM vieja;

COMMIT;
