-- ============================================================
-- 273 — CÓDIGOS DE LAVADO BALLENOIL: LA TANDA DE NOVIEMBRE (HASTA EL 17/12/2026)
-- ============================================================
-- Camilo, 20/11/2026: «Nuevos códigos de lavado Ballenoil. La fecha 02/11/2026
-- fue la fecha que nos dieron estos códigos, pero vencen el 17/12/2026 todos».
--
-- 88 códigos de 8 cifras, todos distintos, con vencimiento el 17/12/2026. Antes
-- de escribir esto se miró producción (solo lectura): ninguno estaba ya en la
-- tabla, y no quedaba ni un código libre vigente (la tanda anterior venció el
-- 17/11). ON CONFLICT DO NOTHING igualmente: si Ballenoil repite un número que ya
-- se entregó, se queda con su historia y no vuelve a darse por libre.
--
-- El botón del bot vuelve a salir hasta el 17/12/2026
-- (services/lavadoBallenoil.js, LAVADO_HASTA). Solo datos: se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/273', true),
       set_config('telecab.usuario_id', '7', true);

INSERT INTO ballenoil_codigo (codigo, vence)
SELECT c, DATE '2026-12-17'
  FROM unnest(ARRAY[
    '26933775', '26526681', '26358888', '26354264', '26730291', '26983655', '26808463', '26542040', '26168199', '26328422',
    '26542569', '26275038', '26348218', '26553342', '26155619', '26971791', '26379826', '26770255', '26412807', '26432651',
    '26575433', '26390160', '26715268', '26181201', '26336751', '26636188', '26929653', '26669313', '26569963', '26456334',
    '26928201', '26824228', '26632691', '26628666', '26980056', '26861113', '26171235', '26255095', '26209332', '26264951',
    '26302021', '26988264', '26614828', '26420915', '26510640', '26479647', '26277638', '26800801', '26194915', '26358839',
    '26137552', '26288493', '26706865', '26301067', '26644827', '26635067', '26125295', '26546924', '26657986', '26360119',
    '26526980', '26519100', '26682076', '26628432', '26661584', '26390514', '26793383', '26863605', '26378778', '26728590',
    '26699694', '26239231', '26858081', '26877332', '26940032', '26952996', '26236172', '26977585', '26684100', '26424666',
    '26684451', '26885167', '26969494', '26319518', '26910462', '26700947', '26766442', '26961067'
  ]::text[]) AS c
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
