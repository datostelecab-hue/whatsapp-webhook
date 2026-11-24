-- ============================================================
-- 280 — UN CONDUCTOR DE PRUEBAS EN PRODUCCIÓN
-- ============================================================
-- Camilo, 24/11/2026: «Crea un usuario de prueba que se pueda abrir siempre en
-- producción simulando ser un conductor, que tenga datos sacados de un
-- conductor al azar para que sea más realista, pero que sí pueda asignarse a un
-- coche, abrir puertas, cerrar, desbloquear el vehículo, etc, esa la usaré yo
-- para pruebas, hasta para las fotos». Y, de lo que se copia, «también su
-- nombre»; que «salga como una más», con «(PRUEBAS)» en el nombre para que se
-- reconozca (en Plantilla, en el mapa y en Mapon, que pone su nombre en el coche).
--
-- Lo que hace:
--   · Elige un conductor AL AZAR de plantilla propia, de alta, con alguna nota
--     semanal de verdad, y copia su NOMBRE y APELLIDOS con « (PRUEBAS)» detrás.
--     Nada más de él: ni documento, ni teléfono, ni email, ni cuentas de BOLT.
--   · Le abre un contrato desde hoy (plantilla propia, 40 h en 5 días), como un
--     alta normal, con el bloqueo de motor encendido (como todo el que entra,
--     26/10/2026): vincular suelta el motor y desvincular lo corta.
--   · Le copia las NOTAS SEMANALES de ese conductor, para que la pestaña
--     «Puntuación» del portal se vea de verdad.
--
-- LO QUE NO VA AQUÍ, A PROPÓSITO: el teléfono, el email y el documento de
-- entrada. El repositorio es público y son datos de Camilo. Los pone él en
-- Plantilla (la ficha «… (PRUEBAS)»): el teléfono con el que se vincula el coche,
-- el email al que llega el código y, como «número de documento», ese mismo
-- teléfono, que es con lo que entrará al portal.
--
-- Se puede pasar dos veces: si ya hay una ficha «(PRUEBAS)», no hace nada.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/280', true),
       set_config('telecab.usuario_id', '7', true);

DO $$
DECLARE
  modelo bigint;
  nuevo  bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM conductor WHERE apellidos LIKE '%(PRUEBAS)') THEN
    RAISE NOTICE 'Ya hay un conductor de pruebas: no se crea otro';
    RETURN;
  END IF;

  SELECT c.id INTO modelo
    FROM conductor c
   WHERE NOT c.es_centinela
     AND EXISTS (SELECT 1 FROM conductor_periodo_empleo e
                  WHERE e.conductor_id = c.id AND e.tipo = 'propia' AND e.baja IS NULL)
     AND EXISTS (SELECT 1 FROM conductor_puntuacion_semana p
                  WHERE p.conductor_id = c.id AND p.letra <> 'N/E')
   ORDER BY random()
   LIMIT 1;
  IF modelo IS NULL THEN
    RAISE NOTICE 'No hay ningún conductor de plantilla propia con notas: no se crea el de pruebas';
    RETURN;
  END IF;

  INSERT INTO conductor (nombre, apellidos, ficha_coche, ficha_coche_at, ficha_coche_por)
  SELECT btrim(c.nombre), btrim(COALESCE(c.apellidos, '') || ' (PRUEBAS)'), TRUE, now(), 7
    FROM conductor c WHERE c.id = modelo
  RETURNING id INTO nuevo;

  -- El alta: `empleo_vigente` lo pone el disparador (tg_empleo_vigente).
  INSERT INTO conductor_periodo_empleo (conductor_id, tipo, alta, jornada_horas, jornada_dias, usuario_id)
  VALUES (nuevo, 'propia', (now() AT TIME ZONE 'Europe/Madrid')::date, 40, 5, 7);

  INSERT INTO conductor_puntuacion_semana
    (conductor_id, semana_lunes, periodo_inicio, periodo_fin, letra, letra_por_puntos, tope_aplicado, motivo,
     total, pts_horas, pts_utilizacion, pts_velocidad, horas_prom, util_prom, excesos_total,
     dias_trabajados, dias_utilizacion, dias_telemetria, version_modelo, sellado_at)
  SELECT nuevo, semana_lunes, periodo_inicio, periodo_fin, letra, letra_por_puntos, tope_aplicado, motivo,
         total, pts_horas, pts_utilizacion, pts_velocidad, horas_prom, util_prom, excesos_total,
         dias_trabajados, dias_utilizacion, dias_telemetria, version_modelo, sellado_at
    FROM conductor_puntuacion_semana WHERE conductor_id = modelo;

  RAISE NOTICE 'Conductor de pruebas: ficha %', nuevo;
END $$;

COMMIT;
