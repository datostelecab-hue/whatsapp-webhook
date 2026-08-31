-- ============================================================
-- 31 - EL CONVENIO COMO CONFIGURACION (datos)
-- ============================================================
-- El seed de asesoria, cargado como migracion: versionado, con huella y una
-- sola vez. Contenido INTACTO respecto al fichero que entrego asesoria
-- (seed_convenio_vtc_madrid.sql); lo unico anadido va aqui arriba y en la
-- seccion "CORRECCIONES" del final, senalado.
--
-- Lo anadido:
--   1. BEGIN/COMMIT alrededor de todo. El fichero original no lo traia y el
--      runner ejecuta cada .sql de una: sin transaccion, un fallo a mitad deja
--      medio convenio cargado. Con ella, o entra todo o no entra nada.
--   2. Tres correcciones al final, cada una con su motivo. NO se tocan las
--      filas originales: se anaden o se ajustan aparte, para que el diff con el
--      fichero de asesoria sea evidente.
-- ============================================================

BEGIN;

-- ============================================================================
-- SEED: Convenio Colectivo VTC Comunidad de Madrid
-- BOCM num. 202, 24/08/2024 | Codigo 28103225012022 | Vigencia hasta 31/12/2026
--
-- Ningun valor de este fichero debe escribirse en el codigo de la aplicacion.
-- Todo se lee de estas tablas, con vigencia.
--
-- Los parametros marcados VL requieren validacion de asesoria antes de usarse
-- en un calculo con efectos economicos o disciplinarios.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------- 1. CONVENIO
INSERT INTO collective_agreement
  (agreement_id, code, name, scope_region, valid_from, valid_to,
   auto_renewal_increase_pct, source_publication, notes)
VALUES
  ('a1000000-0000-0000-0000-000000000001',
   'CC-VTC-MAD-2024',
   'Convenio colectivo del sector de transporte de pasajeros de la Comunidad de Madrid en vehiculo de turismo mediante arrendamiento con licencia VTC',
   'ES-MD', DATE '2024-09-01', DATE '2026-12-31',
   1.00,
   'BOCM num. 202 de 24/08/2024 - Resolucion 12/08/2024 DG Trabajo',
   'Conceptos salariales del art. 25 con efectividad desde 01/05/2024. Prorroga anual con +1% en todos los conceptos economicos si no media denuncia (art. 5.3), maximo 3 anyos.');

-- ------------------------------------------------- 2. GRUPOS PROFESIONALES
INSERT INTO professional_group (group_code, agreement_id, name, article_ref) VALUES
 ('G1',  'a1000000-0000-0000-0000-000000000001', 'Mandos', 'Art. 15'),
 ('G2',  'a1000000-0000-0000-0000-000000000001', 'Personal de coordinacion y tecnicos', 'Art. 15'),
 ('G3A', 'a1000000-0000-0000-0000-000000000001', 'Conductores/as de aplicacion', 'Art. 15'),
 ('G3B', 'a1000000-0000-0000-0000-000000000001', 'Conductores/as de servicio privado tradicional', 'Art. 15'),
 ('G3T', 'a1000000-0000-0000-0000-000000000001', 'Profesionales de taller', 'Art. 15'),
 ('G4',  'a1000000-0000-0000-0000-000000000001', 'Soporte', 'Art. 15');

-- ------------------------------------------------------- 3. PARAMETROS
-- param_code, valor, unidad, articulo, ambito, notas
INSERT INTO agreement_parameter
 (agreement_id, param_code, value_numeric, unit, article_ref, scope_group, valid_from, valid_to, notes) VALUES

-- 3.1 Jornada
('a1000000-0000-0000-0000-000000000001','ANNUAL_EFFECTIVE_HOURS',        1776, 'HOURS',   'Art. 16',   NULL,  DATE '2024-09-01', NULL, 'Jornada ordinaria maxima anual de trabajo efectivo'),
('a1000000-0000-0000-0000-000000000001','IRREGULAR_DISTRIBUTION_PERIOD',    1, 'MONTHS',  'Art. 18.1', 'G3A', DATE '2024-09-01', NULL, 'Computo MENSUAL. Determina target_policy = MONTHLY_POOL'),
('a1000000-0000-0000-0000-000000000001','DAILY_MAX_IMPOSABLE_MINUTES',    480, 'MINUTES', 'Art. 18.4', 'G3A', DATE '2024-09-01', NULL, 'La empresa no puede IMPONER mas de 8h diarias. No es un minimo exigible'),
('a1000000-0000-0000-0000-000000000001','DAILY_MANDATORY_BREAK_MINUTES',   30, 'MINUTES', 'Art. 18.8', 'G3A', DATE '2024-09-01', NULL, 'Antes de las primeras 6 horas. En la pausa debe desconectarse de la plataforma'),
('a1000000-0000-0000-0000-000000000001','BREAK_TRIGGER_AFTER_MINUTES',    360, 'MINUTES', 'Art. 18.8', 'G3A', DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','REST_BETWEEN_SHIFTS_MINUTES',    720, 'MINUTES', 'Art. 18.3', NULL,  DATE '2024-09-01', NULL, '12h ininterrumpidas. Reducible en ferias/eventos con preaviso de 5 dias si es a iniciativa de la empresa'),
('a1000000-0000-0000-0000-000000000001','WEEKLY_REST_DAYS',                 2, 'DAYS',    'Art. 18.2', NULL,  DATE '2024-09-01', NULL, 'Consecutivos. Por acuerdo puede ser 1,5. Desistimiento con 60 dias'),
('a1000000-0000-0000-0000-000000000001','WEEKLY_REST_DAYS_BY_AGREEMENT',  1.5, 'DAYS',    'Art. 18.2', NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','WEEKEND_REST_EVERY_N_WEEKS',       5, 'WEEKS',   'Art. 18.2', NULL,  DATE '2024-09-01', NULL, 'Sab+Dom o Dom+Lun'),
('a1000000-0000-0000-0000-000000000001','AUX_TASKS_DAILY_MINUTES',         20, 'MINUTES', 'Art. 18.6.c', 'G3A', DATE '2024-09-01', NULL, 'Repostaje, limpieza, mantenimiento basico. Salvo relevo por escrito de la empresa'),
('a1000000-0000-0000-0000-000000000001','NON_DRIVER_WEEKLY_HOURS',         40, 'HOURS',   'Art. 17',   NULL,  DATE '2024-09-01', NULL, 'Personal sin funciones de conduccion'),
('a1000000-0000-0000-0000-000000000001','NON_DRIVER_IRREGULARITY_PCT',     10, 'PERCENT', 'Art. 17',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','TIME_RECORD_DELIVERY_DAYS',        5, 'WORKDAYS','Art. 18.9', NULL,  DATE '2024-09-01', NULL, 'Plazo maximo para entregar el registro de jornada al conductor que lo solicite'),

-- 3.2 Horas extraordinarias
('a1000000-0000-0000-0000-000000000001','OVERTIME_ANNUAL_LIMIT_HOURS',     80, 'HOURS',   'Art. 20',   NULL,  DATE '2024-09-01', NULL, 'No computan las de fuerza mayor ni las compensadas con descanso en 4 meses'),
('a1000000-0000-0000-0000-000000000001','OVERTIME_COMP_WINDOW_MONTHS',      4, 'MONTHS',  'Art. 20',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','OVERTIME_PRICE_PAYMENTS',         14, 'UNITS',   'Art. 20',   NULL,  DATE '2024-09-01', NULL, 'Precio hora = (base + antiguedad) x 14 / 1776'),

-- 3.3 Vacaciones
('a1000000-0000-0000-0000-000000000001','VACATION_WORKDAYS_PER_YEAR',      22, 'WORKDAYS','Art. 21',   NULL,  DATE '2024-09-01', NULL, 'Dias LABORABLES. Proporcional a dias en alta si no hay anyo completo'),
('a1000000-0000-0000-0000-000000000001','VACATION_SUMMER_BLOCK_DAYS',      10, 'WORKDAYS','Art. 21',   NULL,  DATE '2024-09-01', NULL, 'Consecutivos, entre julio y septiembre'),
('a1000000-0000-0000-0000-000000000001','VACATION_IT_CARRY_MONTHS',        18, 'MONTHS',  'Art. 21',   NULL,  DATE '2024-09-01', NULL, 'Desde el final del anyo de origen, para IT distinta de embarazo/parto/lactancia'),
('a1000000-0000-0000-0000-000000000001','VACATION_CALENDAR_NOTICE_DAY',    31, 'DAY_OF_JAN','Art. 21', NULL,  DATE '2024-09-01', NULL, 'Notificacion a la RLT antes del 31 de enero'),
('a1000000-0000-0000-0000-000000000001','HOLIDAYS_IN_DATE_PER_YEAR',        4, 'DAYS',    'Art. 21',   NULL,  DATE '2024-09-01', NULL, 'Festivos a disfrutar en la fecha, notificados antes del 31 de enero'),
('a1000000-0000-0000-0000-000000000001','HOLIDAY_COMP_WINDOW_MONTHS',       2, 'MONTHS',  'Art. 21',   NULL,  DATE '2024-09-01', NULL, 'Antes o despues. Preaviso del trabajador: 10 dias naturales'),
('a1000000-0000-0000-0000-000000000001','HOLIDAY_COMP_NOTICE_DAYS',        10, 'DAYS',    'Art. 21',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','VACATION_DAY_EQUIV_MINUTES',     480, 'MINUTES', 'Art. 25.c', 'G3A', DATE '2024-09-01', NULL, 'Computo diario de 8h de promedio. VL si hay horario concreto distinto'),

-- 3.4 Formacion
('a1000000-0000-0000-0000-000000000001','TRAINING_PAID_LEAVE_HOURS',       20, 'HOURS',   'Art. 14',   NULL,  DATE '2024-09-01', NULL, 'Anuales, con >1 anyo de antiguedad, acumulables hasta 5 anyos'),
('a1000000-0000-0000-0000-000000000001','TRAINING_ACCUMULATION_YEARS',      5, 'YEARS',   'Art. 14',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','MANDATORY_TRAINING_HOURS',         8, 'HOURS',   'Art. 14',   'G3A', DATE '2024-09-01', NULL, 'Anual, a cargo de la empresa, COMPUTADA COMO TIEMPO EFECTIVO DE TRABAJO'),

-- 3.5 Nocturnidad
('a1000000-0000-0000-0000-000000000001','NIGHT_BAND_START',              2200, 'HHMM',    'Art. 25.g', NULL,  DATE '2024-09-01', NULL, '22:00'),
('a1000000-0000-0000-0000-000000000001','NIGHT_BAND_END',                 600, 'HHMM',    'Art. 25.g', NULL,  DATE '2024-09-01', NULL, '06:00'),
('a1000000-0000-0000-0000-000000000001','NIGHT_BONUS_PCT',                 10, 'PERCENT', 'Art. 25.g', NULL,  DATE '2024-09-01', NULL, 'VL-1: 10% del salario base + plus de permanencia. El convenio NO aclara si es mensual por trabajar alguna hora nocturna o prorrateado por hora efectiva. NO IMPLEMENTAR SIN VALIDAR'),

-- 3.6 Antiguedad
('a1000000-0000-0000-0000-000000000001','SENIORITY_PCT_5Y',                 6, 'PERCENT', 'Art. 25.d', NULL,  DATE '2024-09-01', NULL, 'Sobre salario base + plus de permanencia'),
('a1000000-0000-0000-0000-000000000001','SENIORITY_PCT_10Y',               13, 'PERCENT', 'Art. 25.d', NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','SENIORITY_PCT_15Y',               20, 'PERCENT', 'Art. 25.d', NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','SENIORITY_PCT_20Y',               27, 'PERCENT', 'Art. 25.d', NULL,  DATE '2024-09-01', NULL, 'Devengo desde el dia 1 del mes natural siguiente al vencimiento'),

-- 3.7 Otros conceptos
('a1000000-0000-0000-0000-000000000001','LANGUAGE_BONUS_MONTHLY',       41.60, 'EUR',     'Art. 25.f', NULL,  DATE '2024-09-01', NULL, 'Solo si la empresa exige idioma extranjero de uso habitual'),
('a1000000-0000-0000-0000-000000000001','CLOTHING_BONUS_ANNUAL',       104.00, 'EUR',     'Art. 25.h', NULL,  DATE '2024-09-01', NULL, 'Extrasalarial, prorrateado en 12 meses'),
('a1000000-0000-0000-0000-000000000001','EXTRA_PAYMENTS_COUNT',             2, 'UNITS',   'Art. 25.e', NULL,  DATE '2024-09-01', NULL, 'Navidad y Julio, prorrateadas en 12 meses salvo pacto, 30 dias cada una'),
('a1000000-0000-0000-0000-000000000001','SIGNING_BONUS_PER_MONTH',      25.00, 'EUR',     'Art. 4',    NULL,  DATE '2024-01-01', DATE '2024-05-01', 'Pago unico por firma de convenio, meses completos trabajados 01/01/2024 a 01/05/2024'),

-- 3.8 Plus de calidad
('a1000000-0000-0000-0000-000000000001','QUALITY_BONUS_PERIOD',             3, 'MONTHS',  'Art. 25.c', 'G3A', DATE '2024-07-01', NULL, 'Trimestres naturales desde el 1 de enero'),
('a1000000-0000-0000-0000-000000000001','QUALITY_MAX_SERIOUS_ACCIDENTS',    1, 'UNITS',   'Art. 25.c', 'G3A', DATE '2024-07-01', NULL, 'No haber sido responsable de MAS DE UN accidente grave'),
('a1000000-0000-0000-0000-000000000001','QUALITY_MAX_CANCELLATION_PCT',     4, 'PERCENT', 'Art. 25.c', 'G3A', DATE '2024-07-01', NULL, 'Indice de cancelacion por responsabilidad EXCLUSIVA del conductor. Dato a confirmar con Bolt'),
('a1000000-0000-0000-0000-000000000001','QUALITY_AVG_DAILY_HOURS',          8, 'HOURS',   'Art. 25.c', 'G3A', DATE '2024-07-01', NULL, 'Computo diario de 8h de promedio'),
('a1000000-0000-0000-0000-000000000001','QUALITY_JUSTIFICATION_SLA_DAYS',  20, 'DAYS',    'Art. 25.c', 'G3A', DATE '2024-07-01', NULL, 'NATURALES. El silencio equivale a que PROCEDE EL PAGO. Alerta bloqueante al dia 15'),

-- 3.9 IT (art. 33)
('a1000000-0000-0000-0000-000000000001','IT_COMPLEMENT_START_DAY',          4, 'DAYS',    'Art. 33',   NULL,  DATE '2024-09-01', NULL, 'A partir del cuarto dia de la baja, en todos los supuestos'),
('a1000000-0000-0000-0000-000000000001','IT_COMPLEMENT_MAX_MONTHS_AT',     12, 'MONTHS',  'Art. 33',   NULL,  DATE '2024-09-01', NULL, 'AT/EP, enfermedad grave, y AN/EC con hospitalizacion o intervencion'),
('a1000000-0000-0000-0000-000000000001','IT_COMPLEMENT_MAX_DAYS_COMMON',   60, 'DAYS',    'Art. 33',   NULL,  DATE '2024-09-01', NULL, 'Resto de casos: enfermedad comun y accidente no laboral'),

-- 3.10 Contratacion y cese
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G1',                  6, 'MONTHS',  'Art. 10',   'G1',  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G2',                  6, 'MONTHS',  'Art. 10',   'G2',  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G3',                  3, 'MONTHS',  'Art. 10',   'G3A', DATE '2024-09-01', NULL, 'Conductores y profesionales de taller. IT/maternidad/paternidad/adopcion INTERRUMPEN el computo'),
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G4',                  2, 'MONTHS',  'Art. 10',   'G4',  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','RESIGNATION_NOTICE_DAYS',          7, 'CALENDAR_DAYS','Art. 11', NULL, DATE '2024-09-01', NULL, 'Incumplimiento: perdida de salarios del periodo no preavisado INCLUIDA la parte proporcional de pagas extras'),
('a1000000-0000-0000-0000-000000000001','TEMP_CONTRACT_MAX_MONTHS',        12, 'MONTHS',  'Art. 9',    NULL,  DATE '2024-09-01', NULL, 'Circunstancias de la produccion. Prorrogable una sola vez sin exceder el maximo'),
('a1000000-0000-0000-0000-000000000001','ETT_RLT_NOTICE_DAYS',             10, 'DAYS',    'Art. 9',    NULL,  DATE '2024-09-01', NULL, 'Plazo para dar a conocer a la RLT los contratos de puesta a disposicion'),

-- 3.11 Permiso de conducir (art. 12)
('a1000000-0000-0000-0000-000000000001','LICENCE_POINTS_ALERT_THRESHOLD',   4, 'POINTS',  'Art. 12',   'G3A', DATE '2024-09-01', NULL, 'El conductor DEBE comunicar si dispone de menos de 4 puntos'),
('a1000000-0000-0000-0000-000000000001','LICENCE_INSURANCE_COMPANY_PCT',   90, 'PERCENT', 'Art. 12',   'G3A', DATE '2024-09-01', NULL, 'Aportacion de la empresa al seguro de recuperacion de puntos'),

-- 3.12 Vehiculo a domicilio (art. 28)
('a1000000-0000-0000-0000-000000000001','HOME_VEHICLE_REVOKE_NOTICE_DAYS', 15, 'DAYS',    'Art. 28.e', NULL,  DATE '2024-09-01', NULL, 'Salvo que el acuerdo venga suscrito en el contrato de trabajo'),

-- 3.13 Licencias sin sueldo (art. 23)
('a1000000-0000-0000-0000-000000000001','UNPAID_LEAVE_MIN_DAYS',           15, 'DAYS',    'Art. 23',   NULL,  DATE '2024-09-01', NULL, 'Antiguedad minima 2 anyos. No computa como tiempo de servicio'),
('a1000000-0000-0000-0000-000000000001','UNPAID_LEAVE_MAX_DAYS',           30, 'DAYS',    'Art. 23',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','UNPAID_LEAVE_MIN_SENIORITY_YEARS', 2, 'YEARS',   'Art. 23',   NULL,  DATE '2024-09-01', NULL, NULL),
('a1000000-0000-0000-0000-000000000001','ABSENCE_QUOTA_PCT',               10, 'PERCENT', 'Arts. 22 y 23', NULL, DATE '2024-09-01', NULL, 'Tope de ausentes simultaneos para conceder permisos de asuntos propios y licencias sin sueldo'),

-- 3.14 Productividad (art. 26)
('a1000000-0000-0000-0000-000000000001','PRODUCTIVITY_WITHDRAWAL_NOTICE_DAYS', 60, 'DAYS','Art. 26',   NULL,  DATE '2024-09-01', NULL, 'Desistimiento voluntario del trabajador del pacto de productividad'),
('a1000000-0000-0000-0000-000000000001','MIN_GUARANTEE_CHECK_REQUIRED',      1, 'BOOL',   'Art. 26',   NULL,  DATE '2024-09-01', NULL, 'Todo sistema de productividad debe garantizar como MINIMO las cantidades del convenio');

-- ------------------------------------------------------- 4. TABLAS SALARIALES
INSERT INTO salary_table_row
 (agreement_id, year, professional_group, base_salary, prorata, gross_monthly,
  permanence_3m, permanence_6m, quality_bonus_quarter, overtime_hour_price) VALUES
-- 2024
('a1000000-0000-0000-0000-000000000001', 2024, 'G1',  1392.56, 232.09, 1624.65, NULL,  NULL,  NULL,   10.98),
('a1000000-0000-0000-0000-000000000001', 2024, 'G2',  1285.44, 214.24, 1499.68, NULL,  NULL,  NULL,   10.13),
('a1000000-0000-0000-0000-000000000001', 2024, 'G3A', 1142.86, 190.48, 1333.34, 20.83, 41.67, 150.00,  9.01),
('a1000000-0000-0000-0000-000000000001', 2024, 'G3B', 1142.86, 190.48, 1333.34, 20.83, 41.67, NULL,    9.01),
('a1000000-0000-0000-0000-000000000001', 2024, 'G3T', 1142.86, 190.48, 1333.34, NULL,  NULL,  NULL,    9.01),
('a1000000-0000-0000-0000-000000000001', 2024, 'G4',  1142.86, 190.48, 1333.34, NULL,  NULL,  NULL,    9.01),
-- 2025
('a1000000-0000-0000-0000-000000000001', 2025, 'G1',  1448.26, 241.38, 1689.64, NULL,  NULL,  NULL,   11.42),
('a1000000-0000-0000-0000-000000000001', 2025, 'G2',  1336.86, 222.81, 1559.67, NULL,  NULL,  NULL,   10.54),
('a1000000-0000-0000-0000-000000000001', 2025, 'G3A', 1188.57, 198.10, 1386.67, 21.67, 43.34, 156.00,  9.37),
('a1000000-0000-0000-0000-000000000001', 2025, 'G3B', 1188.57, 198.10, 1386.67, 21.67, 43.34, NULL,    9.37),
('a1000000-0000-0000-0000-000000000001', 2025, 'G3T', 1188.57, 198.10, 1386.67, NULL,  NULL,  NULL,    9.37),
('a1000000-0000-0000-0000-000000000001', 2025, 'G4',  1188.57, 198.10, 1386.67, NULL,  NULL,  NULL,    9.37),
-- 2026
('a1000000-0000-0000-0000-000000000001', 2026, 'G1',  1506.19, 251.03, 1757.23, NULL,  NULL,  NULL,   11.87),
('a1000000-0000-0000-0000-000000000001', 2026, 'G2',  1390.33, 231.72, 1622.05, NULL,  NULL,  NULL,   10.96),
('a1000000-0000-0000-0000-000000000001', 2026, 'G3A', 1236.12, 206.02, 1442.14, 22.54, 45.07, 162.24,  9.74),
('a1000000-0000-0000-0000-000000000001', 2026, 'G3B', 1236.12, 206.02, 1442.14, 22.54, 45.07, NULL,    9.74),
('a1000000-0000-0000-0000-000000000001', 2026, 'G3T', 1236.12, 206.02, 1442.14, NULL,  NULL,  NULL,    9.74),
('a1000000-0000-0000-0000-000000000001', 2026, 'G4',  1236.12, 206.02, 1442.14, NULL,  NULL,  NULL,    9.74);

-- Prorroga automatica: generar el anyo 2027 con +1% si no media denuncia (art. 5.3).
-- No se inserta ahora: debe generarlo un job tras confirmar que no hubo denuncia.

-- --------------------------------------------------- 5. SUPUESTOS DE TRABAJO EFECTIVO
INSERT INTO effective_work_case (case_code, agreement_id, article_ref, description, requires_area, requires_timeframe, always_counts) VALUES
('TE_A1','a1000000-0000-0000-0000-000000000001','Art. 18.6.a','Conduccion con conexion a plataforma dentro del area indicada y dentro del marco temporal', TRUE,  TRUE,  FALSE),
('TE_A2','a1000000-0000-0000-0000-000000000001','Art. 18.6.a','Regreso al area tras servicio con destino fuera de ella', TRUE,  FALSE, FALSE),
('TE_A3','a1000000-0000-0000-0000-000000000001','Art. 18.6.a','Desde la aceptacion de un servicio hasta su finalizacion', FALSE, FALSE, TRUE),
('TE_B', 'a1000000-0000-0000-0000-000000000001','Art. 18.6.b','Desde la recogida del vehiculo en instalaciones hasta acceder al area, yendo inmediata y directamente', TRUE, FALSE, FALSE),
('TE_C', 'a1000000-0000-0000-0000-000000000001','Art. 18.6.c','Tareas auxiliares: 20 minutos diarios', FALSE, FALSE, TRUE),
('TE_D', 'a1000000-0000-0000-0000-000000000001','Art. 18.6.d','Tiempo en instalaciones o en el taller a disposicion de la empresa, o pendiente de medios', FALSE, FALSE, TRUE),
('TE_NO','a1000000-0000-0000-0000-000000000001','Art. 18.7','Conexion a plataforma sin ninguno de los supuestos anteriores: NO es trabajo efectivo', FALSE, FALSE, FALSE);

-- ------------------------------------------------- 6. TIPOS DE ASIENTO DE JORNADA
INSERT INTO ledger_entry_type
 (entry_type_code, category, obligation_effect, is_paid, counts_as_worked_time,
  requires_approval, requires_evidence, precedence, article_ref, notes) VALUES
('EFFECTIVE_WORK',      'WORK',         'FULFILLS', TRUE,  TRUE,  FALSE, FALSE, 50, 'Art. 18.6', 'Normalizado desde Bolt segun supuestos TE_*'),
('MANUAL_WORK_ADJ',     'WORK',         'FULFILLS', TRUE,  TRUE,  TRUE,  TRUE,  51, 'Art. 18.6', 'Ajuste manual auditado. Nunca edicion directa'),
('AUX_TASKS',           'WORK',         'FULFILLS', TRUE,  TRUE,  FALSE, FALSE, 52, 'Art. 18.6.c','20 min/dia automaticos si hay actividad'),
('MANDATORY_TRAINING',  'WORK',         'FULFILLS', TRUE,  TRUE,  TRUE,  TRUE,  53, 'Art. 14',   '8h anuales. Computa como tiempo efectivo de trabajo'),
('VACATION',            'ABSENCE',      'REDUCES',  TRUE,  FALSE, TRUE,  FALSE, 30, 'Art. 21',   'Bolsa en dias laborables'),
('SICK_LEAVE_IT',       'ABSENCE',      'REDUCES',  TRUE,  FALSE, FALSE, TRUE,  20, 'Art. 33',   'Complemento a cargo de empresa desde el dia 4'),
('PAID_LEAVE',          'ABSENCE',      'REDUCES',  TRUE,  FALSE, TRUE,  TRUE,  35, 'Art. 22',   'Ver catalogo de permisos'),
('TRAINING_LEAVE',      'ABSENCE',      'REDUCES',  TRUE,  FALSE, TRUE,  FALSE, 34, 'Art. 14',   '20h anuales de permiso de formacion, acumulables 5 anyos'),
('UNPAID_LEAVE',        'ABSENCE',      'REDUCES',  FALSE, FALSE, TRUE,  TRUE,  36, 'Art. 23',   'No computa como tiempo de servicio a ningun efecto'),
('SUSPENSION_DISC',     'ABSENCE',      'REDUCES',  FALSE, FALSE, TRUE,  TRUE,  10, 'Art. 39',   'Suspension de empleo y sueldo por sancion'),
('SUSPENSION_PERMISO',  'ABSENCE',      'REDUCES',  FALSE, FALSE, TRUE,  TRUE,  11, 'Art. 12',   'Retirada de permiso o perdida de puntos. Reserva de puesto. NO si es por alcohol, drogas o imprudencia grave'),
('JUST_WORKSHOP',       'JUSTIFICATION','COVERS',   TRUE,  TRUE,  TRUE,  TRUE,  60, 'Art. 18.6.d','A disposicion de la empresa en el taller. Coste imputable al modulo Taller'),
('JUST_TRAFFIC',        'JUSTIFICATION','COVERS',   TRUE,  TRUE,  TRUE,  TRUE,  61, 'Art. 18.6.d','Pendiente de que se le proporcionen los medios. Coste imputable a Trafico'),
('JUST_OPERATIONAL',    'JUSTIFICATION','COVERS',   TRUE,  TRUE,  TRUE,  TRUE,  62, 'Art. 18.6.d','Incidencia de plataforma u operativa'),
('JUST_HR',             'JUSTIFICATION','COVERS',   TRUE,  TRUE,  TRUE,  TRUE,  63, 'Art. 18.6.d','Reuniones, citaciones, gestiones'),
('UNJUSTIFIED_ABSENCE', 'DERIVED',      'NEUTRAL',  FALSE, FALSE, FALSE, FALSE, 99, 'Art. 39',   'RESIDUO CALCULADO. Nunca se teclea'),
('EXCESS_HOURS',        'DERIVED',      'NEUTRAL',  TRUE,  TRUE,  FALSE, FALSE, 98, 'Art. 20',   'Exceso sobre el computo mensual. VL-5: abono o compensacion');

-- --------------------------------------------- 7. CATALOGO DE PERMISOS (art. 22)
INSERT INTO leave_type
 (leave_type_code, agreement_id, name, duration_value, duration_unit, article_ref,
  requires_evidence, starts_next_workday, counted_in_workdays, notes) VALUES
('PR_MATRIMONIO',      'a1000000-0000-0000-0000-000000000001','Matrimonio', 15,'CALENDAR_DAYS','Art. 22.a', TRUE, TRUE, FALSE,'Unico permiso que se cuenta en dias naturales'),
('PR_ENF_GRAVE',       'a1000000-0000-0000-0000-000000000001','Accidente o enfermedad grave, hospitalizacion o intervencion con reposo domiciliario', 5,'WORKDAYS','Art. 22.b', TRUE, TRUE, TRUE,'Conyuge, pareja de hecho, parientes hasta 2o grado, familiar consanguineo de la pareja de hecho y conviviente que requiera cuidado efectivo'),
('PR_FALLECIMIENTO',   'a1000000-0000-0000-0000-000000000001','Fallecimiento de familiar hasta 2o grado', 2,'WORKDAYS','Art. 22.c', TRUE, TRUE, TRUE,'+2 dias si requiere desplazamiento'),
('PR_TRASLADO',        'a1000000-0000-0000-0000-000000000001','Traslado del domicilio habitual', 1,'WORKDAYS','Art. 22.d', TRUE, TRUE, TRUE, NULL),
('PR_DEBER_PUBLICO',   'a1000000-0000-0000-0000-000000000001','Deber inexcusable de caracter publico y personal', NULL,'INDISPENSABLE','Art. 22.e', TRUE, TRUE, TRUE,'Si supera el 20% de horas laborables en 3 meses, la empresa puede pasar a excedencia art. 46.1 ET. Si percibe indemnizacion, se descuenta del salario'),
('PR_SINDICAL',        'a1000000-0000-0000-0000-000000000001','Funciones sindicales o de representacion', NULL,'CREDIT_HOURS','Art. 22.g', FALSE, FALSE, TRUE, NULL),
('PR_PRENATAL',        'a1000000-0000-0000-0000-000000000001','Examenes prenatales y preparacion al parto', NULL,'INDISPENSABLE','Art. 22.h', TRUE, FALSE, TRUE,'Solo si deben realizarse dentro de la jornada'),
('PR_LACTANCIA',       'a1000000-0000-0000-0000-000000000001','Lactancia hasta 9 meses', 60,'MINUTES_PER_DAY','Art. 22.i y 22.k', TRUE, FALSE, TRUE,'Divisible en 2 fracciones. Sustituible por reduccion de media hora o acumulacion en jornadas completas, o 16 dias laborables tras maternidad'),
('PR_PREMATURO',       'a1000000-0000-0000-0000-000000000001','Hijo prematuro u hospitalizado tras el parto', 60,'MINUTES_PER_DAY','Art. 22.j', TRUE, FALSE, TRUE,'Ademas, reduccion de hasta 2 horas con reduccion proporcional de salario'),
('PR_GUARDA_LEGAL',    'a1000000-0000-0000-0000-000000000001','Guarda legal de menor de 12 anyos o persona con discapacidad', NULL,'REDUCTION','Art. 22.l', TRUE, FALSE, TRUE,'Entre 1/8 y 1/2 de la jornada, con reduccion proporcional del salario'),
('PR_VIOLENCIA_GENERO','a1000000-0000-0000-0000-000000000001','Victima de violencia de genero', NULL,'REDUCTION','Art. 22.m', TRUE, FALSE, TRUE,'Reduccion o reordenacion del tiempo de trabajo. DATO ESPECIALMENTE PROTEGIDO'),
('PR_ACOMP_MEDICO',    'a1000000-0000-0000-0000-000000000001','Acompanyamiento a visitas medicas de familiares de 1er grado', 8,'HOURS_PER_YEAR','Art. 22.n', TRUE, FALSE, TRUE,'Menores de edad o con discapacidad y dependientes del trabajador'),
('PR_ASUNTOS_PROPIOS', 'a1000000-0000-0000-0000-000000000001','Asuntos propios', 2,'DAYS_PER_YEAR','Art. 22 parrafo final', FALSE, FALSE, TRUE,'Preaviso 72h. Concesion obligatoria si los ausentes de la misma categoria no exceden del 10%');

-- ------------------------------------- 8. REGIMEN DISCIPLINARIO POR INASISTENCIA
INSERT INTO disciplinary_rule
 (rule_code, agreement_id, severity, article_ref, trigger_metric, operator, threshold,
  window_unit, sanction_min, sanction_max, sanction_unit, auto_detect, requires_human_decision, notes) VALUES
('ABS_1D',    'a1000000-0000-0000-0000-000000000001','LEVE',      'Art. 39.1.b','unjustified_absence_days','=', 1,'MONTH','WRITTEN_WARNING','2','DAYS_SUSPENSION', TRUE, TRUE,'Inasistencia injustificada de un dia en el periodo de un mes'),
('ABS_2D',    'a1000000-0000-0000-0000-000000000001','GRAVE',     'Art. 39.2.b','unjustified_absence_days','>=',2,'MONTH','3','30','DAYS_SUSPENSION', TRUE, TRUE,'Dos dias consecutivos o alternos. ESCALADO CONFIRMADO POR DIRECCION'),
('ABS_4D',    'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.c','unjustified_absence_days','>=',4,'MONTH','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Cuatro o mas dias consecutivos o alternos'),
('REJ_3',     'a1000000-0000-0000-0000-000000000001','LEVE',      'Art. 39.1.f','service_rejections','=', 3,'MONTH','WRITTEN_WARNING','2','DAYS_SUSPENSION', TRUE, TRUE,'Rechazo injustificado de servicios'),
('REJ_4_6',   'a1000000-0000-0000-0000-000000000001','GRAVE',     'Art. 39.2.l','service_rejections','BETWEEN',4,'MONTH','3','30','DAYS_SUSPENSION', TRUE, TRUE,'Entre 4 y 6 ocasiones en un mes'),
('REJ_7',     'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.m','service_rejections','>=',7,'MONTH','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Siete o mas ocasiones en un mes'),
('LOW_CONN',  'a1000000-0000-0000-0000-000000000001','GRAVE',     'Art. 39.2.m','connection_insufficiency','MANUAL',NULL,'MONTH','3','30','DAYS_SUSPENSION', TRUE, TRUE,'Disminucion del rendimiento no reiterada, incluida la conexion en tiempo notoriamente insuficiente. UMBRAL A DEFINIR POR DIRECCION + VL'),
('LOW_CONT',  'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.p','connection_insufficiency_sustained','MANUAL',NULL,'QUARTER','31','60','DAYS_SUSPENSION_OR_DISMISSAL', FALSE, TRUE,'Disminucion voluntaria y CONTINUADA del rendimiento'),
('PERS_USE',  'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.a','personal_vehicle_use','MANUAL',NULL,'EVENT','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Uso del vehiculo para fines personales. Comprobar antes home_vehicle_authorization vigente (art. 28)'),
('CASH_MISS', 'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.f','cash_not_delivered','MANUAL',NULL,'EVENT','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Falta de ingreso de las cantidades recaudadas a clientes, salvo causa debidamente justificada'),
('NO_REPORT', 'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.d','incident_not_reported','MANUAL',NULL,'EVENT','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Solo si la empresa dispone de procedimiento claro de comunicacion (libro de incidencias art. 30)'),
('DAMAGE',    'a1000000-0000-0000-0000-000000000001','GRAVE',     'Art. 39.2.q','vehicle_damage_negligence','MANUAL',NULL,'EVENT','3','30','DAYS_SUSPENSION', TRUE, TRUE,'Danyos al vehiculo mediando accidente, por dolo o negligencia'),
('RECID_L',   'a1000000-0000-0000-0000-000000000001','GRAVE',     'Art. 39.2.r','sanctioned_minor_faults','>=',3,'QUARTER','3','30','DAYS_SUSPENSION', TRUE, TRUE,'Reincidencia: 3 o mas faltas leves sancionadas en un trimestre'),
('RECID_G',   'a1000000-0000-0000-0000-000000000001','MUY_GRAVE', 'Art. 39.3.t','sanctioned_serious_faults','>=',2,'SEMESTER','31','60','DAYS_SUSPENSION_OR_DISMISSAL', TRUE, TRUE,'Reincidencia: 2 faltas graves sancionadas en un semestre');

-- ------------------------------------------------------------------ 9. DIETAS
INSERT INTO per_diem_rate (agreement_id, rate_code, scope, amount, article_ref, notes) VALUES
('a1000000-0000-0000-0000-000000000001','HALF_NATIONAL',   'NATIONAL',      13.52,'Art. 27','Comida o cena. Solo fuera de la Comunidad de Madrid'),
('a1000000-0000-0000-0000-000000000001','FULL_NATIONAL',   'NATIONAL',      29.12,'Art. 27','Comida y cena'),
('a1000000-0000-0000-0000-000000000001','HALF_LODGING_NAT','NATIONAL',      83.20,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','FULL_LODGING_NAT','NATIONAL',     104.00,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','HALF_INTL',       'INTERNATIONAL', 18.72,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','FULL_INTL',       'INTERNATIONAL', 36.40,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','HALF_LODGING_INT','INTERNATIONAL',104.00,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','FULL_LODGING_INT','INTERNATIONAL',124.80,'Art. 27',NULL),
('a1000000-0000-0000-0000-000000000001','MADRID_G3B',      'LOCAL',         12.48,'Art. 27','Solo G3B. Si no disfruta 120 min entre 13-16h o 19-22h');

-- --------------------------------------------------------------- 10. SEGUROS
INSERT INTO insurance_coverage (agreement_id, coverage_code, amount, article_ref, notes) VALUES
('a1000000-0000-0000-0000-000000000001','PERMANENT_ABSOLUTE_DISABILITY', 31200.00,'Art. 31','Causa: accidente laboral'),
('a1000000-0000-0000-0000-000000000001','DEATH',                         20800.00,'Art. 31','Causa: accidente laboral'),
('a1000000-0000-0000-0000-000000000001','PERMANENT_TOTAL_DISABILITY',    20800.00,'Art. 31','Para la profesion habitual'),
('a1000000-0000-0000-0000-000000000001','COLLECTIVE_DEATH_BENEFIT',       1372.80,'Art. 32','Seguro colectivo, a viuda/o o hijos convivientes y a sus expensas');

-- ------------------------------------------- 11. PLANTILLAS DE NOTIFICACION
-- Redaccion PENDIENTE de validacion juridica (VL-6). Se cargan desactivadas.
INSERT INTO notification_template
 (code, version, channel, requires_ack, legal_reference, applies_to_jornada_mode,
  requires_human_approval, active, notes) VALUES
('REQ_JUSTIFICACION_AUSENCIA', 1,'EMAIL', TRUE, 'Arts. 39.1.b, 39.2.b y 39.3.c','ANY',        TRUE,  FALSE,'Requerimiento por dias de inasistencia. Los de calificacion grave y muy grave NO salen sin aprobacion humana'),
('COM_DEFECTO_JORNADA_MES',    1,'EMAIL', TRUE, 'Arts. 16, 18.1 y 20',          'MARCO_TEMPORAL', FALSE, FALSE,'Comunicacion MENSUAL de defecto de jornada. Unica valida con marco temporal'),
('COM_DEFECTO_JORNADA_DIA',    1,'EMAIL', TRUE, 'Arts. 16 y 39.1.a',            'HORARIO_CONCRETO', FALSE, FALSE,'Solo si el contrato tiene horario concreto de entrada y salida'),
('REGISTRO_JORNADA',           1,'EMAIL', TRUE, 'Art. 18.9',                    'ANY',        FALSE, FALSE,'Entrega del registro de jornada. Plazo maximo 5 dias laborables'),
('PLUS_CALIDAD_JUSTIFICACION', 1,'EMAIL', TRUE, 'Art. 25.c',                    'ANY',        FALSE, FALSE,'Justificacion de falta de abono. Plazo 20 dias naturales. El silencio implica que procede el pago'),
('AVISO_PUNTOS_CARNET',        1,'EMAIL', TRUE, 'Art. 12',                      'ANY',        TRUE,  FALSE,'Menos de 4 puntos comunicados'),
('REQ_DOCUMENTACION',          1,'EMAIL', TRUE, 'Art. 13',                      'ANY',        FALSE, FALSE,'Documentacion caducada o pendiente');

-- ============================================================
-- CORRECCIONES (anadidas al integrar el seed, no vienen de asesoria)
-- ============================================================

-- C1 - PERIODO DE PRUEBA DE G3B Y G3T
-- El art. 10 da 3 meses de prueba a "conductores y profesionales de taller".
-- El seed solo lo cargo para G3A (conductores de aplicacion); G3B (conductores
-- de servicio privado) y G3T (profesionales de taller) se quedaban sin periodo
-- de prueba. Se anaden con el mismo valor y articulo. Ambito distinto, asi que
-- no chocan con la fila de G3A en el EXCLUDE de vigencia.
INSERT INTO agreement_parameter
 (agreement_id, param_code, value_numeric, unit, article_ref, scope_group, valid_from, valid_to, notes) VALUES
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G3', 3, 'MONTHS', 'Art. 10', 'G3B', DATE '2024-09-01', NULL, 'Conductores de servicio privado tradicional. Anadido: el art. 10 los incluye'),
('a1000000-0000-0000-0000-000000000001','TRIAL_MONTHS_G3', 3, 'MONTHS', 'Art. 10', 'G3T', DATE '2024-09-01', NULL, 'Profesionales de taller. Anadido: el art. 10 los incluye');

-- C2 - EL SEGUNDO EXTREMO DE LA REGLA "ENTRE 4 Y 6"
-- REJ_4_6 es "entre 4 y 6 rechazos en un mes", con operator BETWEEN. El seed
-- solo cargo el 4 (threshold); sin el 6, la regla no se puede evaluar. La
-- columna threshold_max existe en el esquema justo para esto.
UPDATE disciplinary_rule SET threshold_max = 6 WHERE rule_code = 'REJ_4_6';

-- ============================================================================
-- FIN. Comprobaciones recomendadas tras la carga:
--   1. SELECT count(*) FROM agreement_parameter  -->  esperado 64 (62 del seed original -el comentario decia 57- mas 2 de la correccion C1)
--   2. SELECT sum(target) FROM (calculo mensual de un anyo completo) --> 1776 h
--   3. Ningun valor de este fichero debe aparecer literal en el codigo fuente.
-- ============================================================================

COMMIT;
