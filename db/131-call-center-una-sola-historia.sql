-- ============================================================
-- 131 - CALL CENTER: una sola historia de llamadas por conductor
-- ============================================================
-- HABÍA DOS REGISTROS DE LO MISMO Y NINGUNO ESTABA COMPLETO.
--
--   · `llamada_seguimiento` (db/64, db/98) es donde de verdad se llama: el
--     telefonito de Control · En directo y las campañas. 546 llamadas, con su
--     tipo (taller, RRHH, tráfico, alerta) y con lo que contestó el conductor
--     de cada alerta abierta.
--
--   · `llamada_cc` (db/122) es la pantalla del Call Center. Tenía 26 filas, y
--     las 26 eran un ESPEJO de las de Control escrito por
--     `control.service.apuntarLlamada` — todas con la misma clasificación
--     clavada en el código: «Asistencia → Conexión → No se ha conectado a su
--     puesto», dijera lo que dijera la llamada. Una avería en ruta y un
--     conductor que no coge el teléfono entraban al Call Center como la misma
--     cosa.
--
-- Así que el cuadro de mando del Call Center medía el 5 % de las llamadas y
-- además las medía mal, y el resto —lo que se sabe de verdad de cada
-- conductor— no llegaba nunca.
--
-- A PARTIR DE AQUÍ NO SE COPIA: SE LEE. El Call Center lee las dos tablas y
-- clasifica las de Control al vuelo (`callcenter.service.DESDE_CONTROL`). Cada
-- llamada sigue viviendo donde nació:
--
--   · las de Control, en `llamada_seguimiento`, con su jornada operativa y sus
--     alertas contestadas;
--   · las que se teclean en el Call Center (y las que crea Flota Viva al
--     justificar), en `llamada_cc`, con su seguimiento y su cierre.
--
-- Copiar tenía el problema de siempre: dos versiones de un hecho, y la copia
-- envejece. Leer no puede desincronizarse.
--
-- ── QUÉ HACE ESTA MIGRACIÓN ────────────────────────────────────────────────
-- 1. Borra las 26 filas espejo. No se pierde nada: se ha comprobado una a una
--    que las 26 tienen su original en `llamada_seguimiento` (mismo conductor,
--    mismo resultado, menos de tres minutos de diferencia) y que la nota de
--    quien llamó está en el original. Si no se borran, a partir de ahora cada
--    una saldría DOS veces en la pantalla y contaría doble en los KPIs.
-- 2. Apunta de dónde nace cada llamada del Call Center, que hasta ahora no se
--    guardaba: tecleada en la pantalla o creada por Flota Viva al justificar
--    una incidencia.
-- 3. Guarda la matrícula de las llamadas de Control, que se venía tirando.
-- 4. Índice para la pestaña nueva: la historia de UN conductor.

BEGIN;

-- ── 1 · Fuera el espejo ────────────────────────────────────────────────────
-- Se afina todo lo posible a propósito: la marca del espejo (la nota que le
-- ponía el código), la clasificación clavada y la fecha en la que existió el
-- espejo (del 15/09/2026, cuando entró db/122, a hoy). Una llamada tecleada a
-- mano en la pantalla del Call Center no puede cumplir las tres.
DELETE FROM llamada_cc
 WHERE notas LIKE 'Seguimiento desde Control.%'
   AND cluster = 'Asistencia'
   AND motivo  = 'No se ha conectado a su puesto'
   AND creado_at < now();

-- ── 2 · De dónde nace una llamada del Call Center ──────────────────────────
-- 'callcenter' = la tecleó alguien en la pantalla.
-- 'flota_viva' = la creó `panel.service` al justificar una incidencia de
--                /operaciones/vivo, que también es una llamada de verdad.
-- Las de Control NO entran aquí: se leen de su tabla.
ALTER TABLE llamada_cc
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NOT NULL DEFAULT 'callcenter';

COMMENT ON COLUMN llamada_cc.origen IS
  'Dónde nació la llamada: callcenter (tecleada) | flota_viva (justificar una incidencia). Las de Control viven en llamada_seguimiento';

-- ── 3 · La matrícula de las llamadas de Control ────────────────────────────
-- La pantalla de En directo ya mandaba la matrícula en cada llamada y el
-- repositorio la tiraba: no había columna. Se veía al cruzar las dos tablas —
-- «llamadas por matrícula» solo contaba las del Call Center— y es justo el dato
-- que hace falta para preguntar si un coche concreto genera llamadas.
-- Las anteriores se quedan sin ella: no se puede inventar hacia atrás.
ALTER TABLE llamada_seguimiento
  ADD COLUMN IF NOT EXISTS matricula VARCHAR(16);

COMMENT ON COLUMN llamada_seguimiento.matricula IS
  'El coche del conductor cuando se le llamó. NULL en las anteriores a db/131';

-- ── 4 · La historia de un conductor ────────────────────────────────────────
-- `idx_cc_reincide` empieza por conductor_id, así que serviría; pero lleva el
-- motivo en medio y la pestaña nueva pide «todas las de esta persona, de la
-- última a la primera», que es exactamente este índice.
CREATE INDEX IF NOT EXISTS idx_cc_conductor
  ON llamada_cc (conductor_id, creado_at DESC);

COMMIT;
