-- ============================================================
-- 188 — EL HISTORIAL DE ESTADO DEL COCHE, CUADRADO CON SU ESTADO
-- ============================================================
-- Camilo, 08/10/2026: el 0715MMZ está «En taller», pero en su ficha de
-- Vehículos el historial dice «Operativo desde el 10/09, hasta ahora».
--
-- Por qué: el estado del coche vive en dos sitios. `vehiculo.estado_operativo`
-- dice el de ahora, y `vehiculo_estado_hist` dice desde cuándo y hasta cuándo.
-- La ficha de Vehículos cambiaba los dos. El desplegable de estado del
-- planificador solo cambiaba la columna (`planificador.repo.guardar`, ya
-- arreglado en el mismo commit), y db/76 hizo lo mismo con los coches que
-- pasaron a Barcelona. El 08/10 había 20 coches vivos con los dos sitios
-- descuadrados: 11 de Madrid (10 «En taller» y el 4799LBG en «Policía») y
-- 8 de Barcelona en «Baja», que es como se marcan desde db/76 y db/173.
--
-- Aquí manda el estado del coche: es el que leen el planificador, la cobertura,
-- el mapa y Mantenimientos. Su vigencia empieza HOY, el día en que se aplica:
-- NO SE SABE desde cuándo estaba cada uno así, porque esa fecha no se guardó en
-- ningún sitio. Lo de antes queda cerrado ayer. La cuenta se hace al aplicar:
-- si alguno se ha cuadrado entre medias desde la ficha, no se toca.

BEGIN;

CREATE TEMP TABLE _descuadre ON COMMIT DROP AS
SELECT v.id, v.estado_operativo, (now() AT TIME ZONE 'Europe/Madrid')::date AS hoy
  FROM vehiculo v
  LEFT JOIN LATERAL (
    SELECT h.estado_codigo
      FROM vehiculo_estado_hist h
     WHERE h.vehiculo_id = v.id
       AND h.desde <= (now() AT TIME ZONE 'Europe/Madrid')::date
       AND (h.hasta IS NULL OR h.hasta >= (now() AT TIME ZONE 'Europe/Madrid')::date)
     ORDER BY h.desde DESC LIMIT 1) h ON TRUE
 WHERE v.baja_at IS NULL
   AND v.estado_operativo IS NOT NULL
   AND h.estado_codigo IS DISTINCT FROM v.estado_operativo;

-- Lo que estaba vigente hoy se cierra ayer…
UPDATE vehiculo_estado_hist h
   SET hasta = d.hoy - 1
  FROM _descuadre d
 WHERE h.vehiculo_id = d.id
   AND h.desde < d.hoy
   AND (h.hasta IS NULL OR h.hasta >= d.hoy);

-- …lo que empezaba hoy o después se pisaría con lo nuevo…
DELETE FROM vehiculo_estado_hist h
 USING _descuadre d
 WHERE h.vehiculo_id = d.id
   AND h.desde >= d.hoy;

-- …y desde hoy, el estado que tiene el coche.
INSERT INTO vehiculo_estado_hist (vehiculo_id, estado_codigo, desde)
SELECT id, estado_operativo, hoy FROM _descuadre;

COMMIT;
