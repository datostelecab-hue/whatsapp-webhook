-- ============================================================
-- 67 · BITÁCORA — el histórico SELLADO de horas por persona y jornada
-- ============================================================
-- La bitácora recalculaba las horas de los 365 días desde `fv_tramo` cada vez que
-- se abría. Dos problemas, y el segundo es el gordo:
--
--   1. Coste: 388 personas × 365 días recorridos y fundidos en cada pintado.
--   2. EL PASADO SE MOVÍA SOLO. Las horas salen de cruzar los tramos de BOLT con
--      `conductor_externo` (qué cuenta es de quién). Ese cruce es dato de HOY: el
--      día que se enlaza una cuenta vieja a alguien —o se le cambia la plaza, o
--      se corrige el turno— el histórico entero se recalculaba y meses ya
--      cerrados cambiaban de número sin que nadie hubiera tocado esos días.
--      Para nómina eso no vale: lo cerrado se queda como se cerró.
--
-- Aquí las horas de una jornada YA TERMINADA se calculan UNA vez y se guardan.
-- Lo que se lee después es esta tabla, no el núcleo. La jornada en curso (y la
-- anterior, que aún recibe tramos con retraso) sí se recalculan en vivo y se
-- reescriben en cada pasada; el resto queda sellado.
--
-- La ventana es la JORNADA OPERATIVA (05:00 → 05:00 Europe/Madrid) y el tramo se
-- RECORTA por ella, igual que en el Reporte de horas: un tramo que empieza a las
-- 04:22 y acaba a las 05:36 deja 38 min en la jornada que se cierra y 36 min en
-- la que empieza. Antes la bitácora se lo daba entero al día en que empezaba y
-- discrepaba del reporte en unos minutos por persona.
--
-- Para rehacer un tramo de histórico a propósito (p. ej. tras enlazar cuentas de
-- BOLT que faltaban) está `POST /bitacora/api/resellar`, solo del desarrollador.

BEGIN;

CREATE TABLE IF NOT EXISTS bitacora_horas (
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo DATE        NOT NULL,
  -- Segundos EFECTIVOS (viaje + espera) de esa persona en esa jornada, con los
  -- solapes ya fundidos: si dos cuentas suyas se pisan, el rato cuenta una vez.
  horas_seg     INTEGER     NOT NULL DEFAULT 0,
  -- Cuándo se selló. Sirve para saber si una foto es anterior a un arreglo.
  capturado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conductor_id, dia_operativo)
);

-- El acceso normal es "todas las personas de un rango de días": ese es el índice.
CREATE INDEX IF NOT EXISTS idx_bith_dia ON bitacora_horas (dia_operativo);

COMMENT ON TABLE bitacora_horas IS
  'Histórico SELLADO de horas efectivas por persona y jornada operativa (05->05). Se calcula una vez cuando la jornada cierra y ya no se recalcula: el pasado no se mueve porque hoy se cambie un turno o se enlace una cuenta de BOLT.';
COMMENT ON COLUMN bitacora_horas.horas_seg IS
  'Viaje + espera (fv_cat_situacion.efectivo), recortado por la ventana 05->05 y con los solapes fundidos. El descanso NO cuenta.';

COMMIT;
