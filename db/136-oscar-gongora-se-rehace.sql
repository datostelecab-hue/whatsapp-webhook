-- ============================================================
-- 136 — SE BORRA EL ALTA DE ÓSCAR GÓNGORA PARA REHACERLA
-- ============================================================
-- Se le dio el alta rápida el 23/09/2026 por error, SIN amarrar la vacante, así
-- que quedó contratado y en la lista de la ETT pero sin plaza en el cuadrante.
-- Lo pide Camilo: borrar lo que hay y volver a darle el alta, esta vez con la
-- vacante puesta (ya con el comportamiento nuevo, que ocupa la plaza en el
-- acto desde la fecha prevista).
--
-- ── POR QUÉ NO SE BORRA DESDE LA PANTALLA ──────────────────────────────────
-- Selección sabe borrar una candidatura que no debería existir, pero se niega
-- en cuanto la persona «ha trabajado aquí», y eso lo mide con
-- `alta <= CURRENT_DATE`. Su alta es HOY, así que la comprobación salta aunque
-- no haya trabajado ni un día. Esa regla está bien como está —relajarla para
-- un caso sería abrir la puerta a borrar a gente de verdad—, así que el caso
-- raro se arregla aquí, por escrito y una vez.
--
-- ── QUÉ SE COMPRUEBA ANTES DE BORRAR ───────────────────────────────────────
-- Se borra por id Y POR NOMBRE. Si el 440 fuera otra persona —porque esto se
-- corra sobre otra base, o porque alguien reutilice el id—, no se borra nada.
-- Y consta que no había nada suyo que perder: ni cuenta de BOLT enlazada, ni
-- jornadas, ni asignaciones en el cuadrante. Se comprobó una a una.

BEGIN;

-- Su candidatura (la 64). Va primero y explícita, aunque caería en cascada:
-- borrar a una persona tiene que leerse en el fichero, no adivinarse.
DELETE FROM candidatura k
 USING conductor c
 WHERE k.conductor_id = c.id
   AND c.id = 440
   AND lower(btrim(c.nombre)) = 'oscar'
   AND lower(btrim(c.apellidos)) = 'gongora';

-- Y la ficha. El periodo de empleo y el teléfono caen con ella (ON DELETE
-- CASCADE); no tiene cuenta de BOLT que soltar.
DELETE FROM conductor c
 WHERE c.id = 440
   AND lower(btrim(c.nombre)) = 'oscar'
   AND lower(btrim(c.apellidos)) = 'gongora';

-- LA VACANTE VUELVE A ESTAR ABIERTA. Se quedó en 'proceso' al apuntarla a su
-- candidatura, y en 'proceso' no sale en la lista del alta rápida: sin esto,
-- al rehacer el alta no podría elegirla.
UPDATE vacante SET estado = 'abierta', actualizado_at = now()
 WHERE codigo = 'VMUBGM66H' AND estado = 'proceso';

COMMIT;
