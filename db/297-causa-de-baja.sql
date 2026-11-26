-- ============================================================
-- 297 — LA CAUSA DE UNA BAJA, Y LA CARTA DE BAJA VOLUNTARIA
-- ============================================================
-- Camilo, 26/11/2026: «Esta será la plantilla que mandaremos para baja
-- voluntaria». Para que el ERP la prepare sola hace falta saber que una baja
-- ES voluntaria, y hasta hoy el motivo era texto libre («Baja Voluntaria»,
-- «BAJA VOLUNTARIA», «BV»…). Decidido:
--   · Al dar la baja, una CAUSA de una lista (y el motivo de texto, para los
--     detalles). La lista sirve también para informes y para la gestoría.
--   · En una baja voluntaria, el día en que el trabajador la COMUNICÓ: es la
--     «Fecha de la carta», y el preaviso son los días de ese día a su último.
--   · Al registrarla (inmediata o programada), de plantilla propia, la carta
--     entra sola en la cola de Firmas (tipo «baja_voluntaria», origen «baja»)
--     con la plantilla de YouTrust «Carta de baja voluntaria». La ETT no: su
--     empresa es la ETT.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/297', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE conductor_periodo_empleo ADD COLUMN IF NOT EXISTS causa_baja VARCHAR(24);
ALTER TABLE conductor_periodo_empleo ADD COLUMN IF NOT EXISTS baja_comunicada DATE;
ALTER TABLE conductor_periodo_empleo DROP CONSTRAINT IF EXISTS ck_causa_baja;
ALTER TABLE conductor_periodo_empleo ADD CONSTRAINT ck_causa_baja CHECK (causa_baja IS NULL OR causa_baja IN
  ('voluntaria', 'prueba', 'no_incorpora', 'despido_disciplinario', 'despido_objetivo', 'fin_contrato', 'otra'));
COMMENT ON COLUMN conductor_periodo_empleo.causa_baja IS 'Por qué se fue (db/297): voluntaria, prueba (no supera el periodo de prueba), no_incorpora, despido_disciplinario, despido_objetivo, fin_contrato, otra';
COMMENT ON COLUMN conductor_periodo_empleo.baja_comunicada IS 'Baja voluntaria: el día en que el trabajador la comunicó (la fecha de su carta)';

ALTER TABLE conductor_baja_programada ADD COLUMN IF NOT EXISTS causa VARCHAR(24);
ALTER TABLE conductor_baja_programada ADD COLUMN IF NOT EXISTS comunicada DATE;

-- Las de antes, por su motivo de texto, donde no hay duda.
UPDATE conductor_periodo_empleo SET causa_baja = CASE
    WHEN motivo_baja ~* 'voluntari|^\s*b\.?\s?v\.?\s*$' THEN 'voluntaria'
    WHEN motivo_baja ~* 'nspp|periodo de prueba|no supera' THEN 'prueba'
    WHEN motivo_baja ~* 'no se incorpor' THEN 'no_incorpora'
    WHEN motivo_baja ~* 'disciplinari' THEN 'despido_disciplinario'
  END
 WHERE baja IS NOT NULL AND causa_baja IS NULL AND motivo_baja IS NOT NULL
   AND motivo_baja ~* 'voluntari|^\s*b\.?\s?v\.?\s*$|nspp|periodo de prueba|no supera|no se incorpor|disciplinari';

-- La carta va por la cola de Firmas (db/293) con su tipo y su origen.
ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_tipo;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_tipo
  CHECK (tipo IN ('finiquito', 'suspension', 'sancion', 'descuento', 'contrato', 'comunicacion', 'baja_voluntaria', 'otro'));
ALTER TABLE firma_envio DROP CONSTRAINT IF EXISTS ck_firma_origen;
ALTER TABLE firma_envio ADD CONSTRAINT ck_firma_origen CHECK (origen IN ('manual', 'finiquito', 'semana', 'sancion', 'baja'));

COMMIT;
