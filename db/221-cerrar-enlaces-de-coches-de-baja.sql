-- ============================================================
-- 221 — LOS COCHES DE BAJA SUELTAN SUS ENLACES (odómetros de Mapon)
-- ============================================================
-- Desde el 27/10/2026 a las 14:23 no se guardaba el odómetro de NINGÚN coche:
-- «⚠️ [INGESTA] Odómetros de Mapon: more than one row returned by a subquery
-- used as an expression» en cada pasada (lo vio Camilo en el log de Render el
-- 28/10).
--
-- El 1685KTC se dio de alta como ficha nueva (la 114) el 27/10, pero su ficha
-- vieja (la 36, de baja desde el 23/09) seguía enlazada a la misma unidad de
-- Mapon (932733): dar de baja un coche nunca cerraba sus enlaces. Con dos
-- coches en la misma unidad, la subconsulta de sincronizarOdometros
-- (modules/Vehiculos/vehiculos.repo.js) fallaba y, como todo va en una
-- transacción, se deshacía el lote entero: ningún odómetro y ninguna foto de
-- km del día (vehiculo_km_dia).
--
-- Aquí se cierran los enlaces que siguen abiertos en coches de baja, con la
-- fecha de la baja (o la del enlace, si es posterior: ck_valias_rango). En la
-- copia del 27/10 eran 7, todos de Mapon; el que importa es el de la ficha 36.
-- La pasada siguiente de la ingesta (cada minuto mientras falle) vuelve a
-- guardar los odómetros y la foto del día.
--
-- Para que no vuelva a pasar: darDeBaja ya cierra los enlaces de Mapon del
-- coche, y la 222 impide dos coches vigentes en la misma unidad.

BEGIN;

UPDATE vehiculo_alias a
   SET visto_hasta = GREATEST(v.baja_at, a.visto_desde)
  FROM vehiculo v
 WHERE v.id = a.vehiculo_id
   AND a.visto_hasta IS NULL
   AND v.baja_at IS NOT NULL;

COMMIT;
