-- ============================================================
-- 96 — Registro de avisos de turnos por WhatsApp
-- ============================================================
-- Cada vez que alguien (William, Gabriel…) manda el aviso de turnos desde
-- Cobertura o desde el planificador, queda apuntado AQUÍ: quién lo mandó, a
-- quién, de qué cuadrante salió, para qué semana y QUÉ se le avisó (la huella
-- de sus turnos en ese momento). Con eso salen las tres cosas que se piden:
--
--   · el registro ("William avisó al cuadrante X a tal hora"),
--   · el informe diario (a cuántas personas + cuántas veces a cada una),
--   · el semáforo del cuadrante: VERDE si lo avisado sigue valiendo, ROJO si
--     el cuadrante cambió después del aviso (huella actual ≠ huella avisada).
--
-- La huella es la serialización canónica de los turnos del conductor esa
-- semana (día+turno+matrícula). Se guarda POR PERSONA porque el WhatsApp va
-- por persona: el estado del cuadrante se deriva de la gente que tiene ahora.

BEGIN;

CREATE TABLE aviso_turnos (
  id            bigserial PRIMARY KEY,
  enviado_at    timestamptz NOT NULL DEFAULT now(),

  -- Quién lo mandó. El id puede quedarse huérfano si el usuario se borra;
  -- el nombre se guarda aparte para que el informe siga diciendo "William".
  usuario_id    bigint REFERENCES usuario(id) ON DELETE SET NULL,
  usuario       varchar(120),

  conductor_id  bigint NOT NULL REFERENCES conductor(id),
  telefono      varchar(20),

  -- De dónde salió el envío: el nombre del cuadrante (o 'coches sueltos') si
  -- fue desde el planificador; NULL si fue el botón suelto de Cobertura.
  cuadrante     varchar(120),
  origen        varchar(20) NOT NULL DEFAULT 'cobertura'
                CHECK (origen IN ('cobertura', 'planificador')),

  -- El lunes de la semana avisada y la huella de SUS turnos en ese momento.
  semana_lunes  date NOT NULL,
  huella        varchar(600) NOT NULL DEFAULT '',

  resultado     varchar(20) NOT NULL DEFAULT 'ok'
                CHECK (resultado IN ('ok', 'error', 'sin-telefono')),
  detalle       varchar(300)
);

-- El semáforo pregunta "el último aviso de esta persona para esta semana".
CREATE INDEX ix_aviso_turnos_semana ON aviso_turnos (semana_lunes, conductor_id, enviado_at DESC);
-- El informe diario recorre por fecha de envío.
CREATE INDEX ix_aviso_turnos_dia ON aviso_turnos (enviado_at);

COMMIT;
