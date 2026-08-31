-- ============================================================
-- TELECAB — AUSENCIAS Y SITUACIÓN DEL CONDUCTOR
-- ============================================================
-- Una baja médica, unas vacaciones o un permiso NO son lo mismo que dejar la
-- plaza. La persona sigue asignada a su coche; lo que cambia es su situación.
-- Por eso van en tabla aparte de `asignacion`:
--
--   · La ASIGNACIÓN se cierra cuando Tráfico saca a alguien del planificador.
--     Es una decisión operativa y la fecha la pone quien lo hace.
--
--   · La AUSENCIA se abre cuando la persona deja de venir y se cierra cuando
--     vuelve. En una baja médica NADIE SABE CUÁNDO SERÁ ESO, así que `hasta`
--     nace NULL y se rellena el día que se reincorpora. Poner una fecha
--     estimada sería inventarse el futuro, y el planificador la creería.
--
-- Si se cerrara la asignación al darse alguien de baja, se perdería su plaza y
-- al volver habría que reasignarla a mano, sin saber cuál era la suya.

BEGIN;

CREATE TABLE cat_estado_conductor (
  codigo              VARCHAR(20) PRIMARY KEY,
  etiqueta            VARCHAR(40) NOT NULL,
  es_ausencia         BOOLEAN     NOT NULL,
  -- Si al abrirse hay que dejar su plaza libre para otro en el planificador.
  libera_plaza        BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Si el sistema puede cerrarla solo (vacaciones: sí, con fecha de vuelta
  -- conocida; baja médica: no, hasta que alguien diga que ha vuelto).
  fin_previsible      BOOLEAN     NOT NULL DEFAULT FALSE,
  marca_bitacora      CHAR(1)     REFERENCES cat_marca_dia(codigo),
  orden               SMALLINT    NOT NULL DEFAULT 0
);
COMMENT ON TABLE cat_estado_conductor IS
  'Situaciones en las que puede estar un conductor. Sustituye a la columna ESTADO de AGENDA_V2';

CREATE TABLE conductor_estado_hist (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id   BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  estado         VARCHAR(20) NOT NULL REFERENCES cat_estado_conductor(codigo),
  desde          DATE        NOT NULL,
  -- NULL = sigue así. En una baja médica es lo normal durante semanas.
  hasta          DATE,
  -- Lo que dijo el parte, si lo hay. Informativo: NO cierra la ausencia.
  hasta_previsto DATE,
  motivo         VARCHAR(255),
  peticion_id    BIGINT,      -- FK a peticion(id): se añade con el dominio RRHH
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_por    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_cest_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Una persona no puede estar en dos situaciones a la vez en la misma fecha.
  CONSTRAINT ex_cest_solape EXCLUDE USING gist
    (conductor_id WITH =, daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX idx_cest_abierta ON conductor_estado_hist (conductor_id) WHERE hasta IS NULL;
CREATE INDEX idx_cest_fecha   ON conductor_estado_hist (desde, hasta, estado);
COMMENT ON COLUMN conductor_estado_hist.hasta IS
  'NULL mientras dure. Una baja médica no tiene fecha de fin conocida: se cierra el día que la persona se reincorpora, no antes';
COMMENT ON COLUMN conductor_estado_hist.hasta_previsto IS
  'Fecha tentativa del parte médico. Solo para avisar a Tráfico; NUNCA cierra la ausencia por sí sola';

-- Vista de lo que hace falta a diario: quién está hoy y en qué situación.
CREATE VIEW v_conductor_hoy AS
SELECT c.id AS conductor_id,
       c.nombre, c.apellidos,
       c.empleo_vigente,
       COALESCE(e.estado, 'activo')  AS estado,
       e.desde                       AS ausente_desde,
       e.hasta_previsto,
       (e.id IS NOT NULL)            AS ausente,
       CASE WHEN e.desde IS NOT NULL THEN CURRENT_DATE - e.desde END AS dias_ausente
FROM conductor c
LEFT JOIN conductor_estado_hist e
       ON e.conductor_id = c.id
      AND e.desde <= CURRENT_DATE
      AND (e.hasta IS NULL OR e.hasta >= CURRENT_DATE)
WHERE NOT c.es_centinela;
COMMENT ON VIEW v_conductor_hoy IS
  'Situación de cada conductor HOY, con los días que lleva ausente. Es la consulta que hace el control de tráfico';

COMMIT;
