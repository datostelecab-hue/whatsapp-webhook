-- ============================================================
-- 232 · DOCE CUENTAS DE BOLT DE ANTES DE JULIO, A SU FICHA
-- ============================================================
-- Camilo, 06/11/2026: «Sí, enlázalas con la migración».
--
-- Con db/231 las vacaciones cuentan los días laborados de enero a junio por
-- CUENTA de BOLT, y una cuenta sin enlazar no le suma a nadie. Estas doce tienen
-- jornadas de esos meses, no están enlazadas a ninguna ficha y llevan EXACTAMENTE
-- el nombre completo de alguien de plantilla propia (las mismas palabras), y de
-- nadie más:
--   ficha 14  EMILIO JACINTO ESPINOZA AGUIRRE (baja 03/07/2026): «Emilio Jacinto Espinoza Aguirre», deactivated, 126 jornadas de más de 4 h de ene–jun
--   ficha 5   LUIS DAVID SARZOSA GARZON: «Luis David Sarzosa Garzon», active, 51 jornadas de más de 4 h de ene–jun
--   ficha 11  FRANCISCO JAVIER MAGDALENO CRESPO: «Francisco Javier Magdaleno Crespo», deactivated, 48 jornadas de más de 4 h de ene–jun
--   ficha 102 JOSEBA ANDONI ORUETA ZAMALLOA (baja 12/07/2026): «Joseba Andoni Orueta Zamalloa», deactivated, 34 jornadas de más de 4 h de ene–jun
--   ficha 31  VICTOR ANDRES USECHE CAMPO (baja 29/07/2026): «Victor Andres Useche Campo», deactivated, 24 jornadas de más de 4 h de ene–jun
--   ficha 87  CAMILO JARAMILLO LONDOÑO: «Camilo Jaramillo londoño», deactivated, 15 jornadas de más de 4 h de ene–jun
--   ficha 140 ALLER CUEVAS YERAY (baja 11/07/2026): «Yeray Aller Cuevas», deactivated, 6 jornadas de más de 4 h de ene–jun
--   ficha 143 DANIEL LANZA ROMERO (baja 04/09/2026): «Daniel Lanza Romero», deactivated, 6 jornadas de más de 4 h de ene–jun
--   ficha 145 PEREZ FERRERAS NOE (baja 24/07/2026): «Noé Pérez Ferreras», deactivated, 5 jornadas de más de 4 h de ene–jun
--   ficha 146 DOINA MARIN MARTINEZ (baja 05/08/2026): «Doina Marin Martinez», deactivated, 3 jornadas de más de 4 h de ene–jun
--   ficha 147 ESTHER GONZALEZ HALIOUA (baja 31/08/2026): «Esther Gonzalez Halioua», deactivated, 1 jornadas de más de 4 h de ene–jun
--   ficha 157 RANERA GOMEZ NATALIA (baja 12/07/2026): «Natalia Ranera Gómez», deactivated, 1 jornadas de más de 4 h de ene–jun
--
-- Por migración y no desde Plantilla porque once están DESACTIVADAS en BOLT y
-- «Enlazar BOLT» solo ofrece las activas (v_bolt_libres). Es lo mismo que hace
-- aquel botón (cazamiento.repo.enlazar + la línea del historial de la ficha),
-- firmado por Camilo (usuario 7), con origen «migracion».
--
-- LA BITÁCORA. Siete de estas cuentas tienen tramos desde el 01/07 (fv_tramo),
-- y bitacora_horas los selló sin dueño: al enlazarlas, esas horas pasan a ser
-- de su ficha, pero lo sellado no se entera. Plantilla, al enlazar, vuelve a
-- sellar los días de la cuenta (fantasma.rehacer); aquí se le quita el SELLO a
-- esas jornadas (bitacora_sello) y la bitácora las vuelve a calcular y sellar
-- sola la próxima vez que se abra (horasDeLaRejilla: «huecos del pasado»). Las
-- filas de bitacora_horas no se tocan: hasta entonces todo dice lo de antes.
--
-- SEGURO: si una cuenta ya está enlazada a OTRA persona, o la ficha no existe,
-- se para entera y no toca nada. Si ya está enlazada a la misma, se la salta.
-- Idempotente: aplicarla otra vez no hace nada.
BEGIN;

CREATE TEMP TABLE m232 (cuenta_id BIGINT, uuid TEXT, conductor_id BIGINT, nombre_bolt TEXT, nombre TEXT) ON COMMIT DROP;
INSERT INTO m232 VALUES
    (131, '3d1171f0-bb7c-4f20-a1f0-826b00f7a1c0', 14, 'Emilio Jacinto Espinoza Aguirre', 'EMILIO JACINTO ESPINOZA AGUIRRE'),
    (280, 'b5956396-dffd-405b-b7fa-b6adf2d4b992', 5, 'Luis David Sarzosa Garzon', 'LUIS DAVID SARZOSA GARZON'),
    (154, '68f5949c-e630-4a67-b9d2-937ae16f2911', 11, 'Francisco Javier Magdaleno Crespo', 'FRANCISCO JAVIER MAGDALENO CRESPO'),
    (1405, 'bd35a9ab-f5a4-43bf-908a-c7394348487f', 102, 'Joseba Andoni Orueta Zamalloa', 'JOSEBA ANDONI ORUETA ZAMALLOA'),
    (437, '1614a7bf-2ffd-426a-bd79-e369c9591d34', 31, 'Victor Andres Useche Campo', 'VICTOR ANDRES USECHE CAMPO'),
    (65, 'a797e21a-6aa7-49e9-82b9-21f17d2eca7e', 87, 'Camilo Jaramillo londoño', 'CAMILO JARAMILLO LONDOÑO'),
    (449, 'a26218f6-dedc-4c57-bcba-7fe7d338a9d6', 140, 'Yeray Aller Cuevas', 'ALLER CUEVAS YERAY'),
    (98, '79c07b4f-817e-4c0a-91d4-419db2b034da', 143, 'Daniel Lanza Romero', 'DANIEL LANZA ROMERO'),
    (328, '08a4d33d-452a-4973-b398-5d204910b422', 145, 'Noé Pérez Ferreras', 'PEREZ FERRERAS NOE'),
    (114, 'c989b3ae-35e3-4761-bcf3-addfa140fe95', 146, 'Doina Marin Martinez', 'DOINA MARIN MARTINEZ'),
    (140, 'af4c7b1f-8af8-4be7-86f9-1a217acafceb', 147, 'Esther Gonzalez Halioua', 'ESTHER GONZALEZ HALIOUA'),
    (323, 'ad5cc8a3-839d-4f7f-be4f-f7e8a7a5a37f', 157, 'Natalia Ranera Gómez', 'RANERA GOMEZ NATALIA');

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT m.*, ce.id AS hay, ce.conductor_id AS de, c.id AS ficha
      FROM m232 m
      LEFT JOIN conductor_externo ce ON ce.id = m.cuenta_id AND ce.sistema = 'bolt' AND ce.externo_id = m.uuid
      LEFT JOIN conductor c ON c.id = m.conductor_id
  LOOP
    IF r.hay IS NULL THEN
      RAISE EXCEPTION 'db/232: la cuenta % («%») no está en conductor_externo con ese uuid', r.cuenta_id, r.nombre_bolt;
    END IF;
    IF r.ficha IS NULL THEN
      RAISE EXCEPTION 'db/232: no existe la ficha % (%)', r.conductor_id, r.nombre;
    END IF;
    IF r.de IS NOT NULL AND r.de <> r.conductor_id THEN
      RAISE EXCEPTION 'db/232: la cuenta «%» ya está enlazada a la ficha %, no a la % (%): no se toca nada', r.nombre_bolt, r.de, r.conductor_id, r.nombre;
    END IF;
  END LOOP;
END $$;

-- Las jornadas en las que estas cuentas tienen tramos, ANTES de enlazarlas (de
-- 05:00 a 05:00 hasta el 05/10; un margen de un día por cada lado).
CREATE TEMP TABLE m232_dias ON COMMIT DROP AS
SELECT ((min(t.desde) AT TIME ZONE 'Europe/Madrid')::date - 1) AS desde,
       ((max(COALESCE(t.hasta, now())) AT TIME ZONE 'Europe/Madrid')::date + 1) AS hasta
  FROM fv_tramo t
  JOIN m232 m ON m.uuid = t.conductor_uuid
  JOIN conductor_externo ce ON ce.id = m.cuenta_id AND ce.conductor_id IS NULL;

WITH enlazadas AS (
  UPDATE conductor_externo ce
     SET conductor_id = m.conductor_id, enlazado_at = now(), enlazado_por = 7, origen_enlace = 'migracion'
    FROM m232 m
   WHERE ce.id = m.cuenta_id AND ce.sistema = 'bolt' AND ce.conductor_id IS NULL
  RETURNING ce.conductor_id, ce.externo_id
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', conductor_id, 'cuenta_bolt', NULL, externo_id, 7, 'migracion' FROM enlazadas;

DELETE FROM bitacora_sello s
 USING m232_dias d
 WHERE d.desde IS NOT NULL AND s.dia_operativo BETWEEN d.desde AND d.hasta;

COMMIT;
