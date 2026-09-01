-- ============================================================
-- 50 - INCIDENCIAS ECONOMICAS: el pipeline de 5 estados (spec 10)
-- ============================================================
-- Hito 10. La regla de oro DEUDA != DESCUENTO, hecha maquina de estados. Que
-- exista una deuda (una diferencia de caja, un uso personal, una multa) NO es un
-- descuento en nomina. Entre las dos cosas hay cuatro pasos y una firma:
--
--   DETECTADA -> VALIDADA -> AUTORIZADA -> PROGRAMADA -> DESCONTADA
--
-- Y NO SE GENERA UNA LINEA DE NOMINA hasta AUTORIZADA. La autorizacion es
-- SIEMPRE de Direccion (spec 9). Una diferencia de caja puede quedarse en
-- "validada" para siempre sin tocar la nomina de nadie: ese es justo el control.
--
-- DOS CASOS ESPECIALES:
--   · Combustible: solo se puede descontar si hay un acuerdo de vehiculo a
--     domicilio FIRMADO y vigente (art. 28). Sin acuerdo, no hay deduccion.
--   · Multas: se imputan a quien la AUTORIDAD declare responsable, no con la
--     denuncia. Por eso hay un estado PENDIENTE_AUTORIDAD antes de validar.

BEGIN;

-- ── El acuerdo de vehiculo a domicilio (art. 28) ────────────────────────────
-- La base contractual del descuento de combustible. Sin esto firmado y vigente,
-- Control no puede ni proponer una deduccion por combustible.
CREATE TABLE autorizacion_vehiculo_domicilio (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contrato_id      BIGINT      NOT NULL REFERENCES contrato(id) ON DELETE CASCADE,
  conductor_id     BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  vehiculo_id      BIGINT      REFERENCES vehiculo(id) ON DELETE SET NULL,
  documento_id     BIGINT,                     -- el acuerdo firmado
  importe_mensual  NUMERIC(10,2),              -- el coste fijo pactado, si lo hay
  desde            DATE        NOT NULL,
  -- Revocable con 15 dias de preaviso (art. 28.e).
  revocado_at      DATE,
  preaviso_dias    SMALLINT    NOT NULL DEFAULT 15,
  usuario_id       INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_avd_rango CHECK (revocado_at IS NULL OR revocado_at >= desde)
);
CREATE INDEX idx_avd_vigente ON autorizacion_vehiculo_domicilio (conductor_id) WHERE revocado_at IS NULL;

COMMENT ON TABLE autorizacion_vehiculo_domicilio IS
  'El acuerdo firmado de vehiculo a domicilio (art. 28). Sin acuerdo vigente NO hay deduccion de combustible';

-- ── La incidencia economica y su pipeline ───────────────────────────────────
CREATE TABLE incidencia_economica (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id      BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  contrato_id       BIGINT      REFERENCES contrato(id) ON DELETE SET NULL,
  tipo              VARCHAR(20) NOT NULL,   -- diferencia_caja, uso_personal, multa, combustible, dano_vehiculo, otro
  estado            VARCHAR(20) NOT NULL DEFAULT 'detectada',
  -- DEUDA != DESCUENTO: tres importes distintos. Lo detectado no es lo validado
  -- ni lo autorizado. Se guardan los tres para poder ver donde cambio y por que.
  importe_detectado NUMERIC(10,2) NOT NULL,
  importe_validado  NUMERIC(10,2),
  importe_autorizado NUMERIC(10,2),
  evidencia         JSONB,
  -- Multas: la referencia de la resolucion de la autoridad. Sin ella, la multa
  -- no pasa de PENDIENTE_AUTORIDAD.
  ref_autoridad     VARCHAR(60),
  detectada_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  validada_at       TIMESTAMPTZ,
  validada_por      VARCHAR(120),
  autorizada_at     TIMESTAMPTZ,
  autorizada_por    VARCHAR(120),             -- SIEMPRE Direccion
  -- El mes de nomina donde se programa el descuento, y la linea que genero.
  programada_anio   SMALLINT,
  programada_mes    SMALLINT,
  variable_id       BIGINT REFERENCES variable_nomina(id) ON DELETE SET NULL,
  rechazada_at      TIMESTAMPTZ,
  rechazada_por     VARCHAR(120),
  motivo_rechazo    VARCHAR(300),
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_ie_tipo CHECK (tipo IN
    ('diferencia_caja','uso_personal','multa','combustible','dano_vehiculo','otro')),
  CONSTRAINT ck_ie_estado CHECK (estado IN
    ('detectada','pendiente_autoridad','validada','autorizada','programada','descontada','rechazada'))
);
CREATE INDEX idx_ie_estado ON incidencia_economica (estado, detectada_at);
CREATE INDEX idx_ie_conductor ON incidencia_economica (conductor_id, detectada_at DESC);

COMMENT ON TABLE incidencia_economica IS
  'Deuda != descuento: una incidencia recorre 5 estados y NO genera linea de nomina hasta AUTORIZADA por Direccion';

-- El descuento es una variable de nomina mas (importe negativo). La columna ya
-- es VARCHAR(24) tras la 49, asi que 'descuento' cabe. Solo hay que permitirlo.
ALTER TABLE variable_nomina DROP CONSTRAINT IF EXISTS ck_var_tipo;
ALTER TABLE variable_nomina ADD CONSTRAINT ck_var_tipo CHECK (tipo IN
  ('nocturnidad','propina','hora_extra','plus_calidad','bonus','complemento_garantia','descuento'));

-- ── Validar una incidencia (detectada/pendiente -> validada) ────────────────
-- Confirma que la deuda es real y fija su importe validado. El combustible
-- exige acuerdo de vehiculo a domicilio vigente; sin el, no se valida.
CREATE OR REPLACE FUNCTION f_validar_incidencia(p_id BIGINT, p_importe NUMERIC, p_quien VARCHAR)
RETURNS VARCHAR LANGUAGE plpgsql AS $func$
DECLARE ie incidencia_economica%ROWTYPE; hay_acuerdo BOOLEAN;
BEGIN
  SELECT * INTO ie FROM incidencia_economica WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la incidencia %', p_id; END IF;
  IF ie.estado NOT IN ('detectada','pendiente_autoridad') THEN
    RAISE EXCEPTION 'La incidencia % esta en % y no se puede validar', p_id, ie.estado;
  END IF;
  -- Una multa sin resolucion de la autoridad no se valida: se queda pendiente.
  IF ie.tipo = 'multa' AND ie.ref_autoridad IS NULL THEN
    RAISE EXCEPTION 'La multa % no tiene resolucion de la autoridad', p_id;
  END IF;
  -- El combustible exige acuerdo de vehiculo a domicilio vigente (art. 28).
  IF ie.tipo = 'combustible' THEN
    SELECT EXISTS (SELECT 1 FROM autorizacion_vehiculo_domicilio
                    WHERE conductor_id = ie.conductor_id AND revocado_at IS NULL
                      AND desde <= CURRENT_DATE) INTO hay_acuerdo;
    IF NOT hay_acuerdo THEN
      RAISE EXCEPTION 'Sin acuerdo de vehiculo a domicilio vigente: no hay deduccion de combustible (art. 28)';
    END IF;
  END IF;
  UPDATE incidencia_economica
     SET estado = 'validada', importe_validado = p_importe,
         validada_at = now(), validada_por = p_quien
   WHERE id = p_id;
  RETURN 'validada';
END;
$func$;

-- ── Autorizar (validada -> autorizada -> programada) y CREAR el descuento ────
-- Es el UNICO sitio donde una incidencia se convierte en linea de nomina. Y
-- solo desde 'validada'. La autorizacion es de Direccion (el que llama debe
-- serlo; el control de rol lo hace la ruta).
CREATE OR REPLACE FUNCTION f_autorizar_incidencia(
  p_id BIGINT, p_importe NUMERIC, p_quien VARCHAR, p_anio INT, p_mes INT)
RETURNS BIGINT LANGUAGE plpgsql AS $func$
DECLARE ie incidencia_economica%ROWTYPE; var_id BIGINT;
BEGIN
  SELECT * INTO ie FROM incidencia_economica WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe la incidencia %', p_id; END IF;
  IF ie.estado <> 'validada' THEN
    RAISE EXCEPTION 'Solo se autoriza lo VALIDADO. La incidencia % esta en %', p_id, ie.estado;
  END IF;

  -- La linea de nomina: un descuento (importe negativo) en el mes indicado.
  INSERT INTO variable_nomina
    (contrato_id, conductor_id, tipo, devengo_anio, devengo_mes, pago_anio, pago_mes,
     cantidad, unidad, importe, detalle)
  VALUES (ie.contrato_id, ie.conductor_id, 'descuento', p_anio, p_mes, p_anio, p_mes,
          -p_importe, 'EUR', -p_importe,
          jsonb_build_object('incidencia_id', p_id, 'tipo', ie.tipo,
                             'autorizada_por', p_quien))
  RETURNING id INTO var_id;

  UPDATE incidencia_economica
     SET estado = 'programada', importe_autorizado = p_importe,
         autorizada_at = now(), autorizada_por = p_quien,
         programada_anio = p_anio, programada_mes = p_mes, variable_id = var_id
   WHERE id = p_id;
  RETURN var_id;
END;
$func$;

COMMENT ON FUNCTION f_autorizar_incidencia(BIGINT, NUMERIC, VARCHAR, INT, INT) IS
  'El UNICO camino de una incidencia a linea de nomina, y solo desde validada. Autorizacion de Direccion (art. deuda != descuento)';

-- ── Rechazar (cualquier estado no final -> rechazada) ───────────────────────
CREATE OR REPLACE FUNCTION f_rechazar_incidencia(p_id BIGINT, p_quien VARCHAR, p_motivo VARCHAR)
RETURNS VOID LANGUAGE plpgsql AS $func$
BEGIN
  UPDATE incidencia_economica
     SET estado = 'rechazada', rechazada_at = now(), rechazada_por = p_quien, motivo_rechazo = p_motivo
   WHERE id = p_id AND estado NOT IN ('programada','descontada','rechazada');
  IF NOT FOUND THEN RAISE EXCEPTION 'La incidencia % no se puede rechazar en su estado', p_id; END IF;
END;
$func$;

COMMIT;
