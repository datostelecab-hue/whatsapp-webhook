-- ============================================================
-- 265 — LIMPIEZAS, LUNAS Y RUEDAS
-- ============================================================
-- Camilo, 18/11/2026, con 22 PDF (17 facturas distintas; el resto, copias): «Estos son lavados de coches,
-- súbelos y haz una migración directamente a la carpeta de facturas en el
-- servidor. Necesitamos tener visibilidad de estos lavados, también necesitamos
-- que cuenten mantenimientos de ruedas, quiero un nuevo submódulo como el de
-- mantenimientos, pero que diga "Ruedas", que cada 25K de KM se pase y avise,
-- los KM de los últimos mantenimientos deben de sacarse de cambio de ruedas,
-- hay unos de pinchazos en las facturas por los que esos no cuentan». Y: «que le
-- llegue al chat de Óscar, que es el responsable de taller, también una
-- notificación, pero el chat de Telecab, que se llame "Notificaciones Telecab"».
--
-- Las 17 eran de dos proveedores, y no todas lavados:
--   · 9 LIMPIEZAS de un autónomo (integral 65 €, parcial 40 €: vómitos,
--     combustible derramado, malos olores).
--   · 8 de EXTRELUNAS SL: parabrisas (con calibración ADAS) y una ventanilla.
-- Camilo eligió: las de Extrelunas, como «Lunas»; las limpiezas, como
-- categoría «Limpieza» (sin pestaña aparte).
--
-- LO QUE HACE:
--   1 · Dos categorías y dos tipos de mantenimiento nuevos: limpieza y lunas.
--   2 · Los dos proveedores. Del autónomo NO va su DNI (el repositorio es
--       público): se pone a mano en Facturas de taller si hace falta.
--   3 · Las 17 facturas, cada una con su línea (un coche), su mantenimiento
--       (origen 'factura') y sus piezas. Sin km: no vienen en el papel. Cada
--       una guarda en nombre_archivo el nombre de su PDF, SIN subirlo: los PDF
--       se suben desde Facturas de taller › «Subir los PDF», que los casa por
--       ese nombre y los manda a Drive («Facturas de taller AAAA-MM»), como
--       todas. Los PDF no van al repositorio (público).
--   4 · ruedas_aviso: a qué coches se ha avisado ya de que les toca cambiar las
--       ruedas, una vez por cambio (modules/Vehiculos/ruedas.service.js).
--   5 · El chat admite mensajes de AVISO del sistema (evento 'aviso'): el canal
--       privado «notificaciones-telecab» los recibe (modules/Chat).
--
-- Los importes, SIN IVA y en céntimos. Cada factura cuadra al céntimo: la suma
-- de sus líneas es su base imponible.
-- Se puede pasar dos veces: lo que ya esté (mismo proveedor y número) no se
-- duplica.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/265', true),
       set_config('telecab.usuario_id', '7', true);

-- ── 1 · Limpieza y lunas ───────────────────────────────────────────────────
ALTER TABLE mantenimiento DROP CONSTRAINT IF EXISTS ck_mant_tipo;
ALTER TABLE mantenimiento
  ADD CONSTRAINT ck_mant_tipo CHECK (tipo IN
    ('revision', 'itv', 'neumaticos', 'chapa', 'averia', 'aceite', 'otro',
     'frenos', 'alumbrado', 'bateria', 'suspension', 'mecanica', 'limpieza', 'lunas'));

ALTER TABLE mantenimiento_pieza DROP CONSTRAINT IF EXISTS ck_pieza_categoria;
ALTER TABLE mantenimiento_pieza
  ADD CONSTRAINT ck_pieza_categoria CHECK (categoria IN
    ('aceite', 'frenos', 'neumaticos', 'alumbrado', 'bateria', 'suspension',
     'chapa', 'mecanica', 'mano_obra', 'nota', 'otro', 'limpieza', 'lunas'));

-- ── 2 · Los proveedores ────────────────────────────────────────────────────
INSERT INTO taller_proveedor (nombre, nif, poblacion, telefono, tipo, notas)
SELECT 'Extrelunas SL', 'B87089629', 'San Sebastián de los Reyes', '914384199', 'taller', 'Lunas y parabrisas (db/265)'
 WHERE NOT EXISTS (SELECT 1 FROM taller_proveedor WHERE upper(regexp_replace(COALESCE(nif, ''), '[^A-Za-z0-9]', '', 'g')) = 'B87089629');
INSERT INTO taller_proveedor (nombre, nif, poblacion, telefono, tipo, notas)
SELECT 'Miguel José Celis Junco (limpiezas)', NULL, 'Madrid', NULL, 'taller',
       'Limpieza de vehículos, autónomo (db/265). Su DNI no se carga desde el repositorio: se pone a mano.'
 WHERE NOT EXISTS (SELECT 1 FROM taller_proveedor WHERE nombre = 'Miguel José Celis Junco (limpiezas)');

CREATE TEMP TABLE _prov ON COMMIT DROP AS
SELECT 'extrelunas'::text AS prov, id FROM taller_proveedor WHERE upper(regexp_replace(COALESCE(nif, ''), '[^A-Za-z0-9]', '', 'g')) = 'B87089629'
UNION ALL
SELECT 'limpiezas', id FROM taller_proveedor WHERE nombre = 'Miguel José Celis Junco (limpiezas)';

-- ── 3 · Las facturas ───────────────────────────────────────────────────────
-- k, proveedor, número, fecha, base, iva, total, PDF, matrícula, tipo, taller, lo que se hizo
CREATE TEMP TABLE _fac (k int, prov text, numero text, fecha date, base_cent int, iva_cent int, total_cent int,
                        archivo text, matricula text, tipo text, taller text, descripcion text) ON COMMIT DROP;
INSERT INTO _fac VALUES
( 1, 'limpiezas', 'L678/2026', '2026-09-21', 4000,  840, 4840, '678.FACTURA SEPTIEMBRE 9511MMX.pdf', '9511MMX', 'limpieza', 'Limpiezas Celis',
  'Limpieza de asiento trasero izquierdo y moqueta por manchas de vómito (11:00)'),
( 2, 'limpiezas', 'L697/2026', '2026-09-29', 6500, 1365, 7865, '697.FACTURA SEPTIEMBRE 1206MJY.pdf', '1206MJY', 'limpieza', 'Limpiezas Celis',
  'Limpieza integral de 5 asientos, lavado, aspirado, desinfección y ozono por malos olores'),
( 3, 'limpiezas', 'L715/2026', '2026-10-07', 6500, 1365, 7865, '715.FACTURA OCTUBRE 6663LCY.pdf', '6663LCY', 'limpieza', 'Limpiezas Celis',
  'Limpieza integral de 5 asientos, lavado, aspirado, desinfección y ozono por malos olores'),
( 4, 'limpiezas', 'L738/2026', '2026-10-16', 4000,  840, 4840, '738.FACTURA OCTUBRE 7759MCH.pdf', '7759MCH', 'limpieza', 'Limpiezas Celis',
  'Limpieza de maletero y su moqueta por derrame de combustible (12:00)'),
( 5, 'limpiezas', 'L747/2026', '2026-10-19', 6500, 1365, 7865, '747.FACTURA OCTUBRE 7759MCH.pdf', '7759MCH', 'limpieza', 'Limpiezas Celis',
  'Limpieza integral de 5 asientos, lavado, aspirado, desinfección y ozono por malos olores'),
( 6, 'limpiezas', 'L748/2026', '2026-10-19', 4000,  840, 4840, '748.FACTURA OCTUBRE 3110KSM.pdf', '3110KSM', 'limpieza', 'Limpiezas Celis',
  'Limpieza de asiento trasero derecho, moqueta y alfombrilla por manchas de vómito (11:30)'),
( 7, 'limpiezas', 'L755/2026', '2026-10-21', 6500, 1365, 7865, '755.FACTURA OCTUBRE 3110KSM.pdf', '3110KSM', 'limpieza', 'Limpiezas Celis',
  'Limpieza integral de la tapicería de 5 asientos, lavado, aspirado, desinfección y ozono por malos olores'),
( 8, 'limpiezas', 'L760/2026', '2026-10-24', 4000,  840, 4840, '760.FACTURA OCTUBRE 0730MMZ.pdf', '0730MMZ', 'limpieza', 'Limpiezas Celis',
  'Limpieza de maletero por derrame de gasolina (12:00)'),
( 9, 'limpiezas', 'L804/2026', '2026-11-12', 4000,  840, 4840, '804.FACTURA NOVIEMBRE 4799LBG.pdf', '4799LBG', 'limpieza', 'Limpiezas Celis',
  'Limpieza de asientos traseros, alfombrillas y moqueta por manchas de vómito (15:45)'),
(10, 'extrelunas', '457/GL', '2026-06-22', 34549, 7255, 41804, '_4572026.pdf', '1090MJY', 'lunas', 'Extrelunas',
  'Parabrisas original Toyota y mano de obra'),
(11, 'extrelunas', '476/GL', '2026-06-25', 34540, 7253, 41793, '_4762026.pdf', '1212MJY', 'lunas', 'Extrelunas',
  'Parabrisas original Toyota y mano de obra'),
(12, 'extrelunas', '576/GL', '2026-07-17', 12882, 2705, 15587, '_5762026.pdf', '8475KWG', 'lunas', 'Extrelunas',
  'Ventanilla de la puerta delantera derecha (premontada) y mano de obra'),
(13, 'extrelunas', '718/GL', '2026-09-11', 34809, 7310, 42119, '_7182026.pdf', '8026LTT', 'lunas', 'Extrelunas',
  'Parabrisas acústico solar con calibración ADAS, moldura y almohadilla del sensor'),
(14, 'extrelunas', '719/GL', '2026-09-15', 35895, 7538, 43433, '_7192026.pdf', '9511MMX', 'lunas', 'Extrelunas',
  'Parabrisas original Toyota y almohadilla del sensor'),
(15, 'extrelunas', '800/GL', '2026-10-05', 28220, 5926, 34146, '_8002026.pdf', '1068MJY', 'lunas', 'Extrelunas',
  'Parabrisas acústico con detector de carril y sensor de lluvia y luz'),
(16, 'extrelunas', '806/GL', '2026-10-07', 27454, 5765, 33219, '_8062026.pdf', '7550KYT', 'lunas', 'Extrelunas',
  'Parabrisas acústico con calibración ADAS y sensor'),
(17, 'extrelunas', '827/GL', '2026-10-19', 27260, 5725, 32985, '_8272026.pdf', '6663LCY', 'lunas', 'Extrelunas',
  'Parabrisas acústico con calibración ADAS y sensor');

-- Las piezas: k, orden, código, descripción, cantidad, precio, dto %, importe, categoría
CREATE TEMP TABLE _pie (k int, orden int, codigo text, descripcion text, cantidad numeric, precio_cent int, dto numeric,
                        importe_cent int, categoria text) ON COMMIT DROP;
INSERT INTO _pie
SELECT k, 1, NULL, upper(descripcion), 1, base_cent, 0, base_cent, 'limpieza' FROM _fac WHERE prov = 'limpiezas';
INSERT INTO _pie VALUES
(10, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(10, 2, '8430AGACHMZO1L', 'ORIGINAL TOYOTA 561010ZA90', 1, 70122, 60, 28049, 'lunas'),
(11, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(11, 2, '8430AGACHMZO1L', 'ORIGINAL TOYOTA 561010ZA90', 1, 70100, 60, 28040, 'lunas'),
(12, 1, 'M.OBRA', 'MANO DE OBRA', 1, 5500, 0, 5500, 'mano_obra'),
(12, 2, '4163RGNH5FDW1M', 'HYUNDAI IONIQ 2016 5P DTE.DE.DER.VE. PREMONTADO', 1, 12303, 40, 7382, 'lunas'),
(13, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(13, 2, '4163ASMH', 'HYUNDAI I20 3-5P MOLDURA PB.', 1, 5005, 25, 3754, 'lunas'),
(13, 3, 'ALMOHADILLA', 'ALMOHADILLA DE SENSOR', 1, 2710, 50, 1355, 'lunas'),
(13, 4, '4163AGRBLCV', 'HYUNDAI IONIQ 2016 5P PB.VE/AZ SOLAR ACUSTICO C/ADAS + CHASIS + PIEZA', 1, 58000, 60, 23200, 'lunas'),
(14, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(14, 2, 'ALMOHADILLA', 'ALMOHADILLA DE SENSOR', 1, 2710, 50, 1355, 'lunas'),
(14, 3, '8430AGACHMZ1L', 'ORIGINAL TOYOTA 561010ZA90', 1, 70100, 60, 28040, 'lunas'),
(15, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(15, 2, '8409AGACMZ1L', 'TOYOTA AURIS 2013 5P-BREAK PB.VE.ACUSTICO C/DETECTOR DE CARRIL + SENSOR LLUVIA Y LUZ + PIEZA', 1, 54300, 60, 21720, 'lunas'),
(16, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(16, 2, '8430AGACMVZ', 'TOYOTA COROLLA 2019 4P-5P-BREAK PB.VE.ACUST.C/ADAS+SENSOR+PIEZA 1410x1015', 1, 41908, 50, 20954, 'lunas'),
(17, 1, 'M.OBRA', 'MANO DE OBRA', 1, 6500, 0, 6500, 'mano_obra'),
(17, 2, '8430AGACMVZ', 'TOYOTA COROLLA 2019 4P-5P-BREAK PB.VE.ACUST.C/ADAS+SENSOR+PIEZA 1410x1015', 1, 51900, 60, 20760, 'lunas');

-- Que cada factura cuadre: la suma de sus piezas es su base imponible.
DO $$
DECLARE mal text;
BEGIN
  SELECT string_agg(f.numero, ', ') INTO mal
    FROM _fac f JOIN (SELECT k, sum(importe_cent) s FROM _pie GROUP BY k) p ON p.k = f.k
   WHERE p.s <> f.base_cent OR f.base_cent + f.iva_cent <> f.total_cent;
  IF mal IS NOT NULL THEN RAISE EXCEPTION 'db/265: no cuadran %', mal; END IF;
END $$;

-- Las que ya estén (mismo proveedor y número) no se tocan.
CREATE TEMP TABLE _fid (k int, id bigint) ON COMMIT DROP;
WITH nuevas AS (
  INSERT INTO factura_taller (proveedor_id, numero, fecha, base_cent, iva_cent, total_cent, sede, notas, nombre_archivo, mime)
  SELECT p.id, f.numero, f.fecha, f.base_cent, f.iva_cent, f.total_cent, 'madrid',
         'Cargada del PDF «' || f.archivo || '» (db/265, 18/11/2026). El PDF se sube desde «Subir los PDF».',
         f.archivo, 'application/pdf'
    FROM _fac f JOIN _prov p ON p.prov = f.prov
   WHERE NOT EXISTS (SELECT 1 FROM factura_taller x
                      WHERE x.proveedor_id = p.id AND upper(btrim(x.numero)) = upper(f.numero) AND x.anulado_at IS NULL)
     -- Una factura de un coche que no está en Vehículos no entra (como en db/242).
     AND EXISTS (SELECT 1 FROM vehiculo v WHERE v.matricula_norm = f.matricula)
  RETURNING id, proveedor_id, numero)
INSERT INTO _fid
SELECT f.k, n.id FROM nuevas n JOIN _prov p ON p.id = n.proveedor_id JOIN _fac f ON f.prov = p.prov AND f.numero = n.numero;

-- El coche, por la matrícula (también si está de baja: es su historia).
CREATE TEMP TABLE _veh ON COMMIT DROP AS
SELECT f.k, (SELECT v.id FROM vehiculo v WHERE v.matricula_norm = f.matricula
              ORDER BY v.baja_at IS NOT NULL, v.id DESC LIMIT 1) AS vehiculo_id
  FROM _fac f;

CREATE TEMP TABLE _lin (k int, linea_id bigint) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO factura_taller_linea (factura_id, vehiculo_id, matricula_texto, fecha, concepto, importe_cent)
  SELECT x.id, v.vehiculo_id, f.matricula, f.fecha, f.descripcion, f.base_cent
    FROM _fac f JOIN _fid x ON x.k = f.k JOIN _veh v ON v.k = f.k
  RETURNING id, factura_id)
INSERT INTO _lin SELECT x.k, ins.id FROM ins JOIN _fid x ON x.id = ins.factura_id;

CREATE TEMP TABLE _man (k int, id bigint) ON COMMIT DROP;
WITH ins AS (
  INSERT INTO mantenimiento (vehiculo_id, tipo, fecha, km, taller, coste_cent, descripcion,
                             origen, proveedor_id, factura_id, factura_linea_id, referencia, categorias)
  SELECT v.vehiculo_id, f.tipo, f.fecha, NULL, f.taller, f.base_cent, f.descripcion,
         'factura', p.id, x.id, l.linea_id, f.numero, ARRAY[f.tipo]
    FROM _fac f
    JOIN _prov p ON p.prov = f.prov
    JOIN _fid x  ON x.k = f.k
    JOIN _lin l  ON l.k = f.k
    JOIN _veh v  ON v.k = f.k AND v.vehiculo_id IS NOT NULL
  RETURNING id, factura_id)
INSERT INTO _man SELECT x.k, ins.id FROM ins JOIN _fid x ON x.id = ins.factura_id;

INSERT INTO mantenimiento_pieza (mantenimiento_id, orden, codigo, descripcion, cantidad, precio_cent, dto, importe_cent, categoria)
SELECT m.id, p.orden, p.codigo, p.descripcion, p.cantidad, p.precio_cent, p.dto, p.importe_cent, p.categoria
  FROM _pie p JOIN _man m ON m.k = p.k;

-- ── 4 · Los avisos de ruedas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ruedas_aviso (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id  BIGINT      NOT NULL REFERENCES vehiculo(id) ON DELETE CASCADE,
  -- El cambio de ruedas del que se avisa: con uno nuevo, se vuelve a avisar.
  cambio_id    BIGINT      REFERENCES mantenimiento(id) ON DELETE SET NULL,
  km_desde     INTEGER,
  avisado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  mensaje_id   BIGINT      REFERENCES chat_mensaje(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ruedas_aviso ON ruedas_aviso (vehiculo_id, COALESCE(cambio_id, 0));
COMMENT ON TABLE ruedas_aviso IS
  'A qué coches se avisó ya (por el chat, a Notificaciones Telecab) de que les toca cambiar las ruedas: una vez por cambio (db/265).';

-- ── 5 · El chat admite avisos del sistema ──────────────────────────────────
ALTER TABLE chat_mensaje DROP CONSTRAINT IF EXISTS chat_mensaje_evento_check;
ALTER TABLE chat_mensaje
  ADD CONSTRAINT chat_mensaje_evento_check CHECK (evento IS NULL OR evento IN ('tarea_cerrada', 'aviso'));

SELECT auditoria_vigilar('ruedas_aviso');

COMMIT;
