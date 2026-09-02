-- ============================================================
-- FLOTA VIVA — que esta haciendo ahora mismo cada coche
-- ============================================================
-- Modulo NUEVO y aparte. No comparte una sola tabla con nada existente: sus
-- nombres empiezan todos por `fv_`, asi que puede convivir en la misma base que
-- cualquier otra cosa sin pisarla.
--
-- LA IDEA, en una frase: cada cinco minutos se mira que dice BOLT del conductor
-- y que dice Mapon del coche, y se guarda el TRAMO — no la foto.
--
-- Guardar fotos sueltas obligaria a recorrerlas todas para contestar "cuanto
-- lleva parado este coche". Guardando tramos, esa pregunta es leer una fila:
-- el tramo abierto ya trae desde cuando dura y cuantos km lleva. Y los km por
-- situacion salen gratis, que era lo dificil de la version anterior.

BEGIN;

-- ── QUE COCHES SE VIGILAN ─────────────────────────────────────────────────
-- La lista va en una TABLA, no en el codigo ni en una variable de entorno. Son
-- casi cien matriculas y cambian: se compra un coche, se vende otro. Aqui se
-- aniade o se quita con una linea de SQL, sin desplegar nada.
--
-- Lo que NO este en esta lista no se mira: ni se guarda, ni sale en el panel.
-- BOLT y Mapon devuelven la flota entera; el filtro es nuestro.
--
--   Quitar uno:  UPDATE fv_matricula SET activa = FALSE WHERE matricula = '0261MFX';
--   Aniadir uno: INSERT INTO fv_matricula (matricula) VALUES ('1234ABC');
CREATE TABLE IF NOT EXISTS fv_matricula (
  matricula  VARCHAR(15)  PRIMARY KEY,
  activa     BOOLEAN      NOT NULL DEFAULT TRUE,
  nota       VARCHAR(120),
  creado_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE fv_matricula IS
  'Los coches que se auditan. Lo que no este aqui con activa=TRUE, no se mira';

INSERT INTO fv_matricula (matricula) VALUES
  ('0261MFX'),
  ('0348MMZ'),
  ('0400MMZ'),
  ('0417MMZ'),
  ('0431MMZ'),
  ('0454MMZ'),
  ('0458MMZ'),
  ('0524MMZ'),
  ('0626MMZ'),
  ('0698MMZ'),
  ('0715MMZ'),
  ('0730MMZ'),
  ('0744MMZ'),
  ('0756MMZ'),
  ('0802MJY'),
  ('0835MMZ'),
  ('0870MMZ'),
  ('0970LJJ'),
  ('1067MJY'),
  ('1068MJY'),
  ('1073MJY'),
  ('1085MJY'),
  ('1090LVH'),
  ('1090MJY'),
  ('1096MJY'),
  ('1120KTK'),
  ('1194LCK'),
  ('1204MJY'),
  ('1205MJY'),
  ('1206MJY'),
  ('1208MJY'),
  ('1209MJY'),
  ('1210MJY'),
  ('1212MJY'),
  ('1223MJY'),
  ('1685KTC'),
  ('1888LTJ'),
  ('2264KZW'),
  ('2350LHP'),
  ('2514LNF'),
  ('2903LZH'),
  ('3019KSM'),
  ('3031LTV'),
  ('3110KSM'),
  ('3396NNM'),
  ('3414JXB'),
  ('3724KZS'),
  ('3784LFV'),
  ('3814KYG'),
  ('4799LBG'),
  ('4966LGP'),
  ('5369LJH'),
  ('5631LBW'),
  ('5646MDM'),
  ('5736LGK'),
  ('5775KKL'),
  ('5886LBZ'),
  ('5906LTT'),
  ('5909LBZ'),
  ('5912LBZ'),
  ('6287LBG'),
  ('6544LVX'),
  ('6621LTK'),
  ('6663LCY'),
  ('7222LVG'),
  ('7550KYT'),
  ('7603KZY'),
  ('7711KWV'),
  ('7759MCH'),
  ('8026LTT'),
  ('8083KXD'),
  ('8203LTR'),
  ('8386NNP'),
  ('8388NNP'),
  ('8475KWG'),
  ('8512LDS'),
  ('8563NNR'),
  ('8565NNR'),
  ('8930KVC'),
  ('8997LDK'),
  ('9001LWJ'),
  ('9037LJR'),
  ('9107LWS'),
  ('9212MCF'),
  ('9214LJR'),
  ('9511MMX'),
  ('9521MMX'),
  ('9523MMX'),
  ('9528MMX'),
  ('9533MMX'),
  ('9534MMX'),
  ('9535MMX'),
  ('9549LTP'),
  ('9549MMX'),
  ('9590MMX'),
  ('9753LNT'),
  ('9775LRH'),
  ('9985LBC')
ON CONFLICT (matricula) DO NOTHING;

-- ── Los coches, tal como los conoce BOLT ──────────────────────────────────
CREATE TABLE IF NOT EXISTS fv_vehiculo (
  uuid        VARCHAR(64) PRIMARY KEY,
  matricula   VARCHAR(15),
  flota_id    INTEGER,
  -- El id de Mapon se resuelve por matricula la primera vez y se guarda: cruzar
  -- 80 matriculas en cada vuelta es trabajo que no hace falta repetir.
  mapon_unit  BIGINT,
  visto_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fv_veh_mat ON fv_vehiculo (matricula);

-- ── Los conductores, con su telefono ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS fv_conductor (
  uuid      VARCHAR(64) PRIMARY KEY,
  nombre    VARCHAR(160),
  telefono  VARCHAR(24),
  flota_id  INTEGER,
  visto_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Que situaciones hay, y como se dicen ──────────────────────────────────
-- El vocabulario de BOLT es suyo y puede cambiar sin avisarnos. Se traduce aqui
-- y no en el codigo: si maniana aparece un estado nuevo, se aniade una fila.
CREATE TABLE IF NOT EXISTS fv_cat_situacion (
  codigo     VARCHAR(20) PRIMARY KEY,
  etiqueta   VARCHAR(40) NOT NULL,
  conectado  BOOLEAN     NOT NULL,
  orden      SMALLINT    NOT NULL DEFAULT 0,
  color      VARCHAR(12)
);

INSERT INTO fv_cat_situacion (codigo, etiqueta, conectado, orden, color) VALUES
  ('viaje',        'En viaje',      TRUE,  1, 'green'),
  ('espera',       'En espera',     TRUE,  2, 'gold'),
  ('descanso',     'En descanso',   TRUE,  3, 'warn'),
  ('desconectado', 'Desconectado',  FALSE, 4, 'muted'),
  -- Para un estado de BOLT que no sepamos traducir. Sale tal cual en el panel,
  -- que es la unica forma de enterarse de que existe.
  ('otro',         'Sin clasificar', TRUE, 9, 'red')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, conectado = EXCLUDED.conectado,
  orden = EXCLUDED.orden, color = EXCLUDED.color;

-- Como llama BOLT a cada una. Varias suyas pueden caer en la misma nuestra.
CREATE TABLE IF NOT EXISTS fv_estado_bolt (
  estado    VARCHAR(40) PRIMARY KEY,
  situacion VARCHAR(20) NOT NULL REFERENCES fv_cat_situacion(codigo),
  visto_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fv_estado_bolt (estado, situacion) VALUES
  ('has_order',       'viaje'),
  ('riding',          'viaje'),
  ('on_order',        'viaje'),
  ('waiting_orders',  'espera'),
  ('waiting',         'espera'),
  ('active',          'espera'),
  ('busy',            'descanso'),
  ('inactive',        'desconectado'),
  ('offline',         'desconectado')
ON CONFLICT (estado) DO NOTHING;

-- ── EL TRAMO: lo que de verdad se guarda ──────────────────────────────────
-- Una fila por coche y racha. Mientras la situacion no cambia, la misma fila se
-- va estirando: `hasta` avanza y el odometro final sube. Cuando cambia, se
-- cierra y se abre otra.
--
-- De aqui salen las tres listas de la pantalla sin recorrer historico:
--   · conectados       → tramo abierto con situacion conectada
--   · desconectados    → tramo abierto con situacion desconectada, y `desde`
--                        dice desde cuando
--   · quien lo llevaba → el ultimo tramo cerrado que tuviera conductor
CREATE TABLE IF NOT EXISTS fv_tramo (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_uuid     VARCHAR(64) NOT NULL REFERENCES fv_vehiculo(uuid) ON DELETE CASCADE,
  conductor_uuid    VARCHAR(64) REFERENCES fv_conductor(uuid) ON DELETE SET NULL,
  situacion         VARCHAR(20) NOT NULL REFERENCES fv_cat_situacion(codigo),
  -- El estado crudo que mando BOLT. Se guarda aunque sepamos traducirlo: cuando
  -- algo no cuadre, la pregunta sera "¿que dijo BOLT exactamente?".
  estado_bolt       VARCHAR(40),
  desde             TIMESTAMPTZ NOT NULL,
  hasta             TIMESTAMPTZ,
  -- Odometro de Mapon en metros al empezar y en la ultima vuelta. La resta son
  -- los km de ese tramo, que es lo que contesta "cuanto ha rodado en descanso".
  odometro_ini_m    BIGINT,
  odometro_fin_m    BIGINT,
  vueltas           INTEGER     NOT NULL DEFAULT 1,
  creado_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo tramo abierto por coche. Lo impide la base, no la aplicacion.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fv_tramo_abierto
  ON fv_tramo (vehiculo_uuid) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS idx_fv_tramo_veh ON fv_tramo (vehiculo_uuid, desde DESC);
CREATE INDEX IF NOT EXISTS idx_fv_tramo_sit ON fv_tramo (situacion, hasta);

-- ── Las vueltas, para saber si esto esta vivo ─────────────────────────────
CREATE TABLE IF NOT EXISTS fv_vuelta (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  arrancada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminada_at  TIMESTAMPTZ,
  vehiculos     INTEGER,
  conectados    INTEGER,
  cambios       INTEGER,
  ms            INTEGER,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_fv_vuelta_fecha ON fv_vuelta (arrancada_at DESC);

-- ── Los km, contados vuelta a vuelta y no restando odometros ──────────────
-- El odometro NO sirve como cuentakilometros de un tramo. Un equipo que estuvo
-- sin cobertura se pone al dia de golpe, y ese salto son kilometros de ANTES: al
-- restar el odometro final menos el inicial, todos caian en el tramo abierto y
-- salian 19 km en un coche que llevaba tres minutos parado.
--
-- Ahora se suma el trocito de cada vuelta, y solo si es CREIBLE para el tiempo
-- que ha pasado segun el reloj del propio equipo. Lo que no lo es, no se cuenta
-- y se deja dicho con `km_dudoso` en vez de callarselo.
-- Hasta que apunte de BOLT hemos reproducido ya. Sin esto, cada vuelta volveria
-- a procesar las dos horas de ventana y duplicaria tramos.
ALTER TABLE fv_vehiculo ADD COLUMN IF NOT EXISTS ultimo_log_at TIMESTAMPTZ;

ALTER TABLE fv_tramo ADD COLUMN IF NOT EXISTS km_m             BIGINT NOT NULL DEFAULT 0;
ALTER TABLE fv_tramo ADD COLUMN IF NOT EXISTS odometro_visto_m BIGINT;
ALTER TABLE fv_tramo ADD COLUMN IF NOT EXISTS senal_at         TIMESTAMPTZ;
ALTER TABLE fv_tramo ADD COLUMN IF NOT EXISTS km_dudoso        BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN fv_tramo.km_m IS
  'Metros acumulados vuelta a vuelta, descartando los saltos imposibles. NO es odometro_fin - odometro_ini';
COMMENT ON COLUMN fv_tramo.senal_at IS
  'Cuando hablo el equipo por ultima vez, en su reloj. Es la base para saber si un salto de odometro es creible';

-- ── Lo que pinta la pantalla ──────────────────────────────────────────────
-- Se rehace entera: CREATE OR REPLACE no deja meter una columna en medio,
-- solo aniadir al final.
DROP VIEW IF EXISTS fv_ahora;

CREATE VIEW fv_ahora AS
SELECT v.uuid                                   AS vehiculo_uuid,
       v.matricula,
       v.mapon_unit,
       t.id                                     AS tramo_id,
       t.situacion,
       s.etiqueta                               AS situacion_etiqueta,
       s.conectado,
       s.color,
       s.orden                                  AS situacion_orden,
       t.estado_bolt,
       t.desde,
       -- Cuanto lleva asi. Es LA columna del panel.
       EXTRACT(EPOCH FROM (now() - t.desde))::bigint  AS segundos,
       t.conductor_uuid,
       c.nombre                                 AS conductor,
       c.telefono,
       -- Km de este tramo. En descanso o desconectado, son los km que no
       -- deberian existir.
       round(t.km_m / 1000.0, 1)                AS km,
       -- Los mismos metros en crudo. El panel enseña los km del tramo entero,
       -- pero la auditoria necesita restar los que ya estaban al abrirse la
       -- franja, y para eso el redondeo no vale.
       t.km_m,
       t.km_dudoso,
       -- CERO KILOMETROS Y "NO LO SABEMOS" NO SON LO MISMO.
       --
       -- Si Mapon no ha dado ni una lectura en este tramo, `km` sale 0 y parece
       -- que el coche no se ha movido, cuando lo que pasa es que no tenemos ni
       -- idea. En un coche desconectado esa diferencia es justo la pregunta.
       (t.odometro_visto_m IS NULL)             AS sin_gps,
       -- Cuando fue la ultima senal de este tramo. Un "0 km" de un equipo que
       -- lleva tres horas mudo no es un cero, es un silencio.
       t.senal_at                               AS gps_at,
       t.vueltas,
       -- Quien lo llevaba la ultima vez, para los que estan desconectados.
       ult.conductor_uuid                       AS ultimo_conductor_uuid,
       ultc.nombre                              AS ultimo_conductor,
       ultc.telefono                            AS ultimo_telefono,
       ult.hasta                                AS ultimo_uso_at
  FROM fv_vehiculo v
  -- Solo los vigilados. Desactivar una matricula la saca del panel al momento,
  -- sin borrar su historial.
  JOIN fv_matricula m           ON m.matricula = v.matricula AND m.activa
  LEFT JOIN fv_tramo t          ON t.vehiculo_uuid = v.uuid AND t.hasta IS NULL
  LEFT JOIN fv_cat_situacion s  ON s.codigo = t.situacion
  LEFT JOIN fv_conductor c      ON c.uuid = t.conductor_uuid
  LEFT JOIN LATERAL (
    SELECT x.conductor_uuid, x.hasta
      FROM fv_tramo x
     WHERE x.vehiculo_uuid = v.uuid
       AND x.conductor_uuid IS NOT NULL
       AND x.hasta IS NOT NULL
     ORDER BY x.hasta DESC LIMIT 1) ult ON TRUE
  LEFT JOIN fv_conductor ultc   ON ultc.uuid = ult.conductor_uuid;

-- ============================================================
-- LAS FRANJAS CRITICAS Y SUS INCIDENCIAS
-- ============================================================
-- Hay dos tramos del dia en los que un coche DEBERIA estar trabajando. Si en su
-- franja deja de hacerlo, alguien tiene que llamar al conductor y dejar escrito
-- que paso; y al cerrar la franja, el parte de lo que hubo.
--
-- Entre franja y franja hay relevo —de 15:30 a 18:30 y de 03:30 a 06:30— y ahi
-- no se avisa de nada: se mira a mano.
--
-- Las horas van en una TABLA. Cambiar un turno es entonces un UPDATE, no un
-- despliegue, y es de las cosas que cambian.

CREATE TABLE IF NOT EXISTS fv_franja (
  codigo     VARCHAR(12) PRIMARY KEY,
  etiqueta   VARCHAR(40) NOT NULL,
  -- Minutos desde medianoche. Si `fin` es menor que `inicio`, la franja cruza
  -- las doce y termina al dia siguiente — que es lo que hace la de noche.
  inicio_min SMALLINT    NOT NULL,
  fin_min    SMALLINT    NOT NULL,
  activa     BOOLEAN     NOT NULL DEFAULT TRUE,
  orden      SMALLINT    NOT NULL DEFAULT 0,
  CONSTRAINT ck_franja_min CHECK (inicio_min BETWEEN 0 AND 1439 AND fin_min BETWEEN 0 AND 1439)
);

COMMENT ON TABLE fv_franja IS
  'Las horas en que se vigila. Cambiar un turno es un UPDATE, no un despliegue';

-- Estas horas son el ARRANQUE, no la verdad.
--
-- El sitio donde se decide a que hora empieza un turno es esta tabla, y quien lo
-- decide es quien opera, con un UPDATE. Por eso el conflicto NO pisa `inicio_min`
-- ni `fin_min`: si los pisara, cada despliegue devolveria las horas a lo que
-- diga este fichero y el cambio de ayer se perderia sin que nadie se entere.
INSERT INTO fv_franja (codigo, etiqueta, inicio_min, fin_min, orden) VALUES
  ('dia',   'Turno de dia',   390,  930, 1),   -- 06:30 -> 15:30
  ('noche', 'Turno de noche', 1110, 210, 2)    -- 18:30 -> 03:30 (cruza medianoche)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, orden = EXCLUDED.orden;

-- ── El corte: donde estaba cada coche cuando abrio la franja ──────────────
-- LA AUDITORIA EMPIEZA A LAS 06:30, Y ESO INCLUYE EL CONTADOR.
--
-- Un coche puede llegar a las 06:30 llevando ya cuatro horas desconectado y
-- treinta kilometros encima. Esos kilometros son de la madrugada — del horario
-- de transicion, que se mira a mano— y no son noticia de esta franja. Sin este
-- corte, a las 06:30 clavadas saltaba una alerta de "29,9 km rodando
-- desconectado" por algo que paso a las tres de la maniana.
--
-- Se guarda una fila por coche, franja y dia con los metros que el tramo YA
-- traia, y a partir de ahi solo se cuenta la diferencia. Si el tramo cambia
-- dentro de la franja, deja de casar por `tramo_id` y el nuevo cuenta entero:
-- empezo dentro, luego es todo suyo.
--
-- El corte se toma en la primera vuelta que cae dentro de la franja, no en el
-- minuto exacto de apertura: se pierden como mucho los metros de esos cinco
-- minutos, y a cambio no hace falta un proceso que despierte a las 06:30.
CREATE TABLE IF NOT EXISTS fv_corte (
  vehiculo_uuid VARCHAR(64) NOT NULL REFERENCES fv_vehiculo(uuid) ON DELETE CASCADE,
  franja        VARCHAR(12) NOT NULL REFERENCES fv_franja(codigo),
  dia_operativo DATE        NOT NULL,
  -- Que tramo estaba abierto. Si al mirar hay otro, este corte ya no aplica.
  tramo_id      BIGINT,
  km_m          BIGINT      NOT NULL DEFAULT 0,
  desde         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehiculo_uuid, franja, dia_operativo)
);

COMMENT ON TABLE fv_corte IS
  'Lo que cada coche ya traia al abrirse su franja. La auditoria cuenta desde aqui';

-- ── Que se considera una incidencia ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS fv_cat_incidencia (
  codigo    VARCHAR(24) PRIMARY KEY,
  etiqueta  VARCHAR(60) NOT NULL,
  detalle   VARCHAR(200),
  gravedad  SMALLINT    NOT NULL DEFAULT 1,
  activa    BOOLEAN     NOT NULL DEFAULT TRUE,
  orden     SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO fv_cat_incidencia (codigo, etiqueta, detalle, gravedad, orden) VALUES
  ('desconectado', 'Se ha desconectado',
   'Estaba trabajando en su franja y se cayo de BOLT', 3, 1),
  ('rueda_caido',  'Rueda estando desconectado',
   'Suma kilometros sin estar en la plataforma', 4, 2),
  -- SALE EN CUANTO SE PONE EN DESCANSO, no cuando lleva mucho.
  --
  -- Antes esperaba a los 45 minutos, y eso dejaba fuera lo que mas se queria
  -- ver: el que se pone en descanso veinte minutos y en esos veinte minutos
  -- hace dieciocho kilometros. Ahora salen todos y se despachan de dos maneras,
  -- llamando o ignorando; el detalle dice cuanto lleva para poder distinguir de
  -- un vistazo el que acaba de parar del que lleva hora y media.
  ('descanso',     'Se ha puesto en descanso',
   'Conectado pero sin coger pedidos. El detalle dice cuanto lleva', 2, 3),
  -- EL TIEMPO Y LOS KM SE VIGILAN POR SEPARADO, y este es el motivo.
  --
  -- Un coche puede llevar veinte minutos en descanso —nada— y haber hecho
  -- dieciocho kilometros en esos veinte minutos. Eso no es descansar: es rodar
  -- fuera de la plataforma con el coche de la empresa, y es mas grave que estar
  -- parado dos horas. Con un solo aviso por tiempo, ese coche no salia.
  ('rueda_descanso', 'Rueda estando en descanso',
   'Suma kilometros mientras dice estar descansando', 4, 4),
  ('no_aparece',   'No ha aparecido en su franja',
   'Suele trabajar a estas horas y hoy no se ha conectado', 2, 5)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, detalle = EXCLUDED.detalle,
  gravedad = EXCLUDED.gravedad, orden = EXCLUDED.orden;

-- SE HA DESCONECTADO SIN CUMPLIR SUS HORAS (Fase 2) — NACE APAGADO A PROPOSITO.
--
-- Es mas fino que 'desconectado': no es que se haya caido, es que se ha ido antes
-- de completar su jornada (conectado menos del umbral dentro de la franja). Toca
-- el cron de produccion, asi que se entrega DESACTIVADO y no dispara nada hasta
-- que Trafico ajuste el umbral (variables FLOTA_VIVA_JORNADA_MIN / _RELEVO_MIN) y
-- compruebe que no salta de mas. Se enciende con un UPDATE, sin desplegar:
--   UPDATE fv_cat_incidencia SET activa = TRUE WHERE codigo = 'desc_sin_horas';
--
-- Va en su propio INSERT porque el de arriba no trae la columna `activa`, y el
-- ON CONFLICT de aqui NO la toca: una vez encendido, sigue encendido tras cada
-- despliegue (manda lo que diga la base, no este fichero).
INSERT INTO fv_cat_incidencia (codigo, etiqueta, detalle, gravedad, activa, orden) VALUES
  ('desc_sin_horas', 'Se ha desconectado sin cumplir sus horas',
   'Se fue antes de completar su jornada. El detalle dice cuanto llevaba', 4, FALSE, 1)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, detalle = EXCLUDED.detalle,
  gravedad = EXCLUDED.gravedad, orden = EXCLUDED.orden;

-- ── La incidencia ─────────────────────────────────────────────────────────
-- Una por coche, franja y dia: si el mismo coche se cae tres veces en la misma
-- franja no son tres llamadas, es una conversacion. Se reabre y se suma.
CREATE TABLE IF NOT EXISTS fv_incidencia (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_uuid  VARCHAR(64) NOT NULL REFERENCES fv_vehiculo(uuid) ON DELETE CASCADE,
  tipo           VARCHAR(24) NOT NULL REFERENCES fv_cat_incidencia(codigo),
  franja         VARCHAR(12) NOT NULL REFERENCES fv_franja(codigo),
  -- El dia al que pertenece la franja. La de noche del 25 acaba el 26 a las
  -- 03:30, y sigue siendo la del 25.
  dia_operativo  DATE        NOT NULL,
  conductor_uuid VARCHAR(64) REFERENCES fv_conductor(uuid) ON DELETE SET NULL,
  abierta_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cuando dejo de pasar. Nulo = sigue pasando ahora mismo.
  resuelta_at    TIMESTAMPTZ,
  veces          INTEGER     NOT NULL DEFAULT 1,
  detalle        VARCHAR(300),
  -- La llamada. Es la razon de ser del modulo: detectar sin recoger respuesta
  -- no sirve de nada.
  justificada_at TIMESTAMPTZ,
  justificada_por VARCHAR(120),
  motivo         TEXT,
  -- La llamada que se creo en el Call Center, si se creo. Enlaza los dos libros
  -- sin duplicar el dato: alli estan sus KPIs, aqui el parte del cierre.
  llamada_clave  VARCHAR(40),
  CONSTRAINT uq_fv_inc UNIQUE (vehiculo_uuid, tipo, franja, dia_operativo)
);

-- ── El puente con el Call Center ──────────────────────────────────────────
-- Justificar una incidencia ES una llamada, y el Call Center ya tiene el
-- vocabulario para clasificarla. Se guarda a que clasificacion suya corresponde
-- cada tipo nuestro, como DATO: si maniana cambian su catalogo, es un UPDATE.
--
-- Vacio = esa incidencia se justifica solo aqui, sin crear llamada.
-- La llamada que se creo en el Call Center, si se creo. Enlaza los dos libros
-- sin duplicar el dato.
--
-- VA EN UN ALTER Y NO DENTRO DEL CREATE TABLE: la tabla ya existia de un
-- arranque anterior, y CREATE TABLE IF NOT EXISTS no aniade columnas a una tabla
-- que ya esta. La declaracion de mas arriba no llego a aplicarse nunca.
ALTER TABLE fv_incidencia ADD COLUMN IF NOT EXISTS llamada_clave VARCHAR(40);

-- ── QUE SE HIZO CON ELLA: llamar o ignorar ────────────────────────────────
-- CERRAR UNA INCIDENCIA NO ES SIEMPRE LLAMAR.
--
-- La mitad de lo que salta no necesita telefono: es el descanso de la comida,
-- es un coche en el taller, es algo que ya se sabia. Sin una forma de decir "lo
-- he mirado y no hacia falta", esas se quedan en rojo para siempre y el parte
-- del cierre las cuenta como sin revisar — que es mentira, alguien las miro.
--
-- Y AL IGNORAR SE PIDE MOTIVO IGUAL QUE AL LLAMAR. Un boton que quita cosas de
-- la pantalla sin dejar rastro es un boton para vaciar la pantalla, no para
-- auditarla. Aqui las dos gestiones dejan quien, cuando y por que.
--
-- Va en una tabla y no en un booleano porque maniana pueden ser tres: llamada,
-- ignorada, escalada. Aniadir una es una fila.
CREATE TABLE IF NOT EXISTS fv_cat_gestion (
  codigo       VARCHAR(16) PRIMARY KEY,
  etiqueta     VARCHAR(40) NOT NULL,
  detalle      VARCHAR(200),
  -- Si se puede cerrar sin escribir nada. Por ahora ninguna: las dos exigen.
  exige_motivo BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Si ademas crea una llamada en el Call Center. Ignorar no la crea: no ha
  -- habido llamada, y meterla les ensuciaria los KPIs y la reincidencia.
  crea_llamada BOOLEAN     NOT NULL DEFAULT FALSE,
  color        VARCHAR(12),
  activa       BOOLEAN     NOT NULL DEFAULT TRUE,
  orden        SMALLINT    NOT NULL DEFAULT 0
);

INSERT INTO fv_cat_gestion (codigo, etiqueta, detalle, exige_motivo, crea_llamada, color, orden) VALUES
  ('llamada',  'Ya he llamado',
   'Se ha hablado con el conductor. Queda como llamada en el Call Center', TRUE, TRUE, 'green', 1),
  ('ignorada', 'Ignorar',
   'Se ha mirado y no hacia falta llamar. Queda con nombre y motivo, sin llamada', TRUE, FALSE, 'muted', 2)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, detalle = EXCLUDED.detalle,
  exige_motivo = EXCLUDED.exige_motivo, crea_llamada = EXCLUDED.crea_llamada,
  color = EXCLUDED.color, orden = EXCLUDED.orden;

ALTER TABLE fv_incidencia ADD COLUMN IF NOT EXISTS gestion VARCHAR(16)
  REFERENCES fv_cat_gestion(codigo);

-- Lo que ya estaba cerrado se cerro llamando: entonces no habia otra forma.
UPDATE fv_incidencia SET gestion = 'llamada'
 WHERE justificada_at IS NOT NULL AND gestion IS NULL;

ALTER TABLE fv_cat_incidencia ADD COLUMN IF NOT EXISTS cc_cluster    VARCHAR(40);
ALTER TABLE fv_cat_incidencia ADD COLUMN IF NOT EXISTS cc_subcluster VARCHAR(40);
ALTER TABLE fv_cat_incidencia ADD COLUMN IF NOT EXISTS cc_motivo     VARCHAR(120);

-- OJO CON LAS TILDES: el catalogo del Call Center casa por texto exacto, asi que
-- 'Conexion' no encuentra 'Conexión' y la llamada no se crearia. Lo comprueba
-- `scripts/probar-flota-viva.js` contra el catalogo de verdad.
UPDATE fv_cat_incidencia SET cc_cluster = v.cl, cc_subcluster = v.sub, cc_motivo = v.mot
  FROM (VALUES
    -- Exacto: su catalogo ya tenia este caso.
    ('no_aparece',   'Asistencia', 'Conexión',         'No se ha conectado a su puesto'),
    ('desconectado', 'Asistencia', 'Conexión',         'No se ha conectado a su puesto'),
    -- Un coche que rueda apagado es lo que ellos llaman uso personal.
    ('rueda_caido',  'Conducta',   'Uso del vehículo', 'Uso personal del coche'),
    -- Rodar en descanso es el mismo uso personal, solo que sin apagar BOLT.
    ('rueda_descanso', 'Conducta', 'Uso del vehículo', 'Uso personal del coche'),
    -- El mas flojo de los cuatro: "espera extendida" no es exactamente estar en
    -- descanso. Se deja apuntado para que se cambie si no encaja.
    ('descanso',     'Operativa',  'Servicio',         'Espera extendida')
  ) AS v(cod, cl, sub, mot)
 WHERE fv_cat_incidencia.codigo = v.cod;

CREATE INDEX IF NOT EXISTS idx_fv_inc_dia ON fv_incidencia (dia_operativo DESC, franja);
CREATE INDEX IF NOT EXISTS idx_fv_inc_abierta ON fv_incidencia (justificada_at) WHERE justificada_at IS NULL;

COMMENT ON TABLE fv_incidencia IS
  'Lo que hay que llamar y justificar. Una por coche, franja y dia: tres caidas seguidas son una conversacion, no tres';

-- ── EL SEGUIMIENTO: "he llamado" sin cerrar ───────────────────────────────
-- JUSTIFICAR NO ES LO MISMO QUE LLAMAR UNA VEZ.
--
-- En el panel en vivo se llama, no cogen, se vuelve a llamar. Cada intento deja
-- rastro aqui —quien y cuando— pero NO cierra la incidencia: sigue abierta hasta
-- que alguien la justifica. Por eso es una tabla aparte y no toca justificada_at:
-- puede haber muchos seguimientos y una sola justificacion.
--
-- El boton "He llamado" de En directo escribe aqui; "Justificar" escribe en
-- fv_incidencia. Son dos gestos distintos y se guardan por separado: el primero
-- es un rastro, el segundo cierra.
CREATE TABLE IF NOT EXISTS fv_seguimiento (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incidencia_id BIGINT      NOT NULL REFERENCES fv_incidencia(id) ON DELETE CASCADE,
  quien         VARCHAR(120),
  nota          TEXT,
  creada_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fv_seg_incidencia
  ON fv_seguimiento (incidencia_id, creada_at DESC);

COMMENT ON TABLE fv_seguimiento IS
  'Cada "He llamado" de En directo: rastro de intentos de una incidencia, sin cerrarla';

COMMIT;
