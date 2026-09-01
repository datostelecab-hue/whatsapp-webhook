-- ============================================================
-- 44 - CIERRE MENSUAL, SNAPSHOT Y REGULARIZACION (spec 7)
-- ============================================================
-- Hito 7. Las dos ultimas reglas de oro, hechas base de datos:
--
--   NADA SE SOBRESCRIBE / EL PASADO NO SE REESCRIBE. Al cerrar un mes se
--   FOTOGRAFIA la reconciliacion de cada contrato y se congela. Esa foto es la
--   nomina de ese mes, y no cambia jamas.
--
--   Si despues llega un dato de origen que la habria cambiado -una correccion
--   tardia de BOLT, una baja que se registra con retraso- el mes cerrado NO se
--   toca: la diferencia se apunta como REGULARIZACION en el primer mes abierto.
--   Asi la nomina ya pagada es intocable y el ajuste queda trazado.
--
-- EL MANIFIESTO. El cierre guarda una huella (sha256) de todo lo congelado. Es
-- la prueba de que lo que se cerro es lo que se pago: si alguien dudara, se
-- recalcula la huella sobre la foto y tiene que dar lo mismo.

BEGIN;

-- digest() -para el manifiesto sha256- viene de pgcrypto.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── El periodo de nomina y su candado ───────────────────────────────────────
CREATE TABLE periodo_nomina (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  anio         SMALLINT    NOT NULL,
  mes          SMALLINT    NOT NULL,
  estado       VARCHAR(10) NOT NULL DEFAULT 'abierto',   -- abierto, cerrado
  cerrado_at   TIMESTAMPTZ,
  cerrado_por  VARCHAR(120),
  -- La huella de lo congelado. La prueba de que el cierre es el cierre.
  manifiesto   CHAR(64),
  -- Reapertura excepcional (art. spec): la version N se conserva, se abre N+1.
  reabierto_at TIMESTAMPTZ,
  reabierto_por VARCHAR(120),
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_pernom_mes CHECK (mes BETWEEN 1 AND 12),
  CONSTRAINT ck_pernom_estado CHECK (estado IN ('abierto','cerrado')),
  CONSTRAINT uq_pernom UNIQUE (anio, mes)
);

COMMENT ON TABLE periodo_nomina IS
  'El mes de nomina y si esta abierto o cerrado. Un mes cerrado se congela con su manifiesto y no se reescribe';

-- ── La foto congelada de la reconciliacion ──────────────────────────────────
-- Una fila por contrato y mes cerrado, con las cifras que valieron. ESTO es la
-- nomina de ese mes; la vista v_conciliacion_mes es la foto EN VIVO, que puede
-- moverse. La diferencia entre las dos es lo que se regulariza.
CREATE TABLE cierre_conciliacion (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  periodo_id   BIGINT      NOT NULL REFERENCES periodo_nomina(id) ON DELETE CASCADE,
  contrato_id  BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  bruta        INTEGER     NOT NULL,
  reduce       INTEGER     NOT NULL,
  neta         INTEGER     NOT NULL,
  cumple       INTEGER     NOT NULL,
  cumple_total INTEGER     NOT NULL,
  cubre        INTEGER     NOT NULL,
  defecto      INTEGER     NOT NULL,
  exceso       INTEGER     NOT NULL,
  congelado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_cierre UNIQUE (periodo_id, contrato_id)
);

COMMENT ON TABLE cierre_conciliacion IS
  'La foto congelada de la reconciliacion al cerrar el mes. Es la nomina de ese mes; no se reescribe';

-- ── Las regularizaciones hacia adelante ─────────────────────────────────────
CREATE TABLE regularizacion (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id        BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id       BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- El mes CERRADO cuyo dato cambio.
  origen_anio        SMALLINT    NOT NULL,
  origen_mes         SMALLINT    NOT NULL,
  -- El mes ABIERTO donde se aplica el ajuste.
  aplica_anio        SMALLINT    NOT NULL,
  aplica_mes         SMALLINT    NOT NULL,
  concepto           VARCHAR(16) NOT NULL,       -- cumple, reduce
  -- El ajuste, en minutos. Positivo o negativo. Es la diferencia entre lo que
  -- dice la foto en vivo ahora y lo que se congelo, menos lo ya regularizado.
  delta_min          INTEGER     NOT NULL,
  motivo             VARCHAR(200),
  creado_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_reg_concepto CHECK (concepto IN ('cumple','reduce')),
  CONSTRAINT ck_reg_delta CHECK (delta_min <> 0)
);
CREATE INDEX idx_reg_aplica ON regularizacion (aplica_anio, aplica_mes);
CREATE INDEX idx_reg_origen ON regularizacion (contrato_id, origen_anio, origen_mes, concepto);

COMMENT ON TABLE regularizacion IS
  'El ajuste de un mes cerrado que cambio, aplicado en el mes abierto. El cerrado no se toca; el delta va hacia adelante';

-- ── Cerrar un mes: fotografiar, congelar y candar ───────────────────────────
CREATE OR REPLACE FUNCTION f_cerrar_periodo(p_anio INT, p_mes INT, p_quien VARCHAR)
RETURNS TABLE(periodo_id BIGINT, contratos INT, manifiesto CHAR(64))
LANGUAGE plpgsql AS $func$
DECLARE
  per_id BIGINT;
  huella CHAR(64);
  n INT;
BEGIN
  -- El periodo, creandolo si no existe. Si ya esta cerrado, no se recierra.
  INSERT INTO periodo_nomina (anio, mes) VALUES (p_anio, p_mes)
  ON CONFLICT (anio, mes) DO NOTHING;
  SELECT id INTO per_id FROM periodo_nomina WHERE anio = p_anio AND mes = p_mes;
  IF (SELECT estado FROM periodo_nomina WHERE id = per_id) = 'cerrado' THEN
    RAISE EXCEPTION 'El periodo %-% ya esta cerrado', p_anio, p_mes;
  END IF;

  -- La foto: la reconciliacion en vivo de este mes, congelada.
  INSERT INTO cierre_conciliacion
    (periodo_id, contrato_id, bruta, reduce, neta, cumple, cumple_total, cubre, defecto, exceso)
  SELECT per_id, contrato_id, bruta, reduce, neta, cumple, cumple_total, cubre, defecto, exceso
    FROM v_conciliacion_mes WHERE anio = p_anio AND mes = p_mes
  ON CONFLICT (periodo_id, contrato_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Congelar el objetivo y el registro del mes: ya no se rehacen.
  UPDATE objetivo_mensual SET congelado_at = now()
   WHERE anio = p_anio AND mes = p_mes AND congelado_at IS NULL;
  UPDATE registro_jornada SET congelado_at = now()
   WHERE congelado_at IS NULL
     AND dia >= make_date(p_anio, p_mes, 1)
     AND dia <  (make_date(p_anio, p_mes, 1) + INTERVAL '1 month')::date;

  -- El manifiesto: huella de todo lo congelado. Ordenado para ser reproducible.
  SELECT encode(digest(string_agg(
           contrato_id || ':' || bruta || ':' || reduce || ':' || cumple || ':' ||
           cumple_total || ':' || cubre || ':' || defecto || ':' || exceso,
           '|' ORDER BY contrato_id), 'sha256'), 'hex')
    INTO huella
    FROM cierre_conciliacion WHERE periodo_id = per_id;

  UPDATE periodo_nomina
     SET estado = 'cerrado', cerrado_at = now(), cerrado_por = p_quien, manifiesto = huella
   WHERE id = per_id;

  RETURN QUERY SELECT per_id, n, huella;
END;
$func$;

COMMENT ON FUNCTION f_cerrar_periodo(INT, INT, VARCHAR) IS
  'Cierra un mes: fotografia la reconciliacion, congela objetivo y registro, y sella con su manifiesto';

-- ── Regularizar: lo que cambio en un mes cerrado, hacia adelante ─────────────
-- Compara la foto en vivo del mes cerrado con la congelada. Si difieren (llego
-- un dato tarde), apunta la diferencia en el mes de aplicacion. Idempotente: el
-- delta que apunta es el cambio NUEVO, descontando lo ya regularizado, asi que
-- correrla dos veces sin cambios de por medio no crea nada.
CREATE OR REPLACE FUNCTION f_regularizar(
  p_anio_cerrado INT, p_mes_cerrado INT, p_aplica_anio INT, p_aplica_mes INT)
RETURNS INT
LANGUAGE plpgsql AS $func$
DECLARE
  creadas INT := 0;
  r RECORD;
  ya_cumple INT; ya_reduce INT;
  delta INT;
BEGIN
  FOR r IN
    SELECT v.contrato_id, c.conductor_id,
           v.cumple AS cumple_vivo, v.reduce AS reduce_vivo,
           cc.cumple AS cumple_foto, cc.reduce AS reduce_foto
      FROM v_conciliacion_mes v
      JOIN cierre_conciliacion cc ON cc.contrato_id = v.contrato_id
      JOIN periodo_nomina p ON p.id = cc.periodo_id
                           AND p.anio = p_anio_cerrado AND p.mes = p_mes_cerrado
      JOIN contrato c ON c.id = v.contrato_id
     WHERE v.anio = p_anio_cerrado AND v.mes = p_mes_cerrado
  LOOP
    -- Lo ya regularizado de este contrato para este concepto y mes origen.
    SELECT COALESCE(sum(delta_min), 0) INTO ya_cumple FROM regularizacion
     WHERE contrato_id = r.contrato_id AND origen_anio = p_anio_cerrado
       AND origen_mes = p_mes_cerrado AND concepto = 'cumple';
    SELECT COALESCE(sum(delta_min), 0) INTO ya_reduce FROM regularizacion
     WHERE contrato_id = r.contrato_id AND origen_anio = p_anio_cerrado
       AND origen_mes = p_mes_cerrado AND concepto = 'reduce';

    delta := (r.cumple_vivo - r.cumple_foto) - ya_cumple;
    IF delta <> 0 THEN
      INSERT INTO regularizacion (contrato_id, conductor_id, origen_anio, origen_mes,
        aplica_anio, aplica_mes, concepto, delta_min, motivo)
      VALUES (r.contrato_id, r.conductor_id, p_anio_cerrado, p_mes_cerrado,
        p_aplica_anio, p_aplica_mes, 'cumple', delta,
        'Cambio en el trabajo efectivo tras el cierre');
      creadas := creadas + 1;
    END IF;

    delta := (r.reduce_vivo - r.reduce_foto) - ya_reduce;
    IF delta <> 0 THEN
      INSERT INTO regularizacion (contrato_id, conductor_id, origen_anio, origen_mes,
        aplica_anio, aplica_mes, concepto, delta_min, motivo)
      VALUES (r.contrato_id, r.conductor_id, p_anio_cerrado, p_mes_cerrado,
        p_aplica_anio, p_aplica_mes, 'reduce', delta,
        'Cambio en las ausencias tras el cierre');
      creadas := creadas + 1;
    END IF;
  END LOOP;
  RETURN creadas;
END;
$func$;

COMMENT ON FUNCTION f_regularizar(INT, INT, INT, INT) IS
  'Apunta en el mes abierto lo que cambio en un mes cerrado. El cerrado no se toca. Idempotente: descuenta lo ya regularizado';

COMMIT;
