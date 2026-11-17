-- ============================================================
-- 264 — EN QUÉ ZONA ESTUVO CADA COCHE, CON FECHAS
-- ============================================================
-- Camilo, 17/11/2026, al pedir en Inicio el resumen de cómo va cada zona
-- («Canillejas 450 h de 500 que debía hacer…»): «ten en cuenta los días de las
-- zonas: si hoy el coche pasa de Alcobendas a Canillejas, entonces en el lapso
-- de esa fecha debían hacer tantas horas hasta que se cambió».
--
-- La zona de un coche de Madrid es la suya si alguien se la puso a mano
-- (vehiculo.base_zona_id) o la de su cuadrante (cuadrante.base_zona_id, db/91),
-- y NINGUNA de las dos tiene historial: es la de HOY. Así, mover un coche de
-- cuadrante o un cuadrante de zona se llevaba todo el mes a la zona nueva (el
-- informe de rendimiento de Control lo dice en su cabecera).
--
-- LO QUE HACE:
--
--   1 · vehiculo_zona: una fila = un coche en una zona durante un periodo
--       (desde, hasta; hasta NULL = sigue). base_zona_id NULL = sin zona (sin
--       cuadrante: «Cuadrantes libres»). Un coche no está en dos zonas a la vez
--       (exclusión gist, como sede_coche_cuadrante de db/237).
--   2 · La apunta la base, no el código: un disparador en vehiculo (al darlo de
--       alta o cambiarle el cuadrante o la zona a mano) y otro en cuadrante (al
--       pasarlo de zona o darlo de baja) llaman a f_vehiculo_zona_apuntar. Así
--       vale venga el cambio de donde venga: el tablero, el intercambio de
--       matrícula, «Meter en un cuadrante» o un borrado (ON DELETE SET NULL
--       también dispara). El cambio cuenta DESDE HOY (día de Madrid): el día que
--       se cambia ya es de la zona nueva. Si cambia dos veces el mismo día,
--       manda la última.
--   3 · La siembra: cada coche, con su zona de HOY, desde el 01/09/2026 (cuando
--       empieza el planificador en la base). LO DE ANTES DE HOY NO SE SABE: no
--       hay ningún registro de en qué zona estaba un coche ayer, y se da la de
--       hoy, que es lo que ya hacía el informe. Desde hoy, cada cambio queda.
--
-- Bajo el libro de auditoría (convención 5, db/245).
-- Se puede pasar dos veces: IF NOT EXISTS, CREATE OR REPLACE y la siembra solo
-- para los coches que aún no tienen ninguna fila.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/264', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS vehiculo_zona (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id   BIGINT   NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  base_zona_id  SMALLINT REFERENCES base_zona(id),
  desde         DATE     NOT NULL,
  hasta         DATE,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_vehiculo_zona_fechas CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ex_vehiculo_zona_solape EXCLUDE USING gist (
    vehiculo_id WITH =,
    daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS ix_vehiculo_zona_vigente ON vehiculo_zona (vehiculo_id) WHERE hasta IS NULL;

COMMENT ON TABLE vehiculo_zona IS
  'En qué zona estuvo cada coche de Madrid, con fechas (db/264). La escriben los disparadores de vehiculo y cuadrante (f_vehiculo_zona_apuntar); desde el día del cambio cuenta la zona nueva. Antes del 17/11/2026 no se sabía: la siembra da la zona de ese día desde el 01/09/2026. base_zona_id NULL = sin zona (Cuadrantes libres).';

-- ── Apuntar la zona de HOY de un coche, si cambió ──────────────────────────
-- La de hoy es la misma regla que v_plaza (db/91): la suya a mano o la de su
-- cuadrante vivo.
CREATE OR REPLACE FUNCTION f_vehiculo_zona_apuntar(p_vehiculo BIGINT) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_hoy  date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  v_zona smallint;
  v_fila vehiculo_zona%ROWTYPE;
BEGIN
  SELECT COALESCE(v.base_zona_id, cu.base_zona_id) INTO v_zona
    FROM vehiculo v
    LEFT JOIN cuadrante cu ON cu.id = v.cuadrante_id AND cu.baja_at IS NULL
   WHERE v.id = p_vehiculo;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_fila FROM vehiculo_zona WHERE vehiculo_id = p_vehiculo AND hasta IS NULL FOR UPDATE;
  IF FOUND AND v_fila.base_zona_id IS NOT DISTINCT FROM v_zona THEN RETURN; END IF;

  IF FOUND THEN
    IF v_fila.desde >= v_hoy THEN
      -- Otro cambio el mismo día: hoy manda el último.
      UPDATE vehiculo_zona SET base_zona_id = v_zona WHERE id = v_fila.id;
      RETURN;
    END IF;
    UPDATE vehiculo_zona SET hasta = v_hoy - 1 WHERE id = v_fila.id;
  END IF;
  INSERT INTO vehiculo_zona (vehiculo_id, base_zona_id, desde) VALUES (p_vehiculo, v_zona, v_hoy);
END $$;

COMMENT ON FUNCTION f_vehiculo_zona_apuntar(BIGINT) IS
  'Apunta en vehiculo_zona la zona de hoy del coche si no es la que tenía (db/264): cierra la anterior la víspera y abre la nueva desde hoy (día de Madrid).';

CREATE OR REPLACE FUNCTION tg_vehiculo_zona() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehiculo' THEN
    PERFORM f_vehiculo_zona_apuntar(NEW.id);
  ELSE
    PERFORM f_vehiculo_zona_apuntar(v.id) FROM vehiculo v WHERE v.cuadrante_id = NEW.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS tg_vehiculo_zona ON vehiculo;
CREATE TRIGGER tg_vehiculo_zona
  AFTER INSERT OR UPDATE OF cuadrante_id, base_zona_id ON vehiculo
  FOR EACH ROW EXECUTE FUNCTION tg_vehiculo_zona();

DROP TRIGGER IF EXISTS tg_cuadrante_zona ON cuadrante;
CREATE TRIGGER tg_cuadrante_zona
  AFTER UPDATE OF base_zona_id, baja_at ON cuadrante
  FOR EACH ROW
  WHEN (OLD.base_zona_id IS DISTINCT FROM NEW.base_zona_id OR OLD.baja_at IS DISTINCT FROM NEW.baja_at)
  EXECUTE FUNCTION tg_vehiculo_zona();

-- ── La siembra: la zona de hoy, desde que empieza el planificador ──────────
INSERT INTO vehiculo_zona (vehiculo_id, base_zona_id, desde)
SELECT v.id, COALESCE(v.base_zona_id, cu.base_zona_id), DATE '2026-09-01'
  FROM vehiculo v
  LEFT JOIN cuadrante cu ON cu.id = v.cuadrante_id AND cu.baja_at IS NULL
 WHERE NOT EXISTS (SELECT 1 FROM vehiculo_zona z WHERE z.vehiculo_id = v.id);

SELECT auditoria_vigilar('vehiculo_zona');

COMMIT;
