-- ============================================================
-- 157 — LOS PEDIDOS DE UN COCHE, POR CUÁNDO SE CREARON
-- ============================================================
-- El mapa pregunta, coche a coche y cada diez segundos, «¿tenemos ya el pedido
-- del viaje que este coche acaba de terminar?»: pedidos de esa matrícula
-- creados alrededor de cuando empezó el viaje. db/156 dejó el índice por hora
-- de bajada (el último destino), que no sirve para esta pregunta, y sin este la
-- consulta recorre la tabla entera de pedidos, que crece cada día.

CREATE INDEX IF NOT EXISTS idx_border_coche_creado ON bolt_order (matricula_norm, creado_ts);
