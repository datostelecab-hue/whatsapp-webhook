-- ============================================================
-- 148 — QUIÉN FICHA EL COCHE, PERSONA A PERSONA
-- ============================================================
-- El fichaje de turno por WhatsApp (iniciar suelta el motor, terminar lo
-- bloquea) llevaba desde el 16/09/2026 en pruebas, abierto solo a los
-- teléfonos de una variable de entorno. Ahora se enciende por persona, desde
-- el ERP, para empezar con unos conductores concretos. Lo pidió Camilo el
-- 24/09/2026:
--
--   · a los CONDUCTORES, desde el planificador (botón «Fichaje»);
--   · a la gente de la EMPRESA, desde /usuarios. Ellos no hacen turnos: cogen
--     un coche para algo y lo devuelven, así que lo suyo es un VIAJE.
--
-- Cuando sea obligatorio para todos, el interruptor se quita.
--
-- ── EL RELEVO ──────────────────────────────────────────────────────────────
-- El conductor pulsa «Voy al relevo» JUSTO ANTES de arrancar hacia el sitio
-- donde le da el coche a su compañero. Se apunta la hora: los km de ese
-- trayecto son de trabajo aunque BOLT esté cerrado, y hasta ahora se contaban
-- como "sin nadie fichado".
--
-- ── LAS ÓRDENES A MANO ─────────────────────────────────────────────────────
-- Tráfico puede soltar el motor de un coche desde el planificador —es la
-- salida si alguien se lo encuentra cortado—. Soltar un motor a mano es
-- justo lo que alguien haría para dejar a otro usar un coche sin fichar, así
-- que queda escrito quién, cuándo, por qué y qué contestó el coche.

BEGIN;

-- ── Quién ficha ────────────────────────────────────────────────────────────
ALTER TABLE conductor ADD COLUMN IF NOT EXISTS ficha_coche     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conductor ADD COLUMN IF NOT EXISTS ficha_coche_at  TIMESTAMPTZ;
ALTER TABLE conductor ADD COLUMN IF NOT EXISTS ficha_coche_por BIGINT REFERENCES usuario(id) ON DELETE SET NULL;

COMMENT ON COLUMN conductor.ficha_coche IS
  'Ficha su turno por WhatsApp: iniciar suelta el motor del coche y terminar lo bloquea. Se enciende persona a persona desde el planificador (db/148).';

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS ficha_coche BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN usuario.ficha_coche IS
  'Puede coger un coche por WhatsApp (un viaje): suelta el motor al empezar y lo bloquea al terminar. Distinto de ficha_obligatorio, que es fichar la jornada de oficina (db/148).';

CREATE INDEX IF NOT EXISTS idx_conductor_ficha_coche ON conductor (id) WHERE ficha_coche;
CREATE INDEX IF NOT EXISTS idx_usuario_ficha_coche   ON usuario (id)   WHERE ficha_coche;

-- ── El libro: turno o viaje, y el relevo ──────────────────────────────────
ALTER TABLE fichaje_turno ADD COLUMN IF NOT EXISTS tipo VARCHAR(8) NOT NULL DEFAULT 'turno';
ALTER TABLE fichaje_turno ADD COLUMN IF NOT EXISTS usuario_id BIGINT REFERENCES usuario(id) ON DELETE SET NULL;
ALTER TABLE fichaje_turno ADD COLUMN IF NOT EXISTS relevo_at TIMESTAMPTZ;
ALTER TABLE fichaje_turno ADD COLUMN IF NOT EXISTS km_relevo NUMERIC(10,2);

ALTER TABLE fichaje_turno DROP CONSTRAINT IF EXISTS ck_ft_tipo;
ALTER TABLE fichaje_turno ADD CONSTRAINT ck_ft_tipo CHECK (tipo IN ('turno', 'viaje'));

-- El relevo cae DENTRO del turno: después de empezarlo y, si ya se cerró,
-- antes de cerrarlo. Y solo los turnos lo tienen: un viaje no tiene compañero.
ALTER TABLE fichaje_turno DROP CONSTRAINT IF EXISTS ck_ft_relevo;
ALTER TABLE fichaje_turno ADD CONSTRAINT ck_ft_relevo CHECK (
  relevo_at IS NULL
  OR (tipo = 'turno' AND relevo_at >= inicio AND (fin IS NULL OR relevo_at <= fin)));

-- Un turno que termina porque el compañero cogió el coche no es un olvido ni
-- un cierre normal: se dice.
ALTER TABLE fichaje_turno DROP CONSTRAINT IF EXISTS fichaje_turno_estado_check;
ALTER TABLE fichaje_turno ADD CONSTRAINT fichaje_turno_estado_check
  CHECK (estado IN ('abierto', 'cerrado', 'auto-cerrado', 'relevado'));

COMMENT ON COLUMN fichaje_turno.tipo IS
  'turno = un conductor en su jornada; viaje = alguien de la empresa que coge un coche para algo (db/148).';
COMMENT ON COLUMN fichaje_turno.relevo_at IS
  'Cuándo pulsó «Voy al relevo»: justo antes de arrancar hacia donde entrega el coche a su compañero (db/148).';

-- ── Las órdenes de motor dadas a mano ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fichaje_orden_motor (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  matricula   VARCHAR(16) NOT NULL,
  unit_id     VARCHAR(32) NOT NULL DEFAULT '',
  accion      VARCHAR(8)  NOT NULL CHECK (accion IN ('soltar', 'bloquear')),
  motivo      TEXT        NOT NULL CHECK (btrim(motivo) <> ''),
  hecho       BOOLEAN     NOT NULL,
  respuesta   TEXT        NOT NULL DEFAULT '',
  usuario_id  BIGINT REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fom_coche ON fichaje_orden_motor (matricula, creado_at DESC);

COMMENT ON TABLE fichaje_orden_motor IS
  'Órdenes de motor dadas a mano desde el ERP (soltar un coche cortado). Quién, cuándo, por qué y qué contestó el coche (db/148).';

COMMIT;
