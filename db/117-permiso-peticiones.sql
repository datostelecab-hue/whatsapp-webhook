-- ============================================================
-- 117 - Y EL PERMISO DE PETICIONES, QUE YA NO ABRE NADA
-- ============================================================
-- La 116 borró la tabla y la pantalla. El permiso seguía dado.
--
-- No es inofensivo: sale en la lista de "qué puede ver esta persona" y hace
-- creer que hay algo ahí. Quien lo revise mañana buscará una pantalla que no
-- existe, y quien reparta permisos se lo seguirá dando a la gente nueva.
--
-- Estaba en tres sitios, y en los tres se va:
--   · el catálogo de módulos (`cat_modulo`)
--   · dos roles que lo traían de serie (`rol_modulo`)
--   · tres usuarios que lo tenían dado a mano (`usuario_permiso`)
--
-- Va en una migración aparte y no pegado a la 116 porque la 116 YA ESTABA
-- APLICADA: tocar un fichero ya aplicado le cambia la huella y deja el registro
-- de migraciones en rojo, avisando de un cambio que nadie podrá comprobar.

BEGIN;

DELETE FROM usuario_permiso WHERE clave  = '/peticiones';
DELETE FROM rol_modulo      WHERE modulo = 'peticiones';
DELETE FROM cat_modulo      WHERE codigo = 'peticiones';

COMMIT;
