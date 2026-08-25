-- ============================================================
-- 24 - IRSE DE LA EMPRESA NO ES UNA "SITUACION"
-- ============================================================
-- Habia DOS botones que decian baja, y solo uno terminaba el contrato:
--
--   · "Dar de baja"  -> cierra el periodo de empleo, las asignaciones, el
--                       turno y la situacion. Es la baja de verdad.
--   · "Situacion"    -> ofrecia "Baja en la empresa" en el desplegable, y eso
--                       solo escribia una fila en el historial de estados.
--
-- El segundo pinta a la persona como ida sin terminar nada. La pantalla de
-- Plantilla enseña la etiqueta del estado y dice "Baja en la empresa"; el resto
-- del sistema mira el contrato, lo ve abierto, y sigue contando con ella. Los
-- dos tienen razon: se les pregunto cosas distintas.
--
-- La opcion NO se quita del desplegable: es donde la gente la busca, y quitarla
-- seria esconder el problema en vez de arreglarlo. Lo que cambia es lo que hace:
-- elegirla da de baja de verdad, igual que el boton de al lado, con la misma
-- fecha y la misma confirmacion.
--
-- Lo que si queda prohibido es GUARDARLA como estado, que es lo que dejaba a la
-- persona a medias. Y se prohibe en la base, no en el formulario: ahora tambien
-- se entra por el explorador de SQL, y una regla que solo vive en una pantalla
-- no es una regla.

BEGIN;

-- ── Cual de estas "situaciones" no lo es ──────────────────────────────────
ALTER TABLE cat_estado_conductor
  ADD COLUMN IF NOT EXISTS es_fin_contrato BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cat_estado_conductor.es_fin_contrato IS
  'No es una situacion en la que se este, sino el final del contrato. Se ofrece igual, pero da de baja en vez de guardarse';

UPDATE cat_estado_conductor SET es_fin_contrato = TRUE WHERE codigo = 'baja_empresa';

-- ── Arreglar a quien quedo a medias ───────────────────────────────────────
-- Quien tiene "Baja en la empresa" puesta a mano Y el contrato abierto es
-- alguien a quien se quiso dar de baja y no se le dio. Se le termina el contrato
-- el dia que se marco el estado, que es el dia que se quiso.
--
-- Se cierra lo mismo que cierra `darDeBaja`, y por el mismo motivo: dejarle una
-- asignacion abierta haria que su coche siguiera saliendo cubierto.
CREATE TEMP TABLE _a_medias ON COMMIT DROP AS
  SELECT s.conductor_id, s.desde AS dia
    FROM conductor_estado_hist s
   WHERE s.estado = 'baja_empresa'
     AND s.hasta IS NULL
     AND EXISTS (SELECT 1 FROM conductor_periodo_empleo e
                  WHERE e.conductor_id = s.conductor_id AND e.baja IS NULL);

UPDATE conductor_periodo_empleo e
   SET baja = m.dia,
       motivo_baja = COALESCE(e.motivo_baja, 'Se marco como situacion y no se cerro el contrato')
  FROM _a_medias m
 WHERE e.conductor_id = m.conductor_id AND e.baja IS NULL;

UPDATE asignacion a
   SET hasta = m.dia
  FROM _a_medias m
 WHERE a.conductor_id = m.conductor_id AND (a.hasta IS NULL OR a.hasta > m.dia);

UPDATE conductor_turno_hist t
   SET hasta = m.dia
  FROM _a_medias m
 WHERE t.conductor_id = m.conductor_id AND (t.hasta IS NULL OR t.hasta > m.dia);

UPDATE patron_libranza p
   SET hasta = m.dia
  FROM _a_medias m
 WHERE p.conductor_id = m.conductor_id AND (p.hasta IS NULL OR p.hasta > m.dia);

-- Y la fila de estado que lo empezo todo: ya no hace falta, porque la baja se
-- DEDUCE de no tener contrato abierto. `listar` la calcula sola.
UPDATE conductor_estado_hist s
   SET hasta = m.dia
  FROM _a_medias m
 WHERE s.conductor_id = m.conductor_id AND s.estado = 'baja_empresa' AND s.hasta IS NULL;

-- ── Y que no se pueda volver a guardar ────────────────────────────────────
CREATE OR REPLACE FUNCTION situacion_no_es_baja() RETURNS trigger AS $$
DECLARE
  fin BOOLEAN;
BEGIN
  SELECT es_fin_contrato INTO fin FROM cat_estado_conductor WHERE codigo = NEW.estado;
  IF fin THEN
    RAISE EXCEPTION '"%" no se guarda como situacion: es el final del contrato. Cierra el periodo de empleo', NEW.estado
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION situacion_no_es_baja() IS
  'Impide guardar como situacion lo que en realidad es el final del contrato. La regla vive aqui y no en el formulario';

DROP TRIGGER IF EXISTS tg_situacion_no_es_baja ON conductor_estado_hist;

CREATE TRIGGER tg_situacion_no_es_baja
  BEFORE INSERT OR UPDATE OF estado ON conductor_estado_hist
  FOR EACH ROW EXECUTE FUNCTION situacion_no_es_baja();

COMMIT;
