-- ============================================================
-- 49 - FIX: variable_nomina.tipo demasiado estrecha
-- ============================================================
-- Bug de la 45/48. La columna tipo se definio VARCHAR(16), pero la 48 anadio el
-- valor 'complemento_garantia' -- 20 caracteres. El CHECK lo permitia (es solo
-- la definicion), pero al INSERTAR el complemento reventaba con "value too long
-- for type character varying(16)", asi que f_garantia_convenio no llegaba a
-- crear nada.
--
-- Se ensancha a 24, con margen. Ensanchar un varchar no reescribe la tabla ni
-- toca los datos existentes.

BEGIN;

ALTER TABLE variable_nomina ALTER COLUMN tipo TYPE VARCHAR(24);

COMMIT;
