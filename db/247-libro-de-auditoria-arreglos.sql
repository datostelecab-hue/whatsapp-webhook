-- ============================================================
-- 247 — EL LIBRO DE AUDITORÍA: lo que encontró la revisión de la 245
-- ============================================================
-- La 245 (13/11/2026) ya se había publicado en la rama cuando una revisión
-- encontró fallos, así que se arreglan aquí y la 245 no se toca (una migración
-- aplicada no se edita: la base que ya la tenga se quedaría con la vieja).
-- Vale igual si la 245 está aplicada que si entra justo antes que esta.
--
--   · EL AUTOR SIN FIRMA era `usuario_id`, que en muchas tablas es el
--     responsable o el destinatario (una tarea creada por un cron para Laura
--     quedaba «dada de alta por Laura»). Ahora: `creado_por` en un alta,
--     `anulado_por` y `aprobado_por` en lo suyo, y nada más. Si el código firmó
--     un origen sin usuario, el autor queda vacío: lo hizo el sistema.
--   · LA ACCIÓN Y EL MOTIVO FIRMADOS valían para todas las filas de la
--     transacción: el alta de un aviso creado junto a una reasignación quedaba
--     como «reasignacion». Ahora valen solo para los CAMBIOS (un alta es «alta»
--     y un borrado, «borrado»), y van en variables propias
--     (telecab.libro_accion, telecab.libro_motivo) para no cruzarse con el
--     vocabulario del libro de las J (db/228), que usa telecab.accion.
--   · AUDITORIA_VIGILAR no comprobaba las columnas que no se apuntan: una errata
--     («pass_has») copiaba la contraseña al libro, que no se puede borrar.
--     Ahora exige que existan, que las de nombre de secreto estén entre ellas,
--     que la clave tenga índice único de una sola columna y que no sea una fecha
--     con hora (su texto cambia con la zona).
--   · SI UN CAMBIO MUEVE LA CLAVE, también se apunta en la historia de la vieja.
--   · `registro` pasa a TEXT: una clave de más de 80 letras tumbaba la escritura
--     de negocio desde el disparador. De varchar a text no reescribe la tabla.

BEGIN;

ALTER TABLE auditoria ALTER COLUMN registro TYPE TEXT;

-- ── El apunte: cada alta, cambio o borrado de una tabla vigilada ────────────
-- TG_ARGV[0]: la columna que identifica la fila.
-- TG_ARGV[1]: columnas que NO se apuntan, separadas por comas.
CREATE OR REPLACE FUNCTION auditoria_apuntar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clave        text   := COALESCE(NULLIF(TG_ARGV[0], ''), 'id');
  fuera        text[] := CASE WHEN COALESCE(TG_ARGV[1], '') = '' THEN '{}'::text[]
                              ELSE string_to_array(TG_ARGV[1], ',') END;
  fila_nueva   jsonb  := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  fila_vieja   jsonb  := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  cual         text   := COALESCE(fila_nueva, fila_vieja) ->> clave;
  cual_antes   text   := fila_vieja ->> clave;
  viejo        jsonb;
  nuevo        jsonb;
  difs         jsonb;
  acc          text;
  porque       text;
  quien        int    := auditoria_entero(NULLIF(current_setting('telecab.usuario_id', true), ''));
  donde        text   := NULLIF(current_setting('telecab.origen', true), '');
BEGIN
  viejo := fila_vieja - fuera;
  nuevo := fila_nueva - fuera;

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, jsonb_build_array(viejo -> k, nuevo -> k)) INTO difs
      FROM jsonb_object_keys(nuevo) k
     WHERE (viejo -> k) IS DISTINCT FROM (nuevo -> k);
    IF difs IS NULL THEN RETURN NULL; END IF;   -- nada cambió: nada que apuntar
  END IF;

  -- La acción: un alta y un borrado son siempre eso. En un cambio, la que firmó
  -- el código o, si no firmó ninguna, la que se deduce del cambio.
  IF TG_OP = 'INSERT' THEN
    acc := 'alta';
  ELSIF TG_OP = 'DELETE' THEN
    acc := 'borrado';
    porque := NULLIF(current_setting('telecab.libro_motivo', true), '');
  ELSE
    acc := NULLIF(current_setting('telecab.libro_accion', true), '');
    porque := NULLIF(current_setting('telecab.libro_motivo', true), '');
    IF acc IS NULL THEN
      acc := CASE
        WHEN difs ? 'anulado_at' AND (nuevo ->> 'anulado_at') IS NOT NULL THEN 'anulacion'
        WHEN difs ? 'aprobado_at' AND (nuevo ->> 'aprobado_at') IS NOT NULL THEN 'aprobacion'
        WHEN difs ? 'estado' THEN 'estado'
        ELSE 'cambio' END;
    END IF;
    IF porque IS NULL AND acc = 'anulacion' THEN porque := fila_nueva ->> 'anulado_motivo'; END IF;
  END IF;

  -- Sin NADA firmado (ni usuario ni origen): quien firme la columna, si la hay.
  -- Si el código firmó un origen sin usuario, lo hizo el sistema: sin autor.
  IF quien IS NULL AND donde IS NULL THEN
    quien := CASE acc
      WHEN 'alta'       THEN auditoria_entero(fila_nueva ->> 'creado_por')
      WHEN 'anulacion'  THEN auditoria_entero(fila_nueva ->> 'anulado_por')
      WHEN 'aprobacion' THEN auditoria_entero(fila_nueva ->> 'aprobado_por')
      ELSE NULL END;
  END IF;

  INSERT INTO auditoria (tabla, registro, accion, usuario_id, origen, motivo, cambios, antes, despues)
  VALUES (TG_TABLE_NAME, COALESCE(cual, '?'), acc, quien,
          COALESCE(donde, 'sin decir (SQL a mano o migración)'), porque, difs,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE viejo END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE nuevo END);

  -- Si el cambio movió la clave, la historia de la clave vieja también lo cuenta.
  IF TG_OP = 'UPDATE' AND cual_antes IS DISTINCT FROM cual AND cual_antes IS NOT NULL THEN
    INSERT INTO auditoria (tabla, registro, accion, usuario_id, origen, motivo, cambios, antes, despues)
    VALUES (TG_TABLE_NAME, cual_antes, acc, quien,
            COALESCE(donde, 'sin decir (SQL a mano o migración)'), porque, difs, viejo, nuevo);
  END IF;
  RETURN NULL;
END $$;

-- ── Poner una tabla bajo el libro ───────────────────────────────────────────
--   SELECT auditoria_vigilar('tarea');                       -- clave 'id'
--   SELECT auditoria_vigilar('usuario', 'id',
--          ARRAY['pass_hash', 'pass_correo_cifrada', 'token_reset', 'token_expira']);
-- Se puede repetir: rehace los disparadores.
CREATE OR REPLACE FUNCTION auditoria_vigilar(p_tabla regclass, p_clave text DEFAULT 'id', p_fuera text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  num_clave   smallint;
  tipo_clave  regtype;
  faltan      text;
  secretos    text;
BEGIN
  SELECT a.attnum, a.atttypid::regtype INTO num_clave, tipo_clave
    FROM pg_attribute a
   WHERE a.attrelid = p_tabla AND a.attname = p_clave AND a.attnum > 0 AND NOT a.attisdropped;
  IF num_clave IS NULL THEN
    RAISE EXCEPTION 'auditoria_vigilar: % no tiene la columna «%»', p_tabla, p_clave;
  END IF;
  IF tipo_clave IN ('timestamp'::regtype, 'timestamptz'::regtype) THEN
    RAISE EXCEPTION 'auditoria_vigilar: la clave «%» de % es una fecha con hora, y su texto cambia con la zona horaria', p_clave, p_tabla;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indrelid = p_tabla AND i.indisunique AND i.indpred IS NULL
                    AND i.indnatts = 1 AND i.indkey[0] = num_clave) THEN
    RAISE EXCEPTION 'auditoria_vigilar: la clave «%» de % no es única por sí sola: dos registros compartirían historia', p_clave, p_tabla;
  END IF;

  SELECT string_agg(f, ', ') INTO faltan
    FROM unnest(p_fuera) f
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = p_tabla AND a.attname = f AND a.attnum > 0 AND NOT a.attisdropped);
  IF faltan IS NOT NULL THEN
    RAISE EXCEPTION 'auditoria_vigilar: % no tiene estas columnas de las que no se apuntan: % (¿una errata?)', p_tabla, faltan;
  END IF;

  SELECT string_agg(a.attname, ', ') INTO secretos
    FROM pg_attribute a
   WHERE a.attrelid = p_tabla AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname ~ '(^|_)(pass|password|token|secret|secreto|hash|cifrado|cifrada)(_|$)'
     AND NOT (a.attname = ANY (p_fuera));
  IF secretos IS NOT NULL THEN
    RAISE EXCEPTION 'auditoria_vigilar: % tiene columnas con nombre de secreto que se copiarían al libro para siempre: % (pásalas en las que no se apuntan)', p_tabla, secretos;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria ON %s', p_tabla);
  EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %s
                    FOR EACH ROW EXECUTE FUNCTION auditoria_apuntar(%L, %L)',
                 p_tabla, p_clave, array_to_string(p_fuera, ','));
  EXECUTE format('DROP TRIGGER IF EXISTS trg_auditoria_sin_vaciar ON %s', p_tabla);
  EXECUTE format('CREATE TRIGGER trg_auditoria_sin_vaciar BEFORE TRUNCATE ON %s
                    FOR EACH STATEMENT EXECUTE FUNCTION auditoria_sin_vaciar()', p_tabla);
END $$;

COMMENT ON FUNCTION auditoria_vigilar(regclass, text, text[]) IS
  'Pone una tabla bajo el libro de auditoría (db/245): cada alta, cambio y borrado deja su fila en `auditoria`, y la tabla no se puede vaciar con TRUNCATE. Exige una clave única de una sola columna y que los secretos vayan en las columnas que no se apuntan.';

COMMIT;
