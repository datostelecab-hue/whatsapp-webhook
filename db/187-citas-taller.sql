-- ============================================================
-- 187 — LAS CITAS DEL TALLER: quién lleva el coche y si se ha confirmado
-- ============================================================
-- Camilo, 08/10/2026: el taller manda un Excel con las citas de mantenimiento
-- (matrícula, día y hora). Desde Mantenimientos se sube; el sistema mira en el
-- planificador quién lleva cada coche ese día y a esa hora, le avisa por
-- WhatsApp dos días antes, y Control le llama para confirmar.
--
--   · taller_cita              una por coche y día (subir el mismo Excel otra
--                              vez no duplica, y si el taller cambia la hora se
--                              cambia en la misma cita). El responsable NO se guarda:
--                              es quien lleva el coche ese día en el planificador,
--                              y puede cambiar hasta el último momento. Lo que se
--                              guarda es a quién se avisó (`aviso_*`) y qué dijo
--                              (`confirmacion_*`).
--   · taller_cita_seguimiento  lo que ha pasado con cada cita: el aviso, la
--                              respuesta del conductor por WhatsApp, cada llamada
--                              de Control y los cambios de estado.
--
-- El aviso sale con la plantilla de WhatsApp de la cita (origen 'taller' en el
-- chat de /whatsapp).

BEGIN;

CREATE TABLE IF NOT EXISTS taller_cita (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id        bigint       NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  matricula          varchar(16)  NOT NULL,          -- como venía en el Excel, normalizada
  fecha              date         NOT NULL,
  hora               time         NOT NULL,
  marca              varchar(40),                    -- la columna VEHICULO del Excel
  estado             varchar(16)  NOT NULL DEFAULT 'pendiente',
  -- El aviso al conductor que lleva el coche ese día.
  aviso_via          varchar(12),                    -- whatsapp (el sistema) o manual (alguien a mano)
  aviso_conductor_id bigint       REFERENCES conductor(id) ON DELETE SET NULL,
  aviso_telefono     varchar(24),
  aviso_at           timestamptz,
  aviso_wamid        varchar(160),
  aviso_error        text,                           -- el último intento que falló
  aviso_intento_at   timestamptz,
  aviso_por          bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  -- Lo que dijo: por el botón del WhatsApp o en la llamada de Control.
  confirmacion       varchar(16),
  confirmacion_via   varchar(12),
  confirmacion_at    timestamptz,
  confirmacion_por   bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  fichero            varchar(200),
  creado_por         bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at          timestamptz  NOT NULL DEFAULT now(),
  actualizado_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_tcita_estado CHECK (estado IN ('pendiente', 'hecha', 'no_presentado', 'anulada')),
  CONSTRAINT ck_tcita_aviso CHECK (aviso_via IS NULL OR aviso_via IN ('whatsapp', 'manual')),
  CONSTRAINT ck_tcita_conf CHECK (confirmacion IS NULL OR confirmacion IN ('confirmada', 'no_puede', 'no_contesta', 'otro_conductor')),
  CONSTRAINT ck_tcita_conf_via CHECK (confirmacion_via IS NULL OR confirmacion_via IN ('whatsapp', 'llamada'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcita ON taller_cita (vehiculo_id, fecha);
CREATE INDEX IF NOT EXISTS ix_tcita_fecha ON taller_cita (fecha);
CREATE INDEX IF NOT EXISTS ix_tcita_aviso_tel ON taller_cita (right(aviso_telefono, 9)) WHERE aviso_telefono IS NOT NULL;

CREATE TABLE IF NOT EXISTS taller_cita_seguimiento (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cita_id      bigint       NOT NULL REFERENCES taller_cita(id) ON DELETE CASCADE,
  tipo         varchar(12)  NOT NULL,
  resultado    varchar(80),
  nota         text,
  conductor_id bigint       REFERENCES conductor(id) ON DELETE SET NULL,
  usuario_id   bigint       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_tcseg_tipo CHECK (tipo IN ('aviso', 'respuesta', 'llamada', 'estado'))
);
CREATE INDEX IF NOT EXISTS ix_tcseg_cita ON taller_cita_seguimiento (cita_id, creado_at);

-- El aviso de la cita sale por el chat de WhatsApp con su propio origen.
ALTER TABLE whatsapp_mensaje DROP CONSTRAINT IF EXISTS ck_wam_origen;
ALTER TABLE whatsapp_mensaje ADD CONSTRAINT ck_wam_origen
  CHECK (origen IN ('conductor', 'bot', 'oficina', 'alerta', 'velocidad', 'turnos', 'plantilla', 'taller'));

COMMENT ON TABLE taller_cita IS
  'Citas de mantenimiento del taller, del Excel que manda (db/187). El responsable es quien lleva el coche ese día en el planificador (f_cobertura); aquí queda a quién se avisó y qué contestó.';
COMMENT ON TABLE taller_cita_seguimiento IS
  'Lo que pasa con cada cita del taller: aviso, respuesta del conductor, llamadas de Control y cambios de estado (db/187).';

COMMIT;
