-- ============================================================
-- 291 — LOS FINIQUITOS (MÓDULO 7)
-- ============================================================
-- Módulo 7 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md). El
-- encargo: «El resumen de cierre incluye siempre vacaciones netas, el 100% de la
-- recaudación pendiente, descuentos y bonus pendientes, cada uno con su soporte.
-- Tras la aprobación, se dispara solo el envío a firma y el aviso a la gestoría».
--
-- Decidido por Camilo el 25/11/2026:
--   · Nace AL DAR LA BAJA, de plantilla propia y de ETT: la propia va a la
--     gestoría y la de ETT a la agencia. Queda guardado en la ficha (como hoy
--     las «Extras pendientes»), con los conceptos del encargo.
--   · Diana revisa, Ignacio aprueba.
--   · Las vacaciones netas, en DÍAS: el importe lo pone la gestoría.
--
-- `finiquito`: uno por persona y fecha de baja. `resumen` es la foto de lo
-- calculado (cada concepto con su soporte): mientras está en borrador o
-- revisado se puede recalcular; aprobado, ya no cambia. Estados:
--   borrador → revisado (Diana) → aprobado (Ignacio) → enviado (a la gestoría o
--   a la ETT, solo, por correo) → firmado (con el documento firmado adjunto).
--   Y anulado, con motivo (una baja que se anula).
--
-- La función de Organización «finiquitos_revisar» (el puesto de Diana) recibe
-- la tarjeta de revisarlo; quien tenga la llave de aprobar, la de aprobarlo.
-- Llaves: '/finiquitos' (mirar: Diana e Ignacio), '/finiquitos/revisar' (Diana)
-- y '/finiquitos/aprobar' (Ignacio).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/291', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS finiquito (
  id              BIGSERIAL PRIMARY KEY,
  conductor_id    BIGINT       NOT NULL REFERENCES conductor(id),
  periodo_id      BIGINT REFERENCES conductor_periodo_empleo(id) ON DELETE SET NULL,
  fecha_baja      DATE         NOT NULL,
  tipo            VARCHAR(8)   NOT NULL,
  ett_nombre      TEXT,
  estado          VARCHAR(10)  NOT NULL DEFAULT 'borrador',
  resumen         JSONB        NOT NULL,
  calculado_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  revisado_at     TIMESTAMPTZ,
  revisado_por    INTEGER REFERENCES usuario(id),
  aprobado_at     TIMESTAMPTZ,
  aprobado_por    INTEGER REFERENCES usuario(id),
  enviado_at      TIMESTAMPTZ,
  enviado_por     INTEGER REFERENCES usuario(id),
  enviado_a       TEXT,
  envio_nota      TEXT,
  firmado_at      TIMESTAMPTZ,
  firmado_por     INTEGER REFERENCES usuario(id),
  documento_id    BIGINT,
  nota            TEXT,
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_finiquito UNIQUE (conductor_id, fecha_baja),
  CONSTRAINT ck_finiquito_tipo CHECK (tipo IN ('propia', 'ett')),
  CONSTRAINT ck_finiquito_estado CHECK (estado IN ('borrador', 'revisado', 'aprobado', 'enviado', 'firmado', 'anulado'))
);

CREATE INDEX IF NOT EXISTS ix_finiquito_estado ON finiquito (estado, fecha_baja DESC);

COMMENT ON TABLE finiquito IS
  'Módulo 7 (db/291): el finiquito de cada baja (propia → gestoría, ETT → agencia), con su resumen de cierre y su soporte. Diana revisa, Ignacio aprueba, se avisa solo.';

SELECT auditoria_vigilar('finiquito');

-- El PDF del resumen de cierre, como documento de la persona (como la ficha de alta, db/149).
INSERT INTO cat_tipo_documento
  (codigo, etiqueta, ambito, caduca, obligatorio, aviso_dias, orden, activo, previo_alta, obligatorio_ett)
VALUES
  ('finiquito', 'Finiquito (resumen de cierre)', 'conductor', FALSE, FALSE, 0, 14, TRUE, FALSE, FALSE)
ON CONFLICT (codigo) DO NOTHING;

-- ── Quién los revisa: la función, en el puesto de Diana ───────────────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente)
SELECT 'administracion_personal', 'finiquitos_revisar', FALSE
 WHERE EXISTS (SELECT 1 FROM puesto WHERE codigo = 'administracion_personal')
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion
                    WHERE puesto_codigo = 'administracion_personal' AND funcion = 'finiquitos_revisar' AND anulado_at IS NULL);

-- ── Las llaves ──────────────────────────────────────────────────────────────
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/finiquitos'), (20, 'Diana', '/finiquitos/revisar'),
               (1, 'Ignacio', '/finiquitos'), (1, 'Ignacio', '/finiquitos/aprobar')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
