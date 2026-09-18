-- ============================================================
-- 139 · EL REVERSO DEL DNI Y DEL CARNE DEJAN DE SER OBLIGATORIOS
-- ============================================================
-- El FRENTE lleva lo que la gestoria necesita para el alta en la Seguridad
-- Social: numero, nombre, fechas. El reverso a veces no se puede conseguir
-- —una foto movida, un carne antiguo, alguien que solo manda una cara— y
-- bloquear el alta entera por la cara de atras es parar a una persona que ya
-- esta lista para trabajar.
--
-- Se siguen PIDIENDO en la pantalla de Seleccion, con su linea y su hueco para
-- subirlos. Lo que cambia es que ya no impiden pasar.
--
-- Los frentes (`dni`, `permiso`) se quedan obligatorios, igual que la vida
-- laboral, el certificado de cuenta y el de delitos sexuales.

BEGIN;

UPDATE cat_tipo_documento
   SET obligatorio = FALSE
 WHERE codigo IN ('dni_reverso', 'permiso_reverso');

COMMIT;
