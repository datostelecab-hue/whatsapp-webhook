-- ============================================================
-- 212 · LOS REPOSTAJES QUE LLEGAN POR CORREO
-- ============================================================
-- Camilo, 22/10/2026: «Vamos con la conexión del correo telecab.es para que lea
-- la estructura». Cada repostaje con la tarjeta DNI & GO de Ballenoil llega como
-- un correo a datos@telecab.es: estación, conductor de la tarjeta, matrícula, km,
-- la hora del cargo y la del repostaje, importes y litros. El ERP lo lee solo
-- (modules/Combustible), lo guarda aquí y lo enseña en /combustible. Petroprix
-- mandará los suyos; su lector está preparado y vacío hasta tener su estructura.
--
-- La idea de fondo es AUDITARLOS con Mapon (¿estaba el coche en esa estación a
-- esa hora?, ¿cuadran los km?). Eso no es de esta tanda: aquí se deja sitio.
--
-- DOS TABLAS:
--
--   · repostaje — UNA FILA POR CORREO, también los que no se entienden. Un
--     correo que el lector no sabe leer se guarda como «no_leido» con el motivo
--     y sus partes tal cual llegaron: no se pierde, y cuando el lector mejore se
--     vuelve a leer desde aquí, sin ir al buzón. Y uno que se lee pero la base
--     no acepta (un valor que no cabe), también: «no_leido», con el porqué.
--
--     No se duplica por tres lados, porque los tres han pasado o van a pasar:
--       1. El mismo correo leído dos veces: el Message-ID es único.
--       2. Un correo sin Message-ID: el UID del buzón (con su carpeta y su
--          UIDVALIDITY: los UID son por carpeta, y se leen INBOX y Spam).
--       3. El mismo repostaje en dos correos —el de Ballenoil y el que alguien
--          de la oficina reenvía—: solo uno queda «leido»; el otro, «repetido»,
--          apuntando al primero.
--
--   · repostaje_lectura — una fila por pasada por el buzón (el cron cada 10 min
--     o el botón «Leer el buzón ahora»): cuántos vio, guardó, no entendió, y el
--     error si no pudo entrar. Es lo que la pantalla enseña como «última
--     lectura» y lo que dice, sin abrir el log, que la contraseña dejó de valer.

BEGIN;

CREATE TABLE IF NOT EXISTS repostaje (
  id                   BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- ── El correo ─────────────────────────────────────────────────────────────
  proveedor            VARCHAR(20)  NOT NULL,          -- ballenoil, petroprix…
  mensaje_id           VARCHAR(400),                   -- la cabecera Message-ID, tal cual
  buzon                VARCHAR(120) NOT NULL,          -- de qué buzón se leyó
  buzon_carpeta        VARCHAR(60)  NOT NULL DEFAULT 'INBOX',  -- INBOX o Spam: los UID son por carpeta
  buzon_uidvalidity    BIGINT,
  buzon_uid            BIGINT,
  remitente            VARCHAR(200),                   -- el del proveedor (también si vino reenviado)
  reenviado_por        VARCHAR(200),                   -- quién de la casa lo reenvió, si fue así
  asunto               VARCHAR(500),
  recibido_at          TIMESTAMPTZ  NOT NULL,          -- cuándo llegó al buzón
  cuerpo_texto         TEXT,                           -- el cuerpo en texto plano: lo que enseña la ficha
  cuerpo_partes        JSONB,                          -- las partes tal cual llegaron: para releerlo
  remitente_verificado BOOLEAN,                        -- firma DKIM del proveedor: sí, no, o no se sabe (NULL)
  firma_detalle        VARCHAR(300),                   -- qué dijo la firma, en una frase

  -- ── La lectura ────────────────────────────────────────────────────────────
  estado               VARCHAR(10)  NOT NULL DEFAULT 'leido',
  motivo               TEXT,                           -- por qué no se pudo leer
  avisos               TEXT[],                         -- se leyó, pero algo no cuadra
  repetido_de          BIGINT       REFERENCES repostaje(id) ON DELETE SET NULL,
  lector_version       SMALLINT     NOT NULL DEFAULT 0, -- la versión del lector que lo leyó

  -- ── Lo que dice el correo ─────────────────────────────────────────────────
  estacion             VARCHAR(160),
  conductor_texto      VARCHAR(200),                   -- tal cual: «PROVISIONAL 52 [chico de apoyo]»
  tarjeta_provisional  BOOLEAN      NOT NULL DEFAULT FALSE,
  tarjeta_nota         VARCHAR(200),                   -- lo que va entre corchetes: «TALLER GUTI»
  matricula            VARCHAR(15),
  matricula_norm       VARCHAR(15)  GENERATED ALWAYS AS
                         (upper(regexp_replace(matricula, '[^A-Za-z0-9]', '', 'g'))) STORED,
  km                   INTEGER,                        -- el que teclea el conductor en el surtidor
  cargo_at             TIMESTAMPTZ,
  repostaje_at         TIMESTAMPTZ,
  importe_recarga      NUMERIC(8, 2),                  -- lo que se cargó en la tarjeta
  importe              NUMERIC(8, 2),                  -- lo que costó el repostaje
  devuelto             NUMERIC(8, 2),                  -- lo que volvió al saldo de la tarjeta
  litros               NUMERIC(7, 3),
  -- Desde un litro: con unos litros diminutos la división desbordaría la
  -- columna y la base rechazaría el correo entero.
  precio_litro         NUMERIC(9, 3) GENERATED ALWAYS AS
                         (CASE WHEN litros >= 1 THEN round(importe / litros, 3) END) STORED,
  carburante           VARCHAR(60),
  ahorro               NUMERIC(8, 2),                  -- «ha ahorrado X € frente a la competencia»

  -- ── Con qué casa en el ERP ────────────────────────────────────────────────
  vehiculo_id          BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,
  sede                 VARCHAR(16)  REFERENCES cat_sede(codigo),
  conductor_id         BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  conductor_cuenta_bolt VARCHAR(64),                   -- la cuenta de BOLT con ese nombre (Barcelona no tiene fichas)
  conductor_como       VARCHAR(10),                    -- cómo casó el nombre de la tarjeta

  -- ── Quién estaba conectado en BOLT con ese coche a esa hora ───────────────
  bolt_estado          VARCHAR(10),
  bolt_conductor_uuid  VARCHAR(64),
  bolt_conductor_id    BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  bolt_nombre          VARCHAR(200),
  bolt_situacion       VARCHAR(20),
  bolt_antiguedad_min  INTEGER,
  bolt_mirado_at       TIMESTAMPTZ,
  coincide             BOOLEAN,                        -- la tarjeta y BOLT son la misma persona

  -- ── La auditoría con Mapon (todavía no se hace) ───────────────────────────
  auditoria_estado     VARCHAR(16)  NOT NULL DEFAULT 'pendiente',
  auditoria_at         TIMESTAMPTZ,
  auditoria_detalle    JSONB,

  creado_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  actualizado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT ck_rep_estado   CHECK (estado IN ('leido', 'no_leido', 'repetido')),
  -- Un repostaje «leido» trae lo mínimo para auditarlo; si no, no es «leido».
  CONSTRAINT ck_rep_leido    CHECK (estado <> 'leido' OR (matricula IS NOT NULL AND repostaje_at IS NOT NULL
                                                          AND importe IS NOT NULL AND litros IS NOT NULL)),
  CONSTRAINT ck_rep_no_leido CHECK (estado <> 'no_leido' OR motivo IS NOT NULL),
  -- 0 litros vale: un repostaje anulado (0 litros, 0 € y la recarga devuelta).
  CONSTRAINT ck_rep_cifras   CHECK ((litros IS NULL OR litros >= 0) AND (importe IS NULL OR importe >= 0)
                                    AND (km IS NULL OR km >= 0)),
  CONSTRAINT ck_rep_como     CHECK (conductor_como IS NULL OR conductor_como IN ('exacto', 'parecido', 'ambiguo', 'nadie')),
  CONSTRAINT ck_rep_bolt     CHECK (bolt_estado IS NULL OR bolt_estado IN ('conectado', 'ultimo', 'nadie', 'sin_coche', 'pendiente', 'sin_datos'))
);

-- Los tres candados contra los duplicados (arriba, en la cabecera).
CREATE UNIQUE INDEX IF NOT EXISTS ux_rep_mensaje ON repostaje (mensaje_id) WHERE mensaje_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_rep_uid ON repostaje (buzon, buzon_carpeta, buzon_uidvalidity, buzon_uid) WHERE buzon_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_rep_repostaje ON repostaje (proveedor, matricula_norm, repostaje_at, importe)
  WHERE estado = 'leido';

CREATE INDEX IF NOT EXISTS ix_rep_fecha     ON repostaje (repostaje_at DESC);
CREATE INDEX IF NOT EXISTS ix_rep_recibido  ON repostaje (recibido_at DESC);
CREATE INDEX IF NOT EXISTS ix_rep_matricula ON repostaje (matricula_norm, repostaje_at DESC);
CREATE INDEX IF NOT EXISTS ix_rep_vehiculo  ON repostaje (vehiculo_id, repostaje_at DESC) WHERE vehiculo_id IS NOT NULL;
-- Lo que cada pasada vuelve a mirar: los que no se entendieron y los que BOLT
-- aún no cubría. Pocos, y así no se recorre la tabla entera cada diez minutos.
CREATE INDEX IF NOT EXISTS ix_rep_no_leido  ON repostaje (recibido_at) WHERE estado = 'no_leido';
CREATE INDEX IF NOT EXISTS ix_rep_bolt_pend ON repostaje (repostaje_at) WHERE bolt_estado = 'pendiente';
CREATE INDEX IF NOT EXISTS ix_rep_auditoria ON repostaje (repostaje_at) WHERE auditoria_estado = 'pendiente' AND estado = 'leido';

COMMENT ON TABLE repostaje IS
  'Los repostajes que llegan por correo (Ballenoil DNI & GO; Petroprix preparado): una fila por correo, también los que no se entienden, sin duplicar por Message-ID, UID ni repostaje. Los lee modules/Combustible (db/212)';
COMMENT ON COLUMN repostaje.estado IS
  'leido = se entendió y cuenta; no_leido = el lector no lo entendió (motivo dice qué faltó; se relee solo cuando el lector cambia de versión); repetido = el mismo repostaje ya estaba en otro correo (repetido_de)';
COMMENT ON COLUMN repostaje.cuerpo_texto IS
  'El cuerpo del correo ya pasado a texto plano, el que se leyó (todas sus partes si no se entendió). Es lo que enseña la ficha';
COMMENT ON COLUMN repostaje.cuerpo_partes IS
  'Las partes text/plain y text/html tal cual llegaron, [{tipo, contenido}]. Con esto se vuelve a leer un correo sin ir al buzón, con el código de ese día';
COMMENT ON COLUMN repostaje.remitente_verificado IS
  'true = trae la firma DKIM válida del dominio del proveedor; false = no la trae o no vale (lleva un aviso); NULL = no se puede saber (reenviado por la oficina, o el DNS no contestó). DonDominio no deja su veredicto en Authentication-Results: lo comprueba services/dkim';
COMMENT ON COLUMN repostaje.lector_version IS
  'La versión del lector del proveedor que lo leyó. Si el lector sube de versión, los no_leido se vuelven a leer solos';
COMMENT ON COLUMN repostaje.conductor_texto IS
  'Lo que dice el correo en «Conductor», tal cual. Puede ser una persona, una tarjeta provisional («PROVISIONAL 54») o una nota entre corchetes («[TALLER GUTI]»)';
COMMENT ON COLUMN repostaje.km IS
  'Los km que teclea el conductor en el surtidor. No son de fiar (salen «20» o «400»): contrastarlos con Mapon es de la auditoría';
COMMENT ON COLUMN repostaje.repostaje_at IS
  'La hora del repostaje que dice el correo, que es hora de Madrid, guardada como instante';
COMMENT ON COLUMN repostaje.sede IS
  'La sede del coche: la de Vehículos o, si no está dado de alta, la de la empresa de BOLT que lo tiene. NULL si no se sabe';
COMMENT ON COLUMN repostaje.conductor_como IS
  'Cómo casó el nombre de la tarjeta: exacto (mismas palabras), parecido (unas contienen a las otras), ambiguo (vale para más de una persona: no se enlaza), nadie. NULL si la tarjeta no es de una persona';
COMMENT ON COLUMN repostaje.bolt_estado IS
  'conectado = alguien llevaba ese coche conectado en BOLT a esa hora; ultimo = el último que lo llevó, ya desconectado (bolt_antiguedad_min dice hace cuánto); nadie = BOLT no lo tenía con nadie; sin_coche = el coche no está en BOLT (se vuelve a mirar un mes, por si se da de alta); pendiente = BOLT aún no ha llegado a esa hora (se vuelve a mirar tres días); sin_datos = BOLT no llegó a esa hora en tres días y ya no se mira';
COMMENT ON COLUMN repostaje.coincide IS
  'La persona de la tarjeta es la que estaba en BOLT con el coche. NULL si no se puede comparar (tarjeta provisional, sin nombre o sin nadie en BOLT)';
COMMENT ON COLUMN repostaje.auditoria_estado IS
  'Lo rellenará la auditoría con Mapon (aún no hecha): pendiente hasta entonces. Sin CHECK a propósito: los estados los decidirá esa tanda';

CREATE TABLE IF NOT EXISTS repostaje_lectura (
  id            BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empezada_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  terminada_at  TIMESTAMPTZ,
  origen        VARCHAR(8)   NOT NULL,                 -- cron | manual
  usuario_id    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  buzon         VARCHAR(120),
  desde         DATE,                                  -- desde qué día se buscó en el buzón
  vistos        INTEGER      NOT NULL DEFAULT 0,       -- correos en esa ventana
  candidatos    INTEGER      NOT NULL DEFAULT 0,       -- de un proveedor (o reenviados por la casa)
  ya_estaban    INTEGER      NOT NULL DEFAULT 0,
  nuevos        INTEGER      NOT NULL DEFAULT 0,       -- leídos y guardados
  no_leidos     INTEGER      NOT NULL DEFAULT 0,
  repetidos     INTEGER      NOT NULL DEFAULT 0,
  releidos      INTEGER      NOT NULL DEFAULT 0,       -- no_leido que el lector de ahora sí entiende
  recasados     INTEGER      NOT NULL DEFAULT 0,       -- leídos que casaron con un coche o una sede que antes no
  otros         INTEGER      NOT NULL DEFAULT 0,       -- del proveedor pero sin el asunto de un repostaje (no se guardan)
  bolt_mirados  INTEGER      NOT NULL DEFAULT 0,       -- a los que se les puso quién llevaba el coche en BOLT
  fallos        INTEGER      NOT NULL DEFAULT 0,       -- correos (o cruces con BOLT) que dieron error
  modo_pruebas  BOOLEAN      NOT NULL DEFAULT FALSE,
  error         TEXT,                                  -- no se pudo entrar al buzón, y por qué
  error_tipo    VARCHAR(12),                           -- contrasena | servidor | config | tope | otro
  -- La huella (SHA-256, 16 caracteres) de la contraseña CIFRADA de la ficha del
  -- buzón. Con un error de contraseña, el cron no vuelve a intentarlo hasta que
  -- la ficha tenga otra: reintentar cada 10 minutos una que no vale puede hacer
  -- que el servidor bloquee la IP, que es la que manda todos los correos.
  pass_huella   VARCHAR(16),
  detalle       JSONB,                                 -- los no leídos, los fallos y los «otros», con su motivo
  CONSTRAINT ck_replec_origen CHECK (origen IN ('cron', 'manual')),
  CONSTRAINT ck_replec_tipo   CHECK (error_tipo IS NULL OR error_tipo IN ('contrasena', 'servidor', 'config', 'tope', 'otro'))
);

CREATE INDEX IF NOT EXISTS ix_replec_empezada ON repostaje_lectura (empezada_at DESC);

COMMENT ON TABLE repostaje_lectura IS
  'Una fila por pasada por el buzón de los repostajes (cron cada 10 min o «Leer el buzón ahora»): qué vio, qué guardó, qué no entendió y si no pudo entrar. Se guardan 30 días (90 las que fallaron) (db/212)';

COMMIT;
