-- ============================================================
-- 216 · LA BOYA CON LA VENTANA FIJA: VOLVER A MEDIR LO YA MEDIDO
-- ============================================================
-- Camilo, 23/10/2026, con la ficha del 1212MJY delante: «Aquí hay un error de
-- auditoría ya que dice que le falta el 100% de gasolina, pero porque mapon dio
-- los datos después de repostar, audítalo con el nivel de combustible 15
-- minutos antes del excel y luego media hora después del excel».
--
-- Desde esta versión la boya mide el nivel del aforador a T − 15 min y a T + 30
-- min (T = repostaje_at, la hora del Excel o la del correo) y le suma lo que el
-- coche gastó andando entre las dos lecturas (combustible.boya: `ventana` y
-- `gastadoAndando`). Ya no mira la parada de Mapon. Lo auditado hasta ahora
-- tiene el antes y el después de la regla vieja (las medianas de 5 lecturas
-- antes de parar y después de arrancar), y la auditoría no vuelve sola a lo
-- acabado: hay que devolverlo a la cola.
--
-- QUÉ SE VUELVE A MEDIR, Y QUÉ NO:
--
--   · Solo la BOYA, y solo donde hubo boya (boya_tipo 'litros' o 'porcentaje').
--     Sin aforador ('sin') o sin Mapon (NULL), la regla nueva da lo mismo.
--   · Solo lo auditado con el código de antes: el de ahora escribe SIEMPRE la
--     versión 3 en auditoria_detalle (la de antes, la 2), mida la boya o no.
--     Camilo aplica esta migración DESPUÉS de desplegar, y en ese rato el cron
--     ya audita con la regla nueva: eso no se vuelve a tocar. Hasta la revisión
--     del 23/10/2026 se miraba la marca de la boya (boya.regla = 'ventana'),
--     pero esa marca solo está si la ventana llegó a medir: lo que el código
--     nuevo deja a medias (un Ioniq esperando a bajar del techo, uno de hace
--     menos de T + 30) o «sin datos» no la lleva, y esta migración le habría
--     puesto una boyaAntes falsa o lo habría vuelto a auditar entero (el GPS
--     también, preguntando a Mapon otra vez). Y un reintento del código nuevo
--     no devuelve la boya de antes a su sitio (combustible.auditoria,
--     restaurarBoya): con la versión 3, la boya es de la regla nueva o no hay.
--     Aplicarla dos veces no hace nada.
--   · EL GPS SE QUEDA: su regla no ha cambiado. La posición, la parada, la
--     distancia, la más cercana, su porqué y la gasolinera no se tocan. Los
--     'hecha' vuelven a 'pendiente' con `soloBoya` en el detalle, y la auditoría
--     (combustible.auditoria) les rehace la distancia con la posición guardada,
--     sin preguntar a Mapon, y solo le pide el aforador y los km: pedirle otra
--     vez las paradas y la posición sería pedirle lo que ya está guardado.
--   · Los 'sin_datos' (se cerraron a medias: puede que su GPS no esté entero)
--     vuelven a 'pendiente' sin esa marca: se audita todo.
--   · Los 'incompleta' ya están en la cola: su próximo intento, en su turno, ya
--     mide con la regla nueva. Solo se les quita la boya vieja.
--   · LA BOYA VIEJA SE QUITA de las columnas y de auditoria_detalle.boya (con
--     las lecturas del dibujo), y se guarda en auditoria_detalle.boyaAntes, para
--     que no se pierda. Quitarla, por dos cosas: hasta que se vuelva a medir, la
--     fila enseña «por auditar» en la boya, no un color de la regla de antes (el
--     1212MJY seguiría rojo, un 95 %); y si en el nuevo intento Mapon no
--     contesta, la auditoría devolvería la boya de la vez anterior («un
--     reintento no borra lo que ya se midió») como si fuera de ahora.
--   · Los intentos NO se ponen a cero (db/214 sí lo hizo): un repostaje de hace
--     días ya tiene en Mapon todo lo que va a tener, y si Mapon no lo da, con
--     los intentos que llevaba se cierra antes «sin datos». Es lo que menos
--     pregunta.
--
-- EN PRODUCCIÓN, CON EL CRON POR EL ATRASO DEL EXCEL DE PETROPRIX. Hasta que
-- se despliegue, el cron sigue auditando con la regla vieja, unos 360 por hora:
-- el 23/10 a las 17:18 eran 837 auditados (726 con boya: los que esta migración
-- tocaría a esa hora) y quedaban 1.052 en la cola, que se acaban hacia las
-- 20:15. Si se despliega después, esta migración devolverá casi los 1.900. Lo
-- que vuelve a la cola entra en el mismo orden que
-- lo demás (combustible.repo.paraAuditar): primero los de las últimas 48 horas,
-- por su hora (los de Ballenoil de esos días); luego el atraso, del coche con lo
-- más antiguo al más nuevo, cada coche con lo suyo de 4 días junto, y lo que no
-- se había mirado todavía va en el mismo orden, mezclado. A 60 cada 10 minutos,
-- 1.900 son unas 5 horas, y preguntan poco: de cada coche y 4 días, una lectura
-- del aforador y una de km, sin paradas ni posiciones (medido en el entorno de
-- pruebas: los 94 de la muestra en 41 s con 148 preguntas; la primera vez, 73
-- en 50 s con 175).
-- Mientras tanto, lo devuelto a la cola enseña «por auditar» en la boya, con el
-- color de la fila solo por el GPS, y las cifras de arriba («en rojo», «en
-- amarillo») bajan; se rellenan solas. Un repostaje que no se pudo volver a
-- medir (Mapon no contestó dos veces) se cierra «sin datos», sin boya: se ve en
-- el filtro «sin color». No hay nada que parar ni que esperar para aplicarla.
--
-- No se edita ninguna migración anterior (docs/nucleo/Migraciones.md).

BEGIN;

UPDATE repostaje
   SET auditoria_detalle = (COALESCE(auditoria_detalle, '{}'::jsonb) - 'boya')
         || jsonb_build_object('boyaAntes', jsonb_strip_nulls(jsonb_build_object(
              'regla', 'parada', 'tipo', boya_tipo, 'antes', boya_antes, 'despues', boya_despues,
              'salto', boya_salto, 'techo', boya_techo, 'corregida', boya_corregida, 'litros', boya_litros,
              'deficitPct', boya_error_pct, 'motivo', boya_motivo, 'medidaAt', auditoria_at)))
         || CASE WHEN auditoria_estado = 'hecha' THEN jsonb_build_object('soloBoya', 'db/216') ELSE '{}'::jsonb END,
       boya_tipo = NULL, boya_antes = NULL, boya_despues = NULL, boya_salto = NULL, boya_techo = NULL,
       boya_corregida = NULL, boya_litros = NULL, boya_error_pct = NULL, boya_motivo = NULL,
       auditoria_estado = CASE WHEN auditoria_estado IN ('hecha', 'sin_datos') THEN 'pendiente' ELSE auditoria_estado END,
       actualizado_at = now()
 WHERE estado = 'leido'
   AND auditoria_estado IN ('hecha', 'sin_datos', 'incompleta')
   AND boya_tipo IN ('litros', 'porcentaje')
   AND COALESCE((auditoria_detalle ->> 'version')::int, 0) < 3;

COMMENT ON COLUMN repostaje.boya_antes IS
  'El nivel del aforador 15 minutos antes del repostaje (desde db/216): la última lectura a esa hora o antes, con la mediana de las de sus 10 minutos si son 3 o más. Hasta db/216, la mediana de las 5 antes de parar';
COMMENT ON COLUMN repostaje.boya_despues IS
  'El nivel del aforador 30 minutos después del repostaje (desde db/216): la primera lectura a esa hora o después, con la mediana de las de sus 10 minutos si son 3 o más. Hasta db/216, la mediana de las 5 después de arrancar';
COMMENT ON COLUMN repostaje.boya_litros IS
  'Lo que subió el depósito según la boya, en litros: el salto (boya_despues − boya_antes) más lo que gastó andando entre las dos lecturas (km de Mapon a 4,77 L/100 km), corregido si el aforador topó en su techo (boya_corregida), o pasado de % a litros con la capacidad del depósito';

COMMIT;
