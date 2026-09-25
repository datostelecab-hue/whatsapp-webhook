-- ============================================================
-- 160 — LA INGESTA APUNTA TAMBIÉN LAS PASADAS DEL FORMULARIO
-- ============================================================
-- La lectura del Formulario de tickets («Operaciones 1.0») es una tarea de la
-- ingesta desde el 15/09/2026, pero NUNCA llegó a correr: quedó escrita DENTRO
-- de la tarea de Mapon por una llave mal cerrada, y la sostenía un cron aparte
-- cada dos horas. Al ponerla en su sitio (25/09/2026) hay que poder apuntar sus
-- pasadas: la tabla solo admitía 'bolt' y 'mapon', y una pasada que no se puede
-- apuntar cuenta como fallida —y una tarea sin acierto apuntado se repite en
-- cada latido, contra Google, cada minuto—.

BEGIN;

ALTER TABLE ingesta_ejecucion DROP CONSTRAINT IF EXISTS ck_ingesta_fuente;
ALTER TABLE ingesta_ejecucion ADD CONSTRAINT ck_ingesta_fuente
  CHECK (fuente IN ('bolt', 'mapon', 'formulario'));

COMMIT;
