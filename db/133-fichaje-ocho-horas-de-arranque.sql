-- ============================================================
-- 133 — EL AJUSTE ÚNICO DE LAS 8 HORAS
-- ============================================================
-- El fichaje lleva desde el 13/09/2026 recogiendo datos SIN que nadie hubiera
-- confirmado que el sistema estaba en marcha: hay días de 1 h 57, jornadas que
-- nadie cerró y quien fichó la salida tres días después. No es que la gente
-- trabajara eso: es que el botón estaba ahí y las reglas no.
--
-- Este ajuste se hace UNA VEZ y por decisión expresa: el día que no llega a
-- ocho horas se completa hasta ocho. A partir de aquí manda lo que se pulse, y
-- lo que no cuadre se corrige a mano con su motivo.
--
-- ── SE AJUSTA EL DÍA, NO CADA FICHAJE ──────────────────────────────────────
-- Hay quien ficha dos veces el mismo día (se va a comer y vuelve, o el sistema
-- le cerró la jornada). Subir CADA fichaje a ocho horas le daría a esa persona
-- dieciséis horas ese día, que es más falso que lo que hay. Se mira el TOTAL
-- del día y se estira el ÚLTIMO fichaje hasta que el día sume ocho.
--
-- ── LO QUE NO SE TOCA ──────────────────────────────────────────────────────
-- · Los días que ya pasan de ocho horas. Ahí hay barbaridades —73 h, 56 h— y
--   son justo las que alguien tiene que MIRAR una a una. Nacen pendientes de
--   confirmar (db/132) y se corrigen desde la pantalla, con motivo.
-- · Las jornadas abiertas de HOY. Esa gente está trabajando ahora mismo.
--
-- ── Y SE CIERRAN LAS JORNADAS OLVIDADAS ────────────────────────────────────
-- Tres personas tienen una jornada abierta de días pasados. Eso no es solo un
-- dato feo: el índice único `uq_fichaje_abierto` deja UNA abierta por persona,
-- así que mientras esa siga ahí NO PUEDEN FICHAR. Se cierran a ocho horas de
-- su entrada, con el mismo criterio.
--
-- Todo lo que se toca queda marcado como corregido, con la hora original al
-- lado y el motivo escrito: es un registro legal y esto tiene que verse.

BEGIN;

-- ── 1 · Las jornadas olvidadas de días pasados ─────────────────────────────
UPDATE fichaje
   SET entrada_original = COALESCE(entrada_original, entrada),
       salida_original  = COALESCE(salida_original, salida),   -- NULL: no había
       salida           = entrada + interval '8 hours',
       corregido_at     = now(),
       corregido_motivo = 'Ajuste único de arranque: jornada que quedó sin cerrar, se cierra a 8 h'
 WHERE salida IS NULL
   AND dia < ((now() AT TIME ZONE 'Europe/Madrid')::date);

-- ── 2 · Los días que no llegan a ocho horas ────────────────────────────────
WITH resumen AS (
  SELECT usuario_id, dia,
         COALESCE(SUM(EXTRACT(EPOCH FROM (salida - entrada))) FILTER (WHERE salida IS NOT NULL), 0) AS seg,
         COUNT(*) FILTER (WHERE salida IS NULL) AS abiertos
    FROM fichaje
   GROUP BY usuario_id, dia
),
flacos AS (
  -- Solo días CERRADOS del todo: si queda algo abierto (los de hoy), ese día
  -- todavía no ha terminado y no hay nada que completar.
  SELECT usuario_id, dia, seg FROM resumen
   WHERE abiertos = 0 AND seg < 8 * 3600
),
ultimo AS (
  -- El fichaje que se estira es el ÚLTIMO del día: es el que se alargaría en la
  -- realidad, y así la hora de entrada de la mañana no se mueve.
  SELECT DISTINCT ON (f.usuario_id, f.dia) f.id, x.seg
    FROM fichaje f
    JOIN flacos x ON x.usuario_id = f.usuario_id AND x.dia = f.dia
   ORDER BY f.usuario_id, f.dia, f.entrada DESC, f.id DESC
)
UPDATE fichaje f
   SET entrada_original = COALESCE(f.entrada_original, f.entrada),
       salida_original  = COALESCE(f.salida_original, f.salida),
       salida           = f.salida + make_interval(secs => (8 * 3600 - u.seg)),
       corregido_at     = now(),
       corregido_motivo = 'Ajuste único de arranque: el día no llegaba a 8 h y se completa a 8 h'
  FROM ultimo u
 WHERE f.id = u.id;

COMMIT;
