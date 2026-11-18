-- ============================================================
-- 271 — LOS PERMISOS DE LA OFICINA: ASUNTOS PROPIOS Y TELETRABAJO (18/11/2026)
-- ============================================================
-- Camilo, 18/11/2026: «que también podamos solicitar 2 días de asuntos propios o
-- permisos especiales, como medio día de teletrabajo, todo un día de teletrabajo,
-- etc., y que quede un histórico de esos permisos».
--
-- Lo decidió así (en el chat):
--   · ASUNTOS PROPIOS: un banco aparte de 2 días al año natural (desde su alta, o
--     desde 2026), enteros y sin prorratear; lo que no se usa se acumula. No
--     restan vacaciones (como en los conductores, db/225 y 29/10/2026).
--   · TELETRABAJO: día completo o medio día (mañana o tarde). Sin cupo: se pide,
--     lo aprueba quien tiene la llave de Usuarios y permisos, y queda en el
--     histórico. No consume nada.
--   · Los días de asuntos propios generan vacaciones: el saldo de la oficina se
--     calcula por días del calendario del horario, así que ya cuentan igual.
--
-- UNA SOLICITUD son sus días: cada día laborable del rango es una fila, todas con
-- el mismo `grupo`. Así aprobar o rechazar es de una vez y el histórico sale por
-- solicitud. Lo que resta de verdad es el día aprobado.
--
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/271', true),
       set_config('telecab.usuario_id', '7', true);

CREATE SEQUENCE IF NOT EXISTS oficina_permiso_grupo_seq;

CREATE TABLE IF NOT EXISTS oficina_permiso (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La solicitud a la que pertenece el día (todos sus días comparten el grupo).
  grupo           BIGINT       NOT NULL,
  usuario_id      INTEGER      NOT NULL REFERENCES usuario(id),
  tipo            VARCHAR(24)  NOT NULL CHECK (tipo IN ('asuntos_propios', 'teletrabajo')),
  fecha           DATE         NOT NULL,
  -- Día completo, o media mañana o media tarde (medio día).
  fraccion        VARCHAR(8)   NOT NULL DEFAULT 'dia' CHECK (fraccion IN ('dia', 'manana', 'tarde')),
  nota            TEXT         NOT NULL DEFAULT '',
  estado          VARCHAR(16)  NOT NULL DEFAULT 'pedido'
                  CHECK (estado IN ('pedido', 'aprobado', 'rechazado', 'retirado', 'anulado')),
  pedido_por      INTEGER      NOT NULL REFERENCES usuario(id),
  pedido_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  resuelto_por    INTEGER      REFERENCES usuario(id),
  resuelto_at     TIMESTAMPTZ,
  resuelto_nota   TEXT,
  CONSTRAINT ck_oficina_permiso_resuelto CHECK (
    (estado = 'pedido' AND resuelto_at IS NULL) OR (estado <> 'pedido' AND resuelto_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_oficina_permiso_usuario ON oficina_permiso (usuario_id, fecha);
CREATE INDEX IF NOT EXISTS ix_oficina_permiso_grupo ON oficina_permiso (grupo);
CREATE INDEX IF NOT EXISTS ix_oficina_permiso_pedidos ON oficina_permiso (fecha) WHERE estado = 'pedido';

COMMENT ON TABLE oficina_permiso IS
  'Los permisos de la oficina (db/271): asuntos propios (banco de 2 al año) y teletrabajo. Una solicitud = sus días, con el mismo grupo. Histórico: no se borra, se resuelve o se anula.';

SELECT auditoria_vigilar('oficina_permiso', 'id');

COMMIT;
