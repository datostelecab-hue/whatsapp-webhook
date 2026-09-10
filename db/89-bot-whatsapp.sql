-- ============================================================
-- EL BOT DE WHATSAPP, FUERA DE LAS HOJAS
-- ============================================================
-- Dos cosas que el bot hacía contra Google y que pasan aquí:
--
--   1. ABRIR Y CERRAR PUERTAS. Hasta ahora no quedaba ni rastro: el bot llamaba
--      a un Apps Script, el Apps Script hablaba con Mapon y ahí se acababa la
--      historia. Si mañana aparece un coche abierto a las cuatro de la mañana,
--      no había forma de saber quién lo abrió ni desde qué número. Ahora cada
--      orden deja fila, salga bien o salga mal.
--
--   2. LOS CÓDIGOS DE LAVADO de Ballenoil, que vivían en una pestaña donde el
--      bot marcaba a mano "Usado" y anotaba el teléfono. Un código es de un solo
--      uso y repartirlo dos veces es dinero: eso lo garantiza mejor una
--      restricción de la base que una celda.

BEGIN;

-- ── 1. Órdenes a las puertas ────────────────────────────────────────────────
-- Se guarda el INTENTO, no solo el acierto. Una orden que falla es justo la que
-- hay que poder mirar: si alguien dice "le di y no abrió", tiene que constar.
CREATE TABLE puerta_comando (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pedido_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Quién lo pidió. El teléfono es lo que llega por WhatsApp y es lo que
  -- identifica; la ficha se resuelve en el momento y se guarda enlazada, pero
  -- el nombre se copia tal cual era: quién lo pidió no cambia porque alguien
  -- edite su ficha después.
  telefono      VARCHAR(24)  NOT NULL,
  conductor_id  BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  conductor     VARCHAR(120),

  -- A qué coche. La matrícula tal como la tecleó, y el coche si lo reconocemos.
  matricula     VARCHAR(16)  NOT NULL,
  vehiculo_id   BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,
  unit_id       VARCHAR(32),

  comando       VARCHAR(24)  NOT NULL,   -- open_doors / close_doors
  ok            BOOLEAN      NOT NULL,
  respuesta     TEXT,                    -- lo que contestó Mapon, para diagnosticar
  ms            INTEGER,

  CONSTRAINT ck_puerta_comando CHECK (comando IN ('open_doors', 'close_doors'))
);

-- Las tres preguntas: "qué ha pasado hoy", "quién toca este coche" y "qué hace
-- esta persona".
CREATE INDEX idx_puerta_fecha ON puerta_comando (pedido_at DESC);
CREATE INDEX idx_puerta_veh   ON puerta_comando (vehiculo_id, pedido_at DESC) WHERE vehiculo_id IS NOT NULL;
CREATE INDEX idx_puerta_cond  ON puerta_comando (conductor_id, pedido_at DESC) WHERE conductor_id IS NOT NULL;
CREATE INDEX idx_puerta_mat   ON puerta_comando (matricula, pedido_at DESC);
-- Los fallos son pocos y son los que se van a mirar cuando alguien se queje.
CREATE INDEX idx_puerta_ko    ON puerta_comando (pedido_at DESC) WHERE NOT ok;

COMMENT ON TABLE puerta_comando IS
  'Cada orden de abrir o cerrar puertas mandada desde el bot, salga bien o mal. Es el registro para auditar quien abre que coche';

-- ── 2. Códigos de lavado de Ballenoil ───────────────────────────────────────
CREATE TABLE ballenoil_codigo (
  codigo        VARCHAR(40)  PRIMARY KEY,
  vence         DATE,
  -- Un código es de un solo uso. Que esté usado no es una palabra en una celda:
  -- es tener o no tener fecha de uso, y la restricción de abajo obliga a que
  -- venga acompañada de a quién se le dio.
  usado_at      TIMESTAMPTZ,
  telefono      VARCHAR(24),
  conductor_id  BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  id_bolt       VARCHAR(120),
  importado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  usuario_id    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,

  CONSTRAINT ck_ballenoil_uso CHECK ((usado_at IS NULL) = (telefono IS NULL))
);

-- El bot pide "uno libre que no esté vencido": el índice parcial lo saca sin
-- recorrer los miles ya gastados.
CREATE INDEX idx_ballenoil_libre ON ballenoil_codigo (vence NULLS LAST) WHERE usado_at IS NULL;
CREATE INDEX idx_ballenoil_uso   ON ballenoil_codigo (usado_at DESC) WHERE usado_at IS NOT NULL;
CREATE INDEX idx_ballenoil_tel   ON ballenoil_codigo (telefono, usado_at DESC) WHERE telefono IS NOT NULL;

COMMENT ON TABLE ballenoil_codigo IS
  'Codigos de lavado de un solo uso. Sin usado_at esta libre; con el, dice a quien se le dio y cuando';

COMMIT;
