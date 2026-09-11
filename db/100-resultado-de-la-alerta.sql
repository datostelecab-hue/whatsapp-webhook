-- ============================================================
-- 100 — Arreglar el "qué pasó" de las llamadas por alerta
-- ============================================================
-- El selector de casos guardaba el textContent del BOTÓN, y un caso puede
-- llevar debajo su explicación (las alertas la llevan siempre). Resultado: el
-- "qué pasó" de la llamada quedó pegado a la explicación, sin espacio y
-- recortado a 60 caracteres:
--
--   "1 viaje rechazadoLos rechazó ÉL, con el dedo. No se puede re"
--
-- En pantalla se leía regular; en el informe del Histórico —donde esa columna
-- ES la respuesta a "por qué no se cumplió el horario"— no se lee. El botón ya
-- guarda el texto del caso (public/assets/js/dialogo.js), así que esto arregla
-- lo que se apuntó antes: son ocho llamadas, y en las ocho la etiqueta limpia
-- está guardada al lado, en llamada_alerta.
--
-- Solo se toca lo que EMPIEZA por la etiqueta: si no encaja, se deja como está.
-- No se pierde nada — lo que se quita es la explicación genérica de la alerta,
-- idéntica para todo el mundo, no lo que dijo el conductor (eso es el
-- comentario, y ese nunca se tocó).

BEGIN;

-- Y la etiqueta guardada tampoco puede llevar el "· ya contestada": eso era el
-- estado del momento en la pantalla, no el nombre de la alerta, y agrupar por
-- ella partía en dos la misma alerta en el informe.
UPDATE llamada_alerta
   SET etiqueta = btrim(regexp_replace(etiqueta, ' · ya contestada$', ''))
 WHERE etiqueta LIKE '% · ya contestada';

UPDATE llamada_seguimiento l
   SET resultado = a.etiqueta
  FROM llamada_alerta a
 WHERE a.llamada_id = l.id
   AND l.tipo = 'alerta'
   AND l.resultado IS NOT NULL
   AND a.etiqueta IS NOT NULL
   AND l.resultado <> a.etiqueta
   AND left(l.resultado, length(a.etiqueta)) = a.etiqueta;

COMMIT;
