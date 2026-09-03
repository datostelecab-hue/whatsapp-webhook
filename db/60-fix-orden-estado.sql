-- ============================================================
-- 60 · FIX — bolt_order.estado se queda corto (VARCHAR(24))
-- ============================================================
-- La ingesta viva de órdenes petaba con "value too long for type character
-- varying(24)": algún order_status de BOLT pasa de 24 caracteres (cancelaciones con
-- motivo, etc.), así que esas órdenes NO se guardaban y el neto/viajes salía corto.
-- Se pasa a TEXT (es un campo de staging, no hay razón para capar su longitud). El
-- índice idx_border_estado sigue valiendo sobre TEXT.

ALTER TABLE bolt_order ALTER COLUMN estado TYPE TEXT;
