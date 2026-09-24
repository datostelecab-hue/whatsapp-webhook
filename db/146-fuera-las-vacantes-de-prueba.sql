-- ============================================================
-- 146 — FUERA LAS VACANTES MAL PUESTAS
-- ============================================================
-- El módulo de vacantes se estrenó sin que nadie supiera bien cómo usarlo, y
-- entre el 10 y el 21/09/2026 se crearon 27 vacantes casi todas a la vez, en
-- tandas de un minuto, que no respondían a ninguna plaza real. Camilo pidió
-- sacarlas el 24/09/2026.
--
-- ── LO QUE SE QUEDA ────────────────────────────────────────────────────────
-- Tres vacantes tienen a una persona CONTRATADA colgando, y esas no se tocan:
--
--   6  · VMTVI5G49   Andree Guillermo Alvarado Cárdenas (candidatura + incorporación)
--   15 · VMUBGM66H   la incorporación del conductor 441
--   20 · VMUBGOEPU   Víctor Jiménez Barbero (candidatura)
--
-- Borrarlas no deshacía la contratación, pero dejaba a esa gente sin el rastro
-- de qué vacante cubrió: `candidatura.vacante_id` se pone a NULL solo, y
-- `candidatura.vacante_ref` e `incorporacion.vacante_id` guardan el CÓDIGO como
-- texto, sin clave foránea, así que se quedarían apuntando a nada.
--
-- ── LA LISTA VA ESCRITA, Y ADEMÁS SE COMPRUEBA ─────────────────────────────
-- Se borran los 24 ids que se revisaron uno a uno, NO "todo lo que no tenga
-- candidato": una regla así se llevaría por delante una vacante buena creada
-- entre hoy y el día que corra esto. Y aun dentro de la lista se excluye
-- cualquiera que para entonces tenga a alguien enlazado, por cualquiera de los
-- tres caminos.
--
-- ── SE PUEDE DESHACER ──────────────────────────────────────────────────────
-- Antes de borrar se copia TODO a tres tablas de archivo: la vacante, sus
-- plazas y los días de cada plaza (las dos últimas se irían en cascada). Para
-- recuperar una basta con devolver sus filas en ese mismo orden.

BEGIN;

CREATE TEMP TABLE _fuera ON COMMIT DROP AS
SELECT v.id
  FROM vacante v
 WHERE v.id IN (5, 10, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24,
                25, 26, 27, 28, 29, 30, 31, 32, 33, 34)
   AND NOT EXISTS (SELECT 1 FROM candidatura c WHERE c.vacante_id = v.id)
   AND NOT EXISTS (SELECT 1 FROM candidatura c WHERE c.vacante_ref = v.codigo)
   AND NOT EXISTS (SELECT 1 FROM incorporacion i WHERE i.vacante_id = v.codigo);

-- ── El archivo, antes de nada ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vacante_archivo_20260924 AS
SELECT v.* FROM vacante v WHERE v.id IN (SELECT id FROM _fuera);

CREATE TABLE IF NOT EXISTS vacante_plaza_archivo_20260924 AS
SELECT p.* FROM vacante_plaza p WHERE p.vacante_id IN (SELECT id FROM _fuera);

CREATE TABLE IF NOT EXISTS vacante_plaza_dia_archivo_20260924 AS
SELECT d.* FROM vacante_plaza_dia d
 WHERE d.vacante_plaza_id IN (SELECT p.id FROM vacante_plaza p
                               WHERE p.vacante_id IN (SELECT id FROM _fuera));

COMMENT ON TABLE vacante_archivo_20260924 IS
  'Copia de las vacantes mal puestas que se borraron el 24/09/2026 (db/146). Sus plazas y dias van en las otras dos tablas _archivo_20260924';

-- ── Y el borrado: las plazas y sus días se van en cascada ──────────────────
DELETE FROM vacante WHERE id IN (SELECT id FROM _fuera);

COMMIT;
