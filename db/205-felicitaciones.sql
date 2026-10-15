-- ============================================================
-- 205 — LAS FELICITACIONES ENTRE COMPAÑEROS DE OFICINA
-- ============================================================
-- Camilo, 15/10/2026: «Cuando sea de oficina, poder mandar felicitaciones tipo
-- "Camilo te ha enviado felicitaciones" y que salgan globos o algo de parte de
-- Camilo en la pantalla de la persona. Hoy cumple por ejemplo Karen, quizá
-- mañana lo vea».
--
-- Una fila por quien felicita, a quien y por qué cumpleaños. Se guarda en la
-- base y no en el navegador porque quien cumple puede no entrar hasta mañana,
-- y desde otro ordenador: las ve cuando entre, y al cerrarlas quedan vistas.
-- Una por persona y cumpleaños: pulsar dos veces no manda dos.

BEGIN;

CREATE TABLE IF NOT EXISTS felicitacion (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  para_usuario_id  INTEGER     NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  de_usuario_id    INTEGER     NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  dia              DATE        NOT NULL,   -- el día del cumpleaños que se felicita
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  visto_at         TIMESTAMPTZ,
  CONSTRAINT uq_felicitacion UNIQUE (para_usuario_id, de_usuario_id, dia),
  CONSTRAINT ck_felicitacion_otro CHECK (para_usuario_id <> de_usuario_id)
);
CREATE INDEX IF NOT EXISTS idx_felicitacion_pendiente
  ON felicitacion (para_usuario_id) WHERE visto_at IS NULL;

COMMENT ON TABLE felicitacion IS
  'Felicitaciones de cumpleaños entre usuarios de oficina: quien cumple las ve (con globos) al entrar, aunque sea otro día. db/205';

COMMIT;
