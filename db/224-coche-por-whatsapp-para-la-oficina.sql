-- ============================================================
-- 224 — LA OFICINA COGE COCHES POR WHATSAPP COMO LOS CONDUCTORES
-- ============================================================
-- Camilo, 29/10/2026, con la conversación de Ignacio con el bot delante: «la
-- idea es que tengan algo parecido a los conductores, todo igual, hasta el
-- código de lavado, pero turnos no», «que cuando mande la matrícula
-- automáticamente empiece el viaje» y «hay que habilitarle esto a todos los de
-- la oficina … para todos igual, los mismos botones y lógica».
--
-- La conversación cambia en el código (services/fichajeBot.js). Aquí, lo que
-- la base tiene que dejar:
--
-- 1 · «ENTREGAR COCHE» TAMBIÉN EN LOS VIAJES. El CHECK ck_ft_relevo de db/148
--     solo dejaba apuntar la hora de entrega en un turno («un viaje no tiene
--     compañero»). Ahora el viaje de la oficina lleva el mismo botón, así que
--     vale en los dos. Lo demás se queda: la entrega cae dentro del turno o del
--     viaje (después de empezarlo y, si ya se cerró, antes de cerrarlo).
--
-- 2 · TODA LA OFICINA PUEDE COGER UN COCHE. `usuario.ficha_coche` (db/148) se
--     enciende a todos los usuarios activos, y quien se dé de alta desde ahora
--     ya llega con él. Se puede apagar a alguien como siempre, en /usuarios.
--     Quien no tenga bien su teléfono en /usuarios no entra hasta que se le
--     corrija: el bot le reconoce por ese número.

BEGIN;

ALTER TABLE fichaje_turno DROP CONSTRAINT IF EXISTS ck_ft_relevo;
ALTER TABLE fichaje_turno ADD CONSTRAINT ck_ft_relevo CHECK (
  relevo_at IS NULL
  OR (relevo_at >= inicio AND (fin IS NULL OR relevo_at <= fin)));

COMMENT ON COLUMN fichaje_turno.relevo_at IS
  'Cuándo pulsó «Entregar coche» (antes «Voy al relevo»): justo antes de arrancar hacia donde entrega el coche. En turnos y, desde db/224, también en los viajes de la oficina.';

UPDATE usuario SET ficha_coche = TRUE WHERE estado = 'activo' AND NOT ficha_coche;

ALTER TABLE usuario ALTER COLUMN ficha_coche SET DEFAULT TRUE;

COMMENT ON COLUMN usuario.ficha_coche IS
  'Puede coger un coche por WhatsApp (un viaje): con la matrícula empieza y se suelta el motor; al terminar se bloquea. Encendido a toda la oficina desde db/224, y por defecto a los nuevos. Distinto de ficha_obligatorio, que es fichar la jornada de oficina (db/148).';

COMMIT;
