-- ============================================================
-- 267 — EL BANCO DE KM: los km fuera de BOLT, con su límite
-- ============================================================
-- Camilo, 18/11/2026: «Va a haber un banco de KM por así decirlo por fuera, en
-- el cual va por conductor y un resumen de matrículas por semana. La idea es
-- que tengan un límite de 17,5 km por fuera desconectado al día, por cada uno;
-- si descansa no se le suma al límite. Por ejemplo, si es una persona que está
-- programada para trabajar en el planificador 5 días, entonces tiene 87,5 km de
-- límite a la semana, pero si se programó otro día de la nada entonces son 6
-- días y el límite sube a 105; esto también aplica a los NN: si salieron como
-- NN X día, entonces el límite también le sube».
--
-- Y decidió: gastan banco TODOS los km fuera de BOLT (desconectado y en
-- descanso), los mismos de la columna «KM fuera BOLT» del reporte de Control
-- (con el fichaje: si tenía el coche fichado son suyos; si no, del último que
-- estuvo en BOLT con él); suma el día que le tocaba en el planificador, haya
-- salido o no, y el que salió sin tocarle (vacaciones, baja o libranza no); y
-- la semana va de lunes a domingo y empieza de cero.
--
-- LO QUE HACE:
--   1 · km_banco_dia: cada persona y día (jornada cerrada), con si le tocaba,
--       si salió, el límite de ese día y sus km fuera de BOLT. Es una FOTO que
--       se rehace (modules/Operaciones/bancoKm.service.js, la tarea programada
--       «banco_km.dia»): no va bajo el libro, como auditoria_km.
--   2 · km_banco_coche: esos km, coche a coche (el resumen por matrícula).
--   3 · km_banco_calculo: qué días están hechos, cuándo y con qué resultado.
--   4 · La llave «/operaciones/banco-km» a quien ya ve la auditoría de flota.
--
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/267', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS km_banco_dia (
  dia           DATE         NOT NULL,
  -- Quién: 'c<id>' el conductor; 'u<id>' alguien de la oficina con un viaje
  -- fichado; 'b<uuid>' una cuenta de BOLT sin ficha; 't<teléfono>' quien fichó
  -- sin ficha. El banco es de los conductores; lo demás sale en las matrículas.
  persona       VARCHAR(80)  NOT NULL,
  conductor_id  BIGINT       REFERENCES conductor(id) ON DELETE SET NULL,
  nombre        VARCHAR(200) NOT NULL DEFAULT '',
  turno         VARCHAR(16)  NOT NULL DEFAULT '',
  -- Le tocaba en el planificador (f_cobertura: sin vacaciones, baja ni libranza).
  programado    BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Salió: horas en BOLT (viaje + espera) ese día.
  trabajo       BOOLEAN      NOT NULL DEFAULT FALSE,
  horas         NUMERIC(5,1) NOT NULL DEFAULT 0,
  oficina       BOOLEAN      NOT NULL DEFAULT FALSE,
  justificado   BOOLEAN      NOT NULL DEFAULT FALSE,
  -- Lo que ese día suma al límite (el parámetro banco_km.km_dia de entonces, o
  -- 0 si ni le tocaba ni salió). Se guarda: cambiar el parámetro no reescribe
  -- semanas pasadas.
  limite_km     NUMERIC(6,1) NOT NULL DEFAULT 0 CHECK (limite_km >= 0),
  km_fuera      NUMERIC(8,1) NOT NULL DEFAULT 0 CHECK (km_fuera >= 0),
  -- Estuvo en BOLT con un coche que no dio km: «REVISAR» en el reporte.
  revisar       BOOLEAN      NOT NULL DEFAULT FALSE,
  fichaje       VARCHAR(300) NOT NULL DEFAULT '',
  sin_fichar    BOOLEAN      NOT NULL DEFAULT FALSE,
  PRIMARY KEY (dia, persona)
);
CREATE INDEX IF NOT EXISTS ix_km_banco_dia_conductor ON km_banco_dia (conductor_id, dia);

COMMENT ON TABLE km_banco_dia IS
  'El banco de KM (db/267): cada persona y jornada cerrada, si le tocaba, si salió, lo que suma al límite (banco_km.km_dia) y sus km fuera de BOLT (los del reporte de Control). Foto que se rehace: modules/Operaciones/bancoKm.service.js.';

CREATE TABLE IF NOT EXISTS km_banco_coche (
  dia        DATE         NOT NULL,
  persona    VARCHAR(80)  NOT NULL,
  matricula  VARCHAR(16)  NOT NULL,
  km_fuera   NUMERIC(8,1) NOT NULL CHECK (km_fuera >= 0),
  PRIMARY KEY (dia, persona, matricula),
  FOREIGN KEY (dia, persona) REFERENCES km_banco_dia (dia, persona) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ix_km_banco_coche_matricula ON km_banco_coche (matricula, dia);

COMMENT ON TABLE km_banco_coche IS
  'El banco de KM (db/267): los km fuera de BOLT de cada persona y día, coche a coche. Sin los coches de otra sede.';

CREATE TABLE IF NOT EXISTS km_banco_calculo (
  dia            DATE         PRIMARY KEY,
  calculado_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  personas       INTEGER      NOT NULL DEFAULT 0,
  km_fuera       NUMERIC(10,1) NOT NULL DEFAULT 0,
  milisegundos   INTEGER,
  -- A mano («Recalcular»): quién. NULL = la tarea programada.
  usuario_id     INTEGER      REFERENCES usuario(id) ON DELETE SET NULL
);

COMMENT ON TABLE km_banco_calculo IS
  'El banco de KM (db/267): qué jornadas están calculadas y cuándo. Una jornada solo se calcula cerrada (las 12:00 del día siguiente, como el reporte de Control).';

-- La llave, a quien ya ve la auditoría de flota (el superadmin y el
-- desarrollador entran sin filas).
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT DISTINCT p.usuario_id, '/operaciones/banco-km', NULL::integer
  FROM usuario_permiso p
 WHERE p.clave = '/operaciones/auditoria'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/operaciones/banco-km');

COMMIT;
