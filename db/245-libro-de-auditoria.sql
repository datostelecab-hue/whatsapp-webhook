-- ============================================================
-- 245 — EL LIBRO DE AUDITORÍA: un solo registro de quién, qué y cuándo
-- ============================================================
-- Hoja de ruta de Ignacio, convención 5: «Registro de auditoría. Cada alta,
-- cambio de estado, aprobación o lectura de un aviso guarda quién, qué y
-- cuándo. Nada se borra: se anula, con motivo». Pieza A4 de
-- docs/Hoja de ruta.md (13/11/2026).
--
-- Es el libro de las J (db/228) hecho para cualquier tabla:
--
--   · LO ESCRIBE LA BASE, NO EL CÓDIGO. Una tabla se pone bajo el libro con
--         SELECT auditoria_vigilar('tarea');
--     y desde ese momento un disparador apunta cada alta, cambio y borrado,
--     venga de donde venga (la aplicación, una migración o SQL a mano), con la
--     fila de antes, la de después y los campos que cambiaron. Un cambio que
--     no cambia nada no se apunta.
--   · EL CÓDIGO DICE QUIÉN, DESDE DÓNDE Y POR QUÉ, en la misma transacción
--     (services/libro.js, `firmar`), con las mismas variables que db/228:
--     telecab.usuario_id, telecab.origen, telecab.accion y telecab.motivo. Si
--     no lo dice, la fila se apunta igual: con quien firme la columna si la
--     hay (usuario_id, anulado_por, aprobado_por) y el origen «sin decir».
--   · LO QUE NO ES UNA FILA también se apunta: una LECTURA de un aviso, una
--     reasignación con su motivo… (`libro.apuntar`).
--   · EL LIBRO NO SE TOCA: no admite UPDATE, DELETE ni TRUNCATE. No lleva
--     claves ajenas: borrar una persona no puede borrar su historia.
--   · UNA TABLA VIGILADA NO SE VACÍA: TRUNCATE no pasa por los disparadores de
--     fila y se llevaría la historia sin apuntarla, así que se impide.
--
-- Lo viejo se queda como está (cambio_campo, ticket_evento, el libro de las
-- J): esto es para lo que nazca a partir de ahora, empezando por el tablero de
-- tareas y los avisos de la hoja de ruta. Quién puede LEER el libro lo decide
-- el módulo dueño de cada registro: aquí no hay pantalla que lo enseñe entero.

BEGIN;

CREATE TABLE IF NOT EXISTS auditoria (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- DE QUÉ: la tabla del registro (o la entidad, si es un apunte sin fila).
  tabla       VARCHAR(63)  NOT NULL,
  -- CUÁL: su clave, como texto (también las que no son números).
  registro    VARCHAR(80)  NOT NULL,
  -- QUÉ: alta, cambio, estado, aprobacion, anulacion, borrado, lectura,
  -- reasignacion… Las deduce la base o las dice el código.
  accion      VARCHAR(24)  NOT NULL CHECK (accion ~ '^[a-z_]+$'),
  usuario_id  INTEGER,                -- QUIÉN; NULL = no lo dijo nadie
  origen      VARCHAR(60),            -- DESDE DÓNDE: la pantalla, la tarea programada, una migración…
  motivo      TEXT,                   -- POR QUÉ, cuando lo hay (una anulación, una reasignación)
  cambios     JSONB,                  -- { campo: [antes, después] }, solo en los cambios
  antes       JSONB,
  despues     JSONB,
  detalle     JSONB,                  -- lo que apunta el código en un apunte sin fila
  en          TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
  bd_usuario  TEXT         NOT NULL DEFAULT current_user
);

CREATE INDEX IF NOT EXISTS idx_auditoria_registro ON auditoria (tabla, registro, en);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario  ON auditoria (usuario_id, en);
CREATE INDEX IF NOT EXISTS idx_auditoria_en       ON auditoria (en);

COMMENT ON TABLE auditoria IS
  'Libro de auditoría de todo lo nuevo (convención 5 de la hoja de ruta): una fila por alta, cambio, borrado o apunte (una lectura, una reasignación). Lo escribe el disparador de auditoria_vigilar() o services/libro.js. No se cambia ni se borra (db/245).';

-- ── El libro no se toca ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION auditoria_intocable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El libro de auditoría no se cambia ni se borra (db/245)';
END $$;

DROP TRIGGER IF EXISTS trg_auditoria_intocable ON auditoria;
CREATE TRIGGER trg_auditoria_intocable BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_intocable();
DROP TRIGGER IF EXISTS trg_auditoria_intocable_truncate ON auditoria;
CREATE TRIGGER trg_auditoria_intocable_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_intocable();

-- ── Un número que puede no serlo ────────────────────────────────────────────
-- Para leer quién firmó una columna sin reventar si la columna no es un id.
CREATE OR REPLACE FUNCTION auditoria_entero(v text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v ~ '^[0-9]{1,9}$' THEN v::integer END
$$;

-- ── El apunte: cada alta, cambio o borrado de una tabla vigilada ────────────
-- TG_ARGV[0]: la columna que identifica la fila ('id' por defecto).
-- TG_ARGV[1]: columnas que NO se apuntan, separadas por comas (una contraseña,
--             un `actualizado_at` que cambia en cada guardado…).
CREATE OR REPLACE FUNCTION auditoria_apuntar() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  clave   text   := COALESCE(NULLIF(TG_ARGV[0], ''), 'id');
  fuera   text[] := CASE WHEN COALESCE(TG_ARGV[1], '') = '' THEN '{}'::text[]
                         ELSE string_to_array(TG_ARGV[1], ',') END;
  viejo   jsonb  := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;
  nuevo   jsonb  := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  cual    text   := COALESCE(nuevo, viejo) ->> clave;
  difs    jsonb;
  acc     text   := NULLIF(current_setting('telecab.accion', true), '');
  quien   int    := auditoria_entero(NULLIF(current_setting('telecab.usuario_id', true), ''));
  donde   text   := NULLIF(current_setting('telecab.origen', true), '');
  porque  text   := NULLIF(current_setting('telecab.motivo', true), '');
BEGIN
  viejo := viejo - fuera;
  nuevo := nuevo - fuera;

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(k, jsonb_build_array(viejo -> k, nuevo -> k)) INTO difs
      FROM jsonb_object_keys(nuevo) k
     WHERE (viejo -> k) IS DISTINCT FROM (nuevo -> k);
    IF difs IS NULL THEN RETURN NULL; END IF;   -- nada cambió: nada que apuntar
  END IF;

  IF acc IS NULL THEN
    acc := CASE
      WHEN TG_OP = 'INSERT' THEN 'alta'
      WHEN TG_OP = 'DELETE' THEN 'borrado'
      WHEN difs ? 'anulado_at' AND (nuevo ->> 'anulado_at') IS NOT NULL THEN 'anulacion'
      WHEN difs ? 'aprobado_at' AND (nuevo ->> 'aprobado_at') IS NOT NULL THEN 'aprobacion'
      WHEN difs ? 'estado' THEN 'estado'
      ELSE 'cambio' END;
  END IF;

  IF porque IS NULL AND acc = 'anulacion' THEN porque := nuevo ->> 'anulado_motivo'; END IF;

  -- Sin usuario dicho por el código, quien firme la columna, si la hay.
  IF quien IS NULL THEN
    quien := CASE acc
      WHEN 'alta'       THEN COALESCE(auditoria_entero(nuevo ->> 'usuario_id'), auditoria_entero(nuevo ->> 'creado_por'))
      WHEN 'anulacion'  THEN auditoria_entero(nuevo ->> 'anulado_por')
      WHEN 'aprobacion' THEN auditoria_entero(nuevo ->> 'aprobado_por')
      ELSE NULL END;
  END IF;

  INSERT INTO auditoria (tabla, registro, accion, usuario_id, origen, motivo, cambios, antes, despues)
  VALUES (TG_TABLE_NAME, COALESCE(cual, '?'), acc, quien,
          COALESCE(donde, 'sin decir (SQL a mano o migración)'), porque, difs,
          CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE viejo END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE nuevo END);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION auditoria_sin_vaciar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % está bajo el libro de auditoría: no se vacía con TRUNCATE (db/245)', TG_TABLE_NAME;
END $$;

-- ── Poner una tabla bajo el libro ───────────────────────────────────────────
--   SELECT auditoria_vigilar('tarea');                              -- clave 'id'
--   SELECT auditoria_vigilar('festivo_oficina', 'fecha');
--   SELECT auditoria_vigilar('usuario', 'id', ARRAY['pass_hash']);  -- sin la contraseña
-- Se puede repetir: rehace los disparadores.
CREATE OR REPLACE FUNCTION auditoria_vigilar(p_tabla regclass, p_clave text DEFAULT 'id', p_fuera text[] DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = p_tabla AND attname = p_clave AND attnum > 0 AND NOT attisdropped) THEN
    RAISE EXCEPTION 'auditoria_vigilar: % no tiene la columna «%»', p_tabla, p_clave;
  END IF;
  IF array_to_string(p_fuera, ',') ~ '[^a-z0-9_,]' THEN
    RAISE EXCEPTION 'auditoria_vigilar: las columnas que no se apuntan van en minúsculas y sin espacios';
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
  'Pone una tabla bajo el libro de auditoría (db/245): cada alta, cambio y borrado deja su fila en `auditoria`, y la tabla no se puede vaciar con TRUNCATE.';

COMMIT;
