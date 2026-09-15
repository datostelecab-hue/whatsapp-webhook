-- ============================================================
-- 115 - PETICIONES: Tráfico pide, RRHH resuelve
-- ============================================================
-- Bajas y ausencias no se tocan a mano en el cuadrante. Hay dos caminos:
--
--   · Tráfico crea una PETICIÓN, que queda pendiente → RRHH aprueba o rechaza.
--   · RRHH la crea y la aplica de una vez, sin pasar por Tráfico.
--
-- Esto vivía en la pestaña `PETICIONES` de un Google Sheet, y aplicarla era un
-- paseo por TRES hojas: se escribía el estado en AGENDA_V2, la fecha de vuelta
-- en otra columna de AGENDA_V2, y las letras V/B/P día a día en VISTA_FINAL.
-- Además hacían falta dos crons: uno para poner el estado el día que la ausencia
-- empezaba, y otro para quitarlo el día que terminaba.
--
-- ── NADA DE ESO HACE FALTA AQUÍ ─────────────────────────────────────────────
-- La ausencia ya tiene su sitio: `conductor_estado_hist`, un tramo con desde y
-- hasta. Y `v_agenda` mira ese tramo POR FECHA:
--
--     LEFT JOIN conductor_estado_hist s
--            ON s.desde <= CURRENT_DATE AND (s.hasta IS NULL OR s.hasta >= CURRENT_DATE)
--
-- Así que el estado se pone y se quita solo el día que toca, sin cron, y la
-- fecha de vuelta es `hasta_previsto`. Las letras tampoco se escriben: salen de
-- `cat_estado_conductor.marca_bitacora` cuando la bitácora las pide.
--
-- Aplicar una petición pasa a ser UN INSERT. Lo que antes eran tres escrituras
-- en tres hojas, dos crons y una función que releía la bitácora entera.
--
-- ── LA COLUMNA QUE YA ESPERABA ──────────────────────────────────────────────
-- `conductor_estado_hist.peticion_id` existe desde db/01 con el comentario "FK a
-- peticion(id): se añade con el dominio RRHH". Este es ese día: se crea la tabla
-- y se cierra la clave ajena, para poder contestar "¿de dónde salió esta
-- ausencia?" señalando a quién la pidió y quién la aprobó.

BEGIN;

CREATE TABLE IF NOT EXISTS peticion (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Qué se pide. Cuatro de los cinco son un estado del catálogo; el quinto no:
  -- "reingreso" es traer de vuelta a quien causó baja, y eso no es estar en una
  -- situación, es volver a tener contrato. Por eso esto es un CHECK y no una FK
  -- a cat_estado_conductor: meter un "reingreso" falso en el catálogo de estados
  -- para poder apuntarlo aquí ensuciaría el catálogo para siempre.
  tipo            VARCHAR(24) NOT NULL
                  CHECK (tipo IN ('vacaciones', 'baja_medica', 'permiso',
                                  'baja_empresa', 'reingreso')),

  conductor_id    BIGINT NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,

  -- El rango. El reingreso no lleva ninguna (es inmediato) y la baja de empresa
  -- solo lleva la de efecto: un despido no tiene fecha de vuelta.
  desde           DATE,
  hasta           DATE,
  motivo          TEXT,

  estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),

  -- Quién la pide y quién la resuelve. Se guardan las DOS cosas: el usuario, que
  -- es el dato de verdad, y el nombre escrito a mano, porque la pantalla vieja
  -- se usaba sin login y hay peticiones históricas en las que eso es todo lo que
  -- se sabe. Perder ese nombre sería perder el único rastro que tienen.
  solicitante_id  INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  solicitante     VARCHAR(120) NOT NULL DEFAULT '',
  resuelto_por_id INTEGER REFERENCES usuario(id) ON DELETE SET NULL,
  resuelto_por    VARCHAR(120) NOT NULL DEFAULT '',
  motivo_rechazo  TEXT,

  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  resuelto_at     TIMESTAMPTZ,

  -- Una petición resuelta tiene quién y cuándo; una pendiente, ninguna de las
  -- dos. Sin esto caben "aprobadas por nadie", que es justo lo que no se puede
  -- responder cuando alguien pregunta quién autorizó unas vacaciones.
  CONSTRAINT ck_peticion_resuelta CHECK (
    (estado = 'pendiente' AND resuelto_at IS NULL AND resuelto_por = '')
    OR (estado <> 'pendiente' AND resuelto_at IS NOT NULL AND resuelto_por <> '')
  ),
  -- Lo que lleva rango, con el rango en orden.
  CONSTRAINT ck_peticion_rango CHECK (hasta IS NULL OR desde IS NULL OR hasta >= desde)
);

CREATE INDEX IF NOT EXISTS idx_peticion_pendiente ON peticion (estado, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_peticion_conductor ON peticion (conductor_id, creado_at DESC);

-- La clave ajena que db/01 dejó pendiente. SET NULL y no CASCADE: si alguien
-- borra la petición, la ausencia NO se borra — la persona estuvo de vacaciones
-- igual, y su historial no depende del papeleo que la originó.
ALTER TABLE conductor_estado_hist
  DROP CONSTRAINT IF EXISTS conductor_estado_hist_peticion_id_fkey;
ALTER TABLE conductor_estado_hist
  ADD CONSTRAINT conductor_estado_hist_peticion_id_fkey
  FOREIGN KEY (peticion_id) REFERENCES peticion(id) ON DELETE SET NULL;

COMMENT ON TABLE peticion IS
  'Bajas y ausencias que Tráfico pide y RRHH resuelve. Al aprobarse abren un tramo en conductor_estado_hist';
COMMENT ON COLUMN peticion.tipo IS
  'vacaciones/baja_medica/permiso/baja_empresa son estados del catálogo; reingreso no lo es: es volver a tener contrato';
COMMENT ON COLUMN peticion.solicitante IS
  'Nombre escrito a mano. Se conserva porque la pantalla vieja no tenía login y es el único rastro de las peticiones antiguas';

COMMIT;
