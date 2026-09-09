-- ============================================================
-- EL NOMBRE CON EL QUE FIGURA EN BOLT
-- ============================================================
-- La ficha dice "BILAL ASHRAF MUHAMMAD" y BOLT dice "Muhammad Bilal Ashraf".
-- Las dos son la misma persona y ninguna está mal: la ficha lleva el nombre del
-- DNI, en el orden del registro civil, y BOLT lleva el que él mismo escribió al
-- darse de alta. El problema es que Tráfico habla todo el día con la app de
-- BOLT, y buscar a alguien por un nombre que la app no usa es perder el tiempo.
--
-- Así que en las pantallas de OPERACIÓN manda el nombre de BOLT. El del DNI no
-- se pierde ni se pisa: sigue en `nombre`/`apellidos`, que es lo que va a un
-- contrato, a una nómina y a un documento oficial, donde poner un apodo sería
-- un problema de verdad.
--
-- Se guarda como columna y no se resuelve con una subconsulta en cada pantalla:
-- son 29 consultas repartidas por 15 ficheros, algunas sobre cientos de filas
-- (el planificador, la cobertura), y meter ahí un `SELECT` por fila se paga.
-- La ingesta ya trae el padrón de BOLT cada 60 minutos; llenar esta columna en
-- la misma pasada no cuesta nada.

BEGIN;

ALTER TABLE conductor ADD COLUMN IF NOT EXISTS nombre_bolt VARCHAR(200);
COMMENT ON COLUMN conductor.nombre_bolt IS
  'Como se llama en BOLT. Lo refresca el padron cada hora. El nombre legal sigue en nombre/apellidos';

-- Relleno inicial con lo que ya hay en el padron. Si alguien tiene varias
-- cuentas, manda la ACTIVA; entre varias activas, la vista mas recientemente.
UPDATE conductor c SET nombre_bolt = x.n
  FROM (
    SELECT DISTINCT ON (e.conductor_id)
           e.conductor_id, btrim(e.externo_nombre) AS n
      FROM conductor_externo e
     WHERE e.sistema = 'bolt' AND e.conductor_id IS NOT NULL
       AND btrim(COALESCE(e.externo_nombre, '')) <> ''
     ORDER BY e.conductor_id, (e.estado_externo = 'active') DESC, e.visto_at DESC
  ) x
 WHERE x.conductor_id = c.id
   AND c.nombre_bolt IS DISTINCT FROM x.n;

COMMIT;
