-- ============================================================
-- 69 · RENDIMIENTO — el promedio de horas de cada persona y su letra
-- ============================================================
-- Tráfico necesita saber, de un vistazo y al lado del nombre, a qué tipo de
-- conductor está llamando o colocando en el cuadrante: "Juan Manuel Akieme
-- (9,4 h · A)". El número es el promedio de horas efectivas del MES CORRIDO
-- (del día 1 al último cerrado) y la letra su tramo.
--
-- QUÉ DÍAS ENTRAN EN EL PROMEDIO (regla del usuario, 08/09/2026):
--   · Los que TRABAJÓ, con sus horas de BOLT MÁS LAS JUSTIFICADAS: se SUMAN.
--     2 h justificadas en el taller + 6 h rodando son 8 h ese día, igual que en
--     el reporte y en la nómina.
--   · Los que DEBÍA SALIR y no salió sin nada que lo justifique: cuentan como 0.
--     Esos son los que bajan la media, y ese es el sentido.
--   · NO cuentan: libranzas, vacaciones, bajas, permisos, los días fuera de alta
--     ni un día justificado que no sume horas. Librar no penaliza y la J protege.
--
-- LA ESCALA:  S >= 9 h   ·   A 8–9   ·   B 6–8   ·   C < 6
-- (el usuario dio "A entre 9 y 8" y "B entre 7 y 6"; se hace continua para que
-- no haya un hueco entre 7 y 8 sin letra).
--
-- Se guarda calculado en vez de resolverse en cada pintado: lo miran el
-- planificador y el cockpit en cada carga, y son dos consultas pesadas
-- (f_cobertura de todo el mes). Lo refresca un cron al cerrar la jornada.

BEGIN;

CREATE TABLE IF NOT EXISTS conductor_rendimiento (
  conductor_id   BIGINT      PRIMARY KEY REFERENCES conductor(id) ON DELETE CASCADE,
  -- El mes al que corresponde (día 1). Al cambiar de mes se empieza de cero.
  mes            DATE        NOT NULL,
  -- Promedio de horas efectivas de los días que cuentan.
  horas_prom     NUMERIC(4,1) NOT NULL DEFAULT 0,
  letra          CHAR(1)     NOT NULL DEFAULT 'C',
  -- Cuántos días entraron en la cuenta y cuántos de ellos fueron un 0 (debía
  -- salir y no salió sin justificar). Con esto se sabe si el número es sólido.
  dias           INTEGER     NOT NULL DEFAULT 0,
  dias_cero      INTEGER     NOT NULL DEFAULT 0,
  horas_total    NUMERIC(7,1) NOT NULL DEFAULT 0,
  calculado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_rend_letra CHECK (letra IN ('S','A','B','C'))
);

CREATE INDEX IF NOT EXISTS idx_rend_mes ON conductor_rendimiento (mes);

COMMENT ON TABLE conductor_rendimiento IS
  'Promedio de horas del mes corrido por persona y su letra (S/A/B/C), para pintarlo al lado del nombre en el planificador y en Control. Lo refresca un cron al cerrar la jornada.';
COMMENT ON COLUMN conductor_rendimiento.dias_cero IS
  'Días que debía salir y no salió SIN justificante: cuentan como 0 en el promedio. Librar, vacaciones y las J no cuentan.';

COMMIT;
