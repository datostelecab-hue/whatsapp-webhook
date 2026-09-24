-- ============================================================
-- 147 — LA FOTO DE LA PERSONA
-- ============================================================
-- La ficha de plantilla lleva ahora la foto de cada conductor en la cabecera,
-- junto al nombre. Lo pidió Camilo el 24/09/2026.
--
-- ── POR QUÉ ES UN DOCUMENTO Y NO UNA COLUMNA ───────────────────────────────
-- Una foto es un archivo, y los archivos de una persona ya tienen su sitio: el
-- almacén de Documentos (Drive, con el índice aquí). Ahí se gana todo sin
-- escribir nada nuevo:
--
--   · subir otra foto deja la anterior como NO vigente en vez de pisarla, así
--     que se ve el historial y se puede volver atrás;
--   · se sirve por el ERP, con sus permisos, y no por un enlace de Drive que
--     cualquiera con la URL podría abrir;
--   · queda en la auditoría quién la subió y cuándo.
--
-- Un BYTEA en `conductor` habría sido lo rápido, y habría metido imágenes en
-- cada SELECT * de la tabla más leída del ERP.
--
-- ── NO ES OBLIGATORIA ──────────────────────────────────────────────────────
-- Ni para contratar ni para la ETT: una persona sin foto trabaja igual, y la
-- ficha pinta una silueta en su lugar. Por eso `obligatorio` y
-- `obligatorio_ett` van a FALSE y no entra en lo que se le exige antes del
-- alta.
--
-- Es dato personal: la ve quien ya ve la ficha, y la cambia quien puede
-- cambiar sus datos (RRHH, no Tráfico).

BEGIN;

INSERT INTO cat_tipo_documento
  (codigo, etiqueta, ambito, caduca, obligatorio, aviso_dias, orden, activo, previo_alta, obligatorio_ett)
VALUES
  ('foto', 'Foto de la persona', 'conductor', FALSE, FALSE, 0, 0, TRUE, FALSE, FALSE)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
