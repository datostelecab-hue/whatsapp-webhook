-- ============================================================
-- 209 · VACACIONES — fuera las PREVISTAS de Caverel de mayo en adelante
-- ============================================================
-- Camilo, 19/10/2026: «nosotros nos hicimos cargo de los trabajadores de mayo
-- en adelante, haz caso a las vacaciones de mayo en adelante solamente ya que
-- Caverel tenía vacaciones previstas, pero las que se hicieron efectivas sí o
-- sí es de las vacaciones de la plantilla de RRHH que me pasaron». Y a la
-- pregunta de si quitarlas del ERP: «Sí, quítalos del ERP».
--
-- Se borran los 9 tramos de vacaciones de mayo en adelante que SOLO venían del
-- Excel de Caverel (su motivo lo dice y no nombra la PLANTILLA TRABAJADORES de
-- RRHH), de las 8 personas que se le enseñaron:
--
--   270 · Carlos Eduardo Gómez Quirama ······ 15/07 → 31/07/2026
--   359 · Elian Fernando Bonilla Ruiz ······· 17/06 → 06/07/2026
--   298 · Jamal Halbouz El Kariraa ·········· 24/05 → 28/05/2026
--   321 · Juan Francisco Ruiz Cano ·········· 01/05 → 03/05/2026
--   301 · Juan Manuel Álvarez Akieme ········ 30/05 → 31/05/2026
--   251 · Kevin Johan Ferreira Montilla ····· 04/05 → 30/05/2026
--   337 · Soufyane El Hadri ················· 28/05 → 30/05/2026
--   336 · Soufyane El Hadri ················· 01/06 → 08/06/2026
--   291 · Aquila Daniel Andrade da Silva ···· 06/05 → 13/05/2026
--
-- Contaban como vacaciones disfrutadas: al quitarlos, el saldo de cada uno sube
-- esos días (las de RRHH, los tickets y las puestas en el ERP se quedan).
--
-- SE SALTA DOS REGLAS DE LA PANTALLA, a propósito y con permiso:
--   · la llave de vacaciones es de Laura Blanco (db/189): lo pide y lo
--     autoriza Camilo, y firma él (usuario 7), como las anulaciones de db/190;
--   · «solo a futuro» (16/10/2026): la pantalla no deja borrar vacaciones que
--     ya pasaron.
--
-- QUEDA EL RASTRO, como cuando la pantalla borra una ausencia: cada tramo se
-- apunta en cambio_campo (campo 'situacion', con sus fechas y su motivo), con
-- origen 'migracion'. Estas personas no tenían otro tramo alrededor: no queda
-- ningún hueco que coser.
--
-- SOLO SI TODO ESTÁ COMO SE VIO: cada fila se borra si sigue existiendo con su
-- persona, sus fechas y su motivo de Caverel. Si alguien la ha tocado desde la
-- pantalla, no se hace nada con ella. Se puede pasar dos veces.
--
-- Quedan SIN TOCAR los de mayo en adelante de tres personas que ya no están
-- (no se preguntaron): Emilio Espinoza (15–22/06), Laurentiu Teodor Meran
-- (20–27/05) y Younes Hammaouda (26/05–03/06).

BEGIN;

WITH fuera (id, conductor_id, desde, hasta) AS (VALUES
  (270, 22, DATE '2026-07-15', DATE '2026-07-31'),
  (359, 18, DATE '2026-06-17', DATE '2026-07-06'),
  (298, 37, DATE '2026-05-24', DATE '2026-05-28'),
  (321,  1, DATE '2026-05-01', DATE '2026-05-03'),
  (301, 29, DATE '2026-05-30', DATE '2026-05-31'),
  (251, 27, DATE '2026-05-04', DATE '2026-05-30'),
  (337, 10, DATE '2026-05-28', DATE '2026-05-30'),
  (336, 10, DATE '2026-06-01', DATE '2026-06-08'),
  (291, 44, DATE '2026-05-06', DATE '2026-05-13')
),
borrados AS (
  DELETE FROM conductor_estado_hist h
   USING fuera f
   WHERE h.id = f.id AND h.conductor_id = f.conductor_id AND h.estado = 'vacaciones'
     AND h.desde = f.desde AND h.hasta = f.hasta
     AND h.motivo ILIKE 'Vacaciones según Caverel%'
     AND h.motivo NOT ILIKE '%PLANTILLA TRABAJADORES%'
  RETURNING h.conductor_id, h.desde, h.hasta, h.motivo
)
INSERT INTO cambio_campo (tabla, registro_id, campo, valor_antes, valor_ahora, usuario_id, origen)
SELECT 'conductor', b.conductor_id, 'situacion',
       'vacaciones ' || to_char(b.desde, 'YYYY-MM-DD') || ' → ' || to_char(b.hasta, 'YYYY-MM-DD') || ' · ' || b.motivo,
       NULL, 7, 'migracion'
  FROM borrados b;

COMMIT;
