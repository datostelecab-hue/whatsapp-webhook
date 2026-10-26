-- ============================================================
-- 219 · EL CICLO DE BLOQUEO DE MOTOR PARA TODOS, Y EL CIERRE DE LAS 14 H
-- ============================================================
-- Camilo, 26/10/2026: «Mantén todos los coches disponibles del planificador
-- dentro del ciclo; si alguno se va fuera del ciclo, que aparezca en el módulo
-- como pendiente de entrar en el ciclo y el porqué», «que los nuevos que entren
-- en la plantilla ya lleguen con el bloqueo de motor activo» y «si alguien no
-- cerró turno, que lo cierre 14 horas después, pero si el coche está en
-- movimiento lo mantengas así, y le envíes un mensaje por WhatsApp diciéndole
-- que confirme que sigue en el coche … si no hay nadie logueado en el bot y el
-- coche está parado, se cierra automáticamente el turno y se bloquea el motor,
-- solo si está detenido».
--
-- 1 · EL BLOQUEO, ENCENDIDO A TODOS LOS QUE LLEVAN UN COCHE DEL PLANIFICADOR.
--     Un coche solo se bloquea al terminar si TODOS los que lo llevan hoy o
--     mañana tienen el bloqueo (`conductor.ficha_coche`, db/148): con uno solo
--     sin él, el coche se queda libre y fuera del ciclo. El 26/10 eran 11 de 68
--     coches, por 12 personas. Se les enciende a todos los que están de alta y
--     tienen una plaza vigente o por empezar en un coche de Madrid (los de
--     Barcelona no se tocan: su motor se lleva desde Mapon). Desde este
--     despliegue, quien entra
--     en la plantilla —alta nueva o vuelta— ya llega con él encendido
--     (conductores.repo `crear` y `darDeAlta`), y a RRHH se le pide que le dé la
--     inducción del bloqueo o, por lo menos, le mande el vídeo del bot.
--     `ficha_coche_por` queda vacío: lo encendió esta migración, no una persona.
--     Se puede apagar a alguien como siempre, en el planificador; su coche saldrá
--     en el ciclo como «pendiente de entrar», con su nombre.
--
-- 2 · EL SEGUIMIENTO DEL CIERRE DE LAS 14 H (`fichaje_turno_sigue`). Hasta hoy un
--     turno olvidado se cerraba solo a las 14 h, sin mirar el coche y sin tocar el
--     motor. Desde esta migración lo lleva un repaso cada 5 minutos
--     (services/fichaje.revisarTurnosLargos):
--       · coche detenido (20 min quieto, apagado y con señal) → se cierra el
--         turno y se bloquea el motor, con las mismas reglas que «Terminar turno»;
--       · coche en marcha o encendido → el turno sigue abierto y se le pregunta
--         por WhatsApp si sigue en el coche. Si contesta que sí, no se vuelve a
--         mirar en 2 horas.
--     Aquí se apunta cuándo se le preguntó y hasta cuándo vale su «sigo en el
--     coche». Sin esta tabla, el código hace lo de antes (cerrar a las 14 h sin
--     tocar el motor): por eso va en la migración y no en el despliegue.
--
-- Aplicarla dos veces no hace nada más. No se edita ninguna migración anterior
-- (docs/nucleo/Migraciones.md).

BEGIN;

UPDATE conductor c
   SET ficha_coche = TRUE, ficha_coche_at = now(), ficha_coche_por = NULL
 WHERE c.empleo_vigente AND NOT c.ficha_coche AND NOT c.es_centinela
   AND EXISTS (
     SELECT 1
       FROM asignacion a
       JOIN plaza p    ON p.id = a.plaza_id AND p.baja_at IS NULL
       JOIN vehiculo v ON v.id = p.vehiculo_id
      WHERE a.conductor_id = c.id
        -- Vigente o por empezar: el ciclo mira quién lleva el coche hoy Y mañana
        -- (y el de noche que entra a las 05:00 ya es «mañana»).
        AND (a.hasta IS NULL OR a.hasta >= (now() AT TIME ZONE 'Europe/Madrid')::date)
        AND (v.sede IS NULL OR v.sede = 'madrid'));

CREATE TABLE IF NOT EXISTS fichaje_turno_sigue (
  turno_id       BIGINT      PRIMARY KEY REFERENCES fichaje_turno(id) ON DELETE CASCADE,
  -- La última vez que se le preguntó «¿sigues en el coche?» (y cuántas van).
  preguntado_at  TIMESTAMPTZ,
  preguntas      INTEGER     NOT NULL DEFAULT 0,
  -- Cuándo contestó que sí, y hasta cuándo vale: hasta entonces no se le cierra
  -- el turno ni se le bloquea el coche, aunque esté parado.
  confirmado_at  TIMESTAMPTZ,
  sigue_hasta    TIMESTAMPTZ
);

COMMENT ON TABLE fichaje_turno_sigue IS
  'El cierre de las 14 h de un turno olvidado (db/219): cuándo se le preguntó por WhatsApp si sigue en el coche y hasta cuándo vale su «sí». Con el coche detenido y sin ese «sí», el turno se cierra y el motor se bloquea.';

COMMENT ON COLUMN conductor.ficha_coche IS
  'Bloqueo de motor encendido: al terminar su turno se le bloquea el coche (si todos los que lo llevan lo tienen). Desde db/219 lo tienen todos los que llevan un coche de Madrid del planificador y se enciende solo al dar de alta.';

COMMIT;
