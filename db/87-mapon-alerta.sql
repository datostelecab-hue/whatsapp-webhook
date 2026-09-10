-- ============================================================
-- ALERTAS DE MAPON — el registro, en PostgreSQL
-- ============================================================
-- Esta pantalla no usaba hojas de cálculo, pero tenía el otro problema: llamaba
-- a la API de Mapon EN CADA CARGA. Consecuencias, todas vistas:
--
--   · Mapon se cae de vez en cuando por temas de pago, y con él la pantalla.
--     No enseñaba "esto es de hace un rato": enseñaba un error.
--   · La ventana de la API es de 31 días. Lo de antes no existe para nadie: no
--     se puede preguntar "cuántas alertas de batería dio este coche en junio".
--   · Cada persona que abría la pantalla gastaba cuota de la API.
--
-- Ahora entra por la ingesta y la pantalla lee de aquí. Lo que se pierde es la
-- inmediatez de los últimos minutos; lo que se gana es que haya historia y que
-- la pantalla no dependa de que una API conteste.
--
-- ── Sobre el solape con mapon_zona_evento ───────────────────────────────────
-- Las alertas de tipo 'in_object' (entradas y salidas de zona) también se
-- guardan en `mapon_zona_evento`, que es de quien depende el cálculo de espera
-- en área del convenio. NO se unifican ahora: aquella tabla tiene un consumidor
-- que funciona y su propia forma. Aquí está el registro general de alertas, que
-- responde a otra pregunta.

BEGIN;

CREATE TABLE mapon_alerta (
  -- Los eventos de Mapon NO traen id propio: la clave es unidad + instante +
  -- tipo, la misma que ya usaba el módulo para no repetir avisos.
  clave        VARCHAR(120) PRIMARY KEY,
  ocurrido_at  TIMESTAMPTZ  NOT NULL,
  tipo         VARCHAR(24)  NOT NULL,

  unit_id      VARCHAR(32),
  matricula    VARCHAR(16),
  -- El coche de nuestra flota, si lo reconocemos. Mapon tiene unidades que no
  -- son de esta flota y alguna que ni siquiera tiene matrícula puesta.
  vehiculo_id  BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,
  vehiculo     VARCHAR(60),

  -- Solo para 'speeding'. La velocidad y el límite que dio Mapon, sin tocar.
  velocidad    NUMERIC(5,1),
  limite       NUMERIC(5,1),
  exceso       NUMERIC(5,1),

  -- Solo para 'in_object'.
  zona         VARCHAR(120),
  sentido      VARCHAR(24),

  -- Cómo de gorda es, tal como la clasifica el módulo (grave / media / leve).
  severidad    VARCHAR(12),
  msg          TEXT,

  descarga_id  BIGINT       REFERENCES ingesta_descarga(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_malerta_fecha ON mapon_alerta (ocurrido_at DESC);
CREATE INDEX idx_malerta_tipo  ON mapon_alerta (tipo, ocurrido_at DESC);
CREATE INDEX idx_malerta_mat   ON mapon_alerta (matricula, ocurrido_at DESC);
-- Las graves son las que se miran: el índice parcial las saca sin recorrer el
-- resto, que son la mayoría.
CREATE INDEX idx_malerta_grave ON mapon_alerta (ocurrido_at DESC) WHERE severidad = 'grave';

COMMENT ON TABLE mapon_alerta IS
  'Alertas de Mapon (velocidad, zonas, alimentacion, bateria...) verbatim. La pantalla lee de aqui, no de la API';
COMMENT ON COLUMN mapon_alerta.clave IS
  'unit_id|instante|tipo. Mapon no da id propio, y esto es lo que evita duplicar cuando dos pasadas se solapan';

COMMIT;
