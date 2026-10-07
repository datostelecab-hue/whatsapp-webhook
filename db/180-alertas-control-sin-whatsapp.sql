-- ============================================================
-- 180 — LAS ALERTAS DE CONTROL, SIN WHATSAPP
-- ============================================================
-- Camilo, 07/10/2026: «Desactiva completamente esos avisos, no los necesitamos ya».
--
-- Cada alerta de Control salía como una PLANTILLA de WhatsApp a los dos
-- controladores, y desde el 01/07/2025 Meta cobra cada plantilla entregada, una
-- por una: no hay ventana de 24 h que abra la empresa. Eran unas 600-700 al día
-- (975 en las 48 h anteriores), casi todas de «no vuelve a la M-30» (~160 alertas
-- al día) y «rueda sin nadie conectado» (~110). Ese mismo día la cuenta de
-- WhatsApp Business se bloqueó por el pago (error 131042 desde las 12:51).
--
-- Se apagan con el interruptor que ya existe: el MODO. Fuera de 'live', las
-- tres vías de envío —las alertas de franja, el coche que rueda suelto y la
-- M-30— apuntan la alerta como 'simulada' y NO mandan nada (alertas.repo.js:
-- `simulado = config.modo !== 'live'`). Las alertas se siguen detectando y se
-- ven en /alertas y en Control, que no cuesta nada.
--
-- Para volver a encenderlas: /alertas → Ajustes → modo real. No hace falta otra
-- migración. Si ya se apagaron a mano desde la pantalla, esto no toca nada.

BEGIN;

UPDATE alerta_control_config
   SET valor = jsonb_set(valor, '{modo}', '"test"'),
       actualizado_at = now()
 WHERE clave = 'parametros'
   AND valor->>'modo' = 'live';

COMMIT;
