-- ============================================================
-- 234 — BARCELONA: SUS ZONAS, SUS CUADRANTES, SUS LIBRANZAS Y SUS CORRETURNOS
-- ============================================================
-- Camilo, 06/11/2026: «Vamos ahora con el planificador de Barcelona. En estos
-- momentos no hay RRHH así que no sé quién está de alta desde qué fecha, solo
-- nos basamos si está activo o no en BOLT, bueno, pues ahora necesito agregarle
-- días de libranzas desde el planificador, además de agregar los promedios de
-- cada uno como en el planificador de Madrid, sin letra ya que no nos interesa
-- la utilización y avisos de velocidad, por el momento. Además de que ahora
-- también se van a agregar zonas de Barcelona así como en Madrid, no sé todavía
-- si habrá o no CT allá pero actívalo de una vez, por defecto todos deben de
-- venir con los CT desactivados.»
--
-- Y: «Prácticamente será el mismo diseño de Madrid, solo que la arquitectura y
-- flujo de datos cambia ya que no tenemos lo mismo, pero está empezando de 0
-- para ir cogiendo forma.»
--
-- Lo que decidió al preguntarle: las libranzas son DE LA PLAZA (matrícula +
-- turno), como en Madrid; el CT, como en Madrid, con su bloque; las zonas, en
-- grupos tipo cuadrante (la zona es del cuadrante); el promedio, igual que el de
-- Madrid (el promedio no se guarda: se calcula al vuelo, ver
-- docs/modulos/Barcelona.md).
--
-- EL MISMO MODELO QUE MADRID, EN TABLAS SUYAS (el principio de db/181 y de
-- docs/nucleo/Sedes.md). Nada de Barcelona entra en base_zona, cuadrante,
-- vehiculo_descanso, vehiculo_sin_ct ni asignacion: de esas tablas beben
-- f_cobertura, Control, el bot y las nóminas de Madrid, y un coche o una cuenta
-- de Barcelona saldría allí como un hueco o un NN. Así Madrid no cambia en nada.
--
-- Lo que cambia respecto a Madrid, porque los datos no son los mismos:
--
--   · LA PLAZA VA POR MATRÍCULA (texto normalizado, como sede_asignacion), no
--     por vehiculo_id: hay coches de Barcelona que solo existen en BOLT.
--   · LAS PERSONAS SON CUENTAS DE BOLT (driver_uuid de la empresa de Barcelona):
--     no hay fichas, altas ni ausencias que mirar.
--   · EL CT VA AL REVÉS. En Madrid la marca es de DESACTIVACIÓN (vehiculo_sin_ct:
--     sin fila, el coche lleva correturnos). Aquí es de ACTIVACIÓN (sede_coche_ct:
--     sin fila, el coche NO lleva). Camilo: «por defecto todos deben de venir
--     con los CT desactivados». Sin fila es lo de por defecto, y lo de por
--     defecto no tiene que escribirse.
--   · LOS DÍAS DEL DESCANSO VAN EN UN ARRAY (smallint[]), no en una tabla hija
--     como vehiculo_descanso_dia: aquí nadie más los lee por SQL, y un array se
--     guarda, se compara y se cierra de una vez.
--
-- Cerrar y no borrar, como en Madrid: un cambio cierra lo vigente la víspera
-- (`hasta`) y abre lo nuevo, así el reporte de un día viejo sigue sabiendo
-- quién libraba y qué coche llevaba correturnos.

BEGIN;

-- La exclusión por (sede, matrícula, fechas) mezcla `=` sobre texto con `&&`
-- sobre rangos en un índice gist: eso lo da btree_gist (db/03 ya la creó).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 0 · Unos días de la semana bien escritos ────────────────────────────────
-- 1 = lunes … 7 = domingo (ISODOW, como Madrid), al menos uno, sin repetir y sin
-- huecos (NULL). Una función porque lo piden dos tablas y un CHECK no admite
-- subconsultas; IMMUTABLE porque solo mira su argumento.
CREATE OR REPLACE FUNCTION f_sede_dias_validos(p_dias smallint[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_dias IS NOT NULL
     AND cardinality(p_dias) >= 1
     AND array_ndims(p_dias) = 1
     AND array_position(p_dias, NULL) IS NULL
     AND p_dias <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
     AND cardinality(p_dias) = (SELECT count(DISTINCT d) FROM unnest(p_dias) AS d)
$$;
COMMENT ON FUNCTION f_sede_dias_validos(smallint[]) IS
  'Días de la semana bien escritos: 1..7 (lunes = 1), al menos uno, sin repetir. Para los descansos y los días del CT de otras sedes (db/234).';

-- ── 1 · Las zonas de la sede ────────────────────────────────────────────────
-- Como base_zona de Madrid, sin coordenadas: Barcelona no tiene Selección que
-- mida distancias. Se retiran (activa = false), no se borran: un cuadrante
-- viejo puede seguir apuntando a ella.
CREATE TABLE IF NOT EXISTS sede_zona (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede        varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  nombre      varchar(60)  NOT NULL,
  activa      boolean      NOT NULL DEFAULT true,
  creado_at   timestamptz  NOT NULL DEFAULT now(),
  creado_por  integer      REFERENCES usuario(id) ON DELETE SET NULL,
  CONSTRAINT ck_sede_zona_nombre CHECK (btrim(nombre) <> ''),
  -- «Sin zona» es el grupo de los cuadrantes que no tienen: una zona con ese
  -- nombre se confundiría con él en la pantalla.
  CONSTRAINT ck_sede_zona_reservado CHECK (lower(btrim(nombre)) <> 'sin zona')
);
-- Dos zonas vivas no se llaman igual en la misma sede (sin mirar mayúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_zona_nombre
  ON sede_zona (sede, lower(btrim(nombre))) WHERE activa;

COMMENT ON TABLE sede_zona IS
  'Las zonas de OTRAS sedes (Barcelona), como base_zona de Madrid pero aparte y sin coordenadas. Se retiran, no se borran (db/234).';
COMMENT ON COLUMN sede_zona.activa IS 'false = retirada: no se ofrece. No se retira mientras tenga cuadrantes vivos (lo comprueba el servicio).';

-- ── 2 · Los cuadrantes de la sede ───────────────────────────────────────────
-- Como cuadrante de Madrid: un grupo de coches con su zona. El número es el
-- siguiente libre de la sede (lo da el servicio) y no se repite entre los vivos.
CREATE TABLE IF NOT EXISTS sede_cuadrante (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede        varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  numero      integer      NOT NULL,
  nombre      varchar(60),                        -- opcional: sin nombre, «C<número>»
  zona_id     bigint       REFERENCES sede_zona(id) ON DELETE SET NULL,
  creado_at   timestamptz  NOT NULL DEFAULT now(),
  creado_por  integer      REFERENCES usuario(id) ON DELETE SET NULL,
  baja_at     timestamptz,                        -- borrado: se da de baja, no se borra
  CONSTRAINT ck_sede_cuadrante_numero CHECK (numero > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_cuadrante_numero
  ON sede_cuadrante (sede, numero) WHERE baja_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sede_cuadrante_zona ON sede_cuadrante (zona_id);

COMMENT ON TABLE sede_cuadrante IS
  'Los cuadrantes de OTRAS sedes (Barcelona): grupos de coches con su zona, como cuadrante de Madrid pero aparte (db/234).';
COMMENT ON COLUMN sede_cuadrante.numero IS 'El número del cuadrante (C1, C2…): el siguiente libre de la sede, único entre los vivos.';
COMMENT ON COLUMN sede_cuadrante.baja_at IS 'Dado de baja (solo sin coches). NULL = vivo.';

-- ── 3 · El cuadrante de cada coche ──────────────────────────────────────────
-- Como vehiculo.cuadrante_id en Madrid: la pertenencia de HOY, sin historial
-- (Madrid tampoco lo tiene). Por matrícula, porque hay coches solo en BOLT.
CREATE TABLE IF NOT EXISTS sede_coche (
  sede             varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  matricula        varchar(16)  NOT NULL,
  cuadrante_id     bigint       REFERENCES sede_cuadrante(id) ON DELETE SET NULL,
  actualizado_at   timestamptz  NOT NULL DEFAULT now(),
  actualizado_por  integer      REFERENCES usuario(id) ON DELETE SET NULL,
  PRIMARY KEY (sede, matricula)
);
CREATE INDEX IF NOT EXISTS ix_sede_coche_cuadrante ON sede_coche (cuadrante_id);

COMMENT ON TABLE sede_coche IS
  'El cuadrante de cada coche de OTRAS sedes (Barcelona), por matrícula. La pertenencia actual, sin historial, como vehiculo.cuadrante_id (db/234).';

-- ── 4 · Los periodos CON correturnos ────────────────────────────────────────
-- AL REVÉS QUE MADRID: aquí se apunta cuándo un coche SÍ lleva CT. Sin fila,
-- no lo lleva (lo de por defecto, Camilo). Con fecha, como vehiculo_sin_ct: el
-- pasado de ese coche no tuvo CT y su reporte tiene que seguir cuadrando.
CREATE TABLE IF NOT EXISTS sede_coche_ct (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede         varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  matricula    varchar(16)  NOT NULL,
  desde        date         NOT NULL,
  hasta        date,                                -- último día con CT; NULL = sigue
  creado_por   integer      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    timestamptz  NOT NULL DEFAULT now(),
  cerrado_por  integer      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrado_at   timestamptz,
  CONSTRAINT ck_sede_coche_ct_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Dos periodos del mismo coche no se pisan: la base lo garantiza, no la pantalla.
  CONSTRAINT ex_sede_coche_ct_solape EXCLUDE USING gist (
    sede WITH =,
    matricula WITH =,
    daterange(desde, hasta, '[]') WITH &&)
);

COMMENT ON TABLE sede_coche_ct IS
  'Los periodos en que un coche de OTRA sede (Barcelona) LLEVA correturnos. Sin fila = sin CT, lo de por defecto (al revés que vehiculo_sin_ct de Madrid). db/234';

-- ── 5 · El descanso de cada plaza ───────────────────────────────────────────
-- La libranza vive en el COCHE (en su plaza), no en la persona, como en Madrid
-- (db/56 y db/203): si cambia el fijo, el nuevo libra lo mismo.
--
--   turno NULL       el descanso COMÚN del coche, EL BLOQUE: sus dos fijos
--                    libran esos días y su CT los cubre. Solo en coches CON CT.
--   turno 'dia' o    el del fijo de ese turno: cada uno libra lo suyo y nadie
--   'noche'          lo cubre (ese turno, ese día, el coche no sale: no es un
--                    hueco). Solo en coches SIN CT.
--
-- Qué turno toca según el CT lo decide el servicio (barcelona.plan.js), que es
-- quien sabe de qué periodo es cada día.
CREATE TABLE IF NOT EXISTS sede_descanso (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede         varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  matricula    varchar(16)  NOT NULL,
  turno        varchar(6),
  dias         smallint[]   NOT NULL,              -- ISODOW: 1 = lunes … 7 = domingo
  desde        date         NOT NULL,
  hasta        date,                                -- último día que vale; NULL = sigue
  creado_por   integer      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    timestamptz  NOT NULL DEFAULT now(),
  cerrado_por  integer      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrado_at   timestamptz,
  CONSTRAINT ck_sede_desc_turno CHECK (turno IS NULL OR turno IN ('dia', 'noche')),
  CONSTRAINT ck_sede_desc_rango CHECK (hasta IS NULL OR hasta >= desde),
  -- Sin días no hay descanso: «no libra» es no tener fila.
  CONSTRAINT ck_sede_desc_dias CHECK (f_sede_dias_validos(dias)),
  -- LA TÉCNICA DE db/203 (ex_vehdesc_solape), con la matrícula en vez del
  -- vehiculo_id: el común ocupa los dos turnos (1..2) y uno de turno solo el
  -- suyo (día = 1, noche = 2). Así un común no convive con uno de turno en las
  -- mismas fechas, y dos del mismo turno tampoco.
  CONSTRAINT ex_sede_desc_solape EXCLUDE USING gist (
    sede WITH =,
    matricula WITH =,
    int4range(CASE WHEN turno = 'noche' THEN 2 ELSE 1 END,
              CASE WHEN turno = 'dia'   THEN 1 ELSE 2 END, '[]') WITH &&,
    daterange(desde, hasta, '[]') WITH &&)
);
CREATE INDEX IF NOT EXISTS ix_sede_desc_mat ON sede_descanso (sede, matricula, desde);

COMMENT ON TABLE sede_descanso IS
  'El descanso de cada plaza de OTRAS sedes (Barcelona), con fecha. turno NULL = el bloque del coche (con CT); dia/noche = el del fijo de ese turno (sin CT). db/234';
COMMENT ON COLUMN sede_descanso.turno IS
  'NULL = el descanso común del coche (los dos fijos, lo cubre el CT): solo en coches con CT. dia/noche = solo el fijo de ese turno: coches sin CT.';
COMMENT ON COLUMN sede_descanso.dias IS 'Los días que libra, ISODOW (1 = lunes … 7 = domingo).';

-- ── 6 · Las asignaciones: fijo o correturnos ────────────────────────────────
-- sede_asignacion (db/181) era solo de fijos: «fija hasta cambiarla», sin
-- libranzas. Ahora una plaza puede ser de FIJO o de CT, y el CT lleva los días
-- de la semana que cubre en ESA matrícula (en Madrid, asignacion_dia).
ALTER TABLE sede_asignacion ADD COLUMN IF NOT EXISTS rol varchar(4) NOT NULL DEFAULT 'fijo';
ALTER TABLE sede_asignacion ADD COLUMN IF NOT EXISTS dias smallint[];

ALTER TABLE sede_asignacion DROP CONSTRAINT IF EXISTS ck_sede_asig_rol;
ALTER TABLE sede_asignacion ADD CONSTRAINT ck_sede_asig_rol CHECK (rol IN ('fijo', 'ct'));
-- Un fijo trabaja todos los días menos los que libra su plaza: no lleva días.
-- Un CT solo los que cubre, y al menos uno.
ALTER TABLE sede_asignacion DROP CONSTRAINT IF EXISTS ck_sede_asig_dias;
ALTER TABLE sede_asignacion ADD CONSTRAINT ck_sede_asig_dias CHECK (
  (rol = 'fijo' AND dias IS NULL) OR (rol = 'ct' AND f_sede_dias_validos(dias)));

-- Los índices únicos de db/181 cambian: un fijo y un CT por coche y turno, y
-- una plaza de FIJO por persona y turno. Un CT sí lleva varios coches del mismo
-- turno —los de su cuadrante, en días distintos—, así que a él no le alcanza.
DROP INDEX IF EXISTS uq_sede_asig_plaza;
DROP INDEX IF EXISTS uq_sede_asig_conductor;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_asig_plaza
  ON sede_asignacion (sede, matricula, turno, rol) WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_asig_conductor
  ON sede_asignacion (sede, driver_uuid, turno) WHERE hasta IS NULL AND rol = 'fijo';

COMMENT ON TABLE sede_asignacion IS
  'Planificador de OTRAS sedes (Barcelona): quién lleva cada matrícula de día o de noche, de fijo o de correturnos, hasta que se cambia. Los fijos libran el descanso de su plaza (sede_descanso); los CT, los días que no cubren (db/181, db/234).';
COMMENT ON COLUMN sede_asignacion.rol IS 'fijo = trabaja todos los días menos los que libra su plaza; ct = correturnos: solo los días de `dias`, y solo en un coche con CT (sede_coche_ct). db/234';
COMMENT ON COLUMN sede_asignacion.dias IS 'Solo CT: los días de la semana (ISODOW) que cubre en ESA matrícula. NULL en un fijo. db/234';

-- ── 7 · Nadie de CT en un coche sin CT ──────────────────────────────────────
-- La red debajo de la pantalla, como tg_asignacion_sin_ct de Madrid (db/203):
-- el servicio ya no lo ofrece, pero un CT que entra en una plaza tiene que
-- encontrarse el coche con CT el día que empieza, venga de donde venga (la
-- pantalla, el CT del cuadrante o un apaño a mano). Cerrar una asignación
-- (cambiar `hasta`) no lo dispara: al desactivar el CT se cierran los suyos.
CREATE OR REPLACE FUNCTION tg_sede_asignacion_ct() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rol <> 'ct' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sede_coche_ct x
     WHERE x.sede = NEW.sede AND x.matricula = NEW.matricula
       AND x.desde <= NEW.desde AND (x.hasta IS NULL OR x.hasta >= NEW.desde)) THEN
    RAISE EXCEPTION 'El % no tiene correturnos el %: actívalos antes de poner a alguien de CT',
      NEW.matricula, to_char(NEW.desde, 'DD/MM/YYYY')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_sede_asignacion_ct ON sede_asignacion;
CREATE TRIGGER tg_sede_asignacion_ct
  BEFORE INSERT OR UPDATE OF matricula, rol, desde ON sede_asignacion
  FOR EACH ROW EXECUTE FUNCTION tg_sede_asignacion_ct();

COMMIT;
