-- ============================================================
-- 293 — EL ENVÍO A FIRMA (MÓDULO 6, CON LA APLICACIÓN DE YOUTRUST)
-- ============================================================
-- Módulo 6 del plan de RR. HH. y nóminas. El encargo: «los documentos se
-- firman con firma digital». Camilo, 25/11/2026: plan Plus de YouTrust (la
-- aplicación: firmas ilimitadas y autenticación por SMS; la API es otro
-- producto, aparte). Así que no hay integración: «la API prácticamente serías
-- tú». El camino:
--
--   1. El documento entra en la cola: solo (un finiquito aprobado, a falta del
--      PDF de la gestoría) o a mano (una carta de suspensión, un descuento…).
--   2. DIANA decide si se manda («siempre debe de ser un humano»): con el PDF y
--      con el email y el móvil del firmante. Sin eso no se aprueba.
--   3. Los aprobados ESPERAN a que se le pida a Claude mandarlos. Los manda por
--      la aplicación de YouTrust, en la cuenta de Diana (firma simple con
--      código por SMS), y los apunta como enviados: «Bot telecab, en nombre de
--      Diana». Cada tanda, con un «sí» de una persona en el chat.
--   4. Firmado: con el PDF firmado adjunto. Si era un finiquito, el finiquito
--      pasa a firmado.
--
-- `firma_envio`: un documento para una persona. Estados: borrador (falta el
-- PDF o la decisión) → aprobado → enviado → firmado | rechazado (el firmante
-- no firma) | caducado; y descartado (Diana dice que no), error.
--
-- «Bot telecab»: el usuario con el que firma en el libro de auditoría lo que
-- hace Claude. Bloqueado: no puede entrar en el ERP. Lo crea el propio ERP la
-- primera vez que hace falta (firmas.repo.bot), no esta migración: la base de
-- pruebas no admite usuarios cargados por una migración.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/293', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS firma_envio (
  id               BIGSERIAL PRIMARY KEY,
  tipo             VARCHAR(16)  NOT NULL,
  titulo           VARCHAR(200) NOT NULL,
  origen           VARCHAR(16)  NOT NULL DEFAULT 'manual',
  origen_id        TEXT,
  conductor_id     BIGINT       NOT NULL REFERENCES conductor(id),
  -- El firmante, tal como estaba al aprobarlo (si se cambia en la ficha, se ve aquí).
  firmante_nombre  TEXT,
  firmante_email   TEXT,
  firmante_movil   TEXT,
  estado           VARCHAR(12)  NOT NULL DEFAULT 'borrador',
  nota             TEXT,
  aprobado_at      TIMESTAMPTZ,
  aprobado_por     INTEGER REFERENCES usuario(id),
  enviado_at       TIMESTAMPTZ,
  enviado_por      INTEGER REFERENCES usuario(id),
  en_nombre_de     INTEGER REFERENCES usuario(id),
  proveedor_ref    TEXT,
  proveedor_url    TEXT,
  cerrado_at       TIMESTAMPTZ,
  cerrado_por      INTEGER REFERENCES usuario(id),
  creado_por       INTEGER REFERENCES usuario(id),
  creado_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_firma_tipo CHECK (tipo IN ('finiquito', 'suspension', 'sancion', 'descuento', 'contrato', 'otro')),
  CONSTRAINT ck_firma_origen CHECK (origen IN ('manual', 'finiquito')),
  CONSTRAINT ck_firma_estado CHECK (estado IN ('borrador', 'aprobado', 'enviado', 'firmado', 'rechazado', 'caducado', 'descartado', 'error'))
);

-- Uno vivo por origen (un finiquito no entra dos veces en la cola).
CREATE UNIQUE INDEX IF NOT EXISTS uq_firma_origen ON firma_envio (origen, origen_id)
  WHERE origen <> 'manual' AND estado NOT IN ('descartado', 'error');
CREATE INDEX IF NOT EXISTS ix_firma_estado ON firma_envio (estado, creado_at DESC);

COMMENT ON TABLE firma_envio IS
  'Módulo 6 (db/293): los documentos que se mandan a firmar por YouTrust. Diana aprueba; los manda Claude («Bot telecab») en su nombre; el firmado se adjunta.';

SELECT auditoria_vigilar('firma_envio');

-- ── Quién decide: la función, en el puesto de Diana ───────────────────────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente)
SELECT 'administracion_personal', 'firmas_aprobar', FALSE
 WHERE EXISTS (SELECT 1 FROM puesto WHERE codigo = 'administracion_personal')
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion
                    WHERE puesto_codigo = 'administracion_personal' AND funcion = 'firmas_aprobar' AND anulado_at IS NULL);

-- ── Las llaves ──────────────────────────────────────────────────────────────
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/firmas'), (20, 'Diana', '/firmas/aprobar'), (1, 'Ignacio', '/firmas')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
