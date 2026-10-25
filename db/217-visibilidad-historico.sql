-- ============================================================
-- 217 · LA HISTORIA DE HORAS DE VISIBILIDAD, DE ANTES DEL NÚCLEO
-- ============================================================
-- Camilo, 25/10/2026: «en el gráfico que muestras los últimos 15 días, se pueda
-- agrandar, tipo, última semana, últimos 15 días, hace 30 días, 2 meses, 1 año
-- … que muestren cómo van las horas actualmente y cómo hemos crecido».
--
-- El núcleo (fv_tramo) empieza el 01/07/2026, y con él visibilidad_dia: sin
-- esto, «1 año» son cuatro meses y «cómo hemos crecido» no tiene con qué
-- compararse. Aquí van las horas de flota por DÍA NATURAL (00:00 → 24:00 de
-- Madrid) del 01/01 al 30/06/2026.
--
-- POR QUÉ UNA TABLA APARTE Y NO FILAS EN visibilidad_dia: esa tabla es del
-- núcleo. serieMes recalcula del núcleo cualquier día que falte o esté a 0, y
-- capturarDia / backfillMes lo pisan siempre: de un día de junio el núcleo no
-- sabe nada y escribiría un 0 encima. Esta tabla no la recalcula ni la pisa
-- nadie, y el núcleo no la lee. La regla para una serie larga es: un día vale
-- lo de visibilidad_dia si tiene horas y, si no, lo de esta tabla. El CHECK de
-- la fecha es esa misma frontera: lo de esta tabla es de antes del núcleo.
--
-- DE DÓNDE SALE: el historial de cambios de estado de BOLT (getFleetStateLogs)
-- de las dos empresas de Madrid, 63530 y 143626 (la de Barcelona, 329430, no se
-- pidió). Cada trozo bajado se comprobó contra el total de filas que dice BOLT:
-- están enteros. TODOS los coches de esas dos empresas, también los cuatro que
-- ya no están en Vehículos y los diez que hoy son de Barcelona: de julio a
-- septiembre fv_tramo los contaba en Madrid, y entonces rodaban aquí. Filtrar
-- por la flota de HOY le quitaría a la historia los coches que ya no están.
--
-- EL MÉTODO, el de Visibilidad (horasVentana sobre fv_tramo) hecho sobre los
-- apuntes crudos, como el backfill del núcleo: por coche, un tramo por cada
-- racha de situación (fv_estado_bolt), que empieza en el apunte que la abre y
-- acaba en el que la cambia; recortado al día natural de Madrid. viaje + espera
-- son las efectivas (fv_cat_situacion), el descanso va aparte. conductores =
-- cuentas de BOLT distintas con viaje o espera ese día, como visibilidad_dia:
-- en estos meses es lo mismo que personas (salvo una persona con dos cuentas un
-- día de junio), y ningún segundo de una persona cuenta dos veces (medido:
-- 0 h de solape por cuenta, por persona, por teléfono y por matrícula).
--
-- EL ERROR, medido contra julio: los estados de BOLT del 06 al 12/07/2026,
-- contados igual, frente a fv_tramo de esos días con los mismos coches:
-- -0,007 % (-0,3 h de 5089,8 h; el peor día, un 0,8 %, son minutos que
-- un lado da por espera y el otro por descanso). Contra la foto de
-- visibilidad_dia con TODOS los coches de BOLT sale un 2,48 % de más, y es
-- de un solo coche: el 3035LTX rodó en julio (unas 18 h al día) y sus tramos
-- en fv_tramo empiezan el 01/08; a julio de la pantalla le faltan esas horas.
--
-- LO QUE SALE, por mes:
--   2026-01  31 días  29.756 h  (960 h/día, 128 conductores/día)
--   2026-02  28 días  26.845 h  (959 h/día, 128 conductores/día)
--   2026-03  31 días  29.881 h  (964 h/día, 130 conductores/día)
--   2026-04  30 días  31.858 h  (1062 h/día, 142 conductores/día)
--   2026-05  31 días  18.050 h  (582 h/día, 89 conductores/día)
--   2026-06  30 días  17.955 h  (598 h/día, 90 conductores/día)
--
-- Del 06 al 12/05, el 25/05 y del 01 al 04/06 hay días de 100 a 350 h: no es un
-- fallo de descarga. BOLT también tiene muy pocos pedidos esos días (la 143626
-- cae a la décima parte de golpe el 06/05) y los dos historiales cuadran entre
-- sí. Se cargan como son.
--
-- Calculado el 2026-10-25 18:45:08 con «Scripts de análisis/visibilidad-historico/
-- historico.js» (su README cuenta cómo rehacerlo). 181 días. Idempotente: se
-- puede aplicar dos veces.
BEGIN;

CREATE TABLE IF NOT EXISTS visibilidad_dia_historico (
  dia           DATE         PRIMARY KEY,
  viaje_seg     BIGINT       NOT NULL DEFAULT 0,
  espera_seg    BIGINT       NOT NULL DEFAULT 0,
  descanso_seg  BIGINT       NOT NULL DEFAULT 0,
  conductores   INT          NOT NULL DEFAULT 0,
  fuente        VARCHAR(40)  NOT NULL,
  calculado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT visibilidad_dia_historico_antes_del_nucleo CHECK (dia < DATE '2026-07-01')
);

COMMENT ON TABLE visibilidad_dia_historico IS
  'Horas de flota por día natural de Madrid de ANTES del núcleo (antes del 01/07/2026), sacadas del historial de estados de BOLT con la cuenta de Visibilidad. No la recalcula ni la pisa nadie. Para una serie larga: un día vale lo de visibilidad_dia si tiene horas y, si no, lo de aquí (db/217).';
COMMENT ON COLUMN visibilidad_dia_historico.viaje_seg IS 'Segundos en viaje (efectivo), como visibilidad_dia.';
COMMENT ON COLUMN visibilidad_dia_historico.espera_seg IS 'Segundos en espera (efectivo), como visibilidad_dia.';
COMMENT ON COLUMN visibilidad_dia_historico.descanso_seg IS 'Segundos en descanso: no es efectivo, va aparte.';
COMMENT ON COLUMN visibilidad_dia_historico.conductores IS 'Cuentas de BOLT distintas con viaje o espera ese día, como visibilidad_dia.';
COMMENT ON COLUMN visibilidad_dia_historico.fuente IS 'De dónde sale: bolt_estados = historial de cambios de estado de BOLT (getFleetStateLogs).';
COMMENT ON COLUMN visibilidad_dia_historico.calculado_at IS 'Cuándo se calcularon las horas (no cuándo se cargaron).';

INSERT INTO visibilidad_dia_historico (dia, viaje_seg, espera_seg, descanso_seg, conductores, fuente, calculado_at)
SELECT v.dia, v.viaje_seg, v.espera_seg, v.descanso_seg, v.conductores, 'bolt_estados', TIMESTAMPTZ '2026-10-25 18:45:08 Europe/Madrid'
  FROM (VALUES
  (DATE '2026-01-01', 2193899, 387005, 430970, 99),
  (DATE '2026-01-02', 2206005, 878943, 425330, 119),
  (DATE '2026-01-03', 2116526, 1351646, 396469, 124),
  (DATE '2026-01-04', 2339256, 1134348, 439000, 123),
  (DATE '2026-01-05', 2218949, 952982, 384879, 123),
  (DATE '2026-01-06', 2168024, 994898, 330373, 123),
  (DATE '2026-01-07', 2074445, 1173111, 399560, 127),
  (DATE '2026-01-08', 1868059, 1475415, 390696, 124),
  (DATE '2026-01-09', 2274643, 1348531, 509740, 134),
  (DATE '2026-01-10', 2535088, 1408673, 468732, 129),
  (DATE '2026-01-11', 2617991, 1232860, 455500, 131),
  (DATE '2026-01-12', 2528373, 1065563, 441406, 135),
  (DATE '2026-01-13', 2167301, 1084380, 407865, 132),
  (DATE '2026-01-14', 2254844, 1142684, 430700, 135),
  (DATE '2026-01-15', 2379356, 1087229, 341166, 127),
  (DATE '2026-01-16', 2793439, 999540, 460360, 140),
  (DATE '2026-01-17', 2899802, 982048, 504777, 132),
  (DATE '2026-01-18', 2648163, 986437, 496276, 129),
  (DATE '2026-01-19', 2407932, 988806, 416549, 132),
  (DATE '2026-01-20', 2132710, 847151, 400406, 126),
  (DATE '2026-01-21', 2359510, 860610, 373863, 126),
  (DATE '2026-01-22', 2197300, 905340, 263209, 117),
  (DATE '2026-01-23', 2755534, 857547, 411568, 131),
  (DATE '2026-01-24', 2741741, 1114312, 483208, 127),
  (DATE '2026-01-25', 2692700, 1118242, 515945, 131),
  (DATE '2026-01-26', 2225569, 947200, 487047, 129),
  (DATE '2026-01-27', 2294818, 1007017, 391414, 132),
  (DATE '2026-01-28', 2408576, 1065070, 459824, 131),
  (DATE '2026-01-29', 2500826, 980167, 423861, 125),
  (DATE '2026-01-30', 3027909, 777040, 464818, 137),
  (DATE '2026-01-31', 3008399, 929248, 532209, 133),
  (DATE '2026-02-01', 3146328, 643234, 553630, 132),
  (DATE '2026-02-02', 2542872, 537334, 606758, 131),
  (DATE '2026-02-03', 2253513, 976519, 460561, 130),
  (DATE '2026-02-04', 2151700, 929351, 459474, 128),
  (DATE '2026-02-05', 2178206, 876631, 355223, 116),
  (DATE '2026-02-06', 2634220, 813720, 485561, 131),
  (DATE '2026-02-07', 2633439, 1253509, 448525, 126),
  (DATE '2026-02-08', 2676230, 1053813, 504741, 131),
  (DATE '2026-02-09', 2512964, 863939, 518100, 136),
  (DATE '2026-02-10', 2348332, 1030487, 388272, 134),
  (DATE '2026-02-11', 2300346, 1215088, 391681, 133),
  (DATE '2026-02-12', 2134449, 1111231, 421030, 125),
  (DATE '2026-02-13', 2698940, 926770, 463334, 138),
  (DATE '2026-02-14', 2692784, 1233666, 527174, 131),
  (DATE '2026-02-15', 2765853, 1187676, 491551, 135),
  (DATE '2026-02-16', 2481056, 1091790, 455819, 129),
  (DATE '2026-02-17', 2194149, 1155360, 469666, 132),
  (DATE '2026-02-18', 2145728, 1246366, 450453, 131),
  (DATE '2026-02-19', 2097256, 1289456, 408514, 123),
  (DATE '2026-02-20', 2503150, 1148409, 451180, 131),
  (DATE '2026-02-21', 2288187, 1450086, 431297, 124),
  (DATE '2026-02-22', 2531512, 1179032, 406108, 129),
  (DATE '2026-02-23', 2275999, 1099265, 440963, 130),
  (DATE '2026-02-24', 1999267, 1125878, 359322, 127),
  (DATE '2026-02-25', 2005928, 1220886, 364355, 125),
  (DATE '2026-02-26', 2058009, 1078104, 371049, 120),
  (DATE '2026-02-27', 2354555, 972301, 585485, 123),
  (DATE '2026-02-28', 2236853, 1089928, 484210, 115),
  (DATE '2026-03-01', 2386244, 914740, 446141, 118),
  (DATE '2026-03-02', 2162678, 919156, 342223, 121),
  (DATE '2026-03-03', 2052613, 972135, 320632, 123),
  (DATE '2026-03-04', 1932979, 998280, 299029, 122),
  (DATE '2026-03-05', 2105150, 966282, 351706, 118),
  (DATE '2026-03-06', 2545392, 841058, 457337, 124),
  (DATE '2026-03-07', 2466226, 1018857, 453276, 124),
  (DATE '2026-03-08', 2641339, 953348, 501460, 125),
  (DATE '2026-03-09', 2310542, 883436, 392534, 127),
  (DATE '2026-03-10', 2154457, 908066, 396985, 127),
  (DATE '2026-03-11', 2309909, 1020330, 396566, 132),
  (DATE '2026-03-12', 2361002, 1198645, 303324, 131),
  (DATE '2026-03-13', 2719561, 1027147, 429875, 140),
  (DATE '2026-03-14', 2673924, 1239068, 381262, 132),
  (DATE '2026-03-15', 2787280, 1083717, 387318, 137),
  (DATE '2026-03-16', 2392087, 1066379, 458551, 135),
  (DATE '2026-03-17', 2176183, 1124956, 377832, 129),
  (DATE '2026-03-18', 2097683, 1151668, 363664, 129),
  (DATE '2026-03-19', 2251005, 1228828, 350010, 130),
  (DATE '2026-03-20', 2596005, 916901, 409172, 135),
  (DATE '2026-03-21', 2694455, 1048557, 399027, 127),
  (DATE '2026-03-22', 2777201, 848316, 366909, 131),
  (DATE '2026-03-23', 2557246, 922997, 377048, 131),
  (DATE '2026-03-24', 2267477, 1020676, 348947, 134),
  (DATE '2026-03-25', 2165373, 1027103, 304939, 131),
  (DATE '2026-03-26', 2386909, 1014480, 265784, 129),
  (DATE '2026-03-27', 2963803, 1076387, 419009, 144),
  (DATE '2026-03-28', 2766921, 1492673, 441710, 139),
  (DATE '2026-03-29', 2615355, 1075293, 379032, 139),
  (DATE '2026-03-30', 2365004, 1293454, 362830, 134),
  (DATE '2026-03-31', 2375189, 1260268, 433316, 147),
  (DATE '2026-04-01', 2503186, 977918, 470158, 134),
  (DATE '2026-04-02', 2528377, 968791, 418064, 130),
  (DATE '2026-04-03', 2377127, 1157388, 411989, 126),
  (DATE '2026-04-04', 2138387, 1452471, 409134, 128),
  (DATE '2026-04-05', 2359850, 971459, 379152, 122),
  (DATE '2026-04-06', 2374888, 888854, 385359, 123),
  (DATE '2026-04-07', 2308952, 812863, 538085, 126),
  (DATE '2026-04-08', 2477970, 932490, 364040, 133),
  (DATE '2026-04-09', 2424096, 1222965, 349196, 136),
  (DATE '2026-04-10', 2989600, 1044458, 481504, 150),
  (DATE '2026-04-11', 2752235, 1512237, 410797, 145),
  (DATE '2026-04-12', 2911287, 1340639, 478378, 148),
  (DATE '2026-04-13', 2763324, 1146188, 488209, 148),
  (DATE '2026-04-14', 2837839, 1164123, 527169, 155),
  (DATE '2026-04-15', 2603501, 1154443, 413725, 144),
  (DATE '2026-04-16', 2518895, 1281667, 484782, 141),
  (DATE '2026-04-17', 2995831, 1177605, 530577, 152),
  (DATE '2026-04-18', 3033667, 1426328, 439821, 145),
  (DATE '2026-04-19', 2989822, 1222002, 463089, 154),
  (DATE '2026-04-20', 2790624, 1056080, 484463, 152),
  (DATE '2026-04-21', 2648544, 1198849, 449837, 151),
  (DATE '2026-04-22', 2520416, 1187439, 438854, 147),
  (DATE '2026-04-23', 2620950, 1433105, 455719, 146),
  (DATE '2026-04-24', 3072688, 1284450, 492163, 157),
  (DATE '2026-04-25', 2860779, 1404394, 552808, 144),
  (DATE '2026-04-26', 3056751, 1063296, 519613, 151),
  (DATE '2026-04-27', 2588728, 1207307, 440135, 145),
  (DATE '2026-04-28', 2466856, 1309790, 392145, 142),
  (DATE '2026-04-29', 2378971, 1224808, 475373, 151),
  (DATE '2026-04-30', 2575255, 994718, 511066, 138),
  (DATE '2026-05-01', 2736860, 850621, 518338, 139),
  (DATE '2026-05-02', 2448206, 1017383, 546212, 129),
  (DATE '2026-05-03', 2658331, 1077905, 505508, 140),
  (DATE '2026-05-04', 2313785, 961813, 470494, 135),
  (DATE '2026-05-05', 2044866, 1108548, 463098, 136),
  (DATE '2026-05-06', 418360, 442899, 141016, 51),
  (DATE '2026-05-07', 408334, 298286, 53762, 36),
  (DATE '2026-05-08', 467088, 248666, 113986, 37),
  (DATE '2026-05-09', 411685, 182232, 80000, 33),
  (DATE '2026-05-10', 341346, 153956, 55228, 25),
  (DATE '2026-05-11', 251695, 129379, 52122, 32),
  (DATE '2026-05-12', 925534, 321141, 168614, 83),
  (DATE '2026-05-13', 1841939, 969703, 329520, 116),
  (DATE '2026-05-14', 1806681, 851521, 356232, 110),
  (DATE '2026-05-15', 2293905, 934439, 321678, 125),
  (DATE '2026-05-16', 1908265, 1300009, 414080, 118),
  (DATE '2026-05-17', 2046866, 972958, 389218, 118),
  (DATE '2026-05-18', 1875422, 757864, 438583, 116),
  (DATE '2026-05-19', 1841729, 813215, 383662, 114),
  (DATE '2026-05-20', 1491082, 732491, 253708, 100),
  (DATE '2026-05-21', 1584883, 732849, 236289, 88),
  (DATE '2026-05-22', 1736205, 569173, 333316, 93),
  (DATE '2026-05-23', 1626368, 539398, 327018, 84),
  (DATE '2026-05-24', 1272458, 380322, 340617, 74),
  (DATE '2026-05-25', 799385, 353029, 136437, 59),
  (DATE '2026-05-26', 1214030, 551186, 261391, 74),
  (DATE '2026-05-27', 1211143, 424398, 370047, 78),
  (DATE '2026-05-28', 1472285, 348977, 333300, 78),
  (DATE '2026-05-29', 1740490, 285090, 292001, 86),
  (DATE '2026-05-30', 1651065, 326149, 302270, 76),
  (DATE '2026-05-31', 1323552, 180318, 243375, 68),
  (DATE '2026-06-01', 361713, 28909, 63506, 21),
  (DATE '2026-06-02', 307868, 32074, 60714, 14),
  (DATE '2026-06-03', 500317, 87067, 61785, 52),
  (DATE '2026-06-04', 902802, 210613, 179203, 57),
  (DATE '2026-06-05', 1298763, 318754, 259516, 75),
  (DATE '2026-06-06', 1296316, 601054, 229178, 79),
  (DATE '2026-06-07', 1441135, 374403, 241913, 77),
  (DATE '2026-06-08', 1390642, 328547, 187473, 78),
  (DATE '2026-06-09', 1628146, 278729, 197646, 81),
  (DATE '2026-06-10', 1814879, 362159, 281595, 98),
  (DATE '2026-06-11', 1959993, 377649, 395077, 101),
  (DATE '2026-06-12', 2366360, 473065, 332854, 111),
  (DATE '2026-06-13', 2452017, 750360, 300868, 112),
  (DATE '2026-06-14', 2519221, 439743, 327844, 108),
  (DATE '2026-06-15', 1980138, 267004, 268977, 98),
  (DATE '2026-06-16', 1965391, 237475, 322154, 99),
  (DATE '2026-06-17', 1624545, 368980, 288145, 94),
  (DATE '2026-06-18', 1803084, 428142, 357453, 91),
  (DATE '2026-06-19', 2288119, 626516, 251989, 110),
  (DATE '2026-06-20', 2262837, 758333, 365351, 110),
  (DATE '2026-06-21', 2308463, 609731, 342388, 107),
  (DATE '2026-06-22', 1906480, 413778, 374245, 97),
  (DATE '2026-06-23', 1793389, 459734, 319547, 103),
  (DATE '2026-06-24', 1802185, 452307, 261767, 101),
  (DATE '2026-06-25', 1814949, 490952, 286682, 98),
  (DATE '2026-06-26', 2168988, 492281, 363208, 117),
  (DATE '2026-06-27', 2277725, 735091, 360862, 109),
  (DATE '2026-06-28', 2274094, 606268, 372502, 102),
  (DATE '2026-06-29', 1894199, 381485, 278886, 99),
  (DATE '2026-06-30', 1838363, 402661, 325584, 96)
  ) AS v(dia, viaje_seg, espera_seg, descanso_seg, conductores)
ON CONFLICT (dia) DO NOTHING;

COMMIT;
