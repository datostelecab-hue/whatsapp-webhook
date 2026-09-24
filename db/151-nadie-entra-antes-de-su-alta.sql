-- ============================================================
-- 151 — NADIE ENTRA EN UNA PLAZA ANTES DE SU ALTA
-- ============================================================
-- El 24/09/2026 se colocó a Víctor Jiménez Barbero en el 6663LCY «desde hoy»,
-- y su contrato empieza el 25. El planificador lo pintaba ya de titular y
-- Control lo esperaba ese día y lo daba por «no ha salido» («no llegará,
-- faltan 5,2 h»). Ese mismo día pasó con otros cuatro, todos con el alta el 28.
--
-- El código ya no lo deja pasar (`entraDesde` en planificador.repo.js: la
-- plaza empieza el día del alta). Esto arregla lo que quedó escrito: esas
-- asignaciones pasan a empezar el día de su alta, y hasta entonces el
-- cuadrante las enseña como «→ llega el …».
--
-- SOLO LAS DE QUIEN TODAVÍA NO HA ENTRADO (alta desde el 24/09/2026). Las de
-- antes —hay alguna con un día de diferencia, de principios de mes— ya son
-- historia: moverlas cambiaría la cobertura de días pasados que ya se han
-- mirado y contado.
--
-- Las plazas quedan vacías hasta que llegan: quien las llevaba antes ya se
-- había ido (el 6663LCY de día estaba vacío desde el 20; los del Silvio, desde
-- el 24). No hay a quién alargar.

BEGIN;

UPDATE asignacion a
   SET desde = e.alta
  FROM (SELECT DISTINCT ON (conductor_id) conductor_id, alta
          FROM conductor_periodo_empleo
         WHERE baja IS NULL
         ORDER BY conductor_id, alta DESC) e
 WHERE e.conductor_id = a.conductor_id
   AND a.desde < e.alta
   AND e.alta >= DATE '2026-09-24'
   AND (a.hasta IS NULL OR a.hasta >= e.alta);

COMMIT;
