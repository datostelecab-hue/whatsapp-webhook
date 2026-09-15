-- ============================================================
-- 114 - LA CONFIGURACIÓN DE LA PLATAFORMA, FUERA DE UNA HOJA
-- ============================================================
-- Los ajustes compartidos del ERP —el correo de procesos con su contraseña
-- cifrada, el destinatario de la ETT— vivían en una pestaña `CONFIG` de un
-- Google Sheet, en dos columnas: clave y valor.
--
-- Dos razones para sacarlos, y la segunda pesa más que la primera:
--
-- 1. DE ESTO CUELGA EL CORREO. `services/correo.js` lee la configuración cada
--    vez que manda algo, así que enviar un correo pasaba por Google. Si Sheets
--    tarda o falla, no es que no se pueda cambiar un ajuste: es que no sale el
--    correo.
--
-- 2. AHÍ DENTRO HAY UNA CONTRASEÑA. `correo_pass_cifrada` está cifrada, sí, pero
--    una hoja de cálculo se comparte con un clic y no deja rastro de quién la
--    abrió. Una tabla tiene los permisos de la base y el registro de la base.
--
-- ── LO QUE NO CAMBIA ────────────────────────────────────────────────────────
-- El contrato sigue siendo clave → texto, y el valor se guarda TAL CUAL (el
-- cifrado lo hace `services/cripto` antes de llegar aquí). Esta tabla no sabe
-- qué guarda, y así debe seguir: el día que haya un ajuste nuevo es un INSERT,
-- no una migración.

BEGIN;

CREATE TABLE IF NOT EXISTS config_app (
  clave          VARCHAR(80) PRIMARY KEY,
  -- Texto libre a propósito. Aquí caben un correo, un puerto, un "SI" y un
  -- secreto cifrado; tipar la columna obligaría a una tabla por tipo de ajuste.
  valor          TEXT        NOT NULL DEFAULT '',
  -- Quién lo tocó y cuándo. La hoja no lo decía, y "¿quién cambió el correo de
  -- salida?" es justo la pregunta que se hace cuando algo deja de enviarse.
  usuario_id     INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE config_app IS
  'Ajustes compartidos del ERP (clave/valor). El valor se guarda tal cual: si es un secreto, viene ya cifrado de services/cripto';
COMMENT ON COLUMN config_app.valor IS
  'Texto libre. Aquí caben un correo, un puerto y un secreto cifrado';

COMMIT;
