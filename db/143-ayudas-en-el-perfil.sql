-- ============================================================
-- 143 · LAS AYUDAS AL PASAR EL CURSOR, ENCENDIDAS O APAGADAS
-- ============================================================
-- El sistema explica sus numeros al pasar el raton por encima: que son los km
-- de fuera, por que ese 11 % esta en rojo, de donde sale una calificacion. Es
-- la parte que mas se usa sin darse cuenta, y la que sostiene a quien lleva dos
-- dias aqui — nadie va a preguntar por cada celda.
--
-- A quien lleva dos anos le estorban. Asi que se pueden apagar, y la decision
-- es DE CADA UNO.
--
-- ── POR QUE EN EL PERFIL Y NO EN EL NAVEGADOR ──────────────────────────────
--
-- Podria vivir en el `localStorage` y seria mas barato. Pero entonces seria del
-- NAVEGADOR y no de la persona: quien las apaga en el ordenador de la oficina
-- se las vuelve a encontrar en el de casa, y quien entra por primera vez desde
-- el movil las tendria en un sitio y no en otro sin saber por que.
--
-- Va como el tema (`usuario.tema`): en el perfil, viaja en la sesion y se pinta
-- desde el servidor antes del primer pintado, asi que no hay un parpadeo de
-- ayudas encendiendose al cargar.
--
-- NACE ENCENDIDA para todo el mundo. Es lo que hay hoy —el globo del navegador
-- sale siempre— y es el lado bueno del error: si alguien no sabe que existe la
-- opcion, se queda con la ayuda, no sin ella.

BEGIN;

ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS ayudas BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN usuario.ayudas IS
  'Ensenar el globo de ayuda al pasar el cursor. Nace encendida: quien no sepa que '
  'se puede apagar se queda con la ayuda, no sin ella.';

COMMIT;
