-- ============================================================
-- 189 — EL PORTAL DEL CONDUCTOR: quién entra y quién lo intenta
-- ============================================================
-- Camilo, 09/10/2026: los conductores van a poder entrar a ver su información
-- básica, por su propio dominio, con su TELÉFONO y su DNI/NIE como contraseña.
--
-- Un DNI no es un secreto: está en el contrato, en la ficha de alta y en más
-- de un papel que pasa por la oficina. Por eso cada intento queda apuntado aquí,
-- el bueno y el malo, con desde dónde: si alguien entra con el DNI de otro, es
-- aquí donde se ve (muchos fallos contra un mismo conductor, o entradas desde
-- un sitio raro).
--
-- Del teléfono que se intentó solo se guardan las cuatro últimas cifras, y solo
-- cuando no es de ningún conductor: con eso basta para ver un ataque, sin
-- guardar números ajenos.

BEGIN;

CREATE TABLE IF NOT EXISTS conductor_acceso (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id  bigint       REFERENCES conductor(id) ON DELETE SET NULL,
  ok            boolean      NOT NULL,
  motivo        varchar(20)  NOT NULL,
  tel_final     varchar(4),
  ip            varchar(64),
  agente        varchar(300),
  creado_at     timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_cacceso_motivo CHECK (motivo IN ('ok', 'incompleto', 'documento', 'sin_telefono', 'sin_documento', 'inactivo', 'frenado'))
);
CREATE INDEX IF NOT EXISTS ix_cacceso_conductor ON conductor_acceso (conductor_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS ix_cacceso_fecha ON conductor_acceso (creado_at DESC);

COMMENT ON TABLE conductor_acceso IS
  'Cada intento de entrar al portal del conductor (teléfono + DNI/NIE), bueno o malo, con IP y navegador (db/189). Del teléfono intentado solo las 4 últimas cifras cuando no es de nadie.';

COMMIT;
