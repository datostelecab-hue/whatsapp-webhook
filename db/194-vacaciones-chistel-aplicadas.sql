-- ============================================================
-- 194 — LAS VACACIONES DE CHISTEL CARBAJAL, APLICADAS
-- ============================================================
-- Camilo, 13/10/2026: «haz que ese ticket pase a hacerse efectivo ya mismo».
--
-- El ticket RH-20261013-10650 pide vacaciones del 15 al 17/10/2026 para
-- Chistel Elissa de Lourdes Carbajal Torres (ficha 241). Laura Blanco, que es
-- quien aprueba las vacaciones (db/189), lo dejó el 13/10 a las 16:56 en
-- «Aprobado» —«Resolver», que lo traía marcado de primeras—, y eso solo cerraba
-- el ticket: lo que las pone en la ficha es «Aplicar». Desde ese día la
-- Ticketera ya no ofrece «Aprobado» en vacaciones, bajas y permisos.
--
-- Esto hace lo mismo que «Aplicar» (ticketera.service.aplicar): el tramo de
-- vacaciones del 15 al 17/10 en su ficha, enlazado con el ticket y a nombre de
-- Laura, que es quien las aprobó; y el ticket queda «Ejecutado» con su
-- «Aplicado: …» y su línea en la historia.
--
-- SOLO SI TODO ESTÁ COMO SE VIO: el ticket 651, de la ficha 241, de vacaciones,
-- en «Aprobado» y con esas fechas. Si ya tiene algo puesto esos días (p. ej.
-- Laura las añadió a mano), no se duplica: si son estas vacaciones, el ticket
-- se cierra igual como aplicado; si es otra cosa, no se toca nada.
BEGIN;

WITH t AS (
  SELECT id, conductor_id FROM ticket
   WHERE id = 651 AND codigo = 'RH-20261013-10650' AND conductor_id = 241
     AND subtipo_codigo = 'VACACIONES' AND estado = 'aprobado'
     AND fecha_ini = DATE '2026-10-15' AND fecha_fin = DATE '2026-10-17'
),
puesta AS (
  INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, hasta_previsto, motivo, usuario_id, ticket_id)
  SELECT t.conductor_id, 'vacaciones', DATE '2026-10-15', DATE '2026-10-17', DATE '2026-10-17',
         'Ticket RH-20261013-10650', 4, t.id
    FROM t
   WHERE NOT EXISTS (SELECT 1 FROM conductor_estado_hist h
                      WHERE h.conductor_id = t.conductor_id
                        AND h.desde <= DATE '2026-10-17'
                        AND COALESCE(h.hasta, 'infinity'::date) >= DATE '2026-10-15')
  RETURNING ticket_id
),
cerrado AS (
  UPDATE ticket k
     SET estado = 'ejecutado',
         resolucion = 'Aplicado: Vacaciones del 15/10/2026 al 17/10/2026',
         resuelto_at = now()
    FROM t
   WHERE k.id = t.id
     AND (EXISTS (SELECT 1 FROM puesta)
          OR EXISTS (SELECT 1 FROM conductor_estado_hist h
                      WHERE h.conductor_id = t.conductor_id AND h.estado = 'vacaciones'
                        AND h.desde <= DATE '2026-10-15' AND h.hasta >= DATE '2026-10-17'))
  RETURNING k.id
)
INSERT INTO ticket_evento (ticket_id, estado_antes, estado_despues, nota, usuario_id, quien)
SELECT id, 'aprobado', 'ejecutado',
       'Aplicado: Vacaciones del 15/10/2026 al 17/10/2026 (las aprobó Laura Blanco el 13/10 y no llegaron a aplicarse; db/194)',
       4, 'Laura Blanco'
  FROM cerrado;

COMMIT;
