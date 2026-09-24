-- ============================================================
-- 152 — LAS ASIGNACIONES PASADAS QUE EMPEZABAN ANTES DEL ALTA, SIN HORAS
-- ============================================================
-- db/151 arregló las de quien aún no había entrado. Quedaban siete de
-- septiembre que empezaban uno o varios días antes del alta de su persona.
-- Camilo pidió corregirlas SOLO SI esa persona no hizo horas en BOLT esos días:
-- planificada y sin horas, la bitácora y Control la dan por «Ausencia» un día en
-- que todavía no trabajaba aquí. Si hizo horas, se deja: estuvo en la calle.
--
-- Horas en BOLT (viaje + espera) de la jornada operativa del día en que empezaba
-- la asignación a la del alta, medidas el 24/09/2026:
--
--   245  Pablo Molero Peña            1888LTJ   03/09 → alta 04/09   0 h    SE CORRIGE
--   274  Jonatan San Segundo Del Rio  8997LDK   04/09 → alta 05/09   0 h    SE CORRIGE
--   413  Elena Julia Canovas Sanchez  0715MMZ   07/09 → alta 08/09   0 h    SE CORRIGE
--   477  Abdelkader Kourrit           9521MMX   11/09 → alta 12/09   0 h    SE CORRIGE
--   778  Macilon Dos Santos Sousa     0417MMZ   14/09 → alta 22/09   42,6 h se deja
--   754  Macilon Dos Santos Sousa     1212MJY   16/09 → alta 22/09   33,0 h se deja
--   914  Abdelhak Harroun             1096MJY   21/09 → alta 22/09   0,2 h  se deja (12 min conectado)
--
-- Van por su id y con la misma condición que las eligió: si alguna ya no
-- empieza antes de su alta, no se toca. La bitácora solo sella las HORAS de cada
-- día, no el estado, así que esos días dejan de salir como «Ausencia» al leerse.

BEGIN;

UPDATE asignacion a
   SET desde = e.alta
  FROM (SELECT DISTINCT ON (conductor_id) conductor_id, alta
          FROM conductor_periodo_empleo
         WHERE baja IS NULL
         ORDER BY conductor_id, alta DESC) e
 WHERE e.conductor_id = a.conductor_id
   AND a.id IN (245, 274, 413, 477)
   AND a.desde < e.alta
   AND (a.hasta IS NULL OR a.hasta >= e.alta);

COMMIT;
