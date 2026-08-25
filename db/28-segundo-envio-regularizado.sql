-- ============================================================
-- 28 - EL SEGUNDO ENVIO ES PARA DECIR QUE YA NO HAY PENDIENTES
-- ============================================================
-- La regla de la 25 estaba a medias. Decia:
--
--   se puede mandar si no queda nadie sin decidir Y (no se ha mandado nunca O
--   todavia hay pendientes)
--
-- Y ese "todavia hay pendientes" dejaba generar el segundo Excel con LOS MISMOS
-- pendientes del primero, sin haber tocado a nadie. La agencia recibia dos veces
-- la misma tabla: la primera diciendo "estos tres estan pendientes" y la segunda
-- diciendo exactamente lo mismo. Un envio que no cuenta nada nuevo.
--
-- El segundo envio existe para UNA cosa: decir que los que quedaron pendientes
-- ya no lo estan. Asi que para mandarlo no puede quedar ninguno — todos tienen
-- que estar contratados con fecha, o fuera con su motivo.
--
--   Primer envio  · se puede con pendientes. Es lo que se le esta contando.
--   Segundo envio · no se puede con pendientes. Es lo que viene a resolver.
--
-- Y con eso una tanda tiene como mucho dos envios: el segundo se manda sin
-- pendientes, y sin pendientes se cierra sola.

BEGIN;

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
       'Tanda ' || to_char(q.recibida_at, 'DD/MM/YYYY')
         || COALESCE(' · ' || q.referencia, '')                  AS etiqueta,
       -- POR DONDE VA:
       --
       --   sin_decidir   · hay gente sin decision. No se manda nada.
       --   lista         · todo decidido y sin mandar: va el primer envio, con
       --                   sus pendientes de asignar si los hay.
       --   falta_asignar · ya se mando y siguen habiendo pendientes. AQUI NO SE
       --                   MANDA: hay que regularizarlos primero.
       --   lista_cierre  · ya se mando y no queda ninguno pendiente. Va el
       --                   segundo y ultimo envio.
       --   cerrada       · contestada del todo.
       CASE WHEN q.cerrada_at IS NOT NULL THEN 'cerrada'
            WHEN q.sin_decidir > 0        THEN 'sin_decidir'
            WHEN q.envios = 0             THEN 'lista'
            WHEN q.pendientes > 0         THEN 'falta_asignar'
            ELSE 'lista_cierre'
       END                                                       AS fase,
       -- La regla, dicha una vez: nadie sin decidir, y o es el primero —donde
       -- los pendientes son la noticia— o ya no queda ninguno.
       (q.cerrada_at IS NULL AND q.sin_decidir = 0
        AND (q.envios = 0 OR q.pendientes = 0))                  AS puede_enviar
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
  'Cada tabla pegada con sus numeros y su fase. El segundo envio solo se permite sin nadie pendiente de asignar: es lo que viene a contar';

COMMIT;
