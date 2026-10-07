-- ============================================================
-- 184 — UN ESTADO MÁS DEL COCHE: 'P' Policía
-- ============================================================
-- Camilo, 07/10/2026: en la ficha del coche (Vehículos → Editar), además de
-- Operativo, En taller, Siniestro…, tiene que poder ponerse «Policía»: el
-- coche lo tiene la policía (retenido, precintado…) y no se puede usar.
--
-- Se comporta como En taller o Siniestro: es_operativo FALSE (no se puede
-- conducir) y visible_cobertura FALSE (sale del cuadrante). El planificador
-- y Control leen esas dos marcas del catálogo, no el código, así que lo
-- tratan igual sin tocar nada: sus conductores quedan avisados de que se han
-- quedado sin coche y, si se mueve, Control lo señala.
--
-- Va el último en las listas (orden 8, detrás de Emergencia). Los colores y
-- los textos de cada estado que están escritos en el código se tocan en el
-- mismo cambio (Vehículos, planificador, cobertura y la parrilla).

BEGIN;

INSERT INTO cat_estado_vehiculo (codigo, etiqueta, es_operativo, visible_cobertura, orden)
VALUES ('P', 'Policía', FALSE, FALSE, 8)
ON CONFLICT (codigo) DO NOTHING;

COMMIT;
