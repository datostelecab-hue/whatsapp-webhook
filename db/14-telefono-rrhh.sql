-- ============================================================
-- 14 - EL TELEFONO PUEDE VENIR DE RRHH
-- ============================================================
-- Los telefonos entraban de la agenda, de BOLT, de un ticket o a mano. Ahora la
-- fuente buena es el fichero de RRHH: es el numero con el que se contrata y con
-- el que se da de alta en BOLT, asi que es el que sirve para cruzar las dos
-- cosas. Necesita nombre propio para poder distinguir de donde salio cada uno.

BEGIN;

ALTER TABLE conductor_telefono DROP CONSTRAINT ck_tel_origen;
ALTER TABLE conductor_telefono ADD CONSTRAINT ck_tel_origen CHECK (origen IN
  ('agenda','bolt','db_conductores','ticket','fichaje','manual','rrhh'));

COMMENT ON COLUMN conductor_telefono.origen IS
  'De donde salio el numero. "rrhh" es el del fichero de plantilla: el de contratacion, y el que se cruza con BOLT';

COMMIT;
