-- ============================================================
-- 125 - EL TURNO FICHADO: quién llevaba el coche y cuándo
-- ============================================================
-- El conductor pulsa «Iniciar turno» en WhatsApp, dice su matrícula, y al acabar
-- pulsa «Terminar». Esto guarda esa ventana.
--
-- PARA QUÉ EXISTE, que no es obvio: BOLT solo sabe quién conduce mientras su app
-- está ABIERTA. En cuanto el conductor se pone inactivo dejan de existir logs —y
-- justo ahí está el kilómetro que persigue la auditoría de flota—. Con el
-- fichaje sabemos quién tenía el coche en cada momento aunque BOLT esté cerrado,
-- y la auditoría puede pasar de señalar MATRÍCULAS a señalar PERSONAS.
--
-- La atribución se hace por VENTANA TEMPORAL, igual que con los timestamps de
-- BOLT, sin depender de cómo trate Mapon su histórico.
--
-- ── NO ES LA TABLA `fichaje` ────────────────────────────────────────────────
-- Esa es otra cosa y conviene no confundirlas: `fichaje` es el fichaje de
-- oficina —un usuario con cuenta, su entrada y su salida, con GPS—. Esto es el
-- turno de un conductor con un coche. Misma palabra, dos hechos distintos.
--
-- ── LO QUE LA HOJA NO PODÍA ────────────────────────────────────────────────
-- Vivía en la pestaña `FICHAJE_TURNOS`. Para saber si alguien tenía turno
-- abierto había que leer el libro ENTERO y recorrerlo; y para saber si el coche
-- ya lo tenía otro, lo mismo.
--
-- Peor: no había forma de impedirlo. Dos personas abriendo turno sobre el mismo
-- coche a la vez escribían dos filas y las dos se creían dueñas — que es justo
-- lo que esta tabla tiene que poder contestar sin dudas. Aquí son dos índices
-- únicos parciales: lo impide la base, no el orden en que lleguen las peticiones.

BEGIN;

CREATE TABLE IF NOT EXISTS fichaje_turno (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- La referencia que ya usaba la hoja (tel9-epoch). Se conserva porque sale en
  -- los mensajes y en el panel.
  referencia   VARCHAR(40) NOT NULL UNIQUE,

  -- QUIÉN. El teléfono es la llave con la que llega el mensaje; `conductor_id`
  -- se rellena cuando se le reconoce. Puede faltar: esto está en pruebas y
  -- responde a una lista de teléfonos que no tienen por qué ser conductores.
  telefono     VARCHAR(24) NOT NULL,
  conductor_id BIGINT REFERENCES conductor(id) ON DELETE SET NULL,
  -- El nombre con el que se le da de alta en Mapon. Lo decidimos nosotros: la
  -- mayoría de conductores no están dados de alta allí.
  nombre       VARCHAR(160) NOT NULL DEFAULT '',

  -- QUÉ COCHE. La matrícula tal como la resolvió Mapon, y el vehículo nuestro
  -- si lo tenemos fichado.
  matricula    VARCHAR(16) NOT NULL,
  vehiculo_id  BIGINT REFERENCES vehiculo(id) ON DELETE SET NULL,
  unit_id      VARCHAR(32) NOT NULL DEFAULT '',
  -- El conductor en Mapon, y el coche que tuviera puesto ANTES: al terminar se
  -- le devuelve, para no dejarle la ficha tocada.
  mapon_driver_id VARCHAR(32) NOT NULL DEFAULT '',
  unit_previa     VARCHAR(32) NOT NULL DEFAULT '',

  -- CUÁNDO.
  inicio       TIMESTAMPTZ NOT NULL DEFAULT now(),
  fin          TIMESTAMPTZ,

  -- Qué se movió el coche en esa ventana. Se rellena al cerrar.
  km                   NUMERIC(10,2),
  trayectos            INTEGER NOT NULL DEFAULT 0,
  trayectos_atribuidos INTEGER NOT NULL DEFAULT 0,

  estado       VARCHAR(16) NOT NULL DEFAULT 'abierto'
               CHECK (estado IN ('abierto', 'cerrado', 'auto-cerrado')),
  notas        TEXT NOT NULL DEFAULT '',
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Un turno abierto no tiene fin, y uno cerrado sí. Sin esto caben turnos
  -- «cerrados» sin hora de cierre, que son los que rompen la atribución por
  -- ventana: no se sabe dónde acaba.
  CONSTRAINT ck_ft_cierre CHECK (
    (estado = 'abierto' AND fin IS NULL) OR (estado <> 'abierto' AND fin IS NOT NULL)),
  CONSTRAINT ck_ft_orden  CHECK (fin IS NULL OR fin >= inicio)
);

-- ── LO QUE LA HOJA NO PODÍA GARANTIZAR ─────────────────────────────────────
-- Una persona, un turno abierto. Un coche, un turno abierto. Lo dice la base y
-- no el orden en que lleguen dos mensajes de WhatsApp con medio segundo de
-- diferencia.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_persona_abierta
  ON fichaje_turno (right(regexp_replace(telefono, '[^0-9]', '', 'g'), 9))
  WHERE estado = 'abierto';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ft_coche_abierto
  ON fichaje_turno (matricula) WHERE estado = 'abierto';

-- La pregunta de la auditoría: "¿quién tenía este coche a esta hora?".
CREATE INDEX IF NOT EXISTS idx_ft_coche_ventana ON fichaje_turno (matricula, inicio DESC);
CREATE INDEX IF NOT EXISTS idx_ft_conductor     ON fichaje_turno (conductor_id, inicio DESC);

COMMENT ON TABLE fichaje_turno IS
  'Turno fichado por WhatsApp: quién llevaba qué coche y en qué ventana. NO es la tabla `fichaje`, que es el fichaje de oficina';
COMMENT ON COLUMN fichaje_turno.unit_previa IS
  'El coche que ese conductor tenía puesto en Mapon antes del turno. Se le devuelve al terminar';

COMMIT;
