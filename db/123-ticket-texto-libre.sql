-- ============================================================
-- 123 - LO QUE ESCRIBE UNA PERSONA NO TIENE LONGITUD
-- ============================================================
-- «value too long for type character varying(24)»: la ticketera rechazaba
-- tickets enteros al traerlos del formulario.
--
-- La columna era `prioridad VARCHAR(24)`, dimensionada pensando en «Alta»,
-- «Media», «Baja» — que es lo que valía para los tickets de soporte, donde las
-- opciones las ponemos nosotros. Pero en el formulario esa pregunta es «Nivel de
-- prioridad» y sus respuestas son frases:
--
--     «Incidencia grave (requiere parada inmediata)»
--     «Incidencia moderada (puede seguir rodando)»
--     «Incidencia leve / estética»
--
-- ── LA LECCIÓN, QUE VALE PARA TODA LA TABLA ─────────────────────────────────
-- Un campo que rellena una persona en un formulario que no controlamos no tiene
-- longitud máxima: la tiene la pregunta de hoy, y la pregunta cambia. Ponerle un
-- VARCHAR(n) es apostar a que nadie reescribirá esa opción, y el precio de
-- perder la apuesta no es un texto cortado: es el ticket entero rechazado, que
-- es lo que acaba de pasar.
--
-- `prioridad` pasa a TEXT. Los que se quedan acotados son los que SÍ tienen una
-- longitud real —un DNI, un teléfono, una matrícula— y de esos se encarga el
-- lector, que los normaliza y guarda el original en la descripción: así una
-- respuesta rara tampoco tira el ticket.

BEGIN;

ALTER TABLE ticket ALTER COLUMN prioridad TYPE TEXT;

COMMENT ON COLUMN ticket.prioridad IS
  'Texto libre: en el formulario esta respuesta es una frase, no una palabra';

COMMIT;
