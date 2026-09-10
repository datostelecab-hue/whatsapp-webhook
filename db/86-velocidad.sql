-- ============================================================
-- EXCESOS DE VELOCIDAD — el registro, en PostgreSQL
-- ============================================================
-- El módulo cambia de oficio. Antes era un expediente sancionador: la primera
-- vez avisaba y a partir de la segunda abría un caso que alguien tenía que
-- aprobar a mano para mandar una plantilla distinta. Ahora es lo contrario de
-- eso, y más simple: CADA exceso se avisa, SIEMPRE con el mismo mensaje, y lo
-- que se guarda es cuántas veces se le ha dicho a cada uno y cuántas ha seguido
-- corriendo igual.
--
-- Esa lista —quién acumula avisos sin cambiar— es el dato que de verdad se
-- quería, y era justo el que la hoja de cálculo no sabía dar: los estados de
-- aprobación importaban más que la reincidencia real.
--
-- ── Una sola tabla ──────────────────────────────────────────────────────────
-- El histórico de excesos y el recuento de avisos NO son dos cosas: el recuento
-- es contar las filas que se avisaron. Con una tabla y dos índices salen las
-- dos preguntas, y ninguna puede desmentir a la otra.
--
-- ── Lo que NO se avisa ──────────────────────────────────────────────────────
-- Si no se sabe con confianza quién conducía, el exceso se registra pero no se
-- manda nada. Avisar al que no fue era malo cuando pasaba una vez; ahora que el
-- aviso es automático y repetido, sería peor.

BEGIN;

CREATE TABLE velocidad_exceso (
  -- La clave que da Mapon a la alerta. Es la que evita registrar dos veces el
  -- mismo exceso cuando dos pasadas del cron se solapan.
  clave         VARCHAR(80)  PRIMARY KEY,
  ocurrido_at   TIMESTAMPTZ  NOT NULL,

  placa         VARCHAR(16),
  vehiculo_id   BIGINT       REFERENCES vehiculo(id) ON DELETE SET NULL,

  -- Quién conducía. El uuid es lo que dice BOLT; conductor_id es su ficha, si
  -- la cuenta está enlazada. El nombre y el teléfono se guardan TAL COMO ERAN
  -- en ese momento: es a ese número al que se mandó el aviso, y cambiarlo
  -- después no puede reescribir lo que ya pasó.
  driver_uuid   VARCHAR(64),
  conductor_id  BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  conductor     VARCHAR(120),
  telefono      VARCHAR(24),

  velocidad     NUMERIC(5,1),
  limite        NUMERIC(5,1),
  exceso        NUMERIC(5,1),
  lat           NUMERIC(10,6),
  lng           NUMERIC(10,6),

  --   avisado        se le mandó el WhatsApp
  --   simulado       modo pruebas: se habría mandado
  --   sin_conductor  el coche no tenía a nadie identificable en BOLT
  --   dudoso         hay un candidato, pero el log es demasiado viejo para fiarse
  --   error          se intentó mandar y falló
  estado        VARCHAR(16)  NOT NULL,
  plantilla     VARCHAR(40),
  envio_id      VARCHAR(80),
  enviado_at    TIMESTAMPTZ,

  -- Cuántos segundos antes del exceso es el log con el que se atribuyó. Es la
  -- medida de cuánto hay que fiarse de la atribución, y por eso se guarda.
  ventana_seg   INTEGER,
  nota          TEXT,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT ck_vel_estado CHECK (estado IN
    ('avisado','simulado','sin_conductor','dudoso','error')),
  -- Un aviso enviado tiene que decir a qué número fue: si no, no es un aviso,
  -- es una anotación.
  CONSTRAINT ck_vel_avisado CHECK (estado <> 'avisado' OR telefono IS NOT NULL)
);

-- "Enséñame lo último" y "enséñame a esta persona", que son las dos pantallas.
CREATE INDEX idx_vel_fecha  ON velocidad_exceso (ocurrido_at DESC);
CREATE INDEX idx_vel_cond   ON velocidad_exceso (conductor_id, ocurrido_at DESC) WHERE conductor_id IS NOT NULL;
CREATE INDEX idx_vel_driver ON velocidad_exceso (driver_uuid, ocurrido_at DESC) WHERE driver_uuid IS NOT NULL;
-- Los que hay que mirar a mano: sin conductor o con atribución dudosa.
CREATE INDEX idx_vel_revisar ON velocidad_exceso (ocurrido_at DESC)
  WHERE estado IN ('sin_conductor','dudoso','error');

COMMENT ON TABLE velocidad_exceso IS
  'Un exceso de velocidad por fila. Contar las avisadas por conductor da el recuento de avisos; todas juntas, el historico';
COMMENT ON COLUMN velocidad_exceso.telefono IS
  'El numero al que se aviso, tal como era entonces. No se actualiza: es parte de lo que paso';
COMMENT ON COLUMN velocidad_exceso.ventana_seg IS
  'Antiguedad del log de BOLT con el que se atribuyo el exceso. Cuanto mas alto, menos fiable';

COMMIT;
