-- ============================================================
-- TELECAB — SEMILLA DE PLANIFICACIÓN
-- ============================================================
-- Turnos, cortes, slots, marcas y el calendario del día operativo.
-- Idempotente: se puede ejecutar las veces que haga falta.

BEGIN;

-- ── Turnos ──────────────────────────────────────────────────────────────────
INSERT INTO turno (codigo, etiqueta) VALUES
  ('dia',          'Día'),
  ('noche',        'Noche'),
  ('todoturno',    'TodoTurno'),
  ('desconocido',  'Sin turno')
ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta;

-- ── Cortes del día operativo ────────────────────────────────────────────────
-- De CORTE_TURNO {dia:0, noche:12, todoturno:2} y CORTE_DEFECTO=5, en
-- services/boltHorasCore.js. Vigencia abierta desde 2022: es cuando arranca el
-- histórico más antiguo (la primera alta de la plantilla es de abril de 2022).
--
-- El de NOCHE es 12 a propósito: así el turno de 22:00 a 06:00 cae ENTERO en un
-- solo día operativo en vez de partirse por la medianoche.
INSERT INTO turno_version (turno_id, hora_corte_local, desde)
SELECT t.id, v.corte, DATE '2022-01-01'
FROM (VALUES ('dia',0), ('noche',12), ('todoturno',2), ('desconocido',5)) AS v(codigo, corte)
JOIN turno t ON t.codigo = v.codigo
WHERE NOT EXISTS (SELECT 1 FROM turno_version tv WHERE tv.turno_id = t.id);

-- ── Las 6 plazas de cada coche ──────────────────────────────────────────────
-- El orden es el mismo que trae el planificador: Día, Noche, CT1 Día,
-- CT1 Noche, CT2 Día, CT2 Noche.
INSERT INTO cat_slot (slot, turno_id, rol, orden_ct)
SELECT v.slot, t.id, v.rol, v.orden
FROM (VALUES
  (0, 'dia',   'FIJO', NULL::smallint),
  (1, 'noche', 'FIJO', NULL),
  (2, 'dia',   'CT',   1),
  (3, 'noche', 'CT',   1),
  (4, 'dia',   'CT',   2),
  (5, 'noche', 'CT',   2)
) AS v(slot, codigo, rol, orden)
JOIN turno t ON t.codigo = v.codigo
ON CONFLICT (slot) DO NOTHING;

-- ── Marcas de la bitácora ───────────────────────────────────────────────────
-- Las letras que hoy se pintan en VISTA_FINAL.
INSERT INTO cat_marca_dia (codigo, etiqueta, es_ausencia, cuenta_como_trabajado, color_hex) VALUES
  ('L', 'Libranza',        FALSE, FALSE, '#94A3B8'),
  ('V', 'Vacaciones',      TRUE,  FALSE, '#38BDF8'),
  ('B', 'Baja médica',     TRUE,  FALSE, '#F87171'),
  ('P', 'Permiso',         TRUE,  FALSE, '#FBBF24'),
  ('J', 'Justificado',     FALSE, TRUE,  '#4ADE80')
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, es_ausencia = EXCLUDED.es_ausencia,
      cuenta_como_trabajado = EXCLUDED.cuenta_como_trabajado, color_hex = EXCLUDED.color_hex;

-- ── El calendario del día operativo ─────────────────────────────────────────
-- Para cada versión de turno y cada día, el instante UTC en que empieza y acaba
-- su día operativo. `AT TIME ZONE 'Europe/Madrid'` interpreta la hora local y
-- devuelve el instante absoluto, así que los dos días del año en que cambia la
-- hora quedan resueltos sin ningún caso especial: uno dura 23 h y otro 25.
--
-- Se genera de 2022 a 2028. Ampliarlo es volver a ejecutar esto con otras fechas.
INSERT INTO turno_dia_operativo (turno_version_id, dia, inicio_utc, fin_utc)
-- generate_series con intervalo devuelve TIMESTAMP, no DATE: hay que convertirlo
-- o la suma de dias falla.
SELECT tv.id, d.dia::date,
       ((d.dia::date + make_interval(hours => tv.hora_corte_local)) AT TIME ZONE 'Europe/Madrid'),
       ((d.dia::date + 1 + make_interval(hours => tv.hora_corte_local)) AT TIME ZONE 'Europe/Madrid')
FROM turno_version tv
CROSS JOIN generate_series(DATE '2022-01-01', DATE '2028-12-31', INTERVAL '1 day') AS d(dia)
WHERE d.dia::date >= tv.desde AND (tv.hasta IS NULL OR d.dia::date <= tv.hasta)
ON CONFLICT (turno_version_id, dia) DO NOTHING;

COMMIT;

-- Comprobación
SELECT 'turnos' t, count(*) FROM turno
UNION ALL SELECT 'versiones', count(*) FROM turno_version
UNION ALL SELECT 'slots', count(*) FROM cat_slot
UNION ALL SELECT 'marcas', count(*) FROM cat_marca_dia
UNION ALL SELECT 'dias operativos', count(*) FROM turno_dia_operativo;
