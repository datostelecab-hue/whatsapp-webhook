-- ============================================================
-- 105 — Quién ficha, y poder cortar sesiones desde el servidor
-- ============================================================
-- Dos columnas en `usuario`, de dos asuntos distintos que llegan juntos.
--
-- ── 1. QUIÉN TIENE QUE FICHAR ───────────────────────────────────────────────
-- La empresa quiere que los empleados fichen por el ERP. Pero no todos: la
-- directiva y la gerencia no fichan.
--
-- Se hace POR USUARIO y no por rol. Por rol parece más limpio y es peor: en
-- cuanto haya un jefe de tráfico que sí ficha y otro que no, la regla del rol se
-- rompe y hay que inventar excepciones. Aquí lo decide una persona marcando una
-- casilla, que es como de verdad se decide.
--
-- Y nace en FALSE para todos: se elige a quién SÍ, no a quién no. Si algún día
-- se olvida marcar a alguien, el fallo es que no fiche —se arregla marcándolo—,
-- no que le empiece a contar una jornada que nadie ha pedido.
--
-- ── 2. CORTAR SESIONES ──────────────────────────────────────────────────────
-- Esta es la que hace falta para que "mantener sesión iniciada" no sea un
-- agujero.
--
-- La sesión es una cookie firmada (HMAC) que el servidor NO consulta contra la
-- base: el rol y el estado viajan dentro del token. Hoy dura 12 h, así que
-- bloquear a alguien le deja dentro medio día como mucho. Con una sesión larga
-- de 30 días, bloquear a alguien no haría NADA durante un mes: su cookie sigue
-- siendo válida porque la firma sigue siendo correcta.
--
-- `sesiones_desde` es el corte: toda sesión emitida ANTES de esa marca deja de
-- valer. Bloquear a un usuario, cambiarle la contraseña o pulsar "cerrar sesión
-- en todos los dispositivos" ponen la marca en `now()` y sus cookies mueren en
-- el acto, sin necesidad de guardar sesiones en ningún sitio.
--
-- NULL = nunca se ha cortado nada, que es lo normal.

BEGIN;

ALTER TABLE usuario
  ADD COLUMN IF NOT EXISTS ficha_obligatorio BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sesiones_desde    TIMESTAMPTZ;

COMMENT ON COLUMN usuario.ficha_obligatorio IS
  'Si esta persona tiene que fichar su jornada en el ERP. Se elige una a una, no por rol: en cuanto hay una excepcion, la regla del rol se rompe';

COMMENT ON COLUMN usuario.sesiones_desde IS
  'Corte de sesiones: las emitidas antes de esta marca dejan de valer. Lo pone bloquear al usuario, cambiarle la contrasena o cerrar sesion en todos los dispositivos. NULL = nunca cortado';

-- Quien tiene que fichar se pregunta a menudo (cada vez que se pinta el panel de
-- fichaje) y son pocos: un indice parcial que solo guarda los marcados.
CREATE INDEX IF NOT EXISTS idx_usuario_ficha ON usuario (id) WHERE ficha_obligatorio;

COMMIT;
