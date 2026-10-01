-- ============================================================
-- 169 — LOS EXCESOS DEL 3784LFV QUE NO ERAN DE EDISON
-- ============================================================
-- Camilo, 01/10/2026: «borra los excesos de velocidad de Edison Roman Vera
-- Farfan, eran dudosos y efectivamente no eran de él».
--
-- Son cinco, del 11/09 entre las 20:00 y las 23:21, todos del 3784LFV y todos
-- `dudoso`: el candidato era Edison porque fue el último en BOLT con ese coche,
-- pero se había desconectado de la app de 9 a 13 horas antes, y el coche pudo
-- cambiar de manos. No se le avisó de ninguno.
--
-- NO SE BORRAN LAS FILAS: SE LE QUITAN A ÉL. La fila es también la marca de
-- «este aviso de Mapon ya está procesado» (`excesosPendientes` busca los que NO
-- tienen fila). Borrada, cualquier reproceso de /sanciones que mire tantos días
-- atrás la volvería a crear con el mismo cálculo, otra vez a nombre de Edison.
-- Así el coche sigue constando a 145 km/h ese día —eso pasó—, sin nadie al
-- volante, y con la nota de por qué.
--
-- Sin conductor, uuid ni teléfono: el teléfono era el suyo y el uuid su cuenta
-- de BOLT, y cualquiera de los dos lo seguiría señalando. La ventana de la
-- atribución también se va: medía cuánto fiarse de que era él.
--
-- La letra no depende de esto: desde el modelo 2.1 los dudosos no la bajan a
-- nadie (services/repo/calificacion.js). Esto limpia su expediente.

BEGIN;

UPDATE velocidad_exceso e
   SET conductor_id = NULL,
       driver_uuid  = NULL,
       conductor    = NULL,
       telefono     = NULL,
       ventana_seg  = NULL,
       estado       = 'sin_conductor',
       nota         = 'No era Edison Roman Vera Farfan (lo confirmó Camilo el 01/10/2026): se le quita el exceso. '
                      || 'Atribución anterior, dudosa: ' || COALESCE(e.nota, '')
 WHERE e.clave IN ('893925|2026-09-11T18:00:41Z|speeding',
                   '893925|2026-09-11T20:48:17Z|speeding',
                   '893925|2026-09-11T20:52:41Z|speeding',
                   '893925|2026-09-11T21:01:14Z|speeding',
                   '893925|2026-09-11T21:21:48Z|speeding')
   AND e.conductor_id = 111
   AND e.estado = 'dudoso'
   AND EXISTS (SELECT 1 FROM conductor c
                WHERE c.id = 111 AND c.nombre = 'EDISON ROMAN' AND c.apellidos = 'VERA FARFAN');

COMMIT;
