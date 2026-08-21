-- ============================================================
-- 09 · AUDITORÍA DE EDICIONES Y CONFLICTOS DE PLAZA
-- ============================================================
-- Dos huecos que salen al convertir Conductores en la plantilla de verdad.
--
-- 1. QUIÉN CAMBIÓ QUÉ.
--    Los cambios con historial ya guardan `usuario_id`: cambiar de turno, de
--    situación o de coche deja rastro. Pero editar el DNI, el NAF, la cuenta o
--    la dirección no deja ninguno, y son precisamente los datos que hay que
--    poder justificar ante la gestoría o una inspección. El código viejo ya los
--    tenía marcados como "sensibles" (CAMPOS_SENSIBLES en planificadorV2.js);
--    lo que faltaba era dónde apuntarlo.
--
-- 2. LA MISMA PERSONA EN DOS COCHES EL MISMO DÍA.
--    `ex_asig_plaza` impide que dos conductores ocupen la MISMA plaza en fechas
--    que se pisan, pero no lo contrario: una persona en dos plazas a la vez.
--    No se puede resolver con una restricción de exclusión porque los días de
--    un fijo no están en la asignación: salen de su patrón de libranza, que
--    cambia por su cuenta. Así que se define UNA VEZ como vista y de ahí tiran
--    la pantalla, los avisos y cualquier informe.

BEGIN;

-- ── 1. Auditoría de campos ──────────────────────────────────────────────────
CREATE TABLE cambio_campo (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Genérica a propósito: vale para conductor, vehiculo o lo que venga. No
  -- lleva clave foránea porque tiene que sobrevivir al borrado de la fila que
  -- describe: si se va con ella, no queda constancia de que existió.
  tabla        VARCHAR(40)  NOT NULL,
  registro_id  BIGINT       NOT NULL,
  campo        VARCHAR(40)  NOT NULL,
  valor_antes  TEXT,
  valor_ahora  TEXT,
  usuario_id   INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  cambiado_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  origen       VARCHAR(20)  NOT NULL DEFAULT 'manual',
  CONSTRAINT ck_cambio_origen CHECK (origen IN ('manual','importacion','migracion','api','bot')),
  -- Guardar un cambio que no cambia nada es ruido.
  CONSTRAINT ck_cambio_distinto CHECK (valor_antes IS DISTINCT FROM valor_ahora)
);
CREATE INDEX idx_cambio_registro ON cambio_campo (tabla, registro_id, cambiado_at DESC);
CREATE INDEX idx_cambio_usuario  ON cambio_campo (usuario_id, cambiado_at DESC);
CREATE INDEX idx_cambio_fecha    ON cambio_campo (cambiado_at DESC);

COMMENT ON TABLE cambio_campo IS
  'Quién cambió qué campo y cuándo. Solo para los datos que NO tienen tabla de historial propia: el turno, la situación o el coche ya lo guardan en la suya';
COMMENT ON COLUMN cambio_campo.tabla IS
  'Sin clave foránea a propósito: el registro auditado puede borrarse y el rastro debe quedarse';

-- ── 2. Una persona en dos plazas el mismo día ───────────────────────────────

-- Primero, qué días de la semana cubre CADA asignación vigente.
--   · Un correturno tiene sus días escritos (asignacion_dia).
--   · Un fijo cubre todos los días MENOS los de su patrón de libranza.
-- Tenerlo en una vista evita que cada consulta lo resuelva a su manera, que es
-- como acaban dos pantallas dando números distintos.
CREATE OR REPLACE VIEW v_asignacion_dias AS
SELECT a.id            AS asignacion_id,
       a.conductor_id,
       a.plaza_id,
       p.vehiculo_id,
       v.matricula,
       s.rol,
       s.turno_id,
       a.desde,
       a.hasta,
       d.dia_semana
  FROM asignacion a
  JOIN plaza p     ON p.id = a.plaza_id
  JOIN cat_slot s  ON s.slot = p.slot
  JOIN vehiculo v  ON v.id = p.vehiculo_id
  -- Los siete días de la semana, para poder restarle la libranza a un fijo.
  CROSS JOIN LATERAL generate_series(1, 7) AS d(dia_semana)
 WHERE (
   -- Correturno: solo los días que tenga escritos.
   (s.rol = 'CT' AND EXISTS (
      SELECT 1 FROM asignacion_dia ad
       WHERE ad.asignacion_id = a.id AND ad.dia_semana = d.dia_semana))
   OR
   -- Fijo: todos menos los que libra según el patrón vigente en `desde`.
   (s.rol = 'FIJO' AND NOT EXISTS (
      SELECT 1
        FROM patron_libranza pl
        JOIN patron_libranza_dia pld ON pld.patron_id = pl.id
       WHERE pl.conductor_id = a.conductor_id
         AND pld.dia_semana = d.dia_semana
         AND pl.desde <= COALESCE(a.hasta, 'infinity'::date)
         AND (pl.hasta IS NULL OR pl.hasta >= a.desde)))
 );

COMMENT ON VIEW v_asignacion_dias IS
  'Qué días cubre cada asignación. Un CT los tiene escritos; un FIJO son todos menos su libranza. Una sola definición para todo el sistema';

-- Y ahora el conflicto: dos asignaciones de la MISMA persona que se pisan en
-- fechas y coinciden en algún día, estando en coches distintos.
CREATE OR REPLACE VIEW v_conductor_doble_plaza AS
SELECT a.conductor_id,
       a.dia_semana,
       a.asignacion_id  AS asignacion_a,
       b.asignacion_id  AS asignacion_b,
       a.matricula      AS matricula_a,
       b.matricula      AS matricula_b,
       GREATEST(a.desde, b.desde)                                   AS solapa_desde,
       LEAST(COALESCE(a.hasta, 'infinity'::date),
             COALESCE(b.hasta, 'infinity'::date))                   AS solapa_hasta
  FROM v_asignacion_dias a
  JOIN v_asignacion_dias b
    ON b.conductor_id = a.conductor_id
   AND b.dia_semana   = a.dia_semana
   -- Solo una vez cada pareja, y nunca consigo misma.
   AND b.asignacion_id > a.asignacion_id
   -- En coches distintos: dos plazas del MISMO coche ya lo avisa el planificador
   -- por otro sitio y no es el problema que se persigue aquí.
   AND b.vehiculo_id <> a.vehiculo_id
   -- Y con las fechas pisándose.
   AND daterange(a.desde, a.hasta, '[]') && daterange(b.desde, b.hasta, '[]');

COMMENT ON VIEW v_conductor_doble_plaza IS
  'La misma persona en dos coches el mismo día de la semana. No puede ser una restricción de la base porque los días de un fijo dependen de su libranza, que cambia aparte';

COMMIT;
