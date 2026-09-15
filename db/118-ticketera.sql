-- ============================================================
-- 118 - LA TICKETERA: lo que piden los conductores por el formulario
-- ============================================================
-- Un conductor rellena un Formulario de Google y eso abre un ticket: unas
-- vacaciones, un coche que hace un ruido, un recibo que reclamar, un cambio de
-- cuenta. Es LO ÚNICO que sigue entrando por Google, y por una razón buena: el
-- formulario es el sitio donde la gente pide las cosas.
--
-- Todo lo demás deja de pasar por una hoja. Hasta hoy, un Apps Script hacía el
-- trabajo completo: clasificaba la gestión, buscaba el ID_BOLT cruzando el DNI
-- contra la hoja AGENDA, numeraba el ticket, lo escribía en una hoja MASTER y
-- otra vez en la bandeja de su área, y mandaba el correo. El ERP luego leía esa
-- bandeja y escribía encima.
--
-- Eran dos programas trabajando sobre las mismas filas. Aquí solo entra el dato
-- crudo del formulario y el resto ocurre en la base.
--
-- ── LO QUE SE GANA, ADEMÁS DE QUITAR UNA HOJA ───────────────────────────────
--
-- 1. LAS CUATRO ÁREAS, NO SOLO RRHH. El Apps Script repartía a RRHH, TRÁFICO,
--    TALLER y ADMINISTRACIÓN, pero el ERP solo tenía pantalla para RRHH: los
--    otros tres solo existían dentro de su hoja. Ahora son tickets como los
--    demás.
--
-- 2. LA PERSONA SE IDENTIFICA DE VERDAD. El script casaba el DNI contra una
--    hoja y, si no lo encontraba, escribía 'SIN_IDENTIFICAR' y ahí se quedaba.
--    Aquí se guarda `conductor_id`, y el ticket se puede enlazar después sin
--    reescribir nada.
--
-- 3. LAS REGLAS DE REPARTO SE PUEDEN TOCAR SIN ABRIR EL SCRIPT. Estaban a medias
--    en una pestaña CONFIG y a medias escritas a mano dentro del código. Aquí
--    están todas en una tabla, EN ORDEN, que es lo que de verdad importa: la
--    clasificación va por coincidencia de texto y la primera que encaja gana.

BEGIN;

-- ── Las áreas que reparten el trabajo ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_ticket_area (
  codigo   VARCHAR(16) PRIMARY KEY,
  etiqueta VARCHAR(60) NOT NULL,
  -- El prefijo del código del ticket: RH-20260915-0001.
  prefijo  VARCHAR(8)  NOT NULL,
  orden    SMALLINT    NOT NULL DEFAULT 0,
  activa   BOOLEAN     NOT NULL DEFAULT TRUE
);

INSERT INTO cat_ticket_area (codigo, etiqueta, prefijo, orden) VALUES
  ('RRHH',    'Recursos Humanos', 'RH', 1),
  ('TRAFICO', 'Tráfico',          'TR', 2),
  ('TALLER',  'Taller',           'TL', 3),
  ('ADMIN',   'Administración',   'AD', 4)
ON CONFLICT (codigo) DO NOTHING;

-- ── Qué clase de cosa se pide ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_ticket_subtipo (
  codigo          VARCHAR(32) PRIMARY KEY,
  etiqueta        VARCHAR(80) NOT NULL,
  area_codigo     VARCHAR(16) NOT NULL REFERENCES cat_ticket_area(codigo),
  -- Si aprobarlo mueve el cuadrante. Los que lo llevan abren un tramo de
  -- ausencia en conductor_estado_hist al ejecutarlos.
  afecta_planning BOOLEAN     NOT NULL DEFAULT FALSE,
  -- El estado del catálogo de conductores que abre, cuando afecta al planning.
  -- NULL para los que no. Es una FK a propósito: si mañana se renombra un
  -- estado, esto se entera; una cadena suelta en el código, no.
  estado_abre     VARCHAR(30) REFERENCES cat_estado_conductor(codigo),
  orden           SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO cat_ticket_subtipo (codigo, etiqueta, area_codigo, afecta_planning, estado_abre, orden) VALUES
  ('VACACIONES',          'Vacaciones',              'RRHH',    TRUE,  'vacaciones',  1),
  ('BAJA_AUSENCIA',       'Baja o ausencia',         'RRHH',    TRUE,  'baja_medica', 2),
  ('PERMISO_RETRIBUIDO',  'Permiso retribuido',      'RRHH',    TRUE,  'permiso',     3),
  ('INCIDENCIA_NOMINA',   'Incidencia de nómina',    'RRHH',    FALSE, NULL,          4),
  ('CAMBIO_CUENTA',       'Cambio de cuenta / IBAN', 'RRHH',    FALSE, NULL,          5),
  ('CAMBIO_DOMICILIO',    'Cambio de domicilio',     'RRHH',    FALSE, NULL,          6),
  ('ACTUALIZACION_DOC',   'Actualización de documentación', 'RRHH', FALSE, NULL,      7),
  ('RECOMENDACION',       'Recomendación',           'RRHH',    FALSE, NULL,          8),
  ('SIN_CLASIFICAR',      'Sin clasificar',          'RRHH',    FALSE, NULL,          9),
  ('CAMBIO_LIBRANZA',     'Cambio de libranza',      'TRAFICO', FALSE, NULL,         10),
  ('INCIDENCIA_VEHICULO', 'Incidencia del vehículo', 'TALLER',  FALSE, NULL,         11),
  ('BALLENOIL',           'Ballenoil',               'ADMIN',   FALSE, NULL,         12),
  ('REINTEGRO_GASTOS',    'Reintegro de gastos',     'ADMIN',   FALSE, NULL,         13)
ON CONFLICT (codigo) DO NOTHING;

-- ── En qué estado está ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cat_ticket_estado (
  codigo   VARCHAR(16) PRIMARY KEY,
  etiqueta VARCHAR(40) NOT NULL,
  -- Si con este estado el ticket está CERRADO. Se marca aquí y no con una lista
  -- en el código para que "¿cuántos quedan abiertos?" sea una consulta y no una
  -- lista que alguien tiene que acordarse de ampliar.
  cierra   BOOLEAN     NOT NULL DEFAULT FALSE,
  color    VARCHAR(9),
  orden    SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO cat_ticket_estado (codigo, etiqueta, cierra, color, orden) VALUES
  ('pendiente',  'Pendiente',   FALSE, '#FBBF24', 1),
  ('en_curso',   'En curso',    FALSE, '#38BDF8', 2),
  ('ejecutado',  'Ejecutado',   TRUE,  '#4ADE80', 3),
  ('aprobado',   'Aprobado',    TRUE,  '#4ADE80', 4),
  ('rechazado',  'Rechazado',   TRUE,  '#F87171', 5),
  ('no_procede', 'No procede',  TRUE,  '#94A3B8', 6)
ON CONFLICT (codigo) DO NOTHING;

-- ── EL REPARTO: qué gestión va a qué área ──────────────────────────────────
-- La clasificación va por COINCIDENCIA DE TEXTO sobre lo que el conductor eligió
-- en el formulario, y LA PRIMERA REGLA QUE ENCAJA GANA. Por eso hay `orden` y
-- por eso importa: una gestión que diga "baja por permiso" cae en BAJA_AUSENCIA
-- porque esa regla va antes, y eso es lo correcto — es una baja.
--
-- El Apps Script tenía esto partido en dos: una pestaña CONFIG editable y una
-- cascada de `if` escrita a mano dentro del código, con la pestaña ganando. Aquí
-- es una sola tabla: `manual` marca las que puso una persona, que siguen yendo
-- primero, pero se ven y se tocan en el mismo sitio que las demás.
CREATE TABLE IF NOT EXISTS ticket_routing (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Texto que se busca DENTRO de la gestión, ya normalizado (sin tildes, en
  -- minúsculas). 'ballenoil' encaja con "Solicitud de tarjeta Ballenoil".
  patron         VARCHAR(120) NOT NULL,
  -- Si la coincidencia debe ser exacta en vez de "contiene". Lo usan las reglas
  -- manuales, que nombran una gestión concreta del formulario.
  exacta         BOOLEAN      NOT NULL DEFAULT FALSE,
  subtipo_codigo VARCHAR(32)  NOT NULL REFERENCES cat_ticket_subtipo(codigo),
  orden          SMALLINT     NOT NULL,
  manual         BOOLEAN      NOT NULL DEFAULT FALSE,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (patron, exacta)
);

-- Las reglas automáticas del Apps Script, EN SU ORDEN ORIGINAL. El orden es
-- parte de la regla, no un detalle de presentación.
INSERT INTO ticket_routing (patron, subtipo_codigo, orden) VALUES
  ('ballenoil',   'BALLENOIL',           10),
  ('reintegro',   'REINTEGRO_GASTOS',    20),
  ('taller',      'INCIDENCIA_VEHICULO', 30),
  ('coche',       'INCIDENCIA_VEHICULO', 40),
  ('libranza',    'CAMBIO_LIBRANZA',     50),
  ('vacaciones',  'VACACIONES',          60),
  ('baja',        'BAJA_AUSENCIA',       70),
  ('certificado', 'BAJA_AUSENCIA',       80),
  ('ausencia',    'BAJA_AUSENCIA',       90),
  ('recomendaci', 'RECOMENDACION',      100),
  ('nomina',      'INCIDENCIA_NOMINA',  110),
  ('permiso',     'PERMISO_RETRIBUIDO', 120),
  ('domicilio',   'CAMBIO_DOMICILIO',   130),
  ('documenta',   'ACTUALIZACION_DOC',  140),
  ('cuenta',      'CAMBIO_CUENTA',      150),
  ('iban',        'CAMBIO_CUENTA',      160)
ON CONFLICT (patron, exacta) DO NOTHING;

-- ── A quién se avisa de cada área ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_area_correo (
  area_codigo VARCHAR(16) NOT NULL REFERENCES cat_ticket_area(codigo) ON DELETE CASCADE,
  email       VARCHAR(160) NOT NULL,
  PRIMARY KEY (area_codigo, email)
);

-- ── EL TICKET ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El código que ve la gente: RH-20260915-0001. Se conserva el formato del
  -- Apps Script porque está en correos ya enviados y en conversaciones.
  codigo         VARCHAR(24) NOT NULL UNIQUE,

  origen         VARCHAR(16) NOT NULL DEFAULT 'formulario',
  -- La fila de la hoja de respuestas de la que salió. Es la MARCA DE AGUA que
  -- impide traerse el mismo ticket dos veces, y el hilo para volver a la
  -- respuesta original si algo no cuadra.
  fila_form      INTEGER,
  marca_form     TIMESTAMPTZ,

  -- Quién lo pide. `conductor_id` puede faltar (el formulario lo rellena
  -- cualquiera y a veces el DNI viene mal escrito): entonces quedan el DNI, el
  -- nombre y el teléfono tal como los escribió, y se enlaza después. El Apps
  -- Script escribía 'SIN_IDENTIFICAR' y ahí moría.
  conductor_id   BIGINT REFERENCES conductor(id) ON DELETE SET NULL,
  dni            VARCHAR(24),
  nombre         VARCHAR(160),
  telefono       VARCHAR(24),

  area_codigo    VARCHAR(16) NOT NULL REFERENCES cat_ticket_area(codigo),
  subtipo_codigo VARCHAR(32) NOT NULL REFERENCES cat_ticket_subtipo(codigo),
  -- Lo que eligió en el formulario, tal cual. Se guarda aunque ya esté
  -- clasificado: es la prueba de qué pidió, y sirve para corregir el reparto.
  tipo_gestion   TEXT,
  prioridad      VARCHAR(24),
  descripcion    TEXT,
  matricula      VARCHAR(16),
  fecha_ini      DATE,
  fecha_fin      DATE,

  estado         VARCHAR(16) NOT NULL DEFAULT 'pendiente'
                 REFERENCES cat_ticket_estado(codigo),
  responsable_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  responsable    VARCHAR(160) NOT NULL DEFAULT '',
  observaciones  TEXT,
  resolucion     TEXT,

  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_at    TIMESTAMPTZ,
  resuelto_at    TIMESTAMPTZ,

  -- Un ticket cerrado tiene fecha de cierre y uno abierto no. Sin esto caben
  -- tickets "resueltos" sin saber cuándo, que es lo que rompe cualquier cuenta
  -- de cuánto se tarda en atender.
  CONSTRAINT ck_ticket_cierre CHECK (
    (estado IN ('pendiente', 'en_curso') AND resuelto_at IS NULL)
    OR (estado NOT IN ('pendiente', 'en_curso') AND resuelto_at IS NOT NULL))
);

-- La bandeja de cada área es la consulta que más se hace.
CREATE INDEX IF NOT EXISTS idx_ticket_bandeja   ON ticket (area_codigo, estado, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ticket_conductor ON ticket (conductor_id, creado_at DESC);
-- La marca de agua de la ingesta: "¿de qué fila iba?".
CREATE UNIQUE INDEX IF NOT EXISTS uq_ticket_fila_form
  ON ticket (fila_form) WHERE fila_form IS NOT NULL;

-- ── LO QUE LE HA PASADO AL TICKET ──────────────────────────────────────────
-- El Apps Script llevaba una auditoría en otra pestaña. Aquí es una tabla, y
-- guarda el estado de ANTES y el de DESPUÉS: "pasó a rechazado" sin decir desde
-- dónde no responde a la pregunta que se hace de verdad, que es si alguien
-- deshizo algo.
CREATE TABLE IF NOT EXISTS ticket_evento (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id    BIGINT NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  estado_antes VARCHAR(16),
  estado_despues VARCHAR(16),
  nota         TEXT,
  usuario_id   INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  quien        VARCHAR(160) NOT NULL DEFAULT '',
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_evento ON ticket_evento (ticket_id, creado_at);

COMMENT ON TABLE ticket IS
  'Lo que piden los conductores por el formulario de Google. Es la única entrada que sigue pasando por Google, y solo la entrada';
COMMENT ON COLUMN ticket.fila_form IS
  'Fila de la hoja de respuestas. Único: impide traerse el mismo ticket dos veces';
COMMENT ON TABLE ticket_routing IS
  'Qué gestión va a qué área. Por coincidencia de texto y EN ORDEN: la primera que encaja gana';

COMMIT;
