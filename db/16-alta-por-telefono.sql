-- ============================================================
-- 16 - BUSCAR A ALGUIEN POR SU TELEFONO, AUNQUE YA NO TRABAJE
-- ============================================================
-- El alta empieza escribiendo un telefono. Con ese numero hay que contestar dos
-- preguntas independientes, y de las dos respuestas sale lo que se puede hacer:
--
--   1. ¿Tenemos ficha suya?   -> conductor_telefono
--   2. ¿Tiene cuenta en BOLT? -> conductor_externo.externo_telefono
--
--   ficha + BOLT   -> RESTAURACION: vuelve a su puesto, la cuenta ya existe
--   ficha sin BOLT -> hay ficha, pero sin cuenta no puede trabajar: hay que darle de alta
--   BOLT sin ficha -> alta desde cero, pero la cuenta ya esta: solo reactivarla
--   ni una ni otra -> alta nueva del todo
--
-- Para la primera hay que mirar TAMBIEN los telefonos que ya no estan vigentes.
-- Quien se fue hace un año tiene su telefono cerrado, y es justo a quien hay que
-- reconocer cuando vuelve: si solo se mirasen los vigentes, una restauracion
-- pareceria un alta nueva y se crearia una segunda ficha de la misma persona.
--
-- El indice unico que hay (uq_tel_sufijo_vigente) es PARCIAL, solo sobre los
-- vigentes, asi que no sirve para esta busqueda. Este es el completo.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_tel_sufijo_todos ON conductor_telefono (sufijo9);

COMMENT ON INDEX idx_tel_sufijo_todos IS
  'Para buscar por telefono incluyendo los cerrados: es como se reconoce a quien vuelve';

COMMIT;
