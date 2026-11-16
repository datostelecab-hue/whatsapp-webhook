-- ============================================================
-- 254 — LOS AVISOS ENTRE MÓDULOS (ítem 3 de la hoja de ruta)
-- ============================================================
-- Cuando un módulo genera algo que afecta a otro, avisa al ÁREA que le toca, y
-- el aviso se queda hasta que alguien lo resuelve. Lo que decidió Camilo el
-- 16/11/2026:
--
--   · EL DESTINATARIO ES UN ÁREA DE ORGANIZACIÓN (cat_area, db/248: Control,
--     Taller, RR. HH.…): le llega a toda la gente de esa área y a su
--     responsable. O a una persona concreta.
--   · LEÍDO, CADA UNO EL SUYO (aviso_lectura): el número de cada uno baja
--     cuando lo lee él. RESUELTO, DE TODOS: cuando alguien lo resuelve,
--     desaparece para el área, con quién, cuándo y en qué quedó.
--   · SE RESUELVE SOLO SI SE PUEDE (la cita se hizo, la J se aprobó); si no, a
--     mano con una nota. Un aviso con fecha (una cita) CADUCA solo al pasar.
--   · Se ven en LA CAMPANA (la bandeja de avisos), con su número en la entrada
--     del módulo en el menú, y los urgentes llegan además al móvil (A8).
--
-- Los nombres `notificacion` (requerimientos legales al conductor, db/43),
-- `aviso_turnos` (el WhatsApp de turnos, db/96) y /avisos/efectivo ya estaban
-- cogidos: aquí son `aviso` y `aviso_lectura`, y la ruta /avisos/api.
--
-- Los tipos de aviso (qué módulo, a qué área, cómo se resuelve solo) están en el
-- código: services/avisos.js y el módulo que emite cada uno.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/254', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS aviso (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Qué es y de dónde sale: el tipo ('cita_taller'), el módulo que lo emite
  -- ('taller': donde se ve su número) y el id de lo que lo provocó.
  tipo             VARCHAR(40)  NOT NULL CHECK (tipo ~ '^[a-z][a-z0-9_]*$'),
  modulo           VARCHAR(30)  NOT NULL CHECK (modulo ~ '^[a-z][a-z0-9_]*$'),
  origen_id        VARCHAR(64),
  titulo           VARCHAR(200) NOT NULL CHECK (btrim(titulo) <> ''),
  texto            TEXT,
  -- La pantalla del ERP donde se atiende ('/control/citas-taller').
  enlace           VARCHAR(300) CHECK (enlace IS NULL OR enlace ~ '^/[^/]'),
  urgente          BOOLEAN      NOT NULL DEFAULT FALSE,

  -- A QUIÉN: un área de Organización y/o una persona.
  area_codigo      VARCHAR(20)  REFERENCES cat_area(codigo),
  usuario_id       INTEGER      REFERENCES usuario(id),

  -- Hasta cuándo sirve (la hora de la cita). Pasada, caduca solo.
  caduca_at        TIMESTAMPTZ,
  creado_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  creado_por       INTEGER      REFERENCES usuario(id),

  -- EL FINAL: resuelto (por una persona o por su módulo), caducado o anulado.
  estado           VARCHAR(10)  NOT NULL DEFAULT 'abierto'
                     CHECK (estado IN ('abierto', 'resuelto', 'caducado', 'anulado')),
  cerrado_at       TIMESTAMPTZ,
  cerrado_por      INTEGER      REFERENCES usuario(id),
  -- Lo cerró su módulo (la cita se hizo), no una persona con «Resuelto».
  cerrado_solo     BOOLEAN      NOT NULL DEFAULT FALSE,
  nota             TEXT,

  CONSTRAINT ck_aviso_destino CHECK (area_codigo IS NOT NULL OR usuario_id IS NOT NULL),
  CONSTRAINT ck_aviso_final CHECK ((estado = 'abierto') = (cerrado_at IS NULL)),
  CONSTRAINT ck_aviso_nota CHECK (estado <> 'resuelto' OR cerrado_solo OR btrim(COALESCE(nota, '')) <> '')
);

-- Un aviso por cosa de origen y tipo: emitirlo dos veces no lo duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aviso_origen ON aviso (tipo, origen_id) WHERE origen_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_aviso_abiertos ON aviso (area_codigo, usuario_id) WHERE estado = 'abierto';

-- ── Quién lo ha leído: un libro que no se cambia ni se borra ──────────────
CREATE TABLE IF NOT EXISTS aviso_lectura (
  aviso_id     BIGINT       NOT NULL REFERENCES aviso(id),
  usuario_id   INTEGER      NOT NULL REFERENCES usuario(id),
  leido_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (aviso_id, usuario_id)
);
CREATE INDEX IF NOT EXISTS ix_aviso_lectura_usuario ON aviso_lectura (usuario_id);

CREATE OR REPLACE FUNCTION aviso_lectura_intocable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lo leído no se cambia ni se borra';
END $$;
DROP TRIGGER IF EXISTS tr_aviso_lectura_intocable ON aviso_lectura;
CREATE TRIGGER tr_aviso_lectura_intocable BEFORE UPDATE OR DELETE ON aviso_lectura
  FOR EACH ROW EXECUTE FUNCTION aviso_lectura_intocable();

COMMENT ON TABLE aviso IS
  'Los avisos entre módulos (ítem 3, db/254): a un área de Organización o a una persona; se quedan hasta que alguien los resuelve, su módulo los cierra o caducan. Ver services/avisos.js.';
COMMENT ON TABLE aviso_lectura IS
  'Quién leyó cada aviso y cuándo, cada uno el suyo (db/254). No se cambia ni se borra.';

-- El aviso, bajo el libro de auditoría (A4) antes de que entre ninguno.
SELECT auditoria_vigilar('aviso');

COMMIT;
