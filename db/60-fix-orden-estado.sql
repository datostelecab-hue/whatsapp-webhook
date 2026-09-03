-- ============================================================
-- 60 · FIX — bolt_order.estado se queda corto (VARCHAR(24))
-- ============================================================
-- La ingesta viva de órdenes petaba con "value too long for type character
-- varying(24)": algún order_status de BOLT pasa de 24 caracteres (cancelaciones con
-- motivo, etc.), así que esas órdenes NO se guardaban y el neto/viajes salía corto.
-- Se pasa a TEXT (es un campo de staging, no hay razón para capar su longitud).
--
-- OJO: la vista v_ordenes_conductor (db/38) LEE bolt_order.estado, y Postgres no deja
-- cambiar el tipo de una columna de la que cuelga una vista ("cannot alter type of a
-- column used by a view or rule"). Por eso se SUELTA la vista, se cambia el tipo, y se
-- RECREA idéntica (misma definición que db/38, para no romper nómina/bonus/plus).

BEGIN;

DROP VIEW IF EXISTS v_ordenes_conductor;

ALTER TABLE bolt_order ALTER COLUMN estado TYPE TEXT;

CREATE VIEW v_ordenes_conductor AS
SELECT ce.conductor_id,
       (o.creado_ts AT TIME ZONE 'Europe/Madrid')::date AS dia,
       count(*)                                          AS ordenes,
       count(*) FILTER (WHERE o.estado = 'finished')     AS terminadas,
       count(*) FILTER (WHERE o.estado <> 'finished')    AS no_terminadas,
       round(sum(o.neto), 2)                             AS neto,
       round(sum(o.propina), 2)                          AS propina,
       round(sum(o.peaje), 2)                            AS peaje
  FROM bolt_order o
  JOIN conductor_externo ce
    ON ce.sistema = 'bolt' AND ce.externo_id = o.driver_uuid
 GROUP BY ce.conductor_id, (o.creado_ts AT TIME ZONE 'Europe/Madrid')::date;

COMMENT ON VIEW v_ordenes_conductor IS
  'Dinero y cancelaciones por conductor y dia, cruzado con nuestro conductor. La fuente unica para nomina, bonus y plus de calidad';

COMMIT;
