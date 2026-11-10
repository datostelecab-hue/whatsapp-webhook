-- ============================================================
-- 236 — BARCELONA: EL CORRETURNOS ES UNA CASILLA DEL CUADRANTE
-- ============================================================
-- Camilo, 06/11/2026: «Ahora necesito una reconstrucción. En el planificador
-- de Barcelona, si los coches pertenecen a un cuadrante y tienen correturnos,
-- los correturnos sí o sí van a ser una sola casilla cogiendo los coches que
-- estén ahí, ojo, ninguna plaza se puede repetir, si el coche xxxx tiene como
-- libranza el de día el L, no puede haber otro coche descansando de día el L
-- ya que el correturno debe de coger las plazas que no se trabajan, por lo que
-- no puede coger dos coches a la vez. Pero otra cosa, que se pueda agregar la
-- casilla por jornada, tipo: Agregar CT al cuadrante, se abre con 3 opciones:
-- día, noche, todoturno. Si se escoge día o noche no se puede elegir luego el
-- todoturno y viceversa. Si es todoturno es una sola casilla sin logo. Si es
-- día es una sola casilla con logo de sol. Si es noche es una sola casilla con
-- logo de luna. Si es día y noche cada casilla con su logo. El correturno
-- puesto tendrá como día de libranza el día que no coja ninguno de los coches
-- en el cuadrante.»
--
-- Lo que decidió al preguntarle: el CT cubre a TODOS los coches del cuadrante
-- (desaparece «Sin correturnos» por coche; un coche sin cuadrante no lleva CT);
-- y si el cuadrante no tiene CT de un turno, el día que libra el fijo de ese
-- turno el coche no sale (no es hueco).
--
-- EL MODELO NUEVO:
--
--   · Las libranzas, siempre de cada fijo (sede_descanso con turno 'dia' o
--     'noche'). El descanso común del coche (turno NULL, «el bloque») se acaba.
--   · El CT ya no va por coche (sede_coche_ct y las plazas rol = 'ct' de
--     sede_asignacion, de db/234 y db/235): es UNA CASILLA DEL CUADRANTE por
--     jornada —'dia' (sol), 'noche' (luna) o 'todoturno' (sin icono)— que coge,
--     cada día, la plaza de sus coches cuyo fijo libra. Qué coge cada día y
--     cuándo libra el CT se CALCULA (barcelona.plan.js): aquí solo se guarda la
--     casilla y quién la ocupa.
--   · Lo que guarda la base: una casilla de cada jornada por cuadrante a la
--     vez, el todoturno sin día ni noche, y cada persona en una sola casilla a
--     la vez. «Ninguna plaza se repite» (dos plazas que coge la misma casilla no
--     libran el mismo día) lo comprueba el servicio: depende de los descansos de
--     todos los coches del cuadrante, día a día, y eso un CHECK no lo ve.
--
-- db/234 y db/235 pueden estar ya aplicadas en producción: no se tocan. Esto
-- convierte lo que haya (§ 3) y deja lo de antes como HISTORIAL, cerrado la
-- víspera y no borrado, como siempre: el reporte de un día viejo sigue sabiendo
-- quién libraba y quién lo cubrió (barcelona.plan sigue entendiéndolo para esos
-- días). Ninguna tabla se borra.
--
-- Se puede pasar dos veces: la tabla con IF NOT EXISTS, lo de antes ya
-- convertido no vuelve a salir (está cerrado) y los disparadores se sustituyen.

BEGIN;

-- Las exclusiones mezclan `=` sobre números y texto con `&&` sobre rangos en
-- un índice gist: eso lo da btree_gist (db/03 ya la creó).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 1 · Las casillas de CT de cada cuadrante ────────────────────────────────
-- UNA FILA = LA CASILLA CON SU PERSONA EN UN PERIODO. Poner o cambiar a la
-- persona cierra la fila vigente la víspera y abre otra; vaciarla, igual pero
-- sin persona; quitar la casilla la cierra sin sucesora. Así el reporte de un
-- día viejo sabe quién la ocupaba.
CREATE TABLE IF NOT EXISTS sede_cuadrante_ct (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede          varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  -- Un cuadrante no se borra (se da de baja): sin ON DELETE.
  cuadrante_id  bigint       NOT NULL REFERENCES sede_cuadrante(id),
  jornada       varchar(10)  NOT NULL,
  driver_uuid   varchar(64),                         -- la cuenta de BOLT; NULL = casilla vacía
  desde         date         NOT NULL,
  hasta         date,                                -- último día que vale; NULL = sigue
  creado_por    integer      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     timestamptz  NOT NULL DEFAULT now(),
  cerrado_por   integer      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrado_at    timestamptz,
  CONSTRAINT ck_sede_cuadrante_ct_jornada CHECK (jornada IN ('dia', 'noche', 'todoturno')),
  CONSTRAINT ck_sede_cuadrante_ct_rango CHECK (hasta IS NULL OR hasta >= desde),
  CONSTRAINT ck_sede_cuadrante_ct_persona CHECK (driver_uuid IS NULL OR btrim(driver_uuid) <> ''),
  -- UNA DE CADA JORNADA, Y EL TODOTURNO SOLO. La técnica de db/203 y db/234
  -- con los turnos: la de día ocupa el 1, la de noche el 2 y la todoturno los
  -- dos. Así día y noche conviven, pero el todoturno no convive con ninguna, y
  -- dos de la misma jornada tampoco, en fechas que se pisen.
  CONSTRAINT ex_sede_cuadrante_ct_solape EXCLUDE USING gist (
    cuadrante_id WITH =,
    int4range(CASE WHEN jornada = 'noche' THEN 2 ELSE 1 END,
              CASE WHEN jornada = 'dia'   THEN 1 ELSE 2 END, '[]') WITH &&,
    daterange(desde, hasta, '[]') WITH &&),
  -- UNA PERSONA, EN UNA SOLA CASILLA A LA VEZ (de cualquier cuadrante).
  CONSTRAINT ex_sede_cuadrante_ct_persona EXCLUDE USING gist (
    sede WITH =,
    driver_uuid WITH =,
    daterange(desde, hasta, '[]') WITH &&) WHERE (driver_uuid IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_sede_cuadrante_ct_rango ON sede_cuadrante_ct (sede, desde, hasta);

COMMENT ON TABLE sede_cuadrante_ct IS
  'Las casillas de correturnos de los cuadrantes de OTRAS sedes (Barcelona): una fila = la casilla con su persona en un periodo. Coge las plazas de los coches del cuadrante cuyo fijo libra (lo calcula barcelona.plan.js). db/236';
COMMENT ON COLUMN sede_cuadrante_ct.jornada IS
  'dia = coge las plazas de día (sol); noche = las de noche (luna); todoturno = las de día y las de noche. Día y noche conviven; el todoturno, solo.';
COMMENT ON COLUMN sede_cuadrante_ct.driver_uuid IS 'La cuenta de BOLT que la ocupa. NULL = casilla vacía: lo que le toque coger es un hueco.';
COMMENT ON COLUMN sede_cuadrante_ct.hasta IS 'Último día de esa persona en la casilla (o de la casilla). NULL = sigue.';

-- ── 2 · Fuera la red del CT por coche ───────────────────────────────────────
-- El disparador de db/234/db/235 exigía que una plaza de CT cupiera en un
-- periodo con CT de su coche. Ya no hay plazas de CT por coche: se va, y lo
-- sustituye el de § 4, que no deja entrar ninguna.
DROP TRIGGER IF EXISTS tg_sede_asignacion_ct ON sede_asignacion;
DROP FUNCTION IF EXISTS tg_sede_asignacion_ct();

-- ── 3 · Convertir lo que haya ───────────────────────────────────────────────
-- Desde HOY (en Madrid): lo de antes queda como estaba, cerrado la víspera.
DO $$
DECLARE
  v_hoy            date := (now() AT TIME ZONE 'Europe/Madrid')::date;
  r                record;
  v_uuid           varchar(64);
  v_desde          date;
  v_hasta          date;
  v_personas       integer;
  v_casillas       integer := 0;
  v_vacias         integer := 0;
  v_n              integer;
  v_plazas_cerr    integer := 0;
  v_plazas_borr    integer := 0;
  v_periodos_cerr  integer := 0;
  v_periodos_borr  integer := 0;
  v_comunes        integer := 0;
BEGIN
  -- 3a · LAS CASILLAS. Cada cuadrante vivo con algún coche con CT de hoy en
  -- adelante tenía el CT por coche: con su bloque, el coche salía siempre, de
  -- día y de noche (sin nadie de CT, eso era un hueco). Para que siga igual,
  -- una casilla de día y una de noche desde hoy (o desde que empezaba su CT, si
  -- estaba escrito para más adelante) hasta que acababa (sin fin si algún coche
  -- lo llevaba sin fin), con la persona que llevaba el CT de ese turno en sus
  -- coches (vacía si no había nadie: sigue siendo hueco).
  FOR r IN
    SELECT q.id AS cuadrante_id, q.sede, q.numero, t.turno
      FROM sede_cuadrante q
     CROSS JOIN (VALUES ('dia'), ('noche')) AS t(turno)
     WHERE q.baja_at IS NULL
       AND EXISTS (SELECT 1 FROM sede_coche c
                     JOIN sede_coche_ct x ON x.sede = c.sede AND x.matricula = c.matricula
                    WHERE c.cuadrante_id = q.id AND (x.hasta IS NULL OR x.hasta >= v_hoy))
       -- Ya convertido (o puesto a mano): no se toca.
       AND NOT EXISTS (SELECT 1 FROM sede_cuadrante_ct k
                        WHERE k.cuadrante_id = q.id AND (k.hasta IS NULL OR k.hasta >= v_hoy)
                          AND (k.jornada = t.turno OR k.jornada = 'todoturno'))
     ORDER BY q.sede, q.numero, t.turno
  LOOP
    SELECT GREATEST(v_hoy, min(x.desde)),
           CASE WHEN bool_or(x.hasta IS NULL) THEN NULL ELSE max(x.hasta) END
      INTO v_desde, v_hasta
      FROM sede_coche c
      JOIN sede_coche_ct x ON x.sede = c.sede AND x.matricula = c.matricula
     WHERE c.cuadrante_id = r.cuadrante_id AND (x.hasta IS NULL OR x.hasta >= v_hoy);
    -- Quién: el CT de ese turno en los coches del cuadrante, de hoy en adelante.
    -- Si eran varias personas, la más reciente (primero la que vale hoy).
    SELECT count(DISTINCT a.driver_uuid) INTO v_personas
      FROM sede_asignacion a
      JOIN sede_coche c ON c.sede = a.sede AND c.matricula = a.matricula
     WHERE c.cuadrante_id = r.cuadrante_id AND a.rol = 'ct' AND a.turno = r.turno
       AND (a.hasta IS NULL OR a.hasta >= v_hoy);
    SELECT a.driver_uuid INTO v_uuid
      FROM sede_asignacion a
      JOIN sede_coche c ON c.sede = a.sede AND c.matricula = a.matricula
     WHERE c.cuadrante_id = r.cuadrante_id AND a.rol = 'ct' AND a.turno = r.turno
       AND (a.hasta IS NULL OR a.hasta >= v_hoy)
     ORDER BY (a.desde <= v_hoy) DESC, a.desde DESC, a.id DESC
     LIMIT 1;
    IF v_personas > 1 THEN
      RAISE NOTICE 'C%: % personas de CT de % en sus coches; en la casilla se queda la más reciente (%).',
        r.numero, v_personas, CASE r.turno WHEN 'dia' THEN 'día' ELSE 'noche' END, v_uuid;
    END IF;
    -- Una persona, en una sola casilla: antes podía ser CT de día de un coche y
    -- de noche de otro. Se queda en la primera (por número de cuadrante, el día
    -- antes que la noche) y esta sale vacía.
    IF v_uuid IS NOT NULL AND EXISTS (
         SELECT 1 FROM sede_cuadrante_ct k
          WHERE k.sede = r.sede AND k.driver_uuid = v_uuid
            AND daterange(k.desde, k.hasta, '[]') && daterange(v_desde, v_hasta, '[]')) THEN
      RAISE NOTICE 'C%: % ya está en otra casilla; la de % queda vacía.',
        r.numero, v_uuid, CASE r.turno WHEN 'dia' THEN 'día' ELSE 'noche' END;
      v_uuid := NULL;
    END IF;
    INSERT INTO sede_cuadrante_ct (sede, cuadrante_id, jornada, driver_uuid, desde, hasta)
    VALUES (r.sede, r.cuadrante_id, r.turno, v_uuid, v_desde, v_hasta);
    v_casillas := v_casillas + 1;
    IF v_uuid IS NULL THEN v_vacias := v_vacias + 1; END IF;
  END LOOP;

  -- Un CT por coche en un coche sin cuadrante (vivo) no tiene casilla a la que
  -- ir: un coche sin cuadrante no lleva CT. Se dice cuáles.
  FOR r IN
    SELECT DISTINCT a.matricula, a.turno, a.driver_uuid
      FROM sede_asignacion a
      LEFT JOIN sede_coche c ON c.sede = a.sede AND c.matricula = a.matricula
      LEFT JOIN sede_cuadrante q ON q.id = c.cuadrante_id AND q.baja_at IS NULL
     WHERE a.rol = 'ct' AND (a.hasta IS NULL OR a.hasta >= v_hoy) AND q.id IS NULL
     ORDER BY 1, 2
  LOOP
    RAISE NOTICE 'El % no está en ningún cuadrante: su CT de % (%) se quita (un coche sin cuadrante no lleva CT).',
      r.matricula, CASE r.turno WHEN 'dia' THEN 'día' ELSE 'noche' END, r.driver_uuid;
  END LOOP;

  -- 3b · LAS PLAZAS DE CT POR COCHE: lo que valía hoy se cierra la víspera; lo
  -- que aún no había empezado, se borra (no llegó a valer).
  DELETE FROM sede_asignacion WHERE rol = 'ct' AND desde >= v_hoy;
  GET DIAGNOSTICS v_plazas_borr = ROW_COUNT;
  UPDATE sede_asignacion SET hasta = v_hoy - 1, cerrado_at = now()
   WHERE rol = 'ct' AND desde < v_hoy AND (hasta IS NULL OR hasta >= v_hoy);
  GET DIAGNOSTICS v_plazas_cerr = ROW_COUNT;

  -- 3c · LOS PERIODOS CON CT POR COCHE, igual.
  DELETE FROM sede_coche_ct WHERE desde >= v_hoy;
  GET DIAGNOSTICS v_periodos_borr = ROW_COUNT;
  UPDATE sede_coche_ct SET hasta = v_hoy - 1, cerrado_at = now()
   WHERE desde < v_hoy AND (hasta IS NULL OR hasta >= v_hoy);
  GET DIAGNOSTICS v_periodos_cerr = ROW_COUNT;

  -- 3d · EL DESCANSO COMÚN (el bloque) PASA A CADA FIJO: los mismos días, uno
  -- de día y otro de noche, de hoy (o de cuando empezara) hasta donde llegara.
  -- Primero se cierra (o se borra) el común: la exclusión de db/234 no deja que
  -- conviva con uno de turno en las mismas fechas.
  FOR r IN
    SELECT id, sede, matricula, dias, desde, hasta
      FROM sede_descanso
     WHERE turno IS NULL AND (hasta IS NULL OR hasta >= v_hoy)
     ORDER BY id
  LOOP
    IF r.desde < v_hoy THEN
      UPDATE sede_descanso SET hasta = v_hoy - 1, cerrado_at = now() WHERE id = r.id;
    ELSE
      DELETE FROM sede_descanso WHERE id = r.id;
    END IF;
    INSERT INTO sede_descanso (sede, matricula, turno, dias, desde, hasta)
    SELECT r.sede, r.matricula, t.turno, r.dias, GREATEST(r.desde, v_hoy), r.hasta
      FROM (VALUES ('dia'), ('noche')) AS t(turno);
    v_comunes := v_comunes + 1;
  END LOOP;

  -- 3e · ¿SE REPITE ALGUNA PLAZA? Un cuadrante podía tener coches sin CT (con
  -- la libranza de cada fijo) junto a los que lo llevaban: ahora la casilla los
  -- coge a todos, y dos pueden librar el mismo día. No se arregla aquí (es
  -- decisión de quien planifica): se dice, y la pantalla lo enseña en la
  -- casilla hasta que se cambie una de las libranzas.
  FOR r IN
    SELECT q.numero, k.jornada, d.dia,
           string_agg(s.matricula || CASE s.turno WHEN 'dia' THEN ' (de día)' ELSE ' (de noche)' END, ', '
                      ORDER BY s.turno, s.matricula) AS plazas
      FROM sede_cuadrante_ct k
      JOIN sede_cuadrante q ON q.id = k.cuadrante_id
      JOIN sede_coche c ON c.cuadrante_id = k.cuadrante_id
      JOIN sede_descanso s ON s.sede = c.sede AND s.matricula = c.matricula
                          AND s.turno IN ('dia', 'noche') AND (k.jornada = 'todoturno' OR s.turno = k.jornada)
                          AND s.desde <= v_hoy AND (s.hasta IS NULL OR s.hasta >= v_hoy)
     CROSS JOIN LATERAL unnest(s.dias) AS d(dia)
     WHERE k.desde <= v_hoy AND (k.hasta IS NULL OR k.hasta >= v_hoy)
     GROUP BY q.numero, k.jornada, d.dia
    HAVING count(*) > 1
     ORDER BY q.numero, k.jornada, d.dia
  LOOP
    RAISE NOTICE 'Ojo: en el C% el CT % cogería varias plazas el % (%): ninguna plaza se puede repetir; cámbiale la libranza a una en el planificador.',
      r.numero, CASE r.jornada WHEN 'dia' THEN 'de día' WHEN 'noche' THEN 'de noche' ELSE 'todoturno' END,
      (ARRAY['L', 'M', 'X', 'J', 'V', 'S', 'D'])[r.dia], r.plazas;
  END LOOP;

  SELECT count(*) INTO v_n FROM sede_cuadrante_ct;
  RAISE NOTICE 'db/236: % casilla(s) de CT creada(s) (% vacía(s)); plazas de CT por coche: % cerrada(s) la víspera y % borrada(s); periodos con CT por coche: % cerrado(s) y % borrado(s); % descanso(s) común(es) pasado(s) a cada fijo. Casillas en total: %.',
    v_casillas, v_vacias, v_plazas_cerr, v_plazas_borr, v_periodos_cerr, v_periodos_borr, v_comunes, v_n;
END $$;

-- ── 4 · Lo de antes, solo como historial ────────────────────────────────────
-- Venga de donde venga (la pantalla de antes abierta, un apaño a mano), no
-- entran plazas de CT por coche ni periodos con CT por coche nuevos. Lo que ya
-- hay se puede ACORTAR (cerrarlo la víspera), nunca alargar ni reabrir: es lo
-- único que hace falta para cerrar una fila que se hubiera quedado abierta.
-- Un disparador y no un CHECK: un CHECK no distingue la fila de antes de la
-- nueva, y las de antes tienen que quedarse (el reporte de un día viejo las lee).
CREATE OR REPLACE FUNCTION tg_sede_asignacion_sin_ct() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Un fijo entra siempre; lo que era CT no pasa a ser otra cosa (es historial).
  IF NEW.rol <> 'ct' AND (TG_OP = 'INSERT' OR OLD.rol <> 'ct') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.rol = 'ct' AND NEW.rol = 'ct' AND NEW.sede = OLD.sede AND NEW.matricula = OLD.matricula
     AND NEW.turno = OLD.turno AND NEW.driver_uuid = OLD.driver_uuid AND NEW.dias IS NOT DISTINCT FROM OLD.dias
     AND NEW.desde >= OLD.desde AND NEW.hasta IS NOT NULL AND (OLD.hasta IS NULL OR NEW.hasta <= OLD.hasta) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Los correturnos ya no van por coche: desde el 06/11/2026 son casillas del cuadrante («+ CT» en su cabecera)'
    USING ERRCODE = 'check_violation';
END $$;
COMMENT ON FUNCTION tg_sede_asignacion_sin_ct() IS
  'Desde db/236 no entran plazas de CT por coche en sede_asignacion (el CT es una casilla del cuadrante, sede_cuadrante_ct); las de antes solo se pueden acortar.';

DROP TRIGGER IF EXISTS tg_sede_asignacion_sin_ct ON sede_asignacion;
CREATE TRIGGER tg_sede_asignacion_sin_ct
  BEFORE INSERT OR UPDATE ON sede_asignacion
  FOR EACH ROW EXECUTE FUNCTION tg_sede_asignacion_sin_ct();

CREATE OR REPLACE FUNCTION tg_sede_coche_ct_historico() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sede = OLD.sede AND NEW.matricula = OLD.matricula AND NEW.desde >= OLD.desde
     AND NEW.hasta IS NOT NULL AND (OLD.hasta IS NULL OR NEW.hasta <= OLD.hasta) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Los coches ya no llevan correturnos: desde el 06/11/2026 el CT es una casilla del cuadrante'
    USING ERRCODE = 'check_violation';
END $$;
COMMENT ON FUNCTION tg_sede_coche_ct_historico() IS
  'Desde db/236 sede_coche_ct es solo historial: no entran periodos nuevos y los de antes solo se pueden acortar.';

DROP TRIGGER IF EXISTS tg_sede_coche_ct_historico ON sede_coche_ct;
CREATE TRIGGER tg_sede_coche_ct_historico
  BEFORE INSERT OR UPDATE ON sede_coche_ct
  FOR EACH ROW EXECUTE FUNCTION tg_sede_coche_ct_historico();

-- ── 5 · Lo que dicen las tablas de antes ────────────────────────────────────
COMMENT ON TABLE sede_coche_ct IS
  'HISTÓRICO: los periodos en que un coche de OTRA sede (Barcelona) llevó correturnos por coche (db/234). Desde db/236 los CT son casillas del cuadrante (sede_cuadrante_ct): aquí ya no entra nada.';
COMMENT ON TABLE sede_asignacion IS
  'Planificador de OTRAS sedes (Barcelona): quién lleva cada matrícula de día o de noche de fijo, hasta que se cambia; libra lo de su plaza (sede_descanso). Los correturnos son casillas del cuadrante (sede_cuadrante_ct, db/236); las filas rol = ct son HISTÓRICO (db/181, db/234, db/236).';
COMMENT ON COLUMN sede_asignacion.rol IS
  'fijo = trabaja todos los días menos los que libra su plaza. ct = HISTÓRICO: el CT por coche de db/234; desde db/236 los CT son casillas del cuadrante y no entran filas nuevas con rol ct.';
COMMENT ON COLUMN sede_asignacion.dias IS 'Solo en las filas rol = ct (histórico, antes de db/236): los días de la semana (ISODOW) que cubría en esa matrícula. NULL en un fijo.';
COMMENT ON TABLE sede_descanso IS
  'Lo que libra el fijo de cada plaza de OTRAS sedes (Barcelona), con fecha: turno dia/noche. turno NULL = HISTÓRICO: el descanso común de un coche con CT por coche (db/234), pasado a cada fijo en db/236. db/234, db/236';
COMMENT ON COLUMN sede_descanso.turno IS
  'dia/noche = lo que libra el fijo de ese turno. NULL = HISTÓRICO: el bloque de un coche con CT por coche de antes de db/236 (ya no se escribe).';

COMMIT;
