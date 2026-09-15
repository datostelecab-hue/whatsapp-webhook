-- ============================================================
-- 116 - FUERA PETICIONES: el papeleo sobra cuando hay una ficha
-- ============================================================
-- La migración 115 creó `peticion` para sacar de una hoja el circuito "Tráfico
-- pide una ausencia → RRHH la aprueba". Duró un día: ese circuito ya no se usa.
--
-- Quien tiene permiso sobre la Plantilla cambia la situación de la persona en su
-- ficha, y ahí está todo —el tramo, las fechas, quién lo hizo y cuándo—. Un
-- formulario intermedio para pedir permiso a otra pantalla no añadía ningún
-- dato: añadía un paso.
--
-- ── Y LA COLUMNA TAMBIÉN SE VA ──────────────────────────────────────────────
-- `conductor_estado_hist.peticion_id` estaba desde db/01 esperando esta tabla.
-- Sin el circuito no hay nada que apuntar ahí, y una columna con el nombre de un
-- módulo que no existe es de las cosas que hacen perder media hora dentro de
-- seis meses. Está VACÍA en las 104 filas que hay, así que no se pierde nada:
-- comprobado antes de escribir esto.
--
-- Quién abrió cada tramo sigue guardado en `usuario_id`, que es la pregunta que
-- de verdad se hace.

BEGIN;

ALTER TABLE conductor_estado_hist
  DROP CONSTRAINT IF EXISTS conductor_estado_hist_peticion_id_fkey;

ALTER TABLE conductor_estado_hist
  DROP COLUMN IF EXISTS peticion_id;

DROP TABLE IF EXISTS peticion;

COMMIT;
