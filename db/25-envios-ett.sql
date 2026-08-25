-- ============================================================
-- 25 - CUANTAS VECES SE LE HA CONTESTADO A LA AGENCIA
-- ============================================================
-- La solicitud ya existia; lo que no existia era saber si YA SE HABIA MANDADO.
-- Y de eso depende la regla de verdad del modulo:
--
--   Solo hay un SEGUNDO envio si queda alguien pendiente de asignar.
--
-- Si en el primero todos salieron contratados o rechazados, no hay nada mas que
-- contarle a la agencia: la tanda esta contestada y se cierra sola. Sin esto,
-- la pantalla ofrecia generar un segundo Excel identico al primero, y quien lo
-- recibiera no sabria si es una correccion o un duplicado.
--
-- Cada envio guarda ademas la FOTO de lo que se dijo. Un mes despues, "cuantos
-- iban contratados en el primer envio" es una pregunta que se hace de verdad, y
-- recontarla hoy daria otro numero: los pendientes de entonces ya se resolvieron.

BEGIN;

CREATE TABLE IF NOT EXISTS solicitud_ett_envio (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  solicitud_id BIGINT       NOT NULL REFERENCES solicitud_ett(id) ON DELETE CASCADE,
  -- 1 = el primero, 2 = el segundo. Se cuenta, no se adivina por la fecha.
  orden        INT          NOT NULL,
  enviado_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Como salio: el Excel adjunto o la tabla pegada en el correo.
  formato      VARCHAR(10)  NOT NULL,
  -- La foto del momento. No se recalcula nunca.
  candidatos   INT,
  contratados  INT,
  pendientes   INT,
  descartados  INT,
  usuario_id   INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_envio_formato CHECK (formato IN ('excel', 'texto')),
  CONSTRAINT uq_envio_orden   UNIQUE (solicitud_id, orden)
);

CREATE INDEX IF NOT EXISTS idx_envio_solicitud ON solicitud_ett_envio (solicitud_id, orden);

COMMENT ON TABLE solicitud_ett_envio IS
  'Cada vez que se le contesta a la agencia por una solicitud, con la foto de lo que se le dijo';

-- ── La solicitud, ahora sabiendo por donde va ──────────────────────────────
-- Se rehace entera: las columnas nuevas no van al final.
DROP VIEW IF EXISTS v_solicitud_ett;

CREATE VIEW v_solicitud_ett AS
SELECT q.id,
       q.recibida_at,
       q.referencia,
       q.notas,
       q.cerrada_at,
       q.creado_at,
       q.candidatos,
       q.contratados,
       q.pendientes,
       q.sin_decidir,
       q.descartados,
       q.primera_cita,
       q.ultima_cita,
       q.envios,
       q.ultimo_envio_at,
       -- Como se llama esta tanda cuando hay que elegirla en una lista.
       'Tanda ' || to_char(q.recibida_at, 'DD/MM/YYYY')
         || COALESCE(' · ' || q.referencia, '')                  AS etiqueta,
       -- POR DONDE VA. Una sola definicion, y en la base: la pantalla la pinta
       -- y el servidor la obedece, pero ninguno de los dos la decide.
       --
       --   sin_decidir   · hay gente sin decision. No se puede mandar nada.
       --   lista         · todo decidido y sin mandar: va el primer envio.
       --   falta_asignar · ya se mando y quedan pendientes de asignar. Ahi si
       --                   hace falta un segundo, y solo ahi.
       --   completa      · mandada y sin nadie pendiente. No hay nada mas.
       --   cerrada       · sellada a mano.
       CASE WHEN q.cerrada_at IS NOT NULL THEN 'cerrada'
            WHEN q.sin_decidir > 0        THEN 'sin_decidir'
            WHEN q.envios = 0             THEN 'lista'
            WHEN q.pendientes > 0         THEN 'falta_asignar'
            ELSE 'completa'
       END                                                       AS fase,
       -- La regla, dicha una vez: se manda si no queda nadie sin decidir y o
       -- bien no se ha mandado nunca, o bien todavia hay pendientes que contar.
       (q.cerrada_at IS NULL AND q.sin_decidir = 0
        AND (q.envios = 0 OR q.pendientes > 0))                  AS puede_enviar
  FROM (
    SELECT s.id, s.recibida_at, s.referencia, s.notas, s.cerrada_at, s.creado_at,
           count(k.id)::int                                              AS candidatos,
           count(*) FILTER (WHERE k.inicio_previsto IS NOT NULL)::int    AS contratados,
           count(*) FILTER (WHERE k.inicio_previsto IS NULL
                              AND e.etiqueta_ett = 'Pendiente')::int     AS pendientes,
           count(*) FILTER (WHERE k.inicio_previsto IS NULL
                              AND e.etiqueta_ett IS NULL)::int           AS sin_decidir,
           count(*) FILTER (WHERE k.inicio_previsto IS NULL
                              AND e.etiqueta_ett IN ('No pasa', 'No se presentó'))::int AS descartados,
           min(k.entrevista_at)                                          AS primera_cita,
           max(k.entrevista_at)                                          AS ultima_cita,
           (SELECT count(*) FROM solicitud_ett_envio v
             WHERE v.solicitud_id = s.id)::int                           AS envios,
           (SELECT max(v.enviado_at) FROM solicitud_ett_envio v
             WHERE v.solicitud_id = s.id)                                AS ultimo_envio_at
      FROM solicitud_ett s
      LEFT JOIN candidatura k            ON k.solicitud_id = s.id
      LEFT JOIN cat_estado_candidatura e ON e.codigo = k.estado
     GROUP BY s.id, s.recibida_at, s.referencia, s.notas, s.cerrada_at, s.creado_at
  ) q;

COMMENT ON VIEW v_solicitud_ett IS
  'Cada tabla pegada con sus numeros, por que fase va y si toca mandarle algo a la agencia';

COMMIT;
