-- ============================================================
-- 122 - CALL CENTER: las llamadas a los conductores
-- ============================================================
-- Cada llamada se clasifica Cluster → Subcluster → Motivo → Resultado → Acción,
-- con el motivo separado del resultado a propósito: así los KPIs (% resueltas,
-- no contactados, reincidencia) salen solos.
--
-- Vivía en la hoja `CALL_CENTER` del libro de sanciones. Dos cosas la sacan de
-- ahí, y la segunda es la que importa:
--
-- 1. CADA LLAMADA ERA UNA ESCRITURA EN GOOGLE, y resolverla otra. El call center
--    se usa mientras se habla por teléfono: esperar a Google con alguien al otro
--    lado es exactamente el momento en el que no se quiere esperar.
--
-- 2. RESOLVER UNA LLAMADA ERA LEER-MODIFICAR-ESCRIBIR sobre una fila localizada
--    por su posición. Dos personas cerrando llamadas a la vez podían escribir
--    sobre la fila de la otra, y nada lo impedía: en una hoja no hay forma de
--    decir "solo si sigue pendiente". Aquí eso es un WHERE.
--
-- ── EL CATÁLOGO NO ENTRA EN LA BASE, Y ES A PROPÓSITO ───────────────────────
-- Los clusters, motivos y resultados siguen en el código (`callcenter.service`).
-- No son datos: son el vocabulario con el que se clasifica, y cada cambio
-- arrastra reglas —qué resultados valen para qué motivo, qué cuenta como «no
-- contactado»—. Meterlo en tablas daría la ilusión de que se puede cambiar desde
-- una pantalla cuando en realidad hay que tocar los KPIs a la vez.
--
-- Lo que sí se guarda es el texto elegido, ya validado contra el catálogo: si
-- mañana un motivo se renombra, las llamadas viejas siguen diciendo lo que se
-- dijo entonces. Un catálogo con clave ajena las reescribiría hacia atrás.

BEGIN;

CREATE TABLE IF NOT EXISTS llamada_cc (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La clave que ya usaba la hoja (cc-<epoch>-<azar>). Se conserva porque la
  -- pantalla la lleva en la mano para resolver una llamada.
  clave         VARCHAR(40) NOT NULL UNIQUE,

  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  agente        VARCHAR(160) NOT NULL DEFAULT '',
  agente_id     INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  direccion     VARCHAR(10) NOT NULL DEFAULT 'saliente'
                CHECK (direccion IN ('entrante', 'saliente')),

  -- A quién se llamó. El nombre se guarda SIEMPRE (es lo que se tecleó) y el id
  -- cuando se pudo resolver: la reincidencia se cuenta por persona, y por nombre
  -- se contaría mal en cuanto alguien lo escriba distinto.
  conductor_id  BIGINT REFERENCES conductor(id) ON DELETE SET NULL,
  conductor     VARCHAR(160) NOT NULL,
  telefono      VARCHAR(24) NOT NULL DEFAULT '',
  matricula     VARCHAR(16) NOT NULL DEFAULT '',
  turno         VARCHAR(12) NOT NULL DEFAULT '',

  -- La clasificación, como texto ya validado. Ver la nota de arriba.
  cluster       VARCHAR(40) NOT NULL,
  subcluster    VARCHAR(60) NOT NULL,
  motivo        VARCHAR(120) NOT NULL,
  resultado     VARCHAR(120) NOT NULL,
  accion        TEXT NOT NULL DEFAULT '',
  notas         TEXT NOT NULL DEFAULT '',

  estado        VARCHAR(12) NOT NULL DEFAULT 'resuelta'
                CHECK (estado IN ('pendiente', 'resuelta')),
  resuelto_at   TIMESTAMPTZ,
  resuelta_por  VARCHAR(160) NOT NULL DEFAULT '',
  resolucion    TEXT NOT NULL DEFAULT '',

  -- Una llamada resuelta tiene cuándo; una pendiente, no. Sin esto caben
  -- «resueltas» sin fecha, que es lo que rompe el KPI de cuánto se tarda.
  CONSTRAINT ck_cc_resuelta CHECK (
    (estado = 'pendiente' AND resuelto_at IS NULL)
    OR (estado = 'resuelta' AND resuelto_at IS NOT NULL))
);

-- El periodo es como se mira siempre: "las llamadas de esta semana".
CREATE INDEX IF NOT EXISTS idx_cc_periodo   ON llamada_cc (creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_pendiente ON llamada_cc (estado, creado_at DESC);
-- La reincidencia: mismo conductor + mismo motivo en 30 días.
CREATE INDEX IF NOT EXISTS idx_cc_reincide  ON llamada_cc (conductor_id, motivo, creado_at DESC);

COMMENT ON TABLE llamada_cc IS
  'Llamadas del call center, clasificadas Cluster→Subcluster→Motivo→Resultado→Acción';
COMMENT ON COLUMN llamada_cc.motivo IS
  'Texto del catálogo, ya validado. No es FK a propósito: renombrar un motivo no debe reescribir lo que se dijo en llamadas viejas';

COMMIT;
