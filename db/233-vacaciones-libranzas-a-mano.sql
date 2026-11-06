-- ============================================================
-- 233 — LOS DOS DÍAS QUE LIBRA EN SUS VACACIONES, A MANO
-- ============================================================
-- Camilo, 06/11/2026: «En el simulador debe de decir los días que libra pero A
-- MANO, porque por ejemplo Angel Lopez Gomez descansa según el planificador solo
-- un día, pero le tenemos que saltar dos días los cuales lo elegirá Laura. Sí o
-- sí tienen que ser dos días obligatoriamente; cuando vaya a colocar vacaciones
-- en la situación de la plantilla o por tickets, debe de poner los días que debe
-- de librar según las vacaciones, pero eso sí, solo es por el periodo de
-- vacaciones: cuando vuelva debe de tener de nuevo los días de libranza que le
-- pone el planificador».
--
-- Así que unas vacaciones llevan SUS dos días de libranza (1 = lunes … 7 =
-- domingo, como EXTRACT(ISODOW)): esos días de la semana, dentro del tramo, no
-- cuentan como vacaciones; los demás sí. Solo valen para ese tramo: el
-- planificador no se toca y, al volver, manda otra vez lo suyo (vehiculo_descanso,
-- asignacion_dia).
--
-- Las vacaciones de antes de esto no los tienen (NULL) y siguen contando con las
-- libranzas del planificador (modules/Vacaciones/libranzas.js). Las nuevas los
-- llevan siempre: lo exige la aplicación al ponerlas (Plantilla y Ticketera), y
-- aquí la base solo admite dos días distintos y solo en unas vacaciones.

BEGIN;

ALTER TABLE conductor_estado_hist ADD COLUMN IF NOT EXISTS libra_dias SMALLINT[];

ALTER TABLE conductor_estado_hist DROP CONSTRAINT IF EXISTS ck_estado_libra_dias;
ALTER TABLE conductor_estado_hist ADD CONSTRAINT ck_estado_libra_dias CHECK (
  libra_dias IS NULL OR (
    estado = 'vacaciones'
    AND cardinality(libra_dias) = 2
    AND libra_dias[1] <> libra_dias[2]
    AND libra_dias <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ));

COMMENT ON COLUMN conductor_estado_hist.libra_dias IS
  'Solo en vacaciones (db/233): los DOS días de la semana que libra durante ese tramo (1 = lunes … 7 = domingo), elegidos a mano por quien las aprueba. Esos días no cuentan como vacaciones. NULL en las de antes: cuentan con las libranzas del planificador';

COMMIT;
