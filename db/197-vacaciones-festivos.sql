-- ============================================================
-- 197 — EL MÓDULO DE VACACIONES: LOS FESTIVOS Y SU LLAVE
-- ============================================================
-- Camilo, 14/10/2026. El saldo de vacaciones de cada conductor:
--
--   + 0,0821 días por cada día natural desde el alta (o desde el 01/01/2025,
--     que es donde empieza el histórico de vacaciones), menos los días de
--     suspensión, que no generan. La libranza y la baja médica sí generan.
--   + 1 día por cada festivo nacional o de la Comunidad de Madrid en el que
--     trabajó MÁS DE 6 HORAS.
--   − los días de vacaciones disfrutadas.
--   − los días de permiso retribuido (cada uno resta un día entero).
--
-- El cálculo vive en modules/Vacaciones/vacaciones.service.js. Aquí, lo que
-- necesita y no había: el calendario de festivos y las horas de cada persona en
-- cada festivo.
--
-- LOS FESTIVOS son los doce de cada decreto de la Comunidad de Madrid (los
-- nacionales y los que fija la Comunidad; los dos locales de cada municipio, no):
--   2025: Decreto 93/2024, de 25 de septiembre (BOCM de 26/09/2024).
--   2026: Decreto 75/2025, de 24 de septiembre (BOCM de 25/09/2025).
-- Los de 2027 se añaden con otra migración cuando salga su decreto.
--
-- LAS HORAS DE UN FESTIVO se guardan, no se recalculan cada vez: son las de la
-- nómina (viaje + espera de BOLT, por día natural de Madrid). Desde el
-- 01/07/2026 las pone el propio sistema desde `fv_tramo` (un cron horario, unos
-- días después del festivo, cuando BOLT ya ha mandado todo). Las de antes las
-- carga db/198 desde el historial de BOLT. `horas_at` NULL en un festivo
-- anterior al 01/07/2026 quiere decir SIN DATOS: BOLT no guarda nada de antes de
-- mediados de junio de 2025.
--
-- LA LLAVE '/vacaciones' (ver el módulo) es la de MIRAR los saldos. Aprobar
-- sigue siendo '/vacaciones/aprobar', de una sola persona (db/189), y no la da
-- esta: se mira exacta. Se reparte a quien ya entra en RRHH o aprueba.
BEGIN;

CREATE TABLE IF NOT EXISTS festivo (
  fecha        DATE PRIMARY KEY,
  nombre       VARCHAR(80)  NOT NULL,
  ambito       VARCHAR(10)  NOT NULL CHECK (ambito IN ('nacional', 'madrid')),
  norma        VARCHAR(120) NOT NULL,
  horas_at     TIMESTAMPTZ,
  horas_fuente VARCHAR(10)  CHECK (horas_fuente IN ('bolt', 'nucleo')),
  CONSTRAINT ck_festivo_horas CHECK ((horas_at IS NULL) = (horas_fuente IS NULL))
);
COMMENT ON TABLE festivo IS
  'Festivos nacionales y de la Comunidad de Madrid (los doce del decreto de cada año). '
  'Cada uno en el que alguien trabaja más de 6 h le suma 1 día de vacaciones (db/197).';
COMMENT ON COLUMN festivo.horas_at IS
  'Cuándo se calcularon las horas de ese día (festivo_horas). NULL antes del 01/07/2026 = sin datos de BOLT.';

CREATE TABLE IF NOT EXISTS festivo_horas (
  conductor_id BIGINT  NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  fecha        DATE    NOT NULL REFERENCES festivo(fecha) ON DELETE CASCADE,
  segundos     INTEGER NOT NULL CHECK (segundos > 0),
  PRIMARY KEY (conductor_id, fecha)
);
COMMENT ON TABLE festivo_horas IS
  'Tiempo efectivo (viaje + espera de BOLT) de cada persona en cada festivo, por día natural de Madrid. '
  'Sin fila = no trabajó. La misma cuenta que la nómina.';

INSERT INTO festivo (fecha, nombre, ambito, norma) VALUES
  (DATE '2025-01-01', 'Año Nuevo',                                  'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-01-06', 'Epifanía del Señor',                         'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-04-17', 'Jueves Santo',                               'madrid',   'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-04-18', 'Viernes Santo',                              'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-05-01', 'Fiesta del Trabajo',                         'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-05-02', 'Fiesta de la Comunidad de Madrid',           'madrid',   'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-07-25', 'Santiago Apóstol',                           'madrid',   'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-08-15', 'Asunción de la Virgen',                      'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-11-01', 'Todos los Santos',                           'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-12-06', 'Día de la Constitución Española',            'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-12-08', 'Día de la Inmaculada Concepción',            'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2025-12-25', 'Natividad del Señor',                        'nacional', 'Decreto 93/2024 (BOCM 26/09/2024)'),
  (DATE '2026-01-01', 'Año Nuevo',                                  'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-01-06', 'Epifanía del Señor',                         'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-04-02', 'Jueves Santo',                               'madrid',   'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-04-03', 'Viernes Santo',                              'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-05-01', 'Fiesta del Trabajo',                         'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-05-02', 'Fiesta de la Comunidad de Madrid',           'madrid',   'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-08-15', 'Asunción de la Virgen',                      'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-10-12', 'Fiesta Nacional de España',                  'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-11-02', 'Todos los Santos (trasladado)',              'madrid',   'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-12-07', 'Día de la Constitución Española (trasladado)', 'madrid', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-12-08', 'Día de la Inmaculada Concepción',            'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)'),
  (DATE '2026-12-25', 'Natividad del Señor',                        'nacional', 'Decreto 75/2025 (BOCM 25/09/2025)')
ON CONFLICT (fecha) DO NOTHING;

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT DISTINCT p.usuario_id, '/vacaciones', NULL::integer
  FROM usuario_permiso p
 WHERE p.clave IN ('/rrhh', '/vacaciones/aprobar')
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/vacaciones');

COMMIT;
