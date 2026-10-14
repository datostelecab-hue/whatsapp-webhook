-- ============================================================
-- 200 — LAS FECHAS DE ALTA Y DE BAJA, LAS DE RRHH
-- ============================================================
-- Camilo, 14/10/2026: «APEZTEGUIA RODRIGUEZ, ALVARO tiene como fecha de alta el
-- 04/09/2026 pero en la plantilla … sale como inicio de contrato el 10/04/2026,
-- verifica a todos y corrige, ya que este excel es el definitivo que tengo de
-- RRHH».
--
-- El Excel es «PLANTILLA TRABAJADORES (7).xlsx», pestaña PLANTILLA: la
-- exportación de nóminas, una fila por persona, con «Inicio Contrato»
-- (columna AK), «Fecha Ingreso», «Fecha Baja» y «Fecha Antigüedad». Se cruzó por
-- DNI con los contratos del sistema (y con la fecha de alta de Caverel).
--
-- LO QUE SE CORRIGE, y por qué:
--
--   1. Álvaro Apezteguía: la carga inicial (03/09) convirtió una «Suspensión de
--      empleo y sueldo» en una baja con la fecha de relleno del 04/09, y ese día
--      se le abrió un contrato nuevo. Para RRHH es un solo contrato desde el
--      10/04/2026. Se queda el contrato abierto (es al que apunta su ficha del
--      convenio), con el 10/04, y se borra el cerrado.
--      Lo mismo con otros dos contratos partidos en dos el mismo día, que para
--      RRHH son uno: Samuel Pereira (17/10/2025, cortado el 04/09 «A consultar
--      con RRHH»; queda un contrato hasta su baja del 17/09) y Abdeslam Rais
--      (20/08/2026, cortado el 09/10 y vuelto a abrir ese día; queda uno hasta
--      su baja del 13/10).
--   2. Jorge Eduardo Rodríguez Lezcano: su segundo contrato empieza el 29/07/2026
--      según RRHH (el sistema decía 09/07). Antigüedad, la misma.
--   3. Edwin Alberto Zuluaga Botero: alta el 06/08/2026 (el sistema decía 03/08).
--   4. Jorge Humberto Romero Gutiérrez: alta el 31/08/2023, el inicio de contrato
--      de RRHH (Caverel dice lo mismo). El sistema tenía su fecha de ingreso,
--      26/06/2025. Decidido por Camilo.
--   5. José Miguel Cañas del Olmo: alta el 16/08/2024, el inicio de contrato de
--      RRHH. El sistema tenía su fecha de ingreso, 25/07/2026. Decidido por Camilo.
--   6. Seis bajas con otra fecha. Cinco tenían el 04/09 de relleno de la carga
--      inicial; RRHH da la de verdad. La sexta, Jorge Luis Ferreyra, el 16/08 en
--      vez del 18/08.
--   7. El DNI de cuatro fichas que no lo tenían, o lo tenían con un cero de más
--      delante. Sin DNI, una ficha no se puede cruzar con nada.
--
-- Con cada fecha de contrato se mueve la de su ficha del convenio (`contrato`),
-- que arranca y acaba con él. Todo queda en el historial de cambios de cada
-- ficha. Cada cambio se hace SOLO si los datos siguen como se vieron el 14/10;
-- si no, ese no se toca. Aplicarla dos veces no cambia nada.
--
-- Lo que NO se toca (decidido o a falta de decidir), en «Altas RRHH - lo que no
-- cuadra.xlsx»: las altas de la pestaña ETT (valen las de GiGroup, decidido por
-- Camilo), y 39 personas a las que el sistema da de baja y la exportación de
-- nóminas no (va por detrás: no tiene las bajas recientes ni las altas desde
-- mediados de septiembre).
BEGIN;

-- 1. Apezteguía (ficha 92): un solo contrato desde el 10/04/2026.
DELETE FROM conductor_periodo_empleo
 WHERE id = 92 AND conductor_id = 92 AND tipo = 'propia'
   AND alta = DATE '2026-04-10' AND baja = DATE '2026-09-04'
   AND EXISTS (SELECT 1 FROM conductor_periodo_empleo
                WHERE id = 388 AND conductor_id = 92 AND alta = DATE '2026-09-04' AND baja IS NULL);

WITH c AS (
  UPDATE conductor_periodo_empleo SET alta = DATE '2026-04-10'
   WHERE id = 388 AND conductor_id = 92 AND alta = DATE '2026-09-04' AND baja IS NULL
     AND NOT EXISTS (SELECT 1 FROM conductor_periodo_empleo WHERE id = 92)
  RETURNING id, conductor_id
), k AS (
  UPDATE contrato SET desde = DATE '2026-04-10'
   WHERE periodo_empleo_id = 388 AND desde = DATE '2026-09-04' AND EXISTS (SELECT 1 FROM c)
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'contrato',
       'Propia del 10/04/2026 al 04/09/2026 (baja de la carga inicial: «Suspensión empleo y sueldo») y otra desde el 04/09/2026',
       'Un solo contrato propio desde el 10/04/2026, como dice RRHH (db/200)', 7, 'migracion'
  FROM c;

-- 1b. Samuel Pereira (ficha 58): un contrato del 17/10/2025 al 17/09/2026.
DELETE FROM conductor_periodo_empleo
 WHERE id = 58 AND conductor_id = 58 AND tipo = 'propia'
   AND alta = DATE '2025-10-17' AND baja = DATE '2026-09-04'
   AND EXISTS (SELECT 1 FROM conductor_periodo_empleo
                WHERE id = 385 AND conductor_id = 58 AND alta = DATE '2026-09-04' AND baja = DATE '2026-09-17');

WITH c AS (
  UPDATE conductor_periodo_empleo SET alta = DATE '2025-10-17'
   WHERE id = 385 AND conductor_id = 58 AND alta = DATE '2026-09-04' AND baja = DATE '2026-09-17'
     AND NOT EXISTS (SELECT 1 FROM conductor_periodo_empleo WHERE id = 58)
  RETURNING id, conductor_id
), k AS (
  UPDATE contrato SET desde = DATE '2025-10-17'
   WHERE periodo_empleo_id = 385 AND desde = DATE '2026-09-04' AND EXISTS (SELECT 1 FROM c)
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'contrato',
       'Propia del 17/10/2025 al 04/09/2026 (baja de la carga inicial: «A consultar con RRHH») y otra del 04/09 al 17/09/2026',
       'Un solo contrato propio del 17/10/2025 al 17/09/2026, como dice RRHH (db/200)', 7, 'migracion'
  FROM c;

-- 1c. Abdeslam Rais (ficha 240): un contrato del 20/08/2026 al 13/10/2026.
WITH b AS (
  DELETE FROM conductor_periodo_empleo
   WHERE id = 464 AND conductor_id = 240 AND tipo = 'propia'
     AND alta = DATE '2026-10-09' AND baja = DATE '2026-10-13'
     AND EXISTS (SELECT 1 FROM conductor_periodo_empleo
                  WHERE id = 240 AND conductor_id = 240 AND alta = DATE '2026-08-20' AND baja = DATE '2026-10-09')
  RETURNING motivo_baja
), c AS (
  UPDATE conductor_periodo_empleo e SET baja = DATE '2026-10-13', motivo_baja = b.motivo_baja
    FROM b
   WHERE e.id = 240 AND e.conductor_id = 240 AND e.baja = DATE '2026-10-09'
  RETURNING e.conductor_id
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'contrato',
       'Propia del 20/08 al 09/10/2026 y otra del 09/10 al 13/10/2026',
       'Un solo contrato propio del 20/08 al 13/10/2026, como dice RRHH (db/200)', 7, 'migracion'
  FROM c;

-- 2-5. La fecha de alta del contrato abierto.
WITH v (pid, cid, antes, ahora, antig_antes, antig_ahora, nota) AS (VALUES
    (379::bigint, 166::bigint, DATE '2026-07-09', DATE '2026-07-29', DATE '2026-07-03', DATE '2026-07-29',
     'su segundo contrato empieza el 29/07/2026 según RRHH'),
    (381::bigint, 387::bigint, DATE '2026-08-03', DATE '2026-08-06', NULL::date, NULL::date,
     'alta el 06/08/2026 según RRHH'),
    (3::bigint,   3::bigint,   DATE '2025-06-26', DATE '2023-08-31', DATE '2023-08-31', DATE '2023-08-31',
     'el inicio de contrato de RRHH (y de Caverel); 26/06/2025 es su fecha de ingreso'),
    (13::bigint,  13::bigint,  DATE '2026-07-25', DATE '2024-08-16', DATE '2024-08-13', DATE '2024-08-13',
     'el inicio de contrato de RRHH; 25/07/2026 es su fecha de ingreso')
), c AS (
  UPDATE conductor_periodo_empleo e
     SET alta = v.ahora, fecha_antiguedad = v.antig_ahora
    FROM v
   WHERE e.id = v.pid AND e.conductor_id = v.cid AND e.baja IS NULL AND e.tipo = 'propia'
     AND e.alta = v.antes AND e.fecha_antiguedad IS NOT DISTINCT FROM v.antig_antes
     AND (e.fin_periodo_prueba IS NULL OR e.fin_periodo_prueba >= v.ahora)
  RETURNING e.id, e.conductor_id, v.antes, v.ahora, v.nota
), k AS (
  UPDATE contrato t SET desde = c.ahora
    FROM c
   WHERE t.periodo_empleo_id = c.id AND t.desde = c.antes
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'alta', to_char(antes, 'DD/MM/YYYY'),
       to_char(ahora, 'DD/MM/YYYY') || ' (' || nota || '; db/200)', 7, 'migracion'
  FROM c;

-- 6. Las bajas con otra fecha.
WITH v (pid, cid, antes, ahora) AS (VALUES
    (103::bigint, 103::bigint, DATE '2026-08-18', DATE '2026-08-16'),
    (106::bigint, 106::bigint, DATE '2026-09-04', DATE '2026-08-14'),
    (203::bigint, 203::bigint, DATE '2026-09-04', DATE '2026-09-15'),
    (234::bigint, 234::bigint, DATE '2026-09-04', DATE '2026-08-13'),
    (246::bigint, 246::bigint, DATE '2026-09-04', DATE '2026-09-02'),
    (250::bigint, 250::bigint, DATE '2026-09-04', DATE '2026-09-02')
), c AS (
  UPDATE conductor_periodo_empleo e SET baja = v.ahora
    FROM v
   WHERE e.id = v.pid AND e.conductor_id = v.cid AND e.tipo = 'propia' AND e.baja = v.antes
     AND v.ahora >= e.alta
     AND NOT EXISTS (SELECT 1 FROM conductor_periodo_empleo o
                      WHERE o.conductor_id = e.conductor_id AND o.id <> e.id AND o.alta <= v.ahora AND o.alta > e.alta)
  RETURNING e.id, e.conductor_id, v.antes, v.ahora
), k AS (
  UPDATE contrato t SET hasta = c.ahora
    FROM c
   WHERE t.periodo_empleo_id = c.id AND t.hasta = c.antes
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'baja', to_char(antes, 'DD/MM/YYYY'),
       to_char(ahora, 'DD/MM/YYYY') || ' (la de RRHH; db/200)', 7, 'migracion'
  FROM c;

-- 7. El DNI que faltaba (o con un cero de más), si nadie más lo tiene.
WITH v (cid, antes, ahora) AS (VALUES
    (244::bigint, '052019114Z', '52019114Z'),
    (365::bigint, NULL,         '50583621C'),
    (375::bigint, NULL,         '52114538B'),
    (387::bigint, NULL,         'X2849240T')
), c AS (
  UPDATE conductor k SET dni_nie = v.ahora
    FROM v
   WHERE k.id = v.cid AND k.dni_nie IS NOT DISTINCT FROM v.antes
     AND NOT EXISTS (SELECT 1 FROM conductor o WHERE o.id <> k.id AND upper(btrim(o.dni_nie)) = v.ahora)
  RETURNING k.id, v.antes, v.ahora
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', id, 'dni_nie', antes, ahora || ' (el de RRHH; db/200)', 7, 'migracion'
  FROM c;

COMMIT;
