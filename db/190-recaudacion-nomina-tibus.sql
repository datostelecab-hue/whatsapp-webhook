-- ============================================================
-- 190 — RECAUDACIÓN: LOS DESCUENTOS DE SEPTIEMBRE QUE TIBUS NO HIZO
-- ============================================================
-- 13/10/2026, a Camilo: «de la recaudación de efectivo de nómina, tenemos que
-- rectificar los siguientes descuentos que RRHH no descontó de las nóminas de
-- Tibus. Si podemos dejar descontado el monto correcto a cada conductor».
-- La tabla (table.tsv) trae, por persona, lo que pedía el Excel de septiembre
-- (db/162) y lo que RRHH descontó de verdad en la nómina de Tibus.
--
-- Un descuento de nómina que no se hizo no puede seguir bajando la deuda: el
-- dinero no ha entrado por ningún lado. Así que cada descuento de db/162 se
-- ANULA, con quién y por qué (en la recaudación nada se borra), y donde RRHH
-- descontó algo se apunta ESO, con la misma fecha (25/09) y el mismo
-- responsable (Ignacio, usuario 1, como en db/162). La diferencia vuelve a
-- quedar pendiente, que es lo que ha pasado.
--
--   id 210 · Kevin Eduardo Trejo Rodriguez ····· 445,90 → 82,14   (+363,76 pendiente)
--   id 212 · Oswaldo Antonio Maco Cardenas ····· 439,60 → 439,50  (+0,10)
--   id 231 · David Lazaro-Carrasco Benitez ····· 191,10 → nada    (+191,10, ya no está)
--   id 244 · Jonatan Lozano Crespo ·············  74,95 → nada    (+74,95)
--   id 246 · Juan Carlos Terranova Portilla ····  60,15 → nada    (+60,15, ya no está)
--   id 257 · Helmuth Isaac Held ················   6,90 → nada    (+6,90)
--                                                           total  696,96 €
--
-- ELIAN FERNANDO BONILLA RUIZ (134,20 €, también en la tabla) NO SE TOCA: su
-- descuento (id 233) ya lo anuló Ignacio el 29/09 —«Trae el efectivo en caja.
-- Se cuadra con Diana para sacar de su nómina el pedido de recaudación de
-- efectivo por 134.20€»—. Pagó en efectivo, y por eso RRHH no se lo descontó:
-- volver a ponérselo sería cobrárselo dos veces.
--
-- Las anulaciones las firma Camilo (usuario 7), que es quien lo pide al ERP.
-- La nómina no pasa por la caja (caja 0): esto cambia la deuda de cada uno,
-- no el dinero del cajón.
--
-- SOLO SI TODO ESTÁ COMO SE VIO: cada fila actúa si su movimiento sigue VIVO,
-- es de nómina y tiene el conductor y el importe de arriba. Si alguien lo ha
-- tocado desde la pantalla (o en una base sin estos datos), esa fila no hace
-- nada. El importe bueno solo se apunta si en esta misma pasada se anuló el
-- viejo: no puede quedar dos veces.
BEGIN;

WITH cambio (mov_id, conductor_id, viejo, bueno, motivo) AS (VALUES
  (210, 121, 445.90, 82.14,
   'Corregido (db/190): en la nómina de Tibus de septiembre RRHH descontó 82,14 €, no 445,90 €. Lo sustituye un descuento de 82,14 €; los 363,76 € restantes siguen pendientes'),
  (212,  70, 439.60, 439.50,
   'Corregido (db/190): en la nómina de Tibus de septiembre RRHH descontó 439,50 €, no 439,60 €. Lo sustituye un descuento de 439,50 €; 0,10 € siguen pendientes'),
  (231, 199, 191.10, NULL,
   'Corregido (db/190): RRHH no lo descontó en la nómina de Tibus de septiembre. Los 191,10 € siguen pendientes'),
  (244, 429,  74.95, NULL,
   'Corregido (db/190): RRHH no lo descontó en la nómina de Tibus de septiembre. Los 74,95 € siguen pendientes'),
  (246, 128,  60.15, NULL,
   'Corregido (db/190): RRHH no lo descontó en la nómina de Tibus de septiembre. Los 60,15 € siguen pendientes'),
  (257, 204,   6.90, NULL,
   'Corregido (db/190): RRHH no lo descontó en la nómina de Tibus de septiembre. Los 6,90 € siguen pendientes')
),
anulados AS (
  UPDATE recaudacion_movimiento m
     SET anulado_at     = now(),
         anulado_por    = 7,
         anulado_motivo = c.motivo
    FROM cambio c
   WHERE m.id = c.mov_id
     AND m.conductor_id = c.conductor_id
     AND m.importe = c.viejo
     AND m.tipo = 'nomina'
     AND m.anulado_at IS NULL
  RETURNING m.conductor_id, m.fecha, c.viejo, c.bueno
)
INSERT INTO recaudacion_movimiento (conductor_id, importe, observacion, fecha, tipo, usuario_id)
SELECT conductor_id, bueno,
       'Descuento de nómina de septiembre 2026 (Tibus), corregido el 13/10/2026 (db/190): lo que RRHH descontó de verdad; el Excel decía ' ||
         replace(to_char(viejo, 'FM999990.00'), '.', ',') || ' €',
       fecha, 'nomina', 1
  FROM anulados
 WHERE bueno IS NOT NULL;

COMMIT;
