-- ============================================================
-- 112 - LA JORNADA CONTRATADA, DENTRO DEL CONTRATO
-- ============================================================
-- El agujero del Hito 3 que se ve en cuanto se generan objetivos de verdad: el
-- objetivo mensual salia IGUAL para todo el mundo.
--
-- `f_objetivo_min` prorrateaba la jornada anual del convenio (1.776 h) por los
-- dias de alta, y nada mas. Eso es correcto para una jornada completa, pero a
-- quien tiene 32 horas semanales le exigia lo mismo que a quien tiene 40: un
-- 25 % de mas, todos los meses. Con `contrato` vacio no se notaba; en cuanto hay
-- contratos, 15 de las 215 personas de la plantilla salen mal.
--
-- El contrato sabia BAJO QUE CONVENIO y EN QUE GRUPO, pero no CUANTAS HORAS. Se
-- guarda aqui, y no se lee de `conductor_periodo_empleo`, por la misma razon por
-- la que existe la tabla: el periodo responde "esta de alta?" y el contrato
-- "en que condiciones?". Pasar de 32 a 40 horas es un contrato nuevo, no una
-- baja y un alta, y el objetivo del mes en que ocurra tiene que poder explicar
-- con que horas se calculo cada tramo.

BEGIN;

-- ── La jornada semanal del contrato ────────────────────────────────────────
-- Por omision 40: es la jornada completa y la que tienen 123 de los 138 que la
-- llevan anotada. Sin FK a `cat_jornada` a proposito: ese catalogo es de la
-- pantalla de plantilla (32/40, con sus dias de correturnos) y manana puede
-- tener una jornada que aqui no valga, o al reves. Lo que de verdad hay que
-- impedir es un numero imposible.
ALTER TABLE contrato
  ADD COLUMN IF NOT EXISTS horas_semana NUMERIC(4,1) NOT NULL DEFAULT 40;

ALTER TABLE contrato DROP CONSTRAINT IF EXISTS ck_contrato_horas;
ALTER TABLE contrato
  ADD CONSTRAINT ck_contrato_horas CHECK (horas_semana > 0 AND horas_semana <= 60);

COMMENT ON COLUMN contrato.horas_semana IS
  'Jornada semanal contratada. Escala el objetivo mensual: 32 h deben 32/40 de la jornada anual del convenio';

-- ── El objetivo, ahora proporcional a la jornada contratada ────────────────
-- objetivo_min(mes) = base_anual_h * 60
--                     * (dias_de_alta_en_el_mes / dias_del_anio)     <- lo de antes
--                     * (horas_semana / jornada_completa_semanal)    <- lo nuevo
--
-- La jornada completa NO se escribe aqui: se lee de `agreement_parameter`
-- (NON_DRIVER_WEEKLY_HOURS, hoy 40 h) del convenio que le aplica a ESA persona.
-- Si el convenio baja la semana a 38 h, el objetivo de los de 32 sube solo,
-- porque 32/38 es mas que 32/40. Esa es la gracia del Hito 0 y aqui se respeta.
--
-- Si el parametro no estuviera, se cae a 40 y se sigue: dejar sin objetivo a
-- toda la plantilla por un parametro que falta seria peor que usar la jornada
-- legal ordinaria, que es 40 h desde 1983.
CREATE OR REPLACE FUNCTION f_objetivo_min(
  p_contrato_id BIGINT, p_anio INT, p_mes INT
) RETURNS INT
LANGUAGE plpgsql STABLE AS $func$
DECLARE
  c            contrato%ROWTYPE;
  primero      DATE := make_date(p_anio, p_mes, 1);
  base_horas   NUMERIC;
  semana_plena NUMERIC;
  dias_anio    INT := (make_date(p_anio, 12, 31) - make_date(p_anio, 1, 1)) + 1;  -- 365 o 366
  dias_alta    INT;
BEGIN
  SELECT * INTO c FROM contrato WHERE id = p_contrato_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- La jornada anual del convenio, vigente ese mes. Global (scope_group NULL):
  -- las 1.776 h no distinguen grupo.
  SELECT value_numeric INTO base_horas
    FROM agreement_parameter
   WHERE agreement_id = c.agreement_id
     AND param_code   = 'ANNUAL_EFFECTIVE_HOURS'
     AND scope_group IS NULL
     AND valid_from <= primero
     AND (valid_to IS NULL OR valid_to >= primero)
   ORDER BY valid_from DESC
   LIMIT 1;
  -- Mejor un hueco visible que un cero que parece un objetivo de verdad.
  IF base_horas IS NULL THEN RETURN NULL; END IF;

  SELECT value_numeric INTO semana_plena
    FROM agreement_parameter
   WHERE agreement_id = c.agreement_id
     AND param_code   = 'NON_DRIVER_WEEKLY_HOURS'
     AND scope_group IS NULL
     AND valid_from <= primero
     AND (valid_to IS NULL OR valid_to >= primero)
   ORDER BY valid_from DESC
   LIMIT 1;
  IF semana_plena IS NULL OR semana_plena <= 0 THEN semana_plena := 40; END IF;

  dias_alta := f_dias_alta_mes(c.desde, c.hasta, p_anio, p_mes);
  IF dias_alta = 0 THEN RETURN 0; END IF;

  -- Todo NUMERIC de punta a punta: no hay division entera que se coma los
  -- decimales antes de redondear.
  RETURN round(base_horas * 60
               * dias_alta::numeric / dias_anio
               * LEAST(c.horas_semana, semana_plena) / semana_plena);
END;
$func$;

COMMENT ON FUNCTION f_objetivo_min(BIGINT, INT, INT) IS
  'Minutos que debe un contrato en un mes: jornada anual del convenio, prorrateada por dias de alta y por la jornada semanal contratada';

-- ── La vista, con la jornada delante ───────────────────────────────────────
-- Se recrea entera porque CREATE OR REPLACE VIEW solo admite anadir columnas al
-- final, y aqui interesa que `horas_semana` vaya al lado del grupo: quien mira
-- un contrato quiere ver las dos cosas juntas.
DROP VIEW IF EXISTS v_contrato;
CREATE VIEW v_contrato AS
SELECT c.id,
       c.conductor_id,
       co.nombre                       AS conductor,
       c.grupo,
       pg.name                         AS grupo_nombre,
       c.horas_semana,
       c.agreement_id,
       ca.code                         AS convenio,
       c.jornada_mode,
       c.target_policy,
       c.desde,
       c.hasta,
       (c.hasta IS NULL)               AS vigente
  FROM contrato c
  JOIN conductor co            ON co.id = c.conductor_id
  JOIN collective_agreement ca ON ca.agreement_id = c.agreement_id
  JOIN professional_group pg   ON pg.agreement_id = c.agreement_id AND pg.group_code = c.grupo;

COMMENT ON VIEW v_contrato IS
  'El contrato con los nombres del convenio ya resueltos. Filtra por desde/hasta para una fecha concreta';

COMMIT;
