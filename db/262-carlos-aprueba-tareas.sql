-- ============================================================
-- 262 — DIRECCIÓN BARCELONA TAMBIÉN APRUEBA LAS TAREAS
-- ============================================================
-- Camilo, 17/11/2026: «Que Carlos también apruebe tareas». Carlos ocupa el
-- puesto Dirección Barcelona; las funciones vienen del puesto (db/255), como la
-- de Ignacio, que la tiene por Dirección de Operaciones. Desde ahora le llegan
-- las tareas que se piden para otra persona y puede aprobarlas o rechazarlas;
-- las que crea él no esperan a nadie.
--
-- Solo aprobar (tareas_aprueba): repartir los tickets (tareas_asigna) sigue
-- siendo de Dirección de Operaciones. En otra base sin ese puesto, no hace nada.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/262', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente, creado_por)
SELECT p.codigo, 'tareas_aprueba', FALSE, (SELECT id FROM usuario WHERE id = 7)
  FROM puesto p
 WHERE p.codigo = 'direccion_barcelona'
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion x
                    WHERE x.puesto_codigo = p.codigo AND x.funcion = 'tareas_aprueba' AND x.anulado_at IS NULL);

COMMIT;
