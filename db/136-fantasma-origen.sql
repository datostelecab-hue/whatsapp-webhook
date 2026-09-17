-- ============================================================
-- 136 · CUENTAS FANTASMA — de dónde vino de verdad la petición
-- ============================================================
-- El libro guarda una IP, pero esa IP es una INTERPRETACIÓN: Express la deduce
-- de la cabecera `X-Forwarded-For` contando los saltos de proxy en los que se
-- confía (`trust proxy`, en app.js). Si el número de saltos está mal, la IP
-- guardada es la de un proxy y no la de la persona — y entonces todo el mundo
-- sale con la misma y el libro deja de servir para lo que se hizo.
--
-- Pasó a la primera: la primera acción auditada de verdad quedó con
-- 188.114.111.197, que cae en un rango de Cloudflare. O hay un proxy más de los
-- contados, o quien la hizo estaba detrás de un Cloudflare suyo. Desde fuera no
-- se puede distinguir, y adivinarlo en un libro de auditoría no vale.
--
-- Así que se guarda también LA PRUEBA, no solo la conclusión:
--
--   · `cadena`     la cabecera X-Forwarded-For tal cual llegó. Ahí se ve
--                  cuántos saltos hay de verdad y se puede ajustar el número
--                  sin tener que volver a adivinar.
--   · `ip_cliente` la que dice Cloudflare que es el cliente (CF-Connecting-IP),
--                  si la hay. Cuando la petición pasa por Cloudflare, esta es
--                  la buena; si no hay Cloudflare delante, no viene.
--
-- Se quedan para siempre y no solo para este diagnóstico: en un libro de
-- auditoría interesa la evidencia, no la lectura que alguien hizo de ella.

BEGIN;

ALTER TABLE cuenta_fantasma_log
  ADD COLUMN cadena     TEXT,
  ADD COLUMN ip_cliente VARCHAR(64);

COMMENT ON COLUMN cuenta_fantasma_log.cadena IS
  'X-Forwarded-For tal cual llego. Es la prueba; la columna ip es la interpretacion que hizo Express con trust proxy';
COMMENT ON COLUMN cuenta_fantasma_log.ip_cliente IS
  'CF-Connecting-IP: la que Cloudflare dice que es el cliente. Solo viene si la peticion paso por Cloudflare';

COMMIT;
