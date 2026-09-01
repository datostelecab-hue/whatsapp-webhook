-- ============================================================
-- 41 - LA PUERTA UNICA: staging de las zonas de Mapon
-- ============================================================
-- El tercer endpoint, y con el la puerta queda completa: state logs, ordenes y
-- zonas, todo por una sola llamada cada uno.
--
-- PARA QUE. Es lo que decide si la ESPERA cuenta como trabajo efectivo. El
-- convenio (art. 18.6.a, TE_A1) dice que esperar conectado solo es trabajo
-- DENTRO DEL AREA indicada. Mapon avisa con la alerta `in_object` cada vez que
-- un coche entra o sale de una zona. Con eso se sabe si el coche estaba en el
-- area durante un tramo de espera, y ese tramo sube de TE_NO a TE_A1.
--
-- EL PUENTE. La zona la manda Mapon por su unit_id; el tramo lo trae BOLT por
-- vehicle_uuid. Los dos llegan a nuestro `vehiculo` por vehiculo_alias, que
-- guarda el id externo de cada sistema. Asi un tramo de BOLT alcanza las zonas
-- de Mapon sin cruzar por matricula ni por nombre.

BEGIN;

-- ── Los eventos de entrada/salida de zona, verbatim ─────────────────────────
CREATE TABLE mapon_zona_evento (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id      VARCHAR(32) NOT NULL,          -- el id de Mapon del coche
  zona         VARCHAR(120),
  -- Entrada o salida, tal como lo manda Mapon. El valor exacto (in/out,
  -- entrada/salida) se confirma con el primer dato real; se guarda verbatim.
  sentido      VARCHAR(24),
  ocurrido_at  TIMESTAMPTZ NOT NULL,
  descarga_id  BIGINT REFERENCES ingesta_descarga(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Los eventos de Mapon no traen id propio; la clave es unidad + instante +
-- sentido, igual que en el resto del sistema de alertas.
CREATE UNIQUE INDEX uq_zona ON mapon_zona_evento (unit_id, ocurrido_at, sentido);
CREATE INDEX idx_zona_unit ON mapon_zona_evento (unit_id, ocurrido_at);

COMMENT ON TABLE mapon_zona_evento IS
  'Entradas y salidas de zona de Mapon (alerta in_object), verbatim. Decide si la espera esta dentro del area (TE_A1)';

-- ── Estaba el coche dentro del area en un momento dado? ──────────────────────
-- Se mira el ULTIMO evento de zona de ese coche antes del momento: si fue una
-- ENTRADA, estaba dentro; si fue una salida o no hay eventos, no consta que
-- estuviera. Recibe el vehicle_uuid de BOLT y hace el puente por vehiculo_alias.
--
-- Que valores de `sentido` cuentan como "entrada" se lee de una lista para poder
-- ajustarla cuando se vea el dato real, sin tocar la funcion. Por defecto, lo
-- que empiece por 'in' o 'entra'.
CREATE OR REPLACE FUNCTION f_en_area(p_vehicle_uuid_bolt VARCHAR, p_momento TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $func$
DECLARE
  v_id   BIGINT;
  unit   VARCHAR;
  ult    VARCHAR;   -- el sentido del ultimo evento antes del momento
BEGIN
  -- BOLT uuid -> nuestro vehiculo.
  SELECT vehiculo_id INTO v_id FROM vehiculo_alias
   WHERE sistema = 'bolt' AND externo_id = p_vehicle_uuid_bolt
   ORDER BY visto_desde DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN FALSE; END IF;   -- sin puente, no consta

  -- Nuestro vehiculo -> unit de Mapon.
  SELECT externo_id INTO unit FROM vehiculo_alias
   WHERE sistema = 'mapon' AND vehiculo_id = v_id
   ORDER BY visto_desde DESC LIMIT 1;
  IF unit IS NULL THEN RETURN FALSE; END IF;

  SELECT sentido INTO ult FROM mapon_zona_evento
   WHERE unit_id = unit AND ocurrido_at <= p_momento
   ORDER BY ocurrido_at DESC LIMIT 1;

  -- Ultimo movimiento fue entrar = esta dentro. Los valores se ajustan aqui.
  RETURN ult IS NOT NULL AND (ult ILIKE 'in%' OR ult ILIKE 'entra%');
END;
$func$;

COMMENT ON FUNCTION f_en_area(VARCHAR, TIMESTAMPTZ) IS
  'Si un coche de BOLT estaba dentro de una zona de Mapon en un momento. Puente por vehiculo_alias. Ajustar los valores de sentido con el primer dato real';

COMMIT;
