-- ============================================================
-- 40 - LA AUSENCIA RESTA A LA TASA DEL OBJETIVO, NO 8h PLANOS
-- ============================================================
-- Correccion de la 39. Se restaba 8h (480 min) por cada dia de ausencia, y eso
-- restaba de MAS cuando la ausencia era larga:
--
--   El objetivo del mes se prorratea por dias de CALENDARIO (1776h/365 por dia
--   ~= 292 min). Cada dia del mes "pesa" eso en el objetivo. Pero la ausencia
--   restaba 480. Resultado: 11 dias de baja en un mes de 31 restaban 11*480 =
--   5280, cuando su parte real del objetivo es 11*292 = 3212. Se perdonaba mas
--   jornada de la que el dia representaba.
--
-- LA REGLA CORRECTA: un dia de ausencia resta lo que ese dia aporta al objetivo,
-- que es la MISMA tasa diaria con que se construyo. Asi:
--
--   · Un mes entero de baja deja la neta en CERO exacto (los dias suman el
--     objetivo completo).
--   · Una baja parcial resta su parte justa, ni mas ni menos.
--   · Y se resuelve solo lo de las libranzas: los dias de descanso ya estan
--     prorrateados dentro de esa tasa, asi que no hay que saber cuales son.
--
-- El equivalente de 8h del convenio (art. 25.c) NO desaparece: es la moneda de
-- la BOLSA de vacaciones (f_vacaciones_derecho, en dias laborables), que es otra
-- cuenta. Aqui hablamos de restar de la obligacion, y esa se mide en la tasa del
-- objetivo.

BEGIN;

-- La tasa diaria: lo que un dia aporta al objetivo. base_anual * 60 / dias_anio.
-- Sale del convenio, no del codigo.
CREATE OR REPLACE FUNCTION f_min_por_dia_ausencia(p_agreement UUID, p_fecha DATE)
RETURNS INT
LANGUAGE plpgsql STABLE AS $func$
DECLARE
  base_horas NUMERIC;
  dias_anio  INT := (make_date(EXTRACT(YEAR FROM p_fecha)::int, 12, 31)
                   - make_date(EXTRACT(YEAR FROM p_fecha)::int, 1, 1)) + 1;
BEGIN
  SELECT value_numeric INTO base_horas FROM agreement_parameter
   WHERE agreement_id = p_agreement AND param_code = 'ANNUAL_EFFECTIVE_HOURS'
     AND scope_group IS NULL
     AND valid_from <= p_fecha AND (valid_to IS NULL OR valid_to >= p_fecha)
   ORDER BY valid_from DESC LIMIT 1;
  IF base_horas IS NULL THEN RETURN NULL; END IF;
  RETURN round(base_horas * 60 / dias_anio);
END;
$func$;

COMMENT ON FUNCTION f_min_por_dia_ausencia(UUID, DATE) IS
  'Lo que un dia de ausencia resta: la tasa diaria del objetivo (base_anual*60/dias_anio), no 8h planos';

-- Los asientos de ausencia ya derivados estan a la tasa vieja (480). Se borran
-- para que se rederiven a la nueva. Son puramente derivados: no se pierde nada
-- que no salga de conductor_estado_hist volviendo a llamar f_derivar_ausencias.
DELETE FROM asiento_jornada
 WHERE origen = 'sistema' AND ref_externa LIKE 'aus:%';

COMMIT;
