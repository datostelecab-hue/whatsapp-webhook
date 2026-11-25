-- ============================================================
-- 289 — LAS AUSENCIAS QUE VALIDA RR. HH. (MÓDULO 1, PRIMERA PARTE)
-- ============================================================
-- Módulo 1 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). El
-- encargo: «El ERP asigna ausencias automáticamente a quien no ficha. Ninguna
-- ausencia se descuenta como absentismo sin validación. Tarea diaria para Diana:
-- revisar las ausencias nuevas y confirmar que no son una baja médica».
--
-- La «Ausencia» ya existía: la calcula la bitácora al leer (con plaza, le tocaba
-- y no salió sin nada que lo explique; bitacora.service.claseDelDia). Lo que no
-- había era DÓNDE GUARDAR LO QUE DECIDE RR. HH. de cada una. Es esta tabla: una
-- fila por persona y día, que nace «pendiente» y Diana resuelve:
--   · injustificada  pasa al absentismo (y, con el módulo 4, a la nómina)
--   · justificada    por otro motivo, con nota; la bitácora no cambia
--   · baja_medica    se abre la baja (conductor_estado_hist) y sale del absentismo
--   · permiso        se abre el permiso, con su tipo del convenio
--   · ya_no_es       la bitácora dejó de verla como ausencia (le pusieron una J,
--                    entraron sus horas, una libranza, unas vacaciones…)
-- La baja y el permiso también llegan SOLOS: si después cae una baja encima de
-- una ausencia ya decidida, se reclasifica (encargo: «es retroactivo»). Todo lo
-- que cambia queda en el libro de auditoría, con quién y cuándo; lo que hace el
-- sistema, con `automatica`.
--
-- Decidido por Camilo el 25/11/2026: solo PLANTILLA PROPIA (la nómina de la ETT
-- la hace la agencia) y desde el 26/10/2026, que es donde empieza la nómina de
-- noviembre (las nóminas van del 26 al 25).
--
-- Quién las revisa cada día: la función de Organización «ausencias_validar», en
-- el puesto de Diana. Llaves: '/ausencias' (mirar, también el % de plantilla de
-- baja) y '/ausencias/validar' (decidir y subir el justificante).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/289', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS ausencia_rrhh (
  id            BIGSERIAL PRIMARY KEY,
  conductor_id  BIGINT       NOT NULL REFERENCES conductor(id),
  dia           DATE         NOT NULL,
  estado        VARCHAR(16)  NOT NULL DEFAULT 'pendiente',
  nota          TEXT,
  -- La baja o el permiso que la explica (el tramo de conductor_estado_hist).
  situacion_id  BIGINT REFERENCES conductor_estado_hist(id) ON DELETE SET NULL,
  -- El día en que la vio el ERP: la tarjeta de ese día es la de estas.
  detectada_el  DATE         NOT NULL,
  resuelta_at   TIMESTAMPTZ,
  resuelta_por  INTEGER REFERENCES usuario(id),
  -- La resolvió el sistema (reclasificada por una baja, ya no es ausencia…).
  automatica    BOOLEAN      NOT NULL DEFAULT FALSE,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_ausencia_rrhh UNIQUE (conductor_id, dia),
  CONSTRAINT ck_ausencia_rrhh_estado CHECK (estado IN ('pendiente', 'injustificada', 'justificada', 'baja_medica', 'permiso', 'ya_no_es')),
  CONSTRAINT ck_ausencia_rrhh_cierre CHECK ((estado = 'pendiente') = (resuelta_at IS NULL))
);

CREATE INDEX IF NOT EXISTS ix_ausencia_rrhh_estado ON ausencia_rrhh (estado, dia);
CREATE INDEX IF NOT EXISTS ix_ausencia_rrhh_pendiente ON ausencia_rrhh (detectada_el) WHERE estado = 'pendiente';

COMMENT ON TABLE ausencia_rrhh IS
  'Módulo 1 (db/289): lo que RR. HH. decide de cada «Ausencia» de la bitácora (plantilla propia, desde el 26/10/2026). Solo las injustificadas son absentismo.';

SELECT auditoria_vigilar('ausencia_rrhh');

-- ── Quién las revisa cada día: la función, en el puesto de Diana ───────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente)
SELECT 'administracion_personal', 'ausencias_validar', FALSE
 WHERE EXISTS (SELECT 1 FROM puesto WHERE codigo = 'administracion_personal')
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion
                    WHERE puesto_codigo = 'administracion_personal' AND funcion = 'ausencias_validar' AND anulado_at IS NULL);

-- ── Las llaves ──────────────────────────────────────────────────────────────
-- Mirar y validar: Diana (id y nombre, como db/285). Mirar: Ignacio.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/ausencias'), (20, 'Diana', '/ausencias/validar'), (1, 'Ignacio', '/ausencias')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
