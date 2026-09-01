-- ============================================================
-- 42 - EL REGISTRO DIARIO DE JORNADA (art. 18.9)
-- ============================================================
-- Hito 5. La obligacion literal del art. 18.9: registrar cada dia la jornada
-- -inicio, fin, trabajo efectivo y descansos- y poder entregarsela al conductor
-- que la pida, en 5 dias laborables.
--
-- ES DERIVADO, NO TECLEADO. Todo sale de lo que ya hay: los tramos de BOLT y su
-- clasificacion. La jornada lo genera de una pasada junto con los asientos del
-- ledger, asi que el registro y el ledger NUNCA se contradicen: son la misma
-- verdad contada de dos maneras -- el ledger para la nomina, el registro para la
-- persona.
--
-- REGENERABLE Y CONGELABLE. Se puede rehacer las veces que haga falta (cambia
-- un dato de origen, se rederiva) hasta que se congela al cierre del mes. El
-- congelado es del Hito 7; aqui queda el gancho.

BEGIN;

-- ── El registro de un dia ───────────────────────────────────────────────────
CREATE TABLE registro_jornada (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id          BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  dia                   DATE        NOT NULL,
  -- Primer inicio y ultimo fin del dia. La ventana real, no la de cuando miramos.
  inicio                TIMESTAMPTZ,
  fin                   TIMESTAMPTZ,
  -- Las dos medidas, como en la reconciliacion: la estricta (convenio) y la
  -- total (operativa). La diferencia es la espera fuera de area.
  efectivo_estricto_min INTEGER     NOT NULL DEFAULT 0,
  efectivo_total_min    INTEGER     NOT NULL DEFAULT 0,
  -- Descanso: el tiempo en 'busy'. Es lo que el art. 18.9 pide totalizar aparte.
  descanso_min          INTEGER     NOT NULL DEFAULT 0,
  -- Los 20 min auxiliares del art. 18.6.c, si hubo actividad.
  aux_min               INTEGER     NOT NULL DEFAULT 0,
  -- Minutos en la franja nocturna (22:00-06:00). Lo rellena el Hito 8 (variables
  -- de nocturnidad); aqui nace nulo.
  nocturno_min          INTEGER,
  -- Los tramos del dia con su supuesto, para el desglose del PDF.
  tramos                JSONB,
  generado_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Congelado al cierre del mes (Hito 7). Nulo = todavia se puede rehacer.
  congelado_at          TIMESTAMPTZ,
  CONSTRAINT uq_registro UNIQUE (conductor_id, dia)
);
CREATE INDEX idx_registro_dia ON registro_jornada (dia);

COMMENT ON TABLE registro_jornada IS
  'El registro diario del art. 18.9. Derivado de los tramos de BOLT, regenerable hasta que se congela al cierre';

-- ── Sumar dias laborables a una fecha ───────────────────────────────────────
-- Para el plazo del art. 18.9: la fecha limite es la solicitud + 5 dias
-- laborables. Salta sabados y domingos. (Los festivos se afinan cuando exista
-- el calendario laboral; de momento, fin de semana.)
CREATE OR REPLACE FUNCTION f_sumar_dias_laborables(p_desde DATE, p_dias INT)
RETURNS DATE
LANGUAGE plpgsql IMMUTABLE AS $func$
DECLARE
  d DATE := p_desde;
  quedan INT := p_dias;
BEGIN
  WHILE quedan > 0 LOOP
    d := d + 1;
    IF EXTRACT(ISODOW FROM d) < 6 THEN   -- 1..5 = lunes a viernes
      quedan := quedan - 1;
    END IF;
  END LOOP;
  RETURN d;
END;
$func$;

COMMENT ON FUNCTION f_sumar_dias_laborables(DATE, INT) IS
  'Suma N dias laborables (salta findes). Para el plazo de entrega del registro (art. 18.9)';

-- ── La solicitud del conductor ──────────────────────────────────────────────
-- El conductor pide su registro (por el canal que sea) y arranca el reloj de 5
-- dias laborables. El envio y el aviso bloqueante los hace el motor de
-- notificaciones (Hito 6); aqui se guarda la solicitud y su plazo.
CREATE TABLE solicitud_registro (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conductor_id    BIGINT      NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  solicitado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  via             VARCHAR(12) NOT NULL DEFAULT 'otro',   -- email, telefono, rrhh, whatsapp, otro
  periodo_desde   DATE        NOT NULL,
  periodo_hasta   DATE        NOT NULL,
  -- La fecha limite. Se calcula al crearla con f_sumar_dias_laborables.
  vence_el        DATE        NOT NULL,
  estado          VARCHAR(12) NOT NULL DEFAULT 'recibida',  -- recibida, generada, enviada, reconocida, vencida
  notificacion_id BIGINT,     -- FK al motor de notificaciones (Hito 6)
  usuario_id      INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_solreg_via CHECK (via IN ('email','telefono','rrhh','whatsapp','otro')),
  CONSTRAINT ck_solreg_estado CHECK (estado IN ('recibida','generada','enviada','reconocida','vencida')),
  CONSTRAINT ck_solreg_periodo CHECK (periodo_hasta >= periodo_desde)
);
CREATE INDEX idx_solreg_pendiente ON solicitud_registro (vence_el)
  WHERE estado IN ('recibida','generada');

COMMENT ON TABLE solicitud_registro IS
  'Solicitud del conductor de su registro de jornada (art. 18.9). El reloj de 5 dias laborables arranca aqui';

COMMIT;
