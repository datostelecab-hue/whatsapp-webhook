-- ============================================================
-- 278 — EL LIBRO DE AUDITORÍA, TAMBIÉN EN EL PLANIFICADOR Y EN LOS CONDUCTORES
-- ============================================================
-- Camilo, 23/11/2026: «el planificador está bien auditado? y la subida de
-- datos, ediciones, borrado, etc, de los conductores también?». Y: «no
-- necesito verlo visualmente, sino que se guarde en base de datos y ya. Que yo
-- te pregunte, revisa en la base de datos quién le cambió este dato a X
-- conductor, o quién le dio de alta a Y persona y con qué datos».
--
-- Hasta hoy el libro (db/245) vigilaba 15 tablas y ninguna era del
-- planificador ni de la ficha del conductor: se sabía quién PUSO a alguien en
-- un coche, pero no quién lo QUITÓ, ni el «antes» de muchos cambios. Desde
-- aquí, cada alta, cambio y borrado de estas tablas deja su fila en
-- `auditoria` (con la fila de antes, la de después y los campos que cambiaron),
-- venga de donde venga.
--
-- EL QUIÉN lo pone el servidor en cada escritura (services/contexto.js y
-- services/db.js, 23/11/2026): el usuario de la sesión y la ruta, o la tarea
-- programada, o el portal. Sin eso, el libro apunta igual, «sin decir».
--
-- Fuera del libro, las columnas que cambian solas (lo que BOLT dice cada pocos
-- minutos): si solo cambia eso, no se apunta nada. Y el IBAN cifrado, que no
-- se copia al libro nunca (db/247 lo exige).
--
-- Solo disparadores: se puede pasar dos veces. Una tabla que no exista en esta
-- base se salta.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/278', true),
       set_config('telecab.usuario_id', '7', true);

-- El libro necesita una clave de UNA columna por registro. Las tablas de los
-- días (de un correturnos, del descanso de un coche) y los coches de Barcelona
-- tienen clave compuesta: se les da un `id` propio. Todos sus INSERT nombran
-- sus columnas, así que no cambia nada más.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asignacion_dia', 'vehiculo_descanso_dia', 'sede_coche'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS id BIGINT GENERATED ALWAYS AS IDENTITY', t);
      EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS %I ON %I (id)', 'uq_' || t || '_id', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    -- ── El planificador de Madrid ──
    ('asignacion',               'id',            '{}'::text[]),
    ('asignacion_dia',           'id',            '{}'),
    ('plaza',                    'id',            '{}'),
    ('libranza_excepcional',     'id',            '{}'),
    ('vehiculo_descanso',        'id',            '{}'),
    ('vehiculo_descanso_dia',    'id',            '{}'),
    ('vehiculo_sin_ct',          'id',            '{}'),
    ('plan_relevo',              'id',            '{}'),
    ('cuadrante',                'id',            '{}'),
    ('base_zona',                'id',            '{}'),
    ('evento_operativo',         'id',            '{}'),
    -- ── El planificador de Barcelona ──
    ('sede_asignacion',          'id',            '{}'),
    ('sede_coche_cuadrante',     'id',            '{}'),
    ('sede_cuadrante',           'id',            '{}'),
    ('sede_cuadrante_ct',        'id',            '{}'),
    ('sede_coche_ct',            'id',            '{}'),
    ('sede_descanso',            'id',            '{}'),
    ('sede_zona',                'id',            '{}'),
    ('sede_coche',               'id',            '{}'),
    -- ── La ficha del conductor: alta, datos, contrato, papeles, baja ──
    -- El IBAN, cifrado, NUNCA al libro (se quedaría para siempre): fuera.
    ('conductor',                'id',            '{actualizado_at,iban_cifrado}'),
    ('conductor_telefono',       'id',            '{}'),
    ('conductor_periodo_empleo', 'id',            '{}'),
    ('contrato',                 'id',            '{}'),
    ('conductor_baja_programada','periodo_id',    '{}'),
    ('conductor_baja_cancelada', 'id',            '{}'),
    ('conductor_estado_hist',    'id',            '{}'),
    ('conductor_turno_hist',     'id',            '{}'),
    ('conductor_alias',          'id',            '{}'),
    ('documento',                'id',            '{}'),
    ('candidatura',              'id',            '{actualizado_at}'),
    ('incorporacion',            'id',            '{}'),
    -- Sus cuentas de BOLT: enlazar y desenlazar sí; lo que BOLT refresca solo, no.
    ('conductor_externo',        'id',            '{visto_at,visto_desde,visto_hasta,bolt_rating,bolt_score,bolt_nota_at,efectivo_at}')
  ) AS x (tabla, clave, fuera)
  LOOP
    IF to_regclass('public.' || t.tabla) IS NULL THEN
      RAISE NOTICE 'db/278: % no existe en esta base, se salta', t.tabla;
      CONTINUE;
    END IF;
    PERFORM auditoria_vigilar(t.tabla::regclass, t.clave, t.fuera);
  END LOOP;
END $$;

COMMIT;
