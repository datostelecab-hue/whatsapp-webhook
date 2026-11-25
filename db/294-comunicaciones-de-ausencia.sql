-- ============================================================
-- 294 — LA COMUNICACIÓN SEMANAL DE HORAS QUE QUEDÓ DEBIENDO
-- ============================================================
-- Camilo, 25/11/2026, con la carta de RR. HH. («Comunicación al trabajador»):
-- «semanalmente, dependiendo del contrato (40, 32, 20 horas…) debemos de
-- mandar estas cartas a los conductores … deben de firmarla, sin SMS de
-- autenticación, directo a su correo electrónico; si no tiene, debe de haber
-- un mensaje que diga que se debe de poner el correo del conductor». Y las
-- reglas:
--   · Solo si en la semana (de lunes a domingo) no llegó a las horas de su
--     contrato: «si faltó un día, pero hizo 41 horas en la semana, nada de carta».
--   · La carta lista cada día que quedó debiendo (ausencias, y días con menos
--     de 8 h: «siempre son 8»).
--   · Solo plantilla propia.
--   · Cada MARTES: el lunes Tráfico pide y aprueba los justificantes que
--     falten, y no le llega la carta a quien cumplió por un justificante.
--
-- Entran en la cola de firmas (db/293) como tipo «comunicacion», una por
-- persona y semana (origen «semana»), con el detalle en `detalle`. El documento
-- es la PLANTILLA de YouTrust «Comunicación al trabajador»: no se sube PDF.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/294', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE firma_envio ADD COLUMN IF NOT EXISTS detalle JSONB;

ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_tipo;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_tipo
  CHECK (tipo IN ('finiquito', 'suspension', 'sancion', 'descuento', 'contrato', 'comunicacion', 'otro'));

ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_origen;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_origen CHECK (origen IN ('manual', 'finiquito', 'semana'));

COMMENT ON COLUMN firma_envio.detalle IS
  'Para las comunicaciones semanales (db/294): la semana, el objetivo, las horas hechas, lo que debe y cada día con lo que quedó debiendo.';

COMMIT;
