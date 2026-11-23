-- ============================================================
-- 277 — PLAZA RESERVADA EN EL PLANIFICADOR (ADIÓS A LAS VACANTES)
-- ============================================================
-- Camilo, 23/11/2026: «vamos a eliminar completamente el módulo de vacantes en
-- RRHH y Generar vacantes en tráfico, se harán directamente desde el
-- planificador. Cuando tengo un "Hueco" en un cuadrante, puedo separar esa plaza
-- para alguien que esté en proceso de terminar su alta, tanto de ETT como
-- propia. A veces se quiere separar la plaza para alguien que todavía no está
-- (…) entonces la plaza se puede guardar como "Sin nombre"».
--
-- Una reserva es de UNA plaza (coche + turno + fijo/CT) y, como mucho, de una
-- persona. Mientras está abierta, la celda dice «Plaza reservada» y se puede
-- planificar a alguien encima:
--   · «Sin nombre» o la persona sin fecha: quien se planifica, sin hasta;
--   · la persona con su alta prevista: se la planifica desde ese día (Camilo: «se
--     la planifica sí o sí, para algo se le guardó el puesto»), y quien esté en
--     la plaza acaba la víspera (lo hace el auto-corte de `colocar`).
-- `asignacion_id` es esa planificación. La lógica, en modules/Planificacion/reservas.*.
--
-- Las tablas de vacantes (db/90) NO se borran: quedan como histórico y nada las
-- vuelve a leer ni a escribir. Al 23/11 no había ninguna abierta.
--
-- Nada se borra: una reserva se cierra (quitada o cumplida), con quién y por qué.
-- Tabla nueva: se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/277', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS plaza_reserva (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plaza_id        BIGINT       NOT NULL REFERENCES plaza(id),
  -- Para quién. NULL = «Sin nombre».
  conductor_id    BIGINT       REFERENCES conductor(id),
  nota            TEXT,
  -- La planificación que salió de la reserva (la persona, desde su alta).
  asignacion_id   BIGINT       REFERENCES asignacion(id) ON DELETE SET NULL,
  creado_por      INTEGER      REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  cerrada_at      TIMESTAMPTZ,
  cerrada_por     INTEGER      REFERENCES usuario(id),
  -- 'quitada' (a mano) o 'cumplida' (la persona ya está en su plaza).
  cerrada_motivo  VARCHAR(20)  CHECK (cerrada_motivo IS NULL OR cerrada_motivo IN ('quitada', 'cumplida')),
  CONSTRAINT ck_plaza_reserva_cerrada CHECK ((cerrada_at IS NULL) = (cerrada_motivo IS NULL))
);
-- Una reserva abierta por plaza, y una por persona.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plaza_reserva_plaza ON plaza_reserva (plaza_id) WHERE cerrada_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_plaza_reserva_persona ON plaza_reserva (conductor_id) WHERE cerrada_at IS NULL AND conductor_id IS NOT NULL;

COMMENT ON TABLE plaza_reserva IS
  'Plazas reservadas desde el planificador (db/277): para alguien en proceso de alta o «Sin nombre». Sustituye a las vacantes (db/90). Se cierran, no se borran.';

SELECT auditoria_vigilar('plaza_reserva');

COMMIT;
