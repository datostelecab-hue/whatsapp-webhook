-- ============================================================
-- 177 — SE CIERRA EL TURNO DE MARÍA DEL MAR LARA DEL 05/10 (0348MMZ)
-- ============================================================
-- Camilo, 05/10/2026: «ciérrale el turno a María del Mar, ella no está
-- trabajando». Abrió turno por el bot a las 12:08 en el 0348MMZ —el coche de
-- su cuadrante—, con Mapon caído (solo en la base). Pero ese coche lo llevaba
-- Alessio Pizzuto en BOLT desde las 04:39, ella no tenía horas de BOLT ese día y
-- no abrió puertas. Mientras siguiera abierto, el bot daba el coche por suyo y
-- los km de Alessio caían en su turno.
--
-- El ERP no tiene cierre a mano, y cerrarlo como «Terminar turno» pasaría por
-- el motor (con el coche rodando con otro). Así que se cierra aquí:
--   · `auto-cerrado`: no lo cerró ella (no cuenta como «abrió y cerró»);
--   · fin = inicio: duración cero, para que el coche no le cuente a ella;
--   · sin tocar Mapon: nunca se le puso de conductor allí (Mapon estaba caído).
-- Solo si sigue abierto: si ya lo cerró alguien, no se pisa.

BEGIN;

UPDATE fichaje_turno
   SET estado = 'auto-cerrado',
       fin    = inicio,
       notas  = btrim(COALESCE(notas, '') || ' · Cerrado a mano el 05/10/2026 (db/177): no estaba trabajando, ' ||
                'el 0348MMZ lo llevaba Alessio Pizzuto en BOLT desde las 04:39. Sin km.')
 WHERE id = 301
   AND referencia = '634128044-1791194929727'
   AND conductor_id = 244
   AND estado = 'abierto';

COMMIT;
