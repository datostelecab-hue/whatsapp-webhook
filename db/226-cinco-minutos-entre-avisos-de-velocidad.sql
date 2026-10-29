-- ============================================================
-- 226 — CINCO MINUTOS ENTRE AVISOS DE VELOCIDAD
-- ============================================================
-- Camilo, 29/10/2026: «A Luis Alfredo Betancur Ramirez le salen avisos de
-- velocidad muy seguidos: que entre avisos haya al menos 5 minutos de
-- diferencia para que no se solapen entre ellos, y arregla los que estén así».
--
-- Mapon parte un mismo tirón en varias alertas seguidas, y cada una era un
-- WhatsApp y un aviso más en su cuenta y en su letra. Desde ahora un exceso a
-- menos de 5 min de otro avisado al mismo teléfono va CON ese aviso: estado
-- nuevo `agrupado`, sin WhatsApp, que no cuenta como aviso ni baja la letra
-- (sanciones.service.js, SEPARACION_SEG).
--
-- LOS QUE YA ESTÁN ASÍ: por teléfono y en orden, el primer avisado se queda; el
-- siguiente que cae a menos de 5 min del último que se quedó pasa a `agrupado`,
-- y uno a 5 min o más es un aviso aparte. Se mide contra el último que se queda,
-- no contra el de justo antes: tres a las 10:00, 10:03 y 10:06 son dos avisos
-- (10:00 y 10:06), no uno.
--
-- El WhatsApp de esos ya salió: el id y la hora de envío se quedan, y la nota lo
-- dice. No se borra nada: la fila es también la marca de «ya procesado».
--
-- La letra del mes en curso se rehace sola en la pasada siguiente. La de los
-- meses cerrados está sellada y no se mueve.

BEGIN;

ALTER TABLE velocidad_exceso DROP CONSTRAINT ck_vel_estado;
ALTER TABLE velocidad_exceso ADD CONSTRAINT ck_vel_estado CHECK (estado IN
  ('avisado','simulado','sin_conductor','dudoso','error','agrupado'));

DO $$
DECLARE
  r       RECORD;
  tel     TEXT;
  ultimo  TIMESTAMPTZ;
BEGIN
  FOR r IN SELECT clave, telefono, ocurrido_at
             FROM velocidad_exceso
            WHERE estado = 'avisado'
            ORDER BY telefono, ocurrido_at, clave
  LOOP
    IF tel IS DISTINCT FROM r.telefono THEN
      tel := r.telefono;
      ultimo := r.ocurrido_at;
    ELSIF r.ocurrido_at < ultimo + interval '5 minutes' THEN
      UPDATE velocidad_exceso
         SET estado = 'agrupado',
             nota = 'Va con el aviso de las '
                    || to_char(ultimo AT TIME ZONE 'Europe/Madrid', 'HH24:MI')
                    || ', a menos de 5 min: no cuenta como otro aviso (db/226, 29/10/2026). '
                    || 'El WhatsApp sí había salido. Antes: ' || COALESCE(nota, '')
       WHERE clave = r.clave;
    ELSE
      ultimo := r.ocurrido_at;
    END IF;
  END LOOP;
END $$;

COMMIT;
