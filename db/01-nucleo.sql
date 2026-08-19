-- ============================================================
-- TELECAB — NÚCLEO (PostgreSQL 15+)
-- ============================================================
-- Las identidades que todo lo demás referencia: personas, coches, usuarios,
-- y los alias que los enlazan con BOLT, Mapon y Ballenoil.
--
-- Tres convenciones que se repiten en todo el esquema:
--
--  1. NADA DE PRESENTACIÓN. Ni emojis ni símbolos: los códigos son datos y los
--     iconos los pone la interfaz. Por eso el estado operativo es 'O' y no '✓'.
--
--  2. LOS HISTORIALES CIERRAN CON NULL, no con un centinela '9999-12-31'.
--     En PostgreSQL la fila abierta se protege con un ÍNDICE PARCIAL
--     (... WHERE hasta IS NULL), que sí garantiza una sola. En MySQL esto
--     obligaba a inventarse una fecha centinela porque un UNIQUE con NULL no
--     restringe nada; aquí no hace falta.
--
--  3. EL NOMBRE NUNCA ES CLAVE. Cada persona y cada coche tienen id propio, y
--     los alias guardan con qué identificador los conoce cada sistema externo.
--     Cruzar por nombre es lo que hoy falla en producción.

BEGIN;

-- ── Catálogos sin dependencias ──────────────────────────────────────────────

CREATE TABLE rol (
  id            SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo        VARCHAR(30)  NOT NULL,
  etiqueta      VARCHAR(60)  NOT NULL,
  acceso_total  BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_rol_codigo UNIQUE (codigo)
);
COMMENT ON COLUMN rol.acceso_total IS 'Salta el control por módulo: superadmin y desarrollador';

CREATE TABLE cat_modulo (
  codigo    VARCHAR(40) PRIMARY KEY,
  etiqueta  VARCHAR(60) NOT NULL,
  activo    BOOLEAN     NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE cat_modulo IS 'Secciones del ERP. Sustituye a los prefijos sueltos de la constante ACCESO';

CREATE TABLE rol_modulo (
  rol_id          SMALLINT    NOT NULL REFERENCES rol(id) ON DELETE CASCADE,
  modulo          VARCHAR(40) NOT NULL REFERENCES cat_modulo(codigo) ON DELETE CASCADE,
  puede_leer      BOOLEAN     NOT NULL DEFAULT TRUE,
  puede_escribir  BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (rol_id, modulo)
);
CREATE INDEX idx_rolmod_modulo ON rol_modulo (modulo);

CREATE TABLE cat_estado_vehiculo (
  codigo             VARCHAR(4)  PRIMARY KEY,
  etiqueta           VARCHAR(40) NOT NULL,
  es_operativo       BOOLEAN     NOT NULL,
  visible_cobertura  BOOLEAN     NOT NULL DEFAULT TRUE,
  orden              SMALLINT    NOT NULL DEFAULT 0
);
COMMENT ON TABLE cat_estado_vehiculo IS
  'Estados del coche. Solo códigos: el icono lo decide la interfaz. El operativo es O; en la hoja de cálculo era un símbolo';

CREATE TABLE flota (
  id            SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER      NOT NULL,
  nombre        VARCHAR(80)  NOT NULL,
  region        VARCHAR(40)  NOT NULL,
  activa_desde  DATE,
  activa_hasta  DATE,
  CONSTRAINT uq_flota_company UNIQUE (company_id),
  CONSTRAINT ck_flota_rango CHECK (activa_hasta IS NULL OR activa_hasta >= activa_desde)
);
COMMENT ON COLUMN flota.company_id IS 'company_id de BOLT. activa_hasta NULL = sigue activa';

CREATE TABLE base_zona (
  id           SMALLINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre       VARCHAR(80)   NOT NULL,
  nombre_norm  VARCHAR(80)   GENERATED ALWAYS AS (lower(btrim(nombre))) STORED,
  lat          NUMERIC(9,6)  NOT NULL,
  lng          NUMERIC(9,6)  NOT NULL,
  activa       BOOLEAN       NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_base_nombre_norm UNIQUE (nombre_norm)
);

-- ── Conductores ─────────────────────────────────────────────────────────────

CREATE TABLE conductor (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  es_centinela      BOOLEAN       NOT NULL DEFAULT FALSE,
  nombre            VARCHAR(80)   NOT NULL,
  apellidos         VARCHAR(120),
  nombre_ss         VARCHAR(200),
  dni_nie           VARCHAR(15),
  naf               VARCHAR(20),
  fecha_nacimiento  DATE,
  nacionalidad      VARCHAR(60),
  email             VARCHAR(160),
  direccion         VARCHAR(255),
  codigo_postal     VARCHAR(10),
  localidad         VARCHAR(80),
  provincia         VARCHAR(80),
  lat               NUMERIC(9,6),
  lng               NUMERIC(9,6),
  iban_cifrado      BYTEA,
  tel_emergencia    VARCHAR(20),
  recomendador      VARCHAR(120),
  observaciones     TEXT,
  empleo_vigente    BOOLEAN       NOT NULL DEFAULT FALSE,
  creado_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
  actualizado_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT ck_cond_dni_no_vacio CHECK (dni_nie IS NULL OR btrim(dni_nie) <> '')
);
-- El DNI es único cuando existe; los que no lo tienen no chocan entre sí.
CREATE UNIQUE INDEX uq_cond_dni ON conductor (upper(btrim(dni_nie))) WHERE dni_nie IS NOT NULL;
CREATE INDEX idx_cond_empleo    ON conductor (empleo_vigente);
CREATE INDEX idx_cond_apellidos ON conductor (apellidos, nombre);
COMMENT ON COLUMN conductor.es_centinela IS
  'Fila comodín para imputar horas cuyo conductor no se resuelve. Sin ella se perderían';
COMMENT ON COLUMN conductor.empleo_vigente IS
  'CACHÉ del periodo abierto en conductor_periodo_empleo. La verdad está allí';

CREATE TABLE conductor_periodo_empleo (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  alta          DATE        NOT NULL,
  baja          DATE,
  motivo_baja   VARCHAR(255),
  peticion_id   BIGINT,      -- FK a peticion(id): se añade con el dominio RRHH
  usuario_id    INTEGER,     -- FK a usuario(id): se añade abajo, tras crear usuario
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_empleo_rango CHECK (baja IS NULL OR baja >= alta)
);
-- Un conductor solo puede tener UN periodo de empleo abierto a la vez.
CREATE UNIQUE INDEX uq_empleo_abierto ON conductor_periodo_empleo (conductor_id) WHERE baja IS NULL;
CREATE INDEX idx_empleo_rango ON conductor_periodo_empleo (alta, baja);
COMMENT ON TABLE conductor_periodo_empleo IS
  'Altas y bajas. Un conductor puede irse y volver: por eso no son columnas de conductor';

CREATE TABLE conductor_alias (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  tipo          VARCHAR(20)  NOT NULL,
  alias         VARCHAR(200) NOT NULL,
  alias_norm    VARCHAR(200) NOT NULL,
  ambiguo       BOOLEAN      NOT NULL DEFAULT FALSE,
  vigente       BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_alias_tipo CHECK (tipo IN
    ('bolt_nombre','ss_nombre','libranzas','mapon_nombre','vista_final','manual')),
  CONSTRAINT uq_alias UNIQUE (alias_norm, conductor_id, tipo)
);
-- Un alias no ambiguo apunta a UNA sola persona: es lo que hace fiable el cruce.
CREATE UNIQUE INDEX uq_alias_resoluble ON conductor_alias (alias_norm) WHERE NOT ambiguo AND vigente;
CREATE INDEX idx_alias_cond  ON conductor_alias (conductor_id);
CREATE INDEX idx_alias_busq  ON conductor_alias (alias_norm);
COMMENT ON TABLE conductor_alias IS
  'Con qué nombre conoce cada sistema a esta persona. Sustituye a normClave/normNombre y al cruce por nombre';
COMMENT ON COLUMN conductor_alias.ambiguo IS
  'El mismo alias vale para varias personas: se marca y NO se usa para resolver automáticamente';
COMMENT ON COLUMN conductor_alias.alias_norm IS
  'Normalizado por la aplicación (sin tildes, minúsculas, palabras ordenadas). PostgreSQL distingue mayúsculas: comparar SIEMPRE por esta columna';

CREATE TABLE conductor_telefono (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  e164           VARCHAR(20) NOT NULL,
  sufijo9        CHAR(9)     GENERATED ALWAYS AS (right(regexp_replace(e164, '[^0-9]', '', 'g'), 9)) STORED,
  origen         VARCHAR(20) NOT NULL,
  principal      BOOLEAN     NOT NULL DEFAULT FALSE,
  vigente_desde  DATE        NOT NULL DEFAULT CURRENT_DATE,
  vigente_hasta  DATE,
  CONSTRAINT ck_tel_origen CHECK (origen IN
    ('agenda','bolt','db_conductores','ticket','fichaje','manual')),
  CONSTRAINT ck_tel_rango CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
-- Un número vigente pertenece a UNA persona: si no, el bot no sabe quién llama.
CREATE UNIQUE INDEX uq_tel_sufijo_vigente ON conductor_telefono (sufijo9) WHERE vigente_hasta IS NULL;
CREATE UNIQUE INDEX uq_tel_principal ON conductor_telefono (conductor_id) WHERE principal AND vigente_hasta IS NULL;
CREATE INDEX idx_tel_cond ON conductor_telefono (conductor_id);
COMMENT ON COLUMN conductor_telefono.sufijo9 IS
  'Últimos 9 dígitos: es como cruza hoy el bot, con o sin prefijo +34';

-- ── Usuarios del ERP ────────────────────────────────────────────────────────

CREATE TABLE usuario (
  id                   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                VARCHAR(160) NOT NULL,
  nombre               VARCHAR(80)  NOT NULL,
  apellidos            VARCHAR(120),
  telefono             VARCHAR(20),
  conductor_id         BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  rol_id               SMALLINT     NOT NULL REFERENCES rol(id),
  pass_hash            VARCHAR(160) NOT NULL,
  estado               VARCHAR(15)  NOT NULL DEFAULT 'provisional',
  debe_cambiar         BOOLEAN      NOT NULL DEFAULT TRUE,
  pass_correo_cifrada  BYTEA,
  tema                 VARCHAR(24),
  creado_por           INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultimo_acceso        TIMESTAMPTZ,
  CONSTRAINT ck_usuario_estado CHECK (estado IN ('provisional','activo','bloqueado'))
);
-- Sin distinguir mayúsculas: en MySQL era automático, en PostgreSQL hay que pedirlo.
CREATE UNIQUE INDEX uq_usuario_email ON usuario (lower(email));
CREATE INDEX idx_usuario_rol ON usuario (rol_id, estado);

-- Ahora que existe usuario, se cierran las foráneas que lo apuntaban.
ALTER TABLE conductor_periodo_empleo
  ADD CONSTRAINT fk_empleo_usuario FOREIGN KEY (usuario_id) REFERENCES usuario(id) ON DELETE SET NULL;

CREATE TABLE usuario_acceso_log (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id        INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  email_intentado   VARCHAR(160) NOT NULL,
  evento            VARCHAR(20)  NOT NULL,
  ip                INET,
  ts_utc            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  detalle           JSONB,
  CONSTRAINT ck_acclog_evento CHECK (evento IN
    ('login_ok','login_fallo','bloqueo','logout','cambio_pass','cambio_rol','cambio_estado'))
);
CREATE INDEX idx_acclog_ts    ON usuario_acceso_log (ts_utc DESC);
CREATE INDEX idx_acclog_email ON usuario_acceso_log (email_intentado, ts_utc DESC);
COMMENT ON COLUMN usuario_acceso_log.ip IS 'Tipo INET nativo: ordena y filtra por rango sin trucos';

-- ── Vehículos ───────────────────────────────────────────────────────────────

CREATE TABLE vehiculo (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matricula            VARCHAR(15)  NOT NULL,
  matricula_norm       VARCHAR(15)  GENERATED ALWAYS AS
                         (upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g'))) STORED,
  baja_at              TIMESTAMPTZ,
  marca_modelo         VARCHAR(120),
  anio                 SMALLINT,
  fecha_matriculacion  DATE,
  itv_caduca           DATE,
  aseguradora          VARCHAR(80),
  seguro_caduca        DATE,
  estado_operativo     VARCHAR(4)   NOT NULL REFERENCES cat_estado_vehiculo(codigo),
  base_zona_id         SMALLINT     REFERENCES base_zona(id) ON DELETE SET NULL,
  km_odometro_m        INTEGER,
  km_odometro_at       TIMESTAMPTZ,
  notas                TEXT,
  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_veh_anio CHECK (anio IS NULL OR anio BETWEEN 1980 AND 2100),
  CONSTRAINT ck_veh_odometro CHECK (km_odometro_m IS NULL OR km_odometro_m >= 0),
  -- Un odómetro sin fecha no significa nada.
  CONSTRAINT ck_veh_odometro_fecha CHECK ((km_odometro_m IS NULL) = (km_odometro_at IS NULL))
);
-- Una matrícula solo puede estar viva una vez; las dadas de baja pueden repetirse.
CREATE UNIQUE INDEX uq_veh_matnorm_viva ON vehiculo (matricula_norm) WHERE baja_at IS NULL;
CREATE INDEX idx_veh_zona_estado ON vehiculo (base_zona_id, estado_operativo);
CREATE INDEX idx_veh_itv    ON vehiculo (itv_caduca)    WHERE baja_at IS NULL;
CREATE INDEX idx_veh_seguro ON vehiculo (seguro_caduca) WHERE baja_at IS NULL;
COMMENT ON COLUMN vehiculo.km_odometro_m IS 'METROS, como los da Mapon. Sin conversiones a mitad de camino';
COMMENT ON COLUMN vehiculo.estado_operativo IS
  'CACHÉ del vigente en vehiculo_estado_hist. Para saber el estado en una fecha pasada, consultar el historial';

CREATE TABLE vehiculo_estado_hist (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id    BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  estado_codigo  VARCHAR(4)  NOT NULL REFERENCES cat_estado_vehiculo(codigo),
  desde          DATE        NOT NULL,
  hasta          DATE,
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_vehest_rango CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX uq_vehest_abierto ON vehiculo_estado_hist (vehiculo_id) WHERE hasta IS NULL;
CREATE INDEX idx_vehest_fecha ON vehiculo_estado_hist (desde, hasta, estado_codigo);
COMMENT ON TABLE vehiculo_estado_hist IS
  'Sin esto, recalcular un mes pasado usaría el estado de HOY y saldrían mal la cobertura y las auditorías';

CREATE TABLE vehiculo_base_hist (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id   BIGINT   NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  base_zona_id  SMALLINT NOT NULL REFERENCES base_zona(id),
  desde         DATE     NOT NULL,
  hasta         DATE,
  usuario_id    INTEGER  REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_vehbase_rango CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE UNIQUE INDEX uq_vehbase_abierto ON vehiculo_base_hist (vehiculo_id) WHERE hasta IS NULL;
CREATE INDEX idx_vehbase_fecha ON vehiculo_base_hist (desde, hasta);
COMMENT ON TABLE vehiculo_base_hist IS 'Los km de marzo se imputan a la zona que el coche tenía en marzo';

CREATE TABLE vehiculo_alias (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id        BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  sistema            VARCHAR(12) NOT NULL,
  externo_id         VARCHAR(64) NOT NULL,
  externo_matricula  VARCHAR(30),
  visto_desde        TIMESTAMPTZ NOT NULL DEFAULT now(),
  visto_hasta        TIMESTAMPTZ,
  CONSTRAINT ck_valias_sistema CHECK (sistema IN ('bolt','mapon','ballenoil')),
  CONSTRAINT uq_valias UNIQUE (sistema, externo_id, visto_desde),
  CONSTRAINT ck_valias_rango CHECK (visto_hasta IS NULL OR visto_hasta >= visto_desde)
);
-- Un coche tiene UN identificador vigente por sistema.
CREATE UNIQUE INDEX uq_valias_vigente ON vehiculo_alias (vehiculo_id, sistema) WHERE visto_hasta IS NULL;
CREATE INDEX idx_valias_veh ON vehiculo_alias (vehiculo_id, sistema);
COMMENT ON TABLE vehiculo_alias IS
  'ÚNICO puente coche↔sistema externo. El uuid de BOLT y el unit_id de Mapon NO se enlazan entre sí: los dos pasan por aquí';
COMMENT ON COLUMN vehiculo_alias.externo_matricula IS
  'La matrícula tal como la escribe el sistema externo. Solo para diagnosticar descuadres: NUNCA para cruzar';

COMMIT;
