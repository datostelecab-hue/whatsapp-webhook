-- ============================================================
-- 303 — LOS PARTES DE LAS BAJAS MÉDICAS (MÓDULO 1 DEL PLAN DE RR. HH.)
-- ============================================================
-- El encargo (módulo 1, IT): bajas nuevas, prórrogas o confirmaciones,
-- rectificaciones y altas, cada una con su fecha prevista; las prórrogas se
-- actualizan solas; dos días hábiles antes del fin previsto se comprueba si
-- hay prórroga; solo con el alta confirmada, tarjeta a Diana para la
-- reincorporación y aviso a planificación.
--
-- Camilo, 26/11/2026: se lleva A MANO hasta que llegue el fichero del INSS
-- (FIE), que meterá los mismos partes (`origen` 'fie'). Con el alta, vuelve al
-- día siguiente (la baja de su ficha se cierra el día del alta). Los apunta
-- quien valida ausencias ('/ausencias/validar'). El aviso va al área de
-- Planificación.
--
-- La baja sigue siendo la situación «baja médica» de su ficha
-- (conductor_estado_hist): manda en el planificador y la bitácora. Cada parte
-- la mueve: la baja la abre, la confirmación cambia la fecha prevista
-- (`hasta_previsto`), el alta la cierra y la rectificación corrige fechas.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/303', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS baja_parte (
  id              BIGSERIAL PRIMARY KEY,
  conductor_id    BIGINT       NOT NULL REFERENCES conductor(id),
  -- La baja de su ficha que mueve este parte.
  situacion_id    BIGINT       REFERENCES conductor_estado_hist(id) ON DELETE SET NULL,
  tipo            VARCHAR(14)  NOT NULL,
  -- El día del parte (para el alta, el día del alta: vuelve al siguiente).
  fecha           DATE         NOT NULL,
  -- La fecha prevista de fin (o de la próxima revisión) que dice el parte.
  prevista        DATE,
  -- Contingencia, en el de baja: común, accidente no laboral, enfermedad profesional, accidente de trabajo.
  contingencia    VARCHAR(24),
  origen          VARCHAR(8)   NOT NULL DEFAULT 'manual',
  nota            TEXT,
  creado_por      INTEGER REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at      TIMESTAMPTZ,
  anulado_por     INTEGER REFERENCES usuario(id),
  anulado_motivo  TEXT,
  CONSTRAINT ck_baja_parte_tipo CHECK (tipo IN ('baja', 'confirmacion', 'alta', 'rectificacion')),
  CONSTRAINT ck_baja_parte_origen CHECK (origen IN ('manual', 'fie')),
  CONSTRAINT ck_baja_parte_contingencia CHECK (contingencia IS NULL OR contingencia IN
    ('comun', 'accidente_no_laboral', 'enfermedad_profesional', 'accidente_trabajo')),
  CONSTRAINT ck_baja_parte_rectificacion CHECK (tipo <> 'rectificacion' OR btrim(COALESCE(nota, '')) <> ''),
  CONSTRAINT ck_baja_parte_anulado CHECK (anulado_at IS NULL OR btrim(COALESCE(anulado_motivo, '')) <> '')
);
CREATE INDEX IF NOT EXISTS ix_baja_parte_situacion ON baja_parte (situacion_id) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_baja_parte_conductor ON baja_parte (conductor_id, fecha);

COMMENT ON TABLE baja_parte IS
  'Módulo 1 (db/303): los partes de cada baja médica (baja, confirmación o prórroga, alta, rectificación), a mano o del fichero del INSS. Cada uno mueve la situación «baja médica» de la ficha.';

SELECT auditoria_vigilar('baja_parte');

COMMIT;
