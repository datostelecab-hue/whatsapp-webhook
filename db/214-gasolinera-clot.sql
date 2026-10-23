-- ============================================================
-- 214 · LAS COORDENADAS DE BALLENOIL CLOT
-- ============================================================
-- Camilo, 23/10/2026: «41.406171451334565, 2.187458371035998 BALLENOIL CLOT».
--
-- En el Excel de las gasolineras (db/213) Clot venía SIN coordenadas: la web de
-- Ballenoil solo da el código postal (08038). Así, sus repostajes no podían
-- tener color por el GPS. Es donde más reposta el 7909LRJ, y las dos veces
-- (21/10 16:31 y 22/10 17:09) Mapon lo tenía parado en el Carrer del Clot, 4
-- (08018), a unos 60 m de este punto.
--
-- DOS COSAS:
--
--   · precision admite 'validada': coordenadas puestas a mano por alguien que
--     sabe dónde está la gasolinera. No son de la web del proveedor ni salen de
--     geocodificar la dirección, así que en la lista no llevan «≈».
--
--   · Los repostajes de Clot que ya se auditaron se midieron sin coordenadas
--     («sin coordenadas en la lista») y la auditoría no vuelve sola a los
--     acabados: se ponen otra vez en «pendiente» para que el cron los mida con
--     estas. En producción, donde db/213 y esta van juntas, todavía están todos
--     pendientes y no cambia nada.
--
-- No se edita la 213: ya está aplicada en la base de pruebas y cambiarle la
-- huella la pinta en rojo en /migraciones (docs/nucleo/Migraciones.md).

BEGIN;

ALTER TABLE gasolinera DROP CONSTRAINT IF EXISTS ck_gasolinera_precision;
ALTER TABLE gasolinera ADD CONSTRAINT ck_gasolinera_precision
  CHECK (precision IN ('web', 'validada', 'geocodificada', 'aproximada', 'sin'));

COMMENT ON COLUMN gasolinera.precision IS
  'web = coordenadas del proveedor; validada = puestas a mano por quien conoce la gasolinera; geocodificada = sacadas de la dirección (OpenStreetMap); aproximada = carretera o número no localizable; sin = no hay coordenadas (no se puede medir la distancia)';

UPDATE gasolinera
   SET lat = 41.406171, lng = 2.187458, precision = 'validada',
       observaciones = 'Coordenadas de Camilo (23/10/2026). El Excel solo traía el código postal 08038; los coches paran en el Carrer del Clot, 4 (08018)',
       actualizado_at = now()
 WHERE proveedor = 'ballenoil' AND nombre = 'Ballenoil Clot';

UPDATE repostaje
   SET auditoria_estado = 'pendiente', auditoria_intentos = 0
 WHERE gasolinera_id = (SELECT id FROM gasolinera WHERE proveedor = 'ballenoil' AND nombre = 'Ballenoil Clot')
   AND auditoria_estado IN ('hecha', 'incompleta', 'sin_datos');

COMMIT;
