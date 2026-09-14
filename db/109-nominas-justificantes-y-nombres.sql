-- ============================================================
-- 109 · NÓMINAS — las horas justificadas y los dos nombres
-- ============================================================
-- Dos cosas que la nómina congelada no sabía decir.
--
-- ── 1. LAS J CUENTAN ────────────────────────────────────────────────────────
-- Hasta ahora la nómina solo miraba las horas de BOLT, así que un mes con tres
-- días justificados (coche en taller, cuenta suspendida, médico) salía como un
-- mes con tres días sin trabajar. No es lo mismo, y la diferencia es justo lo
-- que RRHH necesita ver: cuántas horas de las que faltan están explicadas y
-- cuántas no.
--
--   horas_justificadas      las que cubren las J APROBADAS
--   horas_no_justificadas   lo que sigue faltando para el objetivo después de
--                           sumarlas. Es la cifra por la que se pregunta.
--   dias_justificados       cuántos días tuvieron J (para poner las horas en
--                           contexto: 24 h justificadas son tres días)
--
-- CUÁNTO VALE UNA J. Ocho horas: el día entero. La tabla `justificante` tiene
-- una columna de horas, pero en agosto de 2026 no dice nada útil —de las 182 J
-- aprobadas, 114 traen exactamente "8" y otras 13 traen las MISMAS horas que
-- esa persona ya había rodado ese día, que sumadas serían contar dos veces el
-- mismo rato—. Así que se cuenta el día entero, sin distinción, y sin poder
-- pasar de ahí: una J aporta lo que falte para llegar a la jornada, no ocho
-- horas encima de lo que ya se hizo. La regla vive en el servicio, no aquí.
--
-- ── 2. LOS DOS NOMBRES ──────────────────────────────────────────────────────
-- La misma persona se llama de dos maneras y las dos hacen falta en el mismo
-- papel:
--
--   nombre_bolt   como figura su cuenta en BOLT ("Muhammad Bilal Ashraf").
--                 Es por donde lo busca Tráfico y por donde se cruza con
--                 cualquier informe de la plataforma.
--   nombre_ss     como lo tiene RRHH, apellidos primero y separados por coma
--                 ("ASHRAF MUHAMMAD, BILAL"). Es el que entiende la gestoría y
--                 el que va en un documento oficial.
--
-- Van COPIADOS en la fila, como el resto: una nómina congelada se explica sola
-- y no cambia porque mañana alguien corrija una ficha.

BEGIN;

ALTER TABLE nomina_fila
  ADD COLUMN IF NOT EXISTS nombre_bolt           VARCHAR(200),
  ADD COLUMN IF NOT EXISTS nombre_ss             VARCHAR(200),
  ADD COLUMN IF NOT EXISTS horas_justificadas    NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS horas_no_justificadas NUMERIC(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dias_justificados     SMALLINT     NOT NULL DEFAULT 0;

COMMENT ON COLUMN nomina_fila.nombre_bolt IS
  'Como figura su cuenta en BOLT. Copiado: la nomina congelada no cambia porque se corrija la ficha';
COMMENT ON COLUMN nomina_fila.nombre_ss IS
  'Como lo tiene RRHH: apellidos primero, coma, nombres. El que entiende la gestoria';
COMMENT ON COLUMN nomina_fila.horas_justificadas IS
  'Horas cubiertas por J APROBADAS. Cada J vale la jornada entera (8 h), topada por lo que falte del dia: nunca se suma encima de lo ya rodado';
COMMENT ON COLUMN nomina_fila.horas_no_justificadas IS
  'Lo que falta para el objetivo despues de sumar BOLT y las J. Cero si llego';

-- El indice que ya existe por nomina_id sigue sirviendo: estas columnas se leen
-- siempre junto al resto de la fila, nunca solas.

COMMIT;
