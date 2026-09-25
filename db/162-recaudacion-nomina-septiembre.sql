-- ============================================================
-- 162 — RECAUDACIÓN: LOS DESCUENTOS DE NÓMINA DE SEPTIEMBRE 2026
-- ============================================================
-- Camilo, 25/09/2026: «aquí te dejo la recaudación de dinero por nómina, deja
-- como responsable a Ignacio». El Excel «Recaudación de efectivo nomina
-- septiembre 2026» trae dos hojas: «Inicial (Desestimado)», que por su nombre
-- NO cuenta, y «Cierre», que es lo que se descuenta: 67 personas,
-- 20777.90 €.
--
-- Cada fila es un movimiento de tipo 'nomina' (caja =, deuda −: el dinero no
-- entra en la caja, se descuenta del sueldo). Lo firma IGNACIO CAFFERATA
-- (usuario 1), que tiene la llave /recaudacion/nomina: es el responsable.
-- Fecha: el día en que se apuntó (25/09/2026); una fecha futura —el día de
-- la nómina— no la acepta la recaudación.
--
-- Cómo se identificó a cada uno: por el nombre de BOLT del Excel (la columna
-- se llama «ID Bolt» pero trae el nombre), quitadas las notas pegadas al final
-- («ya no está», «SIN FICHA»), contra el nombre de BOLT y el nombre de la ficha
-- sin acentos y sin importar el orden. 66 casan con UNA ficha;
-- Christian Munoz De La Guia no tiene ficha y va por su cuenta de BOLT
-- (bolt_uuid), que es como ya sale en el cuadro de la recaudación.
--
-- 52 importes son exactamente lo que el cuadro decía que debían. En 14 el
-- cuadro era MAYOR: cobraron efectivo después del cierre del Excel; esa
-- diferencia les sigue quedando pendiente, que es lo correcto.
--
-- Se hace una sola vez (lo garantiza el registro de migraciones). Si alguno
-- está mal, se ANULA desde la pantalla con su motivo: no se borra.

BEGIN;

INSERT INTO recaudacion_movimiento (conductor_id, bolt_uuid, importe, observacion, fecha, tipo, usuario_id)
SELECT v.conductor_id, v.bolt_uuid, v.importe, v.observacion, DATE '2026-09-25', 'nomina', 1
  FROM (VALUES
  (222, NULL, 1087.95, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Redy Emmeli Pinza Rivadeneira
  (341, NULL, 932.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Victor Exposito Gonzalez
  (359, NULL, 839.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jonatan San Segundo Del Rio
  (263, NULL, 837.60, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- JESUS ANGELICA MELENDEZ BRACAMONTE
  (252, NULL, 799.15, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- David Polo Tena
  (231, NULL, 789.55, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Alfredo Rodriguez
  (90, NULL, 691.25, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Dennis Ismael Escobar Chávez
  (96, NULL, 675.50, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Andres Jose Garrido Aparicio
  (409, NULL, 652.15, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jose Manuel Viera Sulca
  (95, NULL, 644.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Agustin Nieto Cabrera
  (107, NULL, 626.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jose Luis Menendez Moreno
  (305, NULL, 620.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Kyala Hanae
  (344, NULL, 570.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Pablo Molero Peña
  (404, NULL, 549.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Abdelkader Kourrit
  (396, NULL, 497.35, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Rayssa Agatha Cortez Da Silva
  (126, NULL, 487.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Darwin Estib Varela Yaselga
  (423, NULL, 461.10, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Ivan Martinez Martinez
  (121, NULL, 445.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Kevin Eduardo Trejo Rodriguez
  (340, NULL, 442.40, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jorge Aparicio Garcia
  (70, NULL, 439.60, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Oswaldo Antonio Maco Cardenas
  (104, NULL, 428.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Dylan Hernandez Garcia
  (166, NULL, 421.30, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jorge Eduardo Rodriguez Lezcano
  (32, NULL, 421.05, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- John Jaime Posada Restrepo
  (76, NULL, 415.30, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Daniel Castillo Garcia
  (162, NULL, 384.40, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Enrique Sancristobal Edoko (ya no está)
  (221, NULL, 350.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Muhammad Bilal Ashraf
  (87, NULL, 339.30, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Camilo Jaramillo Londoño
  (366, NULL, 338.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Javier Flores Luque (ya no está)
  (137, NULL, 324.85, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Oliver Vasquez Limon
  (432, NULL, 305.65, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Alejandro Rivera Roda
  (253, NULL, 283.10, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Haytam Ibn Taieb Zouitni
  (342, NULL, 263.25, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Ronny Alexander Carvajal Ludeña
  (428, NULL, 254.80, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Pedro-Pablo Gasca Torres
  (356, NULL, 252.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Maria Camila Gomez Medina (ya no está)
  (362, NULL, 246.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Mattia Rea
  (408, NULL, 243.25, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Franklyn De Leon De La Cruz
  (84, NULL, 225.85, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Achraf Hamdoun
  (142, NULL, 207.25, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Miguel Uric Barry Vizcaino
  (199, NULL, 191.10, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- David Lazaro-Carrasco Benitez (ya no está)
  (NULL, '6adb8246-d42a-4ec0-be96-8db9b9afabfd', 145.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · sin ficha en la plantilla (cuenta de BOLT)'),  -- Christian Munoz De La Guia (SIN FICHA)
  (18, NULL, 134.20, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Elian Fernando Bonilla Ruiz
  (431, NULL, 128.40, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Edgard Steven Martinez Patiño
  (378, NULL, 114.25, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Daniel Arenas Martin
  (384, NULL, 110.95, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Francisco Jose Matarranz Hompanera
  (372, NULL, 108.95, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Vicente Manzano Amador
  (207, NULL, 107.10, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jorge Goicoechea Artiles
  (297, NULL, 106.30, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Raul Jimenez Brizuela
  (181, NULL, 96.20, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Santiago Ortiz Luengo
  (113, NULL, 94.30, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Tarik Lajane Aamara
  (151, NULL, 89.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Kevin Steven Galindo Carvajal
  (391, NULL, 88.45, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Elena Julia Canovas Sanchez
  (429, NULL, 74.95, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jonatan Lozano Crespo
  (250, NULL, 66.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Yerson David Peñafiel Belalcazar (ya no está)
  (128, NULL, 60.15, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Juan Carlos Terranova Portilla (ya no está)
  (333, NULL, 47.45, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Natalio Amador Jimenez (ya no está)
  (360, NULL, 39.05, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Danes Villarreal Cornejo
  (413, NULL, 35.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Anthony Adrian Rodriguez Noguera
  (387, NULL, 31.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Edwin Alberto Zuluaga botero
  (249, NULL, 29.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jeisson David Hoyos Calderon
  (255, NULL, 23.20, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Darwin Alexandro Guacollante Chacasaguay
  (370, NULL, 15.40, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Alfonso De Torre Rodriguez (ya no está)
  (436, NULL, 14.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Jose Alberto Polanco Gutierrez
  (373, NULL, 7.85, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Cesar Manzanero Gomez
  (411, NULL, 7.70, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Daniel Kalko Chokan
  (204, NULL, 6.90, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre'),  -- Helmuth Isaac Held
  (331, NULL, 4.00, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre · ya no está en la empresa'),  -- Randis Odalis Tavarez Jose (ya no está)
  (332, NULL, 0.80, 'Descuento de nómina de septiembre 2026 · Excel «Recaudación de efectivo nomina septiembre 2026», hoja Cierre')   -- Israel Alvarado Rivas
  ) AS v(conductor_id, bolt_uuid, importe, observacion);

COMMIT;
