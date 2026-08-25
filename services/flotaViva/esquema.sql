-- ============================================================
-- FLOTA VIVA — que esta haciendo ahora mismo cada coche
-- ============================================================
-- Modulo NUEVO y aparte. No comparte una sola tabla con nada existente: sus
-- nombres empiezan todos por `fv_`, asi que puede convivir en la misma base que
-- cualquier otra cosa sin pisarla.
--
-- LA IDEA, en una frase: cada cinco minutos se mira que dice BOLT del conductor
-- y que dice Mapon del coche, y se guarda el TRAMO — no la foto.
--
-- Guardar fotos sueltas obligaria a recorrerlas todas para contestar "cuanto
-- lleva parado este coche". Guardando tramos, esa pregunta es leer una fila:
-- el tramo abierto ya trae desde cuando dura y cuantos km lleva. Y los km por
-- situacion salen gratis, que era lo dificil de la version anterior.

BEGIN;

-- ── Los coches, tal como los conoce BOLT ──────────────────────────────────
CREATE TABLE IF NOT EXISTS fv_vehiculo (
  uuid        VARCHAR(64) PRIMARY KEY,
  matricula   VARCHAR(15),
  flota_id    INTEGER,
  -- El id de Mapon se resuelve por matricula la primera vez y se guarda: cruzar
  -- 80 matriculas en cada vuelta es trabajo que no hace falta repetir.
  mapon_unit  BIGINT,
  visto_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fv_veh_mat ON fv_vehiculo (matricula);

-- ── Los conductores, con su telefono ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fv_conductor (
  uuid      VARCHAR(64) PRIMARY KEY,
  nombre    VARCHAR(160),
  telefono  VARCHAR(24),
  flota_id  INTEGER,
  visto_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Que situaciones hay, y como se dicen ──────────────────────────────────
-- El vocabulario de BOLT es suyo y puede cambiar sin avisarnos. Se traduce aqui
-- y no en el codigo: si maniana aparece un estado nuevo, se aniade una fila.
CREATE TABLE IF NOT EXISTS fv_cat_situacion (
  codigo     VARCHAR(20) PRIMARY KEY,
  etiqueta   VARCHAR(40) NOT NULL,
  conectado  BOOLEAN     NOT NULL,
  orden      SMALLINT    NOT NULL DEFAULT 0,
  color      VARCHAR(12)
);

INSERT INTO fv_cat_situacion (codigo, etiqueta, conectado, orden, color) VALUES
  ('viaje',        'En viaje',      TRUE,  1, 'green'),
  ('espera',       'En espera',     TRUE,  2, 'gold'),
  ('descanso',     'En descanso',   TRUE,  3, 'warn'),
  ('desconectado', 'Desconectado',  FALSE, 4, 'muted'),
  -- Para un estado de BOLT que no sepamos traducir. Sale tal cual en el panel,
  -- que es la unica forma de enterarse de que existe.
  ('otro',         'Sin clasificar', TRUE, 9, 'red')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, conectado = EXCLUDED.conectado,
  orden = EXCLUDED.orden, color = EXCLUDED.color;

-- Como llama BOLT a cada una. Varias suyas pueden caer en la misma nuestra.
CREATE TABLE IF NOT EXISTS fv_estado_bolt (
  estado    VARCHAR(40) PRIMARY KEY,
  situacion VARCHAR(20) NOT NULL REFERENCES fv_cat_situacion(codigo),
  visto_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fv_estado_bolt (estado, situacion) VALUES
  ('has_order',       'viaje'),
  ('riding',          'viaje'),
  ('on_order',        'viaje'),
  ('waiting_orders',  'espera'),
  ('waiting',         'espera'),
  ('active',          'espera'),
  ('busy',            'descanso'),
  ('inactive',        'desconectado'),
  ('offline',         'desconectado')
ON CONFLICT (estado) DO NOTHING;

-- ── EL TRAMO: lo que de verdad se guarda ──────────────────────────────────
-- Una fila por coche y racha. Mientras la situacion no cambia, la misma fila se
-- va estirando: `hasta` avanza y el odometro final sube. Cuando cambia, se
-- cierra y se abre otra.
--
-- De aqui salen las tres listas de la pantalla sin recorrer historico:
--   · conectados       → tramo abierto con situacion conectada
--   · desconectados    → tramo abierto con situacion desconectada, y `desde`
--                        dice desde cuando
--   · quien lo llevaba → el ultimo tramo cerrado que tuviera conductor
CREATE TABLE IF NOT EXISTS fv_tramo (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_uuid     VARCHAR(64) NOT NULL REFERENCES fv_vehiculo(uuid) ON DELETE CASCADE,
  conductor_uuid    VARCHAR(64) REFERENCES fv_conductor(uuid) ON DELETE SET NULL,
  situacion         VARCHAR(20) NOT NULL REFERENCES fv_cat_situacion(codigo),
  -- El estado crudo que mando BOLT. Se guarda aunque sepamos traducirlo: cuando
  -- algo no cuadre, la pregunta sera "¿que dijo BOLT exactamente?".
  estado_bolt       VARCHAR(40),
  desde             TIMESTAMPTZ NOT NULL,
  hasta             TIMESTAMPTZ,
  -- Odometro de Mapon en metros al empezar y en la ultima vuelta. La resta son
  -- los km de ese tramo, que es lo que contesta "cuanto ha rodado en descanso".
  odometro_ini_m    BIGINT,
  odometro_fin_m    BIGINT,
  vueltas           INTEGER     NOT NULL DEFAULT 1,
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo tramo abierto por coche. Lo impide la base, no la aplicacion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fv_tramo_abierto
  ON fv_tramo (vehiculo_uuid) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS idx_fv_tramo_veh ON fv_tramo (vehiculo_uuid, desde DESC);
CREATE INDEX IF NOT EXISTS idx_fv_tramo_sit ON fv_tramo (situacion, hasta);

-- ── Las vueltas, para saber si esto esta vivo ─────────────────────────────
CREATE TABLE IF NOT EXISTS fv_vuelta (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arrancada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_at  TIMESTAMPTZ,
  vehiculos     INTEGER,
  conectados    INTEGER,
  cambios       INTEGER,
  ms            INTEGER,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_fv_vuelta_fecha ON fv_vuelta (arrancada_at DESC);

-- ── Lo que pinta la pantalla ──────────────────────────────────────────────
CREATE OR REPLACE VIEW fv_ahora AS
SELECT v.uuid                                   AS vehiculo_uuid,
       v.matricula,
       v.mapon_unit,
       t.id                                     AS tramo_id,
       t.situacion,
       s.etiqueta                               AS situacion_etiqueta,
       s.conectado,
       s.color,
       s.orden                                  AS situacion_orden,
       t.estado_bolt,
       t.desde,
       -- Cuanto lleva asi. Es LA columna del panel.
       EXTRACT(EPOCH FROM (now() - t.desde))::bigint  AS segundos,
       t.conductor_uuid,
       c.nombre                                 AS conductor,
       c.telefono,
       -- Km de este tramo. En descanso o desconectado, son los km que no
       -- deberian existir.
       CASE WHEN t.odometro_fin_m IS NULL OR t.odometro_ini_m IS NULL THEN NULL
            ELSE round((t.odometro_fin_m - t.odometro_ini_m) / 1000.0, 1)
       END                                      AS km,
       t.vueltas,
       -- Quien lo llevaba la ultima vez, para los que estan desconectados.
       ult.conductor_uuid                       AS ultimo_conductor_uuid,
       ultc.nombre                              AS ultimo_conductor,
       ultc.telefono                            AS ultimo_telefono,
       ult.hasta                                AS ultimo_uso_at
  FROM fv_vehiculo v
  LEFT JOIN fv_tramo t          ON t.vehiculo_uuid = v.uuid AND t.hasta IS NULL
  LEFT JOIN fv_cat_situacion s  ON s.codigo = t.situacion
  LEFT JOIN fv_conductor c      ON c.uuid = t.conductor_uuid
  LEFT JOIN LATERAL (
    SELECT x.conductor_uuid, x.hasta
      FROM fv_tramo x
     WHERE x.vehiculo_uuid = v.uuid
       AND x.conductor_uuid IS NOT NULL
       AND x.hasta IS NOT NULL
     ORDER BY x.hasta DESC LIMIT 1) ult ON TRUE
  LEFT JOIN fv_conductor ultc   ON ultc.uuid = ult.conductor_uuid;

COMMIT;
