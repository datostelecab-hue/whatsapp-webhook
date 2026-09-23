-- ============================================================
-- 135 — LA VACANTE SE OCUPA AL DAR EL ALTA, NO AL ACEPTARLA
-- ============================================================
-- Hasta hoy, dar de alta a alguien CON una vacante solo dejaba una alerta
-- pendiente: la plaza no era suya hasta que alguien de Tráfico entraba en el
-- planificador y la aceptaba. Mientras tanto la plaza seguía libre a la vista
-- de todos, así que se la podía llevar otro — y el que acababa de firmar no
-- estaba en ningún sitio.
--
-- Se le da la vuelta: al dar el alta con vacante, la persona OCUPA la plaza en
-- el acto, desde su fecha prevista de alta. La alerta sigue ahí, pero ya no es
-- una propuesta que haya que aprobar: es un aviso de «esto ya está hecho», y
-- Tráfico solo tiene que actuar si NO le vale, rechazándola.
--
-- ── POR QUÉ HACE FALTA UNA COLUMNA ─────────────────────────────────────────
-- Porque rechazar deja de ser gratis. Antes rechazar era «no la acepto» y no
-- había nada que deshacer; ahora puede haber una persona ya metida en el
-- cuadrante, y rechazar tiene que SACARLA. Sin saber si se colocó o no, el
-- rechazo o no limpia nada, o intenta limpiar lo que nunca se escribió.
--
-- `colocada_at` es ese dato: NULL = solo prometida (como siempre), con fecha =
-- ya está dentro del cuadrante desde `colocada_desde`.

BEGIN;

ALTER TABLE incorporacion
  ADD COLUMN IF NOT EXISTS colocada_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS colocada_desde DATE;

-- Colocada quiere decir colocada DESDE un día. Una sin el otro no significa
-- nada, y es justo lo que el rechazo necesita para saber qué deshacer.
ALTER TABLE incorporacion DROP CONSTRAINT IF EXISTS ck_incorporacion_colocada;
ALTER TABLE incorporacion ADD CONSTRAINT ck_incorporacion_colocada CHECK (
  (colocada_at IS NULL) = (colocada_desde IS NULL));

COMMENT ON COLUMN incorporacion.colocada_at IS
  'Cuando se metio en el cuadrante. NULL = solo prometida; con fecha = ya ocupa las plazas y rechazar tiene que sacarla';
COMMENT ON COLUMN incorporacion.colocada_desde IS
  'El dia desde el que ocupa las plazas: su fecha prevista de alta';

COMMIT;
