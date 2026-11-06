-- ============================================================
-- 235 — BARCELONA: UNA PLAZA DE CORRETURNOS NO PASA DEL PERIODO CON CT DE SU COCHE
-- ============================================================
-- El arreglo de un fallo de db/234 (revisión del 06/11/2026, hallazgo 0).
--
-- db/234 dejaba entrar a alguien de CT si el coche llevaba CT EL DÍA QUE
-- EMPIEZA. Pero un coche puede tener ya escrito que se le quita el CT más
-- adelante (sede_coche_ct con `hasta`), y entonces una plaza de CT abierta, sin
-- fin, seguía viva después: en un coche sin CT, donde la pantalla pinta el aviso
-- «Este coche no tiene correturnos…» en vez de la plaza (no se podía vaciar), y
-- el día que se le reactivaba el CT la persona volvía sola, sin que nadie la
-- pusiera. Lo vimos en la copia local: se le quita el CT al 0970LJJ desde el
-- 09/11, se pone el CT de noche del cuadrante desde el 06/11, y el 23/11, al
-- reactivarlo, Miguel aparece de CT de noche trabajando.
--
-- El servicio ya no lo escribe así (barcelona.service.asignar y ctDelCuadrante
-- ponen `hasta` = el último día con CT del coche). Esto es la red de debajo,
-- como en Madrid: venga de donde venga, la plaza de CT ENTERA (de `desde` a
-- `hasta`) tiene que caber en un periodo con CT del coche.
--
--   · Acortar una plaza de CT vale siempre (cerrarla la víspera, quitar el CT
--     del coche): sin eso no se podría cerrar una fila que ya estuviera mal.
--   · El disparador salta también al cambiar `hasta`: alargar una plaza más
--     allá del periodo, o dejarla sin fin, tampoco entra.
--   · Las plazas que ya estuvieran mal se recortan aquí, al último día del
--     periodo con CT en el que empiezan. En producción no hay ninguna (db/234
--     aún no está aplicada allí); en la copia local, las que se hubieran
--     colado. Es un acortamiento, así que el disparador nuevo lo deja pasar.
--
-- No toca db/234 (ya aplicada en la copia local): la función y el disparador se
-- sustituyen aquí (CREATE OR REPLACE / DROP … IF EXISTS), y se puede pasar dos
-- veces.

BEGIN;

CREATE OR REPLACE FUNCTION tg_sede_asignacion_ct() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_hasta date;
BEGIN
  IF NEW.rol <> 'ct' THEN
    RETURN NEW;
  END IF;
  -- ACORTAR SIEMPRE VALE: la misma plaza, que empieza el mismo día o después y
  -- acaba antes (o pasa a tener fin). Es lo que hacen cerrar la víspera y quitar
  -- el CT del coche, y lo que arregla una fila que ya estuviera mal.
  IF TG_OP = 'UPDATE' AND NEW.sede = OLD.sede AND NEW.matricula = OLD.matricula AND OLD.rol = 'ct'
     AND NEW.desde >= OLD.desde AND NEW.hasta IS NOT NULL
     AND (OLD.hasta IS NULL OR NEW.hasta <= OLD.hasta) THEN
    RETURN NEW;
  END IF;
  -- LA PLAZA ENTERA DENTRO DE UN PERIODO CON CT (sin `hasta`, hasta siempre).
  IF EXISTS (
    SELECT 1 FROM sede_coche_ct x
     WHERE x.sede = NEW.sede AND x.matricula = NEW.matricula
       AND daterange(x.desde, x.hasta, '[]') @> daterange(NEW.desde, NEW.hasta, '[]')) THEN
    RETURN NEW;
  END IF;
  -- No cabe. Se dice por qué: o ese día el coche no lleva CT, o lo lleva pero
  -- solo hasta un día (y la plaza se pasa).
  SELECT x.hasta INTO v_hasta
    FROM sede_coche_ct x
   WHERE x.sede = NEW.sede AND x.matricula = NEW.matricula
     AND x.desde <= NEW.desde AND (x.hasta IS NULL OR x.hasta >= NEW.desde)
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El % no tiene correturnos el %: actívalos antes de poner a alguien de CT',
      NEW.matricula, to_char(NEW.desde, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  RAISE EXCEPTION 'El % lleva correturnos hasta el %: la plaza de CT no puede pasar de ese día',
    NEW.matricula, to_char(v_hasta, 'DD/MM/YYYY')
    USING ERRCODE = 'check_violation';
END $$;

COMMENT ON FUNCTION tg_sede_asignacion_ct() IS
  'Una plaza de CT de otra sede (Barcelona) cabe ENTERA en un periodo con CT de su coche (sede_coche_ct); acortarla vale siempre. db/234, db/235';

-- Ahora también al cambiar `hasta` (alargar o quitar el fin de una plaza de CT).
DROP TRIGGER IF EXISTS tg_sede_asignacion_ct ON sede_asignacion;
CREATE TRIGGER tg_sede_asignacion_ct
  BEFORE INSERT OR UPDATE OF matricula, rol, desde, hasta ON sede_asignacion
  FOR EACH ROW EXECUTE FUNCTION tg_sede_asignacion_ct();

-- Las que ya estuvieran mal: hasta el último día del periodo con CT en el que
-- empiezan. Si no empiezan en ninguno, no se tocan (db/234 ya no las dejaba
-- entrar, y no hay día al que recortarlas).
UPDATE sede_asignacion a
   SET hasta = x.hasta, cerrado_at = now()
  FROM sede_coche_ct x
 WHERE a.rol = 'ct'
   AND x.sede = a.sede AND x.matricula = a.matricula
   AND x.desde <= a.desde AND x.hasta IS NOT NULL AND x.hasta >= a.desde
   AND (a.hasta IS NULL OR a.hasta > x.hasta);

COMMIT;
