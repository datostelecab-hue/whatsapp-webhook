-- ============================================================
-- 195 — LAS VACACIONES DE LOS EXCEL DE RRHH, EN EL SISTEMA
-- ============================================================
-- Camilo, 14/10/2026: «revisa los excels de las vacaciones gozadas de los
-- conductores … alinéalos en el sistema, si hay unos que no cuadran me dices».
--
-- Los dos Excel: «vacaciones caverel 2025-2026.xlsx» (hojas 2025 y 2026, hasta
-- el 31/08/2026) y la pestaña VACACIONES de «PLANTILLA TRABAJADORES (7).xlsx»
-- (de finales de julio de 2026 en adelante). Se casaron con las fichas por
-- teléfono (Caverel) o DNI (plantilla) y, si no, por nombre.
--
-- AQUÍ SOLO ENTRA LO QUE NO TIENE DUDA: 121 tramos de vacaciones de 50 personas
-- (79 de 2025, 42 de 2026; 1085 días) que están en los Excel y no en el
-- sistema, caen dentro de un contrato suyo y no pisan nada. Lo que no cuadra
-- (fechas distintas entre los Excel o con el sistema, fechas imposibles,
-- vacaciones dentro de una baja médica, gente sin ficha) NO se toca: va en el
-- informe «Vacaciones RRHH - lo que no cuadra.xlsx» para que RRHH decida.
--
-- Un tramo de Caverel partido por meses (07/08–31/08 y 01/09) entra como uno.
-- Sin usuario: es una carga desde los Excel, y el motivo dice de cuál y de qué
-- celda o fila sale.
--
-- Cada fila entra SOLO si esa persona no tiene nada esos días (ninguna
-- situación), así que aplicarla dos veces no duplica nada, y si algo cambió
-- entre el ensayo y la aplicación, esa fila simplemente no entra.
BEGIN;

WITH v (conductor_id, desde, hasta, motivo) AS (VALUES
  (60, DATE '2026-01-01', DATE '2026-01-04', 'Vacaciones según Caverel (Vacaciones 2025 AR74)'),  -- AGUSTIN CERRO PINILLA · 4 d
  (60, DATE '2026-09-29', DATE '2026-09-29', 'Vacaciones según PLANTILLA TRABAJADORES, pestaña VACACIONES (fila 41)'),  -- AGUSTIN CERRO PINILLA · 1 d
  (57, DATE '2025-11-18', DATE '2025-11-19', 'Vacaciones según Caverel (Vacaciones 2025 AL71)'),  -- ALEX BOLIVAR VILLALVA JACHO · 2 d
  (57, DATE '2026-04-01', DATE '2026-04-06', 'Vacaciones según Caverel (Vacaciones 2026 T78)'),  -- ALEX BOLIVAR VILLALVA JACHO · 6 d
  (12, DATE '2025-02-19', DATE '2025-02-23', 'Vacaciones según Caverel (Vacaciones 2025 K6)'),  -- ANGEL LOPEZ GOMEZ · 5 d
  (12, DATE '2025-08-18', DATE '2025-09-04', 'Vacaciones según Caverel (Vacaciones 2025 AC6 + Vacaciones 2025 AF6)'),  -- ANGEL LOPEZ GOMEZ · 18 d
  (12, DATE '2026-02-01', DATE '2026-02-08', 'Vacaciones según Caverel (Vacaciones 2026 N6)'),  -- ANGEL LOPEZ GOMEZ · 8 d
  (44, DATE '2025-09-16', DATE '2025-09-23', 'Vacaciones según Caverel (Vacaciones 2025 AF63)'),  -- AQUILA DANIEL ANDRADE DA SILVA · 8 d
  (44, DATE '2026-05-06', DATE '2026-05-13', 'Vacaciones según Caverel (Vacaciones 2026 W68)'),  -- AQUILA DANIEL ANDRADE DA SILVA · 8 d
  (43, DATE '2025-10-03', DATE '2025-10-05', 'Vacaciones según Caverel (Vacaciones 2025 AI67)'),  -- BADRI DIN ANDALUSI EL HAKKAOUI · 3 d
  (43, DATE '2025-11-01', DATE '2025-11-02', 'Vacaciones según Caverel (Vacaciones 2025 AL67)'),  -- BADRI DIN ANDALUSI EL HAKKAOUI · 2 d
  (39, DATE '2025-10-22', DATE '2025-10-28', 'Vacaciones según Caverel (Vacaciones 2025 AI60)'),  -- CARLOS ARTURO BORELLI BARRAZA · 7 d
  (39, DATE '2026-02-04', DATE '2026-03-02', 'Vacaciones según Caverel (Vacaciones 2026 N65)'),  -- CARLOS ARTURO BORELLI BARRAZA · 27 d
  (22, DATE '2025-06-15', DATE '2025-06-30', 'Vacaciones según Caverel (Vacaciones 2025 W43)'),  -- CARLOS EDUARDO GOMEZ QUIRAMA · 16 d
  (22, DATE '2026-07-15', DATE '2026-07-31', 'Vacaciones según Caverel (Vacaciones 2026 AC45)'),  -- CARLOS EDUARDO GOMEZ QUIRAMA · 17 d
  (26, DATE '2025-09-03', DATE '2025-09-14', 'Vacaciones según Caverel (Vacaciones 2025 AF34)'),  -- CARLOS ENRIQUE RAMIREZ GARCES · 12 d
  (26, DATE '2026-02-28', DATE '2026-03-01', 'Vacaciones según Caverel (Vacaciones 2026 Q35)'),  -- CARLOS ENRIQUE RAMIREZ GARCES · 2 d
  (18, DATE '2025-03-21', DATE '2025-03-23', 'Vacaciones según Caverel (Vacaciones 2025 N22)'),  -- ELIAN FERNANDO BONILLA RUIZ · 3 d
  (18, DATE '2025-06-23', DATE '2025-06-29', 'Vacaciones según Caverel (Vacaciones 2025 W22)'),  -- ELIAN FERNANDO BONILLA RUIZ · 7 d
  (18, DATE '2025-09-20', DATE '2025-09-30', 'Vacaciones según Caverel (Vacaciones 2025 AF22)'),  -- ELIAN FERNANDO BONILLA RUIZ · 11 d
  (18, DATE '2026-06-17', DATE '2026-07-06', 'Vacaciones según Caverel (Vacaciones 2026 Z23)'),  -- ELIAN FERNANDO BONILLA RUIZ · 20 d
  (14, DATE '2025-08-09', DATE '2025-08-13', 'Vacaciones según Caverel (Vacaciones 2025 AC30)'),  -- EMILIO JACINTO ESPINOZA AGUIRRE · 5 d
  (14, DATE '2026-06-15', DATE '2026-06-22', 'Vacaciones según Caverel (Vacaciones 2026 Z31)'),  -- EMILIO JACINTO ESPINOZA AGUIRRE · 8 d
  (11, DATE '2025-08-14', DATE '2025-08-29', 'Vacaciones según Caverel (Vacaciones 2025 AC55)'),  -- FRANCISCO JAVIER MAGDALENO CRESPO · 16 d
  (11, DATE '2025-12-31', DATE '2026-01-06', 'Vacaciones según Caverel (Vacaciones 2025 AO55 + Vacaciones 2025 AR55)'),  -- FRANCISCO JAVIER MAGDALENO CRESPO · 7 d
  (23, DATE '2025-06-02', DATE '2025-06-13', 'Vacaciones según Caverel (Vacaciones 2025 W39)'),  -- HAMID OUAHHAJ · 12 d
  (23, DATE '2025-11-16', DATE '2025-11-23', 'Vacaciones según Caverel (Vacaciones 2025 AL39)'),  -- HAMID OUAHHAJ · 8 d
  (69, DATE '2026-04-11', DATE '2026-04-18', 'Vacaciones según Caverel (Vacaciones 2026 T137)'),  -- HAMZA CHAOUI · 8 d
  (40, DATE '2025-09-15', DATE '2025-09-18', 'Vacaciones según Caverel (Vacaciones 2025 AF65)'),  -- HAROLD ESMIL TEJEDA MIRANDA · 4 d
  (15, DATE '2025-07-23', DATE '2025-07-28', 'Vacaciones según Caverel (Vacaciones 2025 Z29)'),  -- ISAAC ERNESTO CHECA MONTENEGRO · 6 d
  (15, DATE '2025-09-04', DATE '2025-09-19', 'Vacaciones según Caverel (Vacaciones 2025 AF29)'),  -- ISAAC ERNESTO CHECA MONTENEGRO · 16 d
  (42, DATE '2025-12-25', DATE '2025-12-27', 'Vacaciones según Caverel (Vacaciones 2025 AO73)'),  -- ISAC FERNANDO MUNTEAN · 3 d
  (42, DATE '2026-01-05', DATE '2026-01-15', 'Vacaciones según Caverel (Vacaciones 2025 AR73)'),  -- ISAC FERNANDO MUNTEAN · 11 d
  (62, DATE '2026-01-19', DATE '2026-01-25', 'Vacaciones según Caverel (Vacaciones 2025 AR85)'),  -- IVAN DE PABLO ROMAN · 7 d
  (37, DATE '2025-08-15', DATE '2025-08-23', 'Vacaciones según Caverel (Vacaciones 2025 AC49)'),  -- JAMAL HALBOUZ EL KARIRAA · 9 d
  (37, DATE '2026-01-25', DATE '2026-01-29', 'Vacaciones según Caverel (Vacaciones 2025 AR49)'),  -- JAMAL HALBOUZ EL KARIRAA · 5 d
  (37, DATE '2026-05-24', DATE '2026-05-28', 'Vacaciones según Caverel (Vacaciones 2026 W53)'),  -- JAMAL HALBOUZ EL KARIRAA · 5 d
  (56, DATE '2026-02-02', DATE '2026-02-08', 'Vacaciones según Caverel (Vacaciones 2025 AR87)'),  -- JHONSON CASTRO MATEO · 7 d
  (32, DATE '2025-08-21', DATE '2025-08-26', 'Vacaciones según Caverel (Vacaciones 2025 AC50)'),  -- JOHN JAIME POSADA RESTREPO · 6 d
  (32, DATE '2026-01-02', DATE '2026-01-06', 'Vacaciones según Caverel (Vacaciones 2025 AR50)'),  -- JOHN JAIME POSADA RESTREPO · 5 d
  (30, DATE '2025-05-30', DATE '2025-06-01', 'Vacaciones según Caverel (Vacaciones 2025 T42 + Vacaciones 2025 W42)'),  -- JORGE EDISON GONGORA LOPEZ · 3 d
  (30, DATE '2025-08-03', DATE '2025-08-03', 'Vacaciones según Caverel (Vacaciones 2025 AC42)'),  -- JORGE EDISON GONGORA LOPEZ · 1 d
  (30, DATE '2025-10-04', DATE '2025-10-08', 'Vacaciones según Caverel (Vacaciones 2025 AI42)'),  -- JORGE EDISON GONGORA LOPEZ · 5 d
  (30, DATE '2025-11-22', DATE '2025-11-24', 'Vacaciones según Caverel (Vacaciones 2025 AL42)'),  -- JORGE EDISON GONGORA LOPEZ · 3 d
  (30, DATE '2026-02-06', DATE '2026-02-06', 'Vacaciones según Caverel (Vacaciones 2026 N44)'),  -- JORGE EDISON GONGORA LOPEZ · 1 d
  (63, DATE '2025-11-22', DATE '2025-11-23', 'Vacaciones según Caverel (Vacaciones 2025 AL70)'),  -- JORGE ENRIQUE ARENAS VALENCIA · 2 d
  (63, DATE '2026-02-04', DATE '2026-02-09', 'Vacaciones según Caverel (Vacaciones 2026 N77)'),  -- JORGE ENRIQUE ARENAS VALENCIA · 6 d
  (63, DATE '2026-03-15', DATE '2026-03-22', 'Vacaciones según Caverel (Vacaciones 2026 Q77)'),  -- JORGE ENRIQUE ARENAS VALENCIA · 8 d
  (3, DATE '2025-10-10', DATE '2025-10-13', 'Vacaciones según Caverel (Vacaciones 2025 AI68)'),  -- JORGE HUMBERTO ROMERO GUTIERREZ · 4 d
  (3, DATE '2025-12-22', DATE '2026-01-16', 'Vacaciones según Caverel (Vacaciones 2025 AO68 + Vacaciones 2025 AR68)'),  -- JORGE HUMBERTO ROMERO GUTIERREZ · 26 d
  (50, DATE '2026-02-10', DATE '2026-02-11', 'Vacaciones según Caverel (Vacaciones 2026 N87)'),  -- Jose Alberto Moya Leon MOYA LEON · 2 d
  (50, DATE '2026-04-03', DATE '2026-04-08', 'Vacaciones según Caverel (Vacaciones 2026 Q87)'),  -- Jose Alberto Moya Leon MOYA LEON · 6 d
  (25, DATE '2025-07-20', DATE '2025-07-20', 'Vacaciones según Caverel (Vacaciones 2025 Z33)'),  -- JOSE DAVID MOLINA GARCIA · 1 d
  (25, DATE '2025-10-26', DATE '2025-10-27', 'Vacaciones según Caverel (Vacaciones 2025 AI33)'),  -- JOSE DAVID MOLINA GARCIA · 2 d
  (25, DATE '2025-11-16', DATE '2025-11-25', 'Vacaciones según Caverel (Vacaciones 2025 AL33)'),  -- JOSE DAVID MOLINA GARCIA · 10 d
  (17, DATE '2025-06-02', DATE '2025-06-03', 'Vacaciones según Caverel (Vacaciones 2025 W13)'),  -- JOSE ISRAEL SANCHEZ RAMIREZ · 2 d
  (17, DATE '2025-07-17', DATE '2025-07-30', 'Vacaciones según Caverel (Vacaciones 2025 Z13)'),  -- JOSE ISRAEL SANCHEZ RAMIREZ · 14 d
  (17, DATE '2025-11-15', DATE '2025-11-30', 'Vacaciones según Caverel (Vacaciones 2025 AL13)'),  -- JOSE ISRAEL SANCHEZ RAMIREZ · 16 d
  (21, DATE '2025-07-27', DATE '2025-08-09', 'Vacaciones según Caverel (Vacaciones 2025 Z18 + Vacaciones 2025 AC18)'),  -- JOSE LUIS ARMIJO CAMPOS · 14 d
  (21, DATE '2025-12-04', DATE '2025-12-08', 'Vacaciones según Caverel (Vacaciones 2025 AO18)'),  -- JOSE LUIS ARMIJO CAMPOS · 5 d
  (21, DATE '2026-01-11', DATE '2026-01-11', 'Vacaciones según Caverel (Vacaciones 2025 AR18)'),  -- JOSE LUIS ARMIJO CAMPOS · 1 d
  (1, DATE '2025-02-28', DATE '2025-03-02', 'Vacaciones según Caverel (Vacaciones 2025 K7)'),  -- JUAN FRANCISCO RUIZ CANO · 3 d
  (1, DATE '2025-08-11', DATE '2025-08-31', 'Vacaciones según Caverel (Vacaciones 2025 AC7)'),  -- JUAN FRANCISCO RUIZ CANO · 21 d
  (1, DATE '2026-03-02', DATE '2026-03-09', 'Vacaciones según Caverel (Vacaciones 2026 Q7)'),  -- JUAN FRANCISCO RUIZ CANO · 8 d
  (1, DATE '2026-05-01', DATE '2026-05-03', 'Vacaciones según Caverel (Vacaciones 2026 W7)'),  -- JUAN FRANCISCO RUIZ CANO · 3 d
  (29, DATE '2025-09-10', DATE '2025-09-23', 'Vacaciones según Caverel (Vacaciones 2025 AF45)'),  -- JUAN MANUEL ALVAREZ AKIEME · 14 d
  (29, DATE '2025-11-10', DATE '2025-11-10', 'Vacaciones según Caverel (Vacaciones 2025 AL45)'),  -- JUAN MANUEL ALVAREZ AKIEME · 1 d
  (29, DATE '2025-12-24', DATE '2025-12-25', 'Vacaciones según Caverel (Vacaciones 2025 AO45)'),  -- JUAN MANUEL ALVAREZ AKIEME · 2 d
  (29, DATE '2026-05-30', DATE '2026-05-31', 'Vacaciones según Caverel (Vacaciones 2026 W47)'),  -- JUAN MANUEL ALVAREZ AKIEME · 2 d
  (27, DATE '2025-10-01', DATE '2025-10-15', 'Vacaciones según Caverel (Vacaciones 2025 AI38)'),  -- KEVIN JOHAN FERREIRA MONTILLA · 15 d
  (27, DATE '2026-05-04', DATE '2026-05-30', 'Vacaciones según Caverel (Vacaciones 2026 W40)'),  -- KEVIN JOHAN FERREIRA MONTILLA · 27 d
  (41, DATE '2025-11-05', DATE '2025-11-18', 'Vacaciones según Caverel (Vacaciones 2025 AL56)'),  -- LAURENTIU TEODOR MERAN · 14 d
  (41, DATE '2026-05-20', DATE '2026-05-27', 'Vacaciones según Caverel (Vacaciones 2026 W61)'),  -- LAURENTIU TEODOR MERAN · 8 d
  (7, DATE '2025-10-05', DATE '2025-11-30', 'Vacaciones según Caverel (Vacaciones 2025 AI69 + Vacaciones 2025 AL69)'),  -- LESLIE ANDREA ARBELAEZ VARGAS · 57 d
  (2, DATE '2025-09-01', DATE '2025-09-30', 'Vacaciones según Caverel (Vacaciones 2025 AF23)'),  -- LUIS ALFONSO ALCOCER CHACON · 30 d
  (19, DATE '2025-02-20', DATE '2025-02-25', 'Vacaciones según Caverel (Vacaciones 2025 K12)'),  -- LUIS AREVALO CARRASCO · 6 d
  (19, DATE '2025-03-18', DATE '2025-03-23', 'Vacaciones según Caverel (Vacaciones 2025 N12)'),  -- LUIS AREVALO CARRASCO · 6 d
  (19, DATE '2025-04-09', DATE '2025-04-13', 'Vacaciones según Caverel (Vacaciones 2025 Q12)'),  -- LUIS AREVALO CARRASCO · 5 d
  (19, DATE '2025-05-31', DATE '2025-06-01', 'Vacaciones según Caverel (Vacaciones 2025 T12 + Vacaciones 2025 W12)'),  -- LUIS AREVALO CARRASCO · 2 d
  (19, DATE '2025-12-30', DATE '2025-12-31', 'Vacaciones según Caverel (Vacaciones 2025 AO12)'),  -- LUIS AREVALO CARRASCO · 2 d
  (5, DATE '2025-02-18', DATE '2025-02-28', 'Vacaciones según Caverel (Vacaciones 2025 K5)'),  -- LUIS DAVID SARZOSA GARZON · 11 d
  (5, DATE '2025-04-28', DATE '2025-05-07', 'Vacaciones según Caverel (Vacaciones 2025 Q5 + Vacaciones 2025 T5)'),  -- LUIS DAVID SARZOSA GARZON · 10 d
  (5, DATE '2025-07-03', DATE '2025-07-28', 'Vacaciones según Caverel (Vacaciones 2025 Z5)'),  -- LUIS DAVID SARZOSA GARZON · 26 d
  (8, DATE '2025-08-01', DATE '2025-08-20', 'Vacaciones según Caverel (Vacaciones 2025 AC15)'),  -- MARTHA CECILIA MENESES GONZALEZ · 20 d
  (8, DATE '2025-12-01', DATE '2025-12-10', 'Vacaciones según Caverel (Vacaciones 2025 AO15)'),  -- MARTHA CECILIA MENESES GONZALEZ · 10 d
  (6, DATE '2025-02-18', DATE '2025-02-28', 'Vacaciones según Caverel (Vacaciones 2025 K9)'),  -- MOHAMED ABOULGHAZI · 11 d
  (6, DATE '2025-05-21', DATE '2025-05-27', 'Vacaciones según Caverel (Vacaciones 2025 T9)'),  -- MOHAMED ABOULGHAZI · 7 d
  (6, DATE '2025-07-02', DATE '2025-07-14', 'Vacaciones según Caverel (Vacaciones 2025 Z9)'),  -- MOHAMED ABOULGHAZI · 13 d
  (6, DATE '2025-09-24', DATE '2025-09-29', 'Vacaciones según Caverel (Vacaciones 2025 AF9)'),  -- MOHAMED ABOULGHAZI · 6 d
  (48, DATE '2026-02-18', DATE '2026-02-26', 'Vacaciones según Caverel (Vacaciones 2026 N103)'),  -- MORAD EL OUANSAIDI · 9 d
  (28, DATE '2025-09-07', DATE '2025-09-14', 'Vacaciones según Caverel (Vacaciones 2025 AF61)'),  -- NELSON ALIRIO ONTIVEROS PARADA · 8 d
  (28, DATE '2026-01-02', DATE '2026-01-12', 'Vacaciones según Caverel (Vacaciones 2025 AR61)'),  -- NELSON ALIRIO ONTIVEROS PARADA · 11 d
  (28, DATE '2026-09-07', DATE '2026-09-08', 'Vacaciones según PLANTILLA TRABAJADORES, pestaña VACACIONES (fila 39)'),  -- NELSON ALIRIO ONTIVEROS PARADA · 2 d
  (9, DATE '2025-07-27', DATE '2025-08-10', 'Vacaciones según Caverel (Vacaciones 2025 Z27 + Vacaciones 2025 AC27)'),  -- NELSON JESUS JIMENEZ IZQUIERDO · 15 d
  (9, DATE '2025-11-02', DATE '2025-11-12', 'Vacaciones según Caverel (Vacaciones 2025 AL27)'),  -- NELSON JESUS JIMENEZ IZQUIERDO · 11 d
  (24, DATE '2025-06-10', DATE '2025-06-20', 'Vacaciones según Caverel (Vacaciones 2025 W44)'),  -- OMAR LENIN SUQUILANDA CARRION · 11 d
  (24, DATE '2025-12-23', DATE '2026-01-02', 'Vacaciones según Caverel (Vacaciones 2025 AO44 + Vacaciones 2025 AR44)'),  -- OMAR LENIN SUQUILANDA CARRION · 11 d
  (35, DATE '2025-09-26', DATE '2025-10-01', 'Vacaciones según Caverel (Vacaciones 2025 AF51 + Vacaciones 2025 AI51)'),  -- OSCAR LAZARO LUQUE · 6 d
  (35, DATE '2025-11-09', DATE '2025-11-09', 'Vacaciones según Caverel (Vacaciones 2025 AL51)'),  -- OSCAR LAZARO LUQUE · 1 d
  (33, DATE '2025-09-01', DATE '2025-09-10', 'Vacaciones según Caverel (Vacaciones 2025 AF52)'),  -- PETRUTA OANA STEFAN · 10 d
  (33, DATE '2025-11-27', DATE '2025-12-05', 'Vacaciones según Caverel (Vacaciones 2025 AL52 + Vacaciones 2025 AO52)'),  -- PETRUTA OANA STEFAN · 9 d
  (33, DATE '2026-03-12', DATE '2026-03-17', 'Vacaciones según Caverel (Vacaciones 2026 Q56)'),  -- PETRUTA OANA STEFAN · 6 d
  (4, DATE '2025-10-01', DATE '2025-10-31', 'Vacaciones según Caverel (Vacaciones 2025 AI46)'),  -- RACHID LAKRAA · 31 d
  (4, DATE '2026-03-15', DATE '2026-03-30', 'Vacaciones según Caverel (Vacaciones 2026 Q48)'),  -- RACHID LAKRAA · 16 d
  (53, DATE '2026-03-19', DATE '2026-03-26', 'Vacaciones según Caverel (Vacaciones 2025 AR76)'),  -- SAID AHAJTANE · 8 d
  (10, DATE '2025-06-08', DATE '2025-06-08', 'Vacaciones según Caverel (Vacaciones 2025 W28)'),  -- SOUFYANE EL HADRI · 1 d
  (10, DATE '2025-09-05', DATE '2025-09-30', 'Vacaciones según Caverel (Vacaciones 2025 AF28)'),  -- SOUFYANE EL HADRI · 26 d
  (10, DATE '2025-12-13', DATE '2025-12-17', 'Vacaciones según Caverel (Vacaciones 2025 AO28)'),  -- SOUFYANE EL HADRI · 5 d
  (10, DATE '2026-05-28', DATE '2026-05-30', 'Vacaciones según Caverel (Vacaciones 2026 W29)'),  -- SOUFYANE EL HADRI · 3 d
  (10, DATE '2026-06-01', DATE '2026-06-08', 'Vacaciones según Caverel (Vacaciones 2026 Z29)'),  -- SOUFYANE EL HADRI · 8 d
  (31, DATE '2025-10-01', DATE '2025-10-02', 'Vacaciones según Caverel (Vacaciones 2025 AI53)'),  -- VICTOR ANDRES USECHE CAMPO · 2 d
  (31, DATE '2025-11-03', DATE '2025-11-03', 'Vacaciones según Caverel (Vacaciones 2025 AO53)'),  -- VICTOR ANDRES USECHE CAMPO · 1 d
  (31, DATE '2026-01-18', DATE '2026-01-22', 'Vacaciones según Caverel (Vacaciones 2025 AR53)'),  -- VICTOR ANDRES USECHE CAMPO · 5 d
  (51, DATE '2026-01-03', DATE '2026-01-10', 'Vacaciones según Caverel (Vacaciones 2025 AR84)'),  -- VICTOR RAFAEL REQUENA OBISPO · 8 d
  (38, DATE '2025-08-24', DATE '2025-08-26', 'Vacaciones según Caverel (Vacaciones 2025 AC54)'),  -- VICTOR ROLLON VETAS · 3 d
  (38, DATE '2025-09-07', DATE '2025-09-08', 'Vacaciones según Caverel (Vacaciones 2025 AF54)'),  -- VICTOR ROLLON VETAS · 2 d
  (38, DATE '2025-12-28', DATE '2026-01-01', 'Vacaciones según Caverel (Vacaciones 2025 AO54 + Vacaciones 2025 AR54)'),  -- VICTOR ROLLON VETAS · 5 d
  (38, DATE '2026-02-15', DATE '2026-02-19', 'Vacaciones según Caverel (Vacaciones 2026 N58)'),  -- VICTOR ROLLON VETAS · 5 d
  (38, DATE '2026-03-01', DATE '2026-03-01', 'Vacaciones según Caverel (Vacaciones 2026 Q58)'),  -- VICTOR ROLLON VETAS · 1 d
  (36, DATE '2026-03-02', DATE '2026-03-30', 'Vacaciones según Caverel (Vacaciones 2026 Q63)'),  -- YOUNES HAMMAOUDA · 29 d
  (36, DATE '2026-05-26', DATE '2026-06-03', 'Vacaciones según Caverel (Vacaciones 2026 W63 + Vacaciones 2026 Z63)')  -- YOUNES HAMMAOUDA · 9 d
)
INSERT INTO conductor_estado_hist (conductor_id, estado, desde, hasta, hasta_previsto, motivo)
SELECT v.conductor_id, 'vacaciones', v.desde, v.hasta, v.hasta, v.motivo
  FROM v
  JOIN conductor c ON c.id = v.conductor_id
 WHERE NOT EXISTS (
         SELECT 1 FROM conductor_estado_hist h
          WHERE h.conductor_id = v.conductor_id
            AND h.desde <= v.hasta
            AND COALESCE(h.hasta, 'infinity'::date) >= v.desde);

COMMIT;
