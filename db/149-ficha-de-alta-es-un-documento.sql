-- ============================================================
-- 149 — LA FICHA DE ALTA, GUARDADA COMO UN DOCUMENTO MÁS
-- ============================================================
-- La ficha de alta que se genera desde Selección (el PDF con los papeles
-- incrustados) se subía a la carpeta de Drive de la persona, pero NO se
-- apuntaba en el almacén de documentos. Resultado: se podía ver con el enlace
-- del aviso que sale al generarla y, al cerrarlo, no había forma de volver a
-- ella desde el ERP. Lo contó Camilo el 24/09/2026.
--
-- Ahora es un documento de tipo 'ficha_alta': sale en los documentos de la
-- ficha de Plantilla y en los de Selección, y generar otra deja la anterior
-- como no vigente en vez de pisarla, como cualquier papel.
--
-- No es obligatoria ni previa al alta: se genera en el alta, y quien entró antes
-- de que existiera no tiene por qué tenerla.

BEGIN;

INSERT INTO cat_tipo_documento
  (codigo, etiqueta, ambito, caduca, obligatorio, aviso_dias, orden, activo, previo_alta, obligatorio_ett)
VALUES
  ('ficha_alta', 'Ficha de alta', 'conductor', FALSE, FALSE, 0, 13, TRUE, FALSE, FALSE)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
