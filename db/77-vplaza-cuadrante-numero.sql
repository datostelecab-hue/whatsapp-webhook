-- ============================================================
-- v_plaza expone el NÚMERO del cuadrante, no solo su nombre
-- ============================================================
-- El planificador ordenaba por `cuadrante`, que es texto, y el texto ordena
-- "Cuadrante 10" antes que "Cuadrante 2". En pantalla ya salía así, y la
-- parrilla impresa lo heredaba.
--
-- `cuadrante.numero` existe y está relleno en los 29 cuadrantes vivos; lo que
-- faltaba era sacarlo por la vista para poder ordenar por él.

BEGIN;

CREATE OR REPLACE VIEW v_plaza AS
 SELECT p.id AS plaza_id,
    p.vehiculo_id,
    v.matricula,
    v.estado_operativo,
    ev.es_operativo,
    ev.visible_cobertura,
    v.base_zona_id,
    bz.nombre AS zona,
    p.slot,
    s.turno_id,
    t.codigo AS turno_codigo,
    t.etiqueta AS turno,
    s.rol,
    s.orden_ct,
    p.orden_pantalla,
    v.cuadrante_id,
    cu.nombre AS cuadrante,
    cu.numero AS cuadrante_num
   FROM plaza p
     JOIN vehiculo v ON v.id = p.vehiculo_id AND v.baja_at IS NULL
     JOIN cat_slot s ON s.slot = p.slot
     JOIN turno t ON t.id = s.turno_id
     JOIN cat_estado_vehiculo ev ON ev.codigo::text = v.estado_operativo::text
     LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
     LEFT JOIN cuadrante cu ON cu.id = v.cuadrante_id AND cu.baja_at IS NULL
  WHERE p.baja_at IS NULL;

COMMIT;
