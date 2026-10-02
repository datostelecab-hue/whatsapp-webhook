-- ============================================================
-- 174 — LAS CUENTAS DE BOLT DE BARCELONA, SOLO EN LA BASE
-- ============================================================
-- Camilo, 02/10/2026: «la migración completa de conductores de Barcelona a
-- Telecab, PERO solo en base de datos; si quieres agregamos el ID de la company
-- para saber de qué company es, sin importar la ficha… pero nada visual».
--
-- BOLT tiene cuatro empresas en nuestra integración (getCompanies). El ERP solo
-- conocía dos, las de Madrid: la 63530 (cerrada en agosto) y la 143626. La de
-- Barcelona es la 329430 (28 conductores, 22 activos el 02/10). La cuarta,
-- 364138, no tiene ni conductores ni coches y no se da de alta.
--
--   1 · `flota.sede`: de qué sede es cada empresa. Las dos de Madrid, de Madrid.
--   2 · La empresa de Barcelona, en `flota`.
--   3 · `conductor_externo.bolt_company_id`: de qué empresa es cada cuenta. Lo
--       rellena el padrón (cada hora), que desde esta tanda pregunta también a
--       la empresa de Barcelona. Vacío = una cuenta que no se ha vuelto a ver
--       desde entonces: se trata como de Madrid, que es lo que era todo hasta hoy.
--   4 · Las cuentas de otra sede NO se ofrecen para enlazar: las dos vistas de
--       las que beben «IDs de BOLT libres», las sugerencias por teléfono y la
--       situación en BOLT de cada persona las dejan fuera. Así entran en la base
--       sin que ninguna pantalla de Madrid cambie.
--
-- Las cuentas de Barcelona NO tienen ficha (`conductor`): Camilo no tiene datos
-- de esas personas todavía. Las horas tampoco se traen: la ingesta sigue
-- preguntando solo a las empresas de Madrid.

BEGIN;

-- 1 · La sede de cada empresa.
ALTER TABLE flota
  ADD COLUMN IF NOT EXISTS sede varchar(16) NOT NULL DEFAULT 'madrid'
    REFERENCES cat_sede(codigo);

COMMENT ON COLUMN flota.sede IS
  'De qué sede es la empresa de BOLT. Las cuentas de una empresa de otra sede que la vigilada (Madrid) no se ofrecen para enlazar con fichas de Madrid (db/174).';

-- 2 · La empresa de Barcelona. El id lo pone la tabla (es de identidad).
INSERT INTO flota (company_id, nombre, region, sede)
VALUES (329430, 'Flota de Barcelona (BOLT 329430)', 'Barcelona', 'barcelona')
ON CONFLICT (company_id) DO UPDATE
   SET region = EXCLUDED.region, sede = EXCLUDED.sede;

-- 3 · De qué empresa es cada cuenta.
ALTER TABLE conductor_externo
  ADD COLUMN IF NOT EXISTS bolt_company_id integer REFERENCES flota(company_id);

COMMENT ON COLUMN conductor_externo.bolt_company_id IS
  'Empresa de BOLT en la que el padrón vio la cuenta por última vez. NULL = no se ha visto desde db/174 (se trata como de Madrid).';

-- 4 · Las dos vistas, idénticas a las de hoy salvo la última condición.
CREATE OR REPLACE VIEW v_bolt_libres AS
SELECT id,
       externo_id      AS driver_uuid,
       externo_nombre  AS nombre_en_bolt,
       externo_telefono,
       externo_email,
       estado_externo,
       visto_desde,
       visto_at
  FROM conductor_externo e
 WHERE sistema = 'bolt' AND conductor_id IS NULL AND estado_externo = 'active'
   AND NOT EXISTS (SELECT 1 FROM flota fsede
                    WHERE fsede.company_id = e.bolt_company_id AND fsede.sede <> 'madrid');

CREATE OR REPLACE VIEW v_bolt_por_telefono AS
SELECT ce.id             AS cuenta_id,
       ce.externo_id     AS driver_uuid,
       ce.externo_nombre AS nombre_en_bolt,
       ce.externo_telefono,
       ce.estado_externo,
       ce.conductor_id   AS ya_enlazada_con,
       ct.conductor_id,
       ct.e164           AS telefono_nuestro,
       right(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g'), 9) AS tel9
  FROM conductor_externo ce
  JOIN conductor_telefono ct
    ON ct.vigente_hasta IS NULL
   AND ct.sufijo9 = right(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g'), 9)
 WHERE ce.sistema = 'bolt' AND ce.externo_telefono IS NOT NULL
   AND length(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g')) >= 9
   AND NOT EXISTS (SELECT 1 FROM flota fsede
                    WHERE fsede.company_id = ce.bolt_company_id AND fsede.sede <> 'madrid');

COMMIT;
