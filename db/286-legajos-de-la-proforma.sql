-- ============================================================
-- 286 — LOS LEGAJOS QUE FALTABAN, DE LA PROFORMA DE NOVIEMBRE
-- ============================================================
-- Fase 0 del plan de RR. HH. y nóminas. La gestoría mandó el 23/11/2026 la
-- proforma de A3NOM de noviembre: su «Código» es el legajo sin los ceros. De
-- los 71 de plantilla propia en alta sin legajo, 57 casaban por nombre y
-- apellidos con un código de la proforma que el ERP no tenía; revisados con su
-- fecha de alta (la gestoría numera según entran, y las fechas siguen el orden
-- de los códigos), se cargan 55. Camilo: «Sí, carga los 57 y corrige los 3».
-- Fuera, para revisarlos a mano: el 2666 propuesto a una segunda ficha que no
-- es la persona, y el 2648, cuyo nombre solo casa a medias y cuya alta no encaja.
--
-- SOLO NÚMEROS DE FICHA Y LEGAJOS: ningún nombre, DNI ni dato de la persona.
-- Se pone solo a quien no tiene legajo y si nadie más lo tiene.
--
-- Y LOS 3 LEGAJOS DEL ERP QUE NO ERAN DE QUIEN DICE LA GESTORÍA:
--   · ficha 239 (en alta): 002613 → 002614, el suyo en la proforma; el 002614
--     lo tenía la ficha 240 (de baja), que se queda sin legajo;
--   · ficha 249 (en alta): 002623 → 002641, el suyo en la proforma (el 2623 es
--     de otra persona que aún no está en el ERP);
--   · ficha 248 (de baja): sin legajo; el 002622 es, según la gestoría, de
--     otra persona que aún no está en el ERP.
-- Cada cambio solo si el legajo sigue siendo el que era (en otra base, nada).
-- Todo queda en el libro de auditoría con su motivo.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/286', true),
       set_config('telecab.usuario_id', '7', true),
       set_config('telecab.libro_accion', 'cambio', true),
       set_config('telecab.libro_motivo', 'Legajos de la proforma de A3NOM de noviembre de 2026 (db/286)', true),
       set_config('telecab.libro_firmado', '1', true);

-- 1. Los tres que no cuadraban. Primero se liberan, luego se ponen.
UPDATE conductor SET legajo = NULL, actualizado_at = now() WHERE id = 240 AND legajo = '002614';
UPDATE conductor SET legajo = NULL, actualizado_at = now() WHERE id = 248 AND legajo = '002622';
UPDATE conductor SET legajo = '002614', actualizado_at = now()
 WHERE id = 239 AND legajo = '002613'
   AND NOT EXISTS (SELECT 1 FROM conductor o WHERE o.legajo = '002614');
UPDATE conductor SET legajo = '002641', actualizado_at = now()
 WHERE id = 249 AND legajo = '002623'
   AND NOT EXISTS (SELECT 1 FROM conductor o WHERE o.legajo = '002641');

-- 2. Los 55 que faltaban.
UPDATE conductor c SET legajo = v.legajo, actualizado_at = now()
  FROM (VALUES
    (375, '002633'),
    (381, '002638'),
    (438, '002654'),
    (446, '002657'),
    (450, '002659'),
    (459, '002662'),
    (275, '002663'),
    (263, '002665'),
    (264, '002666'),
    (262, '002667'),
    (467, '002668'),
    (480, '002672'),
    (474, '002673'),
    (486, '002675'),
    (488, '002677'),
    (494, '002679'),
    (496, '002681'),
    (502, '002682'),
    (506, '002683'),
    (507, '002684'),
    (508, '002686'),
    (290, '002689'),
    (509, '002690'),
    (515, '002691'),
    (511, '002692'),
    (282, '002693'),
    (522, '002695'),
    (526, '002696'),
    (527, '002697'),
    (530, '002699'),
    (546, '002701'),
    (549, '002702'),
    (558, '002703'),
    (563, '002708'),
    (561, '002709'),
    (568, '002712'),
    (570, '002713'),
    (577, '002716'),
    (582, '002720'),
    (583, '002722'),
    (588, '002723'),
    (581, '002726'),
    (580, '002727'),
    (589, '002728'),
    (584, '002729'),
    (585, '002731'),
    (592, '002733'),
    (591, '002734'),
    (593, '002735'),
    (595, '002737'),
    (596, '002738'),
    (597, '002739'),
    (598, '002740'),
    (599, '002741'),
    (336, '002742')
  ) AS v (id, legajo)
 WHERE c.id = v.id AND c.legajo IS NULL
   AND NOT EXISTS (SELECT 1 FROM conductor o WHERE o.legajo = v.legajo);

COMMIT;
