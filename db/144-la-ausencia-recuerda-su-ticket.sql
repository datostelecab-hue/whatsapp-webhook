-- ============================================================
-- 144 · LA AUSENCIA SE ACUERDA DEL TICKET QUE LA ABRIO
-- ============================================================
-- Una baja medica aplicada desde la ticketera deja hoy DOS rastros que no se
-- hablan: el tramo en la ficha de la persona y el ticket cerrado en su bandeja.
-- Quien mira la ficha ve "Baja medica, del 18 al 20" y nada mas. Las tres
-- preguntas que se hacen justo despues -- quien la puso, por que, y donde esta
-- el justificante -- se contestan abriendo la ticketera y buscando a mano.
--
-- Con el ticket enganchado se contestan las tres sin salir de la ficha: el
-- responsable ya estaba en `usuario_id`, el motivo es el codigo del ticket, y
-- el justificante es el enlace de Drive que el conductor subio al formulario.
--
-- ── POR QUE UN NUMERO Y NO UNA COPIA ───────────────────────────────────────
--
-- Se guarda el ID del ticket, no su codigo ni su enlace. Copiar el enlace seria
-- mas rapido de leer, pero seria una FOTO: el dia que el conductor vuelva a
-- subir el certificado corregido, la ficha seguiria enseñando el viejo y nadie
-- se enteraria. Apuntando el ticket, lo que se enseña es siempre lo que el
-- ticket tiene HOY.
--
-- Es la misma regla del Call Center con las llamadas de Control: se leen de
-- donde viven, no se duplican.
--
-- ── SET NULL Y NO CASCADE ──────────────────────────────────────────────────
--
-- Si algun dia se borra un ticket, la AUSENCIA NO SE BORRA CON EL. Un tramo de
-- baja es lo que explica las horas de esos dias en la bitacora y en la nomina:
-- que desaparezca por limpiar una bandeja seria perder la razon de un hueco que
-- ya esta contado. Se queda el tramo, sin ticket.

ALTER TABLE conductor_estado_hist
  ADD COLUMN IF NOT EXISTS ticket_id BIGINT REFERENCES ticket(id) ON DELETE SET NULL;

COMMENT ON COLUMN conductor_estado_hist.ticket_id IS
  'El ticket que abrio esta ausencia, si vino de la ticketera. El responsable esta en usuario_id.';

-- Parcial: casi ningun tramo viene de un ticket, y el indice solo hace falta
-- para ir del ticket a su ausencia ("¿esto ya se aplico?").
CREATE INDEX IF NOT EXISTS ix_estado_hist_ticket
  ON conductor_estado_hist (ticket_id) WHERE ticket_id IS NOT NULL;
