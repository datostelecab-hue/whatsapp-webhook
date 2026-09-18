-- ============================================================
-- 138 · LA TARJETA VTC DEJA DE SER OBLIGATORIA PARA CONTRATAR
-- ============================================================
-- Para pasar a alguien a RRHH, `exigencia.faltaPara` pide todos los documentos
-- marcados `previo_alta AND obligatorio` con ambito 'conductor'. La Tarjeta VTC
-- estaba en esa lista, pero NO esta entre los papeles que pide la pantalla de
-- Seleccion (`DOCUMENTOS`, en modules/Seleccion/seleccion.service.js):
--
--   dni · dni_reverso · permiso · permiso_reverso · cuenta · vida_laboral · penales
--
-- Es decir: el sistema bloqueaba el alta por un documento que el propio sistema
-- no ofrecia subir en ningun sitio. Quien reclutaba se quedaba mirando un
-- "Documento: Tarjeta VTC" sin boton al lado.
--
-- Se quita la exigencia, no el tipo: quien tenga la tarjeta la puede seguir
-- subiendo desde la ficha del conductor, y los documentos ya subidos siguen
-- donde estaban. Si algun dia vuelve a hacer falta, es un UPDATE de una linea.

BEGIN;

UPDATE cat_tipo_documento
   SET obligatorio = FALSE
 WHERE codigo = 'vtc';

COMMIT;
