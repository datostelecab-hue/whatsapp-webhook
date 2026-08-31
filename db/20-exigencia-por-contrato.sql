-- ============================================================
-- 20 - LO QUE SE EXIGE DEPENDE DE QUIEN CONTRATA
-- ============================================================
-- "Obligatorio" no es una propiedad del documento: es una propiedad de la
-- RELACION. A quien contratamos nosotros le pedimos el expediente entero; a
-- quien viene por una ETT no podemos pedirle casi nada, y no por dejadez:
--
--   La agencia solo nos pasa nombre, DNI, telefono, direccion, fecha de
--   nacimiento y correo. No nos da mas por proteccion de datos — la relacion
--   laboral es con ellos, no con nosotros. Los documentos los mandan despues,
--   y a veces incompletos (el DNI solo por delante).
--
-- Y por eso la creamos: para poder darle de alta en BOLT, que es lo unico que
-- hace falta para que pueda conducir. Exigir el expediente completo para eso
-- bloquea a gente que ya esta trabajando.
--
-- A los TRES MESES pasan a plantilla propia, y ahi si: entonces la relacion es
-- con nosotros y el expediente tiene que estar entero. Ese momento tiene su
-- propia funcion (`alta.convertirAPropia`) y es donde se comprueba.

BEGIN;

ALTER TABLE cat_tipo_documento
  ADD COLUMN IF NOT EXISTS obligatorio_ett BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cat_tipo_documento.obligatorio IS
  'Si hace falta para contratar en plantilla PROPIA. Para la via ETT manda obligatorio_ett';
COMMENT ON COLUMN cat_tipo_documento.obligatorio_ett IS
  'Si hace falta para dar de alta a alguien que viene por una ETT. Casi ninguno: la agencia manda los papeles despues, y no todos';

-- Por ahora, ninguno bloquea un alta de ETT. Se deja explicito en vez de
-- confiar en el DEFAULT: asi se lee que es una decision y no un descuido, y
-- cambiar de opinion sobre uno es cambiar una linea.
UPDATE cat_tipo_documento SET obligatorio_ett = FALSE WHERE ambito = 'conductor';

COMMIT;
