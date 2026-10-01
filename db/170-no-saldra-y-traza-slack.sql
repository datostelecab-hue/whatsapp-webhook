-- ============================================================
-- 170 — «NO SALDRÁ» Y «TRAZA POR SLACK», EN CONTROL
-- ============================================================
-- Camilo, 01/10/2026, dos cosas para cada conductor del cockpit de Control:
--
-- 1. «NO SALDRÁ», con un motivo de seis y comentario obligatorio: «Error de
--    planificación, Asuntos propios, Baja médica sin justificar, Baja médica
--    justificada, Caso específico» y «Herramientas auxiliares». «Eso le quitará
--    también la alerta de "No llegará", ya que resolvimos por qué no va a salir».
--
-- 2. «TRAZA POR SLACK»: «un check para cada uno de los conductores en control,
--    que pueda poner "Traza por slack" y pueda elegir uno de estos canales que
--    tenemos en la empresa». Es una marca: el ERP no escribe en Slack.
--
-- Las dos son de una JORNADA OPERATIVA (05→05), como las llamadas y las J, y
-- solo puede haber UNA vigente por conductor y jornada: lo vigila el índice,
-- no la pantalla. Marcar otra vez anula la anterior (queda, con quién la
-- quitó) y escribe la nueva; quitarla es anularla. No se borra nada: el
-- Histórico tiene que poder contar qué se dijo y quién lo cambió.
--
-- Los motivos viven también en `modules/Control/marcas.repo.js`: si se añade
-- uno allí, hay que añadirlo en el CHECK. Los canales de Slack NO llevan CHECK
-- de lista a propósito: cambian más que los motivos, y un canal nuevo no
-- debería pedir una migración. Solo se exige que parezca un canal.

BEGIN;

CREATE TABLE IF NOT EXISTS control_no_sale (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo  DATE         NOT NULL,
  turno          VARCHAR(10),
  motivo         VARCHAR(30)  NOT NULL,
  comentario     TEXT         NOT NULL,
  matricula      VARCHAR(16),
  usuario_id     BIGINT       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  anulado_at     TIMESTAMPTZ,
  anulado_por    BIGINT       REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_no_sale_motivo CHECK (motivo IN (
    'error_planificacion', 'asuntos_propios', 'baja_sin_justificar',
    'baja_justificada', 'herramientas_auxiliares', 'caso_especifico')),
  -- Sin comentario no es una respuesta: es un clic. Cinco letras como mínimo.
  CONSTRAINT ck_no_sale_comentario CHECK (char_length(btrim(comentario)) >= 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_no_sale_vigente
  ON control_no_sale (conductor_id, dia_operativo) WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_no_sale_dia ON control_no_sale (dia_operativo);

COMMENT ON TABLE control_no_sale IS
  'Control · «No saldrá»: por qué un conductor no va a salir esa jornada, con motivo y comentario. '
  'Quita las alertas de horas del cockpit y lo saca de las colas de las campañas (db/170).';

CREATE TABLE IF NOT EXISTS control_traza_slack (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia_operativo  DATE         NOT NULL,
  canal          VARCHAR(60)  NOT NULL,
  usuario_id     BIGINT       REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  quitado_at     TIMESTAMPTZ,
  quitado_por    BIGINT       REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_traza_slack_canal CHECK (canal ~ '^[a-z0-9][a-z0-9_-]*$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_traza_slack_vigente
  ON control_traza_slack (conductor_id, dia_operativo) WHERE quitado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_traza_slack_dia ON control_traza_slack (dia_operativo);

COMMENT ON TABLE control_traza_slack IS
  'Control · «Traza por Slack»: en qué canal de Slack de la empresa se dejó constancia del conductor esa jornada. '
  'Solo la marca: el ERP no escribe en Slack (db/170).';

COMMIT;
