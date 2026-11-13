-- ============================================================
-- 243 — PARÁMETROS DE NEGOCIO: los números de las reglas, editables y con historia
-- ============================================================
-- Hoja de ruta de Ignacio, convención 4: «Todo número de regla es un parámetro.
-- Plazos, topes y fechas (5 días, 100 €, día 20, etc.) van en una tabla de
-- parámetros editable por un administrador, no en el código». Pieza A3 de
-- docs/Hoja de ruta.md (13/11/2026).
--
-- QUÉ PARÁMETROS HAY lo dice el CÓDIGO (services/parametros.js, CATALOGO): su
-- clave, su tipo, su unidad, su valor por defecto y qué ítem lo usa. La base
-- guarda solo los CAMBIOS: cada uno es una fila con el valor nuevo, desde
-- cuándo vale, por qué y quién. Nada se sobrescribe ni se borra (convención 5):
-- el valor de hoy es el último cambio que ya ha empezado; sin cambios, el del
-- código. Así un parámetro nuevo no necesita migración, y la historia de cada
-- uno (quién puso 7 días donde había 5, y cuándo) está entera.
--
-- Por qué no config_app (db/114): sobrescribe el valor y pierde el anterior, y
-- no sabe de unidades. Por qué no agreement_parameter (db/30): es del convenio,
-- con su artículo y su grupo profesional; mezclar los plazos de la oficina ahí
-- confundiría lo que dice la ley con lo que decide la empresa.
--
-- QUIÉN LOS CAMBIA. Camilo, 13/11/2026: «Llave propia: Ignacio y
-- desarrollador». La llave es '/parametros' (manual: no la siembra ningún rol)
-- y de inicio la tiene Ignacio; el desarrollador entra por su rol. El
-- superadmin NO entra por serlo (services/sesion.js, requiereDesarrolladorOLlave).
-- Se puede dar a más gente en /usuarios.

BEGIN;

CREATE TABLE IF NOT EXISTS parametro_cambio (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La clave del catálogo del código: 'sanciones.plazo_dias_habiles'.
  clave       VARCHAR(64) NOT NULL CHECK (clave ~ '^[a-z][a-z0-9_.]*$'),
  -- El valor, en JSON porque cada parámetro es de un tipo: un número, un
  -- importe, un texto o un horario ({"dias":[1,2,3,4,5],"desde":"09:00","hasta":"18:00"}).
  -- Lo valida el código contra su tipo antes de guardarlo.
  valor       JSONB       NOT NULL,
  -- Desde cuándo vale. Un plazo que ya está corriendo guardó su fecha límite al
  -- nacer: cambiar el parámetro solo afecta a lo que nazca después.
  desde       TIMESTAMPTZ NOT NULL DEFAULT now(),
  motivo      TEXT        NOT NULL CHECK (btrim(motivo) <> ''),
  usuario_id  INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parametro_cambio ON parametro_cambio (clave, desde DESC, id DESC);

COMMENT ON TABLE parametro_cambio IS
  'Cambios de los parámetros de negocio (convención 4 de la hoja de ruta). El catálogo y los valores por defecto viven en services/parametros.js; aquí solo los cambios, con desde cuándo, motivo y quién. No se cambia ni se borra: un cambio es una fila nueva (db/243).';

-- ── El historial no se toca ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION parametro_cambio_intocable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El historial de parámetros no se cambia ni se borra: un cambio es una fila nueva (db/243)';
END $$;

DROP TRIGGER IF EXISTS trg_parametro_cambio_intocable ON parametro_cambio;
CREATE TRIGGER trg_parametro_cambio_intocable BEFORE UPDATE OR DELETE ON parametro_cambio
  FOR EACH ROW EXECUTE FUNCTION parametro_cambio_intocable();
DROP TRIGGER IF EXISTS trg_parametro_cambio_intocable_truncate ON parametro_cambio;
CREATE TRIGGER trg_parametro_cambio_intocable_truncate BEFORE TRUNCATE ON parametro_cambio
  FOR EACH STATEMENT EXECUTE FUNCTION parametro_cambio_intocable();

-- ── La llave, para Ignacio ──────────────────────────────────────────────────
-- Ignacio es el usuario 1 (Ignacio Cafferata, como en db/168). Por id Y por
-- nombre: si el 1 fuera otra persona en esta base, no se le da a nadie.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/parametros', 7
  FROM usuario u
 WHERE u.id = 1 AND u.nombre = 'Ignacio' AND u.apellidos = 'Cafferata'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = '/parametros');

COMMIT;
