-- ============================================================
-- 295 — FALTAS Y SANCIONES (MÓDULO 3 DEL PLAN DE RR. HH.)
-- ============================================================
-- Camilo, 25/11/2026:
--   · La abre la oficina (Tráfico, Control, Taller, RR. HH.) con sus pruebas, y
--     la aprueban Ángel, William o Ignacio. Después Diana prepara la carta.
--   · El ERP PROPONE la falta con el catálogo del art. 39 (`disciplinary_rule`,
--     db/31): las ausencias que RR. HH. da por injustificadas y la reincidencia.
--     Nunca sanciona solo: una persona la abre o la descarta.
--   · La carta, con una plantilla con huecos en YouTrust (sin IA): los hechos los
--     escribe quien la abre; el artículo, la gravedad y la sanción, el ERP.
--   · Una suspensión de empleo y sueldo entra en el planificador (situación
--     «suspendido») al firmarse la carta, o cuando no la firma o caduca.
--
-- `sancion`: una falta de una persona. Estados:
--   propuesta (la vio el ERP) → abierta (por aprobar) → aprobada (la carta, por
--   preparar) → en_firma (en la cola de Firmas) → comunicada; y descartada.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/295', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS sancion (
  id                BIGSERIAL PRIMARY KEY,
  conductor_id      BIGINT       NOT NULL REFERENCES conductor(id),
  -- La regla del convenio (art. 39). Sin regla: otra falta, descrita a mano.
  regla             VARCHAR(16)  REFERENCES disciplinary_rule(rule_code),
  gravedad          VARCHAR(12)  NOT NULL,
  articulo          VARCHAR(24),
  falta             TEXT         NOT NULL,
  fecha_hechos      DATE         NOT NULL,
  hechos            TEXT,
  origen            VARCHAR(12)  NOT NULL DEFAULT 'manual',
  origen_id         TEXT,
  -- Lo que la sostiene, cuando la propuso el ERP (los días de ausencia, las sanciones de la reincidencia).
  detalle           JSONB,
  estado            VARCHAR(12)  NOT NULL DEFAULT 'abierta',
  -- La decisión: amonestación por escrito o suspensión de empleo y sueldo de N días.
  medida            VARCHAR(12),
  dias              SMALLINT,
  decision_nota     TEXT,
  aprobada_at       TIMESTAMPTZ,
  aprobada_por      INTEGER REFERENCES usuario(id),
  -- Hasta cuándo hay para comunicarla (sanciones.plazo_dias_habiles desde la aprobación).
  comunicar_antes   DATE,
  -- Las fechas de la suspensión (las pone RR. HH. al preparar la carta).
  suspension_desde  DATE,
  suspension_hasta  DATE,
  firma_envio_id    BIGINT REFERENCES firma_envio(id),
  -- El tramo «suspendido» que se puso al comunicarla.
  situacion_id      BIGINT REFERENCES conductor_estado_hist(id) ON DELETE SET NULL,
  comunicada_at     TIMESTAMPTZ,
  nota              TEXT,
  cerrada_at        TIMESTAMPTZ,
  cerrada_por       INTEGER REFERENCES usuario(id),
  abierta_por       INTEGER REFERENCES usuario(id),
  abierta_at        TIMESTAMPTZ,
  creado_por        INTEGER REFERENCES usuario(id),
  creado_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_sancion_gravedad CHECK (gravedad IN ('LEVE', 'GRAVE', 'MUY_GRAVE')),
  CONSTRAINT ck_sancion_origen CHECK (origen IN ('manual', 'propuesta')),
  CONSTRAINT ck_sancion_estado CHECK (estado IN ('propuesta', 'abierta', 'aprobada', 'en_firma', 'comunicada', 'descartada')),
  CONSTRAINT ck_sancion_medida CHECK (medida IS NULL OR medida IN ('amonestacion', 'suspension')),
  CONSTRAINT ck_sancion_dias CHECK ((medida = 'suspension') = (dias IS NOT NULL AND dias > 0) OR medida IS NULL),
  CONSTRAINT ck_sancion_fechas CHECK (suspension_hasta IS NULL OR suspension_hasta >= suspension_desde)
);

-- Una propuesta del ERP no nace dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sancion_origen ON sancion (origen_id) WHERE origen = 'propuesta';
CREATE INDEX IF NOT EXISTS ix_sancion_estado ON sancion (estado, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_sancion_conductor ON sancion (conductor_id, fecha_hechos);

COMMENT ON TABLE sancion IS
  'Módulo 3 (db/295): las faltas y sanciones (art. 39). La abre la oficina o la propone el ERP; la aprueban Ángel, William o Ignacio; Diana manda la carta a firmar.';

SELECT auditoria_vigilar('sancion');

-- La carta va por la cola de Firmas (db/293) con su origen.
ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_origen;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_origen CHECK (origen IN ('manual', 'finiquito', 'semana', 'sancion'));

-- ── Quién hace qué: las funciones, en los puestos ─────────────────────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente)
SELECT x.puesto, x.funcion, FALSE
  FROM (VALUES ('direccion_operaciones', 'sanciones_aprobar'), ('jefe_control', 'sanciones_aprobar'),
               ('jefe_planificacion', 'sanciones_aprobar'), ('administracion_personal', 'sanciones_rrhh')) AS x (puesto, funcion)
 WHERE EXISTS (SELECT 1 FROM puesto WHERE codigo = x.puesto)
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion f WHERE f.puesto_codigo = x.puesto AND f.funcion = x.funcion AND f.anulado_at IS NULL);

-- ── Las llaves ──────────────────────────────────────────────────────────────
-- Ignacio (1), William (2) y Ángel (31): mirar, abrir y aprobar. Diana (20):
-- mirar, abrir y preparar la carta. A los demás de la oficina, desde Usuarios.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (1, 'Ignacio', '/disciplina'), (1, 'Ignacio', '/disciplina/abrir'), (1, 'Ignacio', '/disciplina/aprobar'),
               (2, 'William', '/disciplina'), (2, 'William', '/disciplina/abrir'), (2, 'William', '/disciplina/aprobar'),
               (31, 'Angel', '/disciplina'), (31, 'Angel', '/disciplina/abrir'), (31, 'Angel', '/disciplina/aprobar'),
               (20, 'Diana', '/disciplina'), (20, 'Diana', '/disciplina/abrir'), (20, 'Diana', '/disciplina/carta'))
       AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
