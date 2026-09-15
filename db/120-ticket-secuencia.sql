-- ============================================================
-- 120 - EL NÚMERO DEL TICKET
-- ============================================================
-- El código que ve la gente es `RH-20260915-0042`: prefijo del área, día, y un
-- número. El número del Apps Script era un contador GLOBAL que no se reiniciaba
-- nunca (`TICKET_SEQ` en las propiedades del script), así que el 0042 no era el
-- ticket 42 de ese día sino el 42 desde que aquello se encendió.
--
-- Se conserva ese formato porque está en correos ya enviados y en
-- conversaciones: cambiarlo obligaría a la gente a aprenderse otro.
--
-- ── POR QUÉ EMPIEZA EN 10.000 ───────────────────────────────────────────────
-- Porque los códigos viejos existen. Si esta secuencia arrancara en 1, el primer
-- ticket de hoy sería `RH-20260915-0001`, que es exactamente el código que pudo
-- emitir el script esta misma mañana. Dos tickets distintos con el mismo nombre
-- es de los errores que solo se descubren cuando alguien busca uno y encuentra
-- el otro.
--
-- Arrancando por encima del contador viejo, ningún código nuevo puede repetir
-- uno antiguo. Se nota —el número pasa a tener cinco cifras— y esa es la idea:
-- se ve de un vistazo cuáles son de antes.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS ticket_codigo_seq START WITH 10000;

COMMENT ON SEQUENCE ticket_codigo_seq IS
  'El número del código del ticket. Global y sin reinicio, como el TICKET_SEQ del Apps Script. Arranca en 10000 para no chocar con los códigos ya emitidos';

COMMIT;
