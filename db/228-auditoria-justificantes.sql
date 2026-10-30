-- ============================================================
-- 228 — EL LIBRO DE AUDITORÍA DE LAS J Y LAS −J
-- ============================================================
-- Camilo, 30/10/2026: «Ojo, las −J y J tienen que ser bien auditadas en todo el
-- flujo, asegura eso».
--
-- Hasta aquí cada fila guardaba solo su ÚLTIMO estado, y había huecos:
--   · editar una J pisaba `usuario_id`: quien la puso desaparecía y quedaba el
--     último que la tocó;
--   · una J APROBADA se podía editar (otras horas, otro tipo) y seguía aprobada:
--     las horas nuevas entraban en la nómina sin que nadie las mirara;
--   · anular desde la Bitácora no guardaba ni quién ni por qué;
--   · reabrir una rechazada no guardaba quién;
--   · y de ningún cambio quedaba el valor de antes.
--
-- AHORA CADA CAMBIO DEJA UNA FILA AQUÍ, Y LA DEJA LA BASE, NO EL CÓDIGO: un
-- disparador en `justificante` y otro en `menos_j` apuntan TODO alta, cambio y
-- borrado, venga de donde venga (la aplicación, una migración o SQL a mano),
-- con la fila entera de antes y de después y los campos que cambiaron. El
-- código dice QUIÉN y DESDE DÓNDE con `telecab.usuario_id` y `telecab.origen`
-- (services/repo/auditoriaJ.js, en la misma transacción); si no lo dice —SQL a
-- mano, una migración— la fila se apunta igual, con quien firmó la columna si
-- la hay (aprobado_por, anulado_por…) y, si no, sin usuario y con el usuario de
-- la base. Lo que no puede pasar es que un cambio no deje rastro.
--
-- EL LIBRO NO SE TOCA: no admite UPDATE, DELETE ni TRUNCATE (otro disparador
-- lo impide). Y no lleva claves ajenas: borrar una persona no puede borrar su
-- historia.
--
-- LO ANTERIOR SE RECONSTRUYE de las columnas que había (puesta, aprobada,
-- anulada, cerrada), marcado como «reconstruido»: es todo lo que se sabe de
-- antes de hoy. Una J editada antes de hoy conserva solo su último editor.

BEGIN;

CREATE TABLE IF NOT EXISTS justificante_auditoria (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidad        VARCHAR(10)  NOT NULL,              -- 'j' o 'menos_j'
  registro_id    BIGINT       NOT NULL,              -- justificante.id o menos_j.id
  conductor_id   BIGINT,
  dia_operativo  DATE,
  accion         VARCHAR(16)  NOT NULL,
  usuario_id     INTEGER,                            -- quién; NULL = no lo dijo nadie
  origen         VARCHAR(40),                        -- bitacora, control, justificantes, campanas, migración…
  cambios        JSONB,                              -- { campo: [antes, después] }
  antes          JSONB,
  despues        JSONB,
  en             TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  bd_usuario     TEXT         NOT NULL DEFAULT current_user,
  CONSTRAINT ck_jaud_entidad CHECK (entidad IN ('j', 'menos_j')),
  CONSTRAINT ck_jaud_accion  CHECK (accion IN ('poner', 'editar', 'aprobar', 'rechazar', 'anular',
                                               'cerrar', 'reabrir', 'borrar', 'cambio'))
);
CREATE INDEX IF NOT EXISTS idx_jaud_registro  ON justificante_auditoria (entidad, registro_id, en);
CREATE INDEX IF NOT EXISTS idx_jaud_conductor ON justificante_auditoria (conductor_id, dia_operativo);
CREATE INDEX IF NOT EXISTS idx_jaud_en        ON justificante_auditoria (en);

COMMENT ON TABLE justificante_auditoria IS
  'Libro de auditoría de las J y las −J: una fila por cada alta, cambio o borrado, la apunta un disparador. No se cambia ni se borra';

-- ── El libro no se toca ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION justificante_auditoria_intocable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El libro de auditoría de las J no se cambia ni se borra (db/228)';
END $$;

DROP TRIGGER IF EXISTS trg_jaud_intocable ON justificante_auditoria;
CREATE TRIGGER trg_jaud_intocable BEFORE UPDATE OR DELETE ON justificante_auditoria
  FOR EACH ROW EXECUTE FUNCTION justificante_auditoria_intocable();
DROP TRIGGER IF EXISTS trg_jaud_intocable_truncate ON justificante_auditoria;
CREATE TRIGGER trg_jaud_intocable_truncate BEFORE TRUNCATE ON justificante_auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION justificante_auditoria_intocable();

-- ── Lo de antes de hoy, reconstruido de las columnas ────────────────────────
-- Solo si el libro está vacío: aplicar esto dos veces no duplica la historia.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM justificante_auditoria) THEN RETURN; END IF;

  INSERT INTO justificante_auditoria (entidad, registro_id, conductor_id, dia_operativo, accion, usuario_id, origen, despues, en)
  SELECT 'j', j.id, j.conductor_id, j.dia_operativo, x.accion, x.quien, 'reconstruido (db/228)', x.detalle, x.en
    FROM justificante j
    CROSS JOIN LATERAL (VALUES
      ('poner',  j.usuario_id, j.creado_at,
         jsonb_build_object('horas_seg_momento', j.horas_seg_momento, 'observacion', j.observacion, 'tipo', j.tipo,
                            'nota', 'quien la puso o, si se editó antes del 30/10/2026, el último que la editó')),
      ('aprobar', j.aprobado_por, j.aprobado_at,
         jsonb_build_object('nota', CASE WHEN j.aprobado_por IS NULL THEN 'de oficio (db/73)' END)),
      (CASE WHEN j.anulado_por IS NULL AND j.anulado_motivo IS NULL THEN 'anular' ELSE 'rechazar' END,
         j.anulado_por, j.anulado_at, jsonb_build_object('anulado_motivo', j.anulado_motivo)),
      ('cerrar', j.cerrada_por, j.cerrada_at, jsonb_build_object('cerrada_nota', j.cerrada_nota))
    ) AS x(accion, quien, en, detalle)
   WHERE x.en IS NOT NULL;

  INSERT INTO justificante_auditoria (entidad, registro_id, conductor_id, dia_operativo, accion, usuario_id, origen, despues, en)
  SELECT 'menos_j', m.id, m.conductor_id, m.dia_operativo, x.accion, x.quien, 'reconstruido (db/228)', x.detalle, x.en
    FROM menos_j m
    CROSS JOIN LATERAL (VALUES
      ('poner',    m.usuario_id,   m.creado_at,   to_jsonb(m)),
      ('aprobar',  m.aprobado_por, m.aprobado_at, NULL::jsonb),
      ('rechazar', m.anulado_por,  m.anulado_at,  jsonb_build_object('anulado_motivo', m.anulado_motivo))
    ) AS x(accion, quien, en, detalle)
   WHERE x.en IS NOT NULL;
END $$;

-- ── El disparador: cada cambio, una fila ────────────────────────────────────
CREATE OR REPLACE FUNCTION auditar_justificante() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ent      text  := TG_ARGV[0];
  viejo    jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  nuevo    jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  fila     jsonb := COALESCE(nuevo, viejo);
  difs     jsonb;
  acc      text  := NULLIF(current_setting('telecab.accion', true), '');
  quien    int   := NULLIF(current_setting('telecab.usuario_id', true), '')::int;
  donde    text  := NULLIF(current_setting('telecab.origen', true), '');
BEGIN
  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, jsonb_build_array(viejo -> k, nuevo -> k)) INTO difs
      FROM jsonb_object_keys(nuevo) k
     WHERE (viejo -> k) IS DISTINCT FROM (nuevo -> k);
    IF difs IS NULL THEN RETURN NULL; END IF;   -- nada cambió: nada que apuntar
  END IF;

  IF acc IS NULL THEN
    acc := CASE
      WHEN TG_OP = 'INSERT' THEN 'poner'
      WHEN TG_OP = 'DELETE' THEN 'borrar'
      WHEN difs ? 'anulado_at' AND (nuevo ->> 'anulado_at') IS NOT NULL THEN
        CASE WHEN (nuevo ->> 'anulado_motivo') IS NULL THEN 'anular' ELSE 'rechazar' END
      WHEN difs ? 'cerrada_at' AND (nuevo ->> 'cerrada_at') IS NOT NULL THEN 'cerrar'
      WHEN difs ? 'cerrada_at' THEN 'reabrir'
      WHEN difs ? 'aprobado_at' AND (nuevo ->> 'aprobado_at') IS NOT NULL THEN 'aprobar'
      WHEN difs ? 'anulado_at' THEN 'cambio'
      ELSE 'editar' END;
  END IF;

  -- Sin usuario dicho por el código, quien firmó la columna, si la hay.
  IF quien IS NULL THEN
    quien := CASE acc
      WHEN 'poner'    THEN (fila ->> 'usuario_id')::int
      WHEN 'aprobar'  THEN (fila ->> 'aprobado_por')::int
      WHEN 'rechazar' THEN (fila ->> 'anulado_por')::int
      WHEN 'anular'   THEN (fila ->> 'anulado_por')::int
      WHEN 'cerrar'   THEN (fila ->> 'cerrada_por')::int
      ELSE NULL END;
  END IF;

  INSERT INTO justificante_auditoria (entidad, registro_id, conductor_id, dia_operativo, accion,
                                      usuario_id, origen, cambios, antes, despues)
  VALUES (ent, (fila ->> 'id')::bigint, (fila ->> 'conductor_id')::bigint, (fila ->> 'dia_operativo')::date, acc,
          quien, COALESCE(donde, 'sin decir (SQL a mano o migración)'), difs, viejo, nuevo);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_auditar_justificante ON justificante;
CREATE TRIGGER trg_auditar_justificante AFTER INSERT OR UPDATE OR DELETE ON justificante
  FOR EACH ROW EXECUTE FUNCTION auditar_justificante('j');

DROP TRIGGER IF EXISTS trg_auditar_menos_j ON menos_j;
CREATE TRIGGER trg_auditar_menos_j AFTER INSERT OR UPDATE OR DELETE ON menos_j
  FOR EACH ROW EXECUTE FUNCTION auditar_justificante('menos_j');

COMMIT;
