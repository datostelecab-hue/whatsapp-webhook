-- ============================================================
-- 154 — LA PLANTILLA DE LA ETT, CUADRADA CON LA LISTA DE LA ETT
-- ============================================================
-- El 24/09/2026 la ETT (GiGroup) mandó su lista: 74 personas con NIF y fecha
-- de alta. Cruzada por NIF (y por nombre las que no tenían NIF en el sistema):
-- 58 cuadraban. Esto arregla el resto, con una regla que puso Camilo antes para
-- lo mismo: LA FECHA SOLO SE MUEVE SI ESA PERSONA NO HIZO HORAS EN BOLT ANTES DE
-- LA FECHA NUEVA. Si las hizo, moverla escondería en la bitácora días que sí
-- trabajó; esos se quedan como están y se le preguntan a la ETT:
--
--   #378 Daniel Arenas Martín        sistema 31/08 · ETT 01/09 · 8,5 h el 31/08
--   #321 Michael Guacollante         sistema 14/08 · ETT 14/09 · 118 h entre el 14/08 y el 13/09
--   #417 Fausto Fernández Radio      sistema 15/09 · ETT 18/09 · 8,1 h el 17/09
--   #435 Antonio Gabriel Zavada      sistema 18/09 · ETT 22/09 · 6,3 h la noche del 21 al 22
--
-- Cada cambio va por id Y con la condición que lo eligió (el tipo, la fecha o
-- el NIF de antes): si alguien lo arregló entre medias, no se toca.

BEGIN;

-- ── 1. De plantilla propia a ETT ────────────────────────────────────────────
-- Estaban en la lista de la ETT y el sistema los tenía como propia. Pedro Masó
-- tuvo un periodo de ETT (20/08 → 14/09) y volvió el 23/09: ese segundo periodo
-- también es de la ETT.
UPDATE conductor_periodo_empleo p
   SET tipo = 'ett', ett_nombre = 'GiGroup'
  FROM conductor c
 WHERE c.id = p.conductor_id
   AND p.baja IS NULL AND p.tipo = 'propia'
   AND (c.id, upper(btrim(c.dni_nie))) IN ((390, '52012670X'),   -- Perla Brigitte Pilatasig Toalombo
                                            (359, '49066510N'),   -- Jonathan San Segundo del Río
                                            (391, '46852134F'),   -- Elena Julia Cánovas Sánchez
                                            (382, '00698453N'));  -- Pedro Masó Postigo

-- Sus candidaturas vinieron por la bolsa de la ETT y no decían el tipo.
UPDATE candidatura SET tipo_contrato = 'ETT'
 WHERE conductor_id IN (391, 359) AND canal = 'bolsa_ett' AND tipo_contrato IS NULL;

-- El único periodo con la ETT escrita en minúsculas (Raúl Briz).
UPDATE conductor_periodo_empleo SET ett_nombre = 'GiGroup' WHERE id = 424 AND ett_nombre = 'gigroup';

-- ── 2. Las fechas de alta, las de la ETT (sin horas antes) ──────────────────
WITH cambio(conductor_id, antes, ahora) AS (VALUES
  (423, DATE '2026-09-15', DATE '2026-09-16'),   -- Iván Martínez Martínez
  (413, DATE '2026-09-16', DATE '2026-09-17'),   -- Anthony Adrián Rodríguez Noguera
  (428, DATE '2026-09-16', DATE '2026-09-18'),   -- Pedro Pablo Gasca Torres
  (436, DATE '2026-09-18', DATE '2026-09-21'),   -- José Alberto Polanco Gutiérrez
  (434, DATE '2026-09-18', DATE '2026-09-21'),   -- Francisco Juan Gómez Zamora
  (439, DATE '2026-09-22', DATE '2026-09-25'))   -- Daniel Heredia García
UPDATE conductor_periodo_empleo p
   SET alta = x.ahora
  FROM cambio x
 WHERE p.conductor_id = x.conductor_id AND p.baja IS NULL AND p.alta = x.antes
   AND NOT EXISTS (SELECT 1 FROM bitacora_horas h
                    WHERE h.conductor_id = p.conductor_id AND h.horas_seg > 0
                      AND h.dia_operativo >= x.antes AND h.dia_operativo < x.ahora);

-- Y sus plazas empiezan el día del alta, como en db/151: si no, el cuadrante los
-- pone de titulares antes de entrar y Control los da por «Ausencia».
UPDATE asignacion a
   SET desde = p.alta
  FROM conductor_periodo_empleo p
 WHERE p.conductor_id = a.conductor_id AND p.baja IS NULL
   AND a.conductor_id IN (423, 413, 428, 436, 434, 439)
   AND a.desde < p.alta
   AND (a.hasta IS NULL OR a.hasta >= p.alta);

-- La de un solo día ANTES del alta no tiene a dónde moverse: Francisco Gómez
-- Zamora estaba puesto el 18/09 en la plaza 382, y entró el 21. La función de
-- cobertura no mira `retirada_at`, así que retirarla no bastaría: se borra.
DELETE FROM asignacion a
 USING conductor_periodo_empleo p
 WHERE a.id = 865 AND p.conductor_id = a.conductor_id AND p.baja IS NULL
   AND a.hasta IS NOT NULL AND a.hasta < p.alta;

-- ── 3. Los NIF que faltaban, de la lista de la ETT ──────────────────────────
-- Entraron por la alta rápida de la bolsa, sin NIF. Solo si sigue vacío.
UPDATE conductor c SET dni_nie = x.nif, dni_tipo = x.tipo
  FROM (VALUES (430, '50339032J', 'DNI'),    -- Israel Muñoz Maya
               (434, '02618152Q', 'DNI'),    -- Francisco Juan Gómez Zamora
               (439, '55127876G', 'DNI'),    -- Daniel Heredia García
               (442, '35714936F', 'DNI'))    -- Alfonso Vidal Feliz Jiménez
       AS x(id, nif, tipo)
 WHERE c.id = x.id AND c.dni_nie IS NULL;

-- Antonio Gabriel Zavada tenía un número que no es un NIF español (061396114,
-- el de su documento de fuera). La ETT lo tiene con su NIE. El de antes se
-- queda apuntado en observaciones.
UPDATE conductor
   SET dni_nie = 'Y1019261F', dni_tipo = 'NIE',
       observaciones = concat_ws(E'\n', NULLIF(observaciones, ''),
         'Documento anterior en el sistema: 061396114. NIE de la lista de la ETT (24/09/2026).')
 WHERE id = 435 AND dni_nie = '061396114';

-- ── 4. Dos nombres mal escritos, que la ETT y BOLT escriben igual ───────────
UPDATE conductor SET nombre = 'Daniel Heredia Garcia'
 WHERE id = 439 AND nombre = 'Daniel Garcia Heredia';          -- los apellidos, al revés
UPDATE conductor SET nombre = 'Rayssa Agatha Cortez Da Silva'
 WHERE id = 396 AND nombre = 'Rayssa Agatha Cortez De Silva';  -- «Da», no «De»

COMMIT;
