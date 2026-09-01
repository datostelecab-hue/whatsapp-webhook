-- ============================================================
-- 55 - EL CUADRANTE: el grupo de coches que comparte correturnos
-- ============================================================
-- El cuadrante se construye DESDE los días de libranza (spec de Tráfico):
--
--   Bloque L/M -> matrícula 0400MMZ -> fijo día + fijo noche (libran L/M)
--   Bloque X/J -> matrícula 0401ZZX -> fijo día + fijo noche (libran X/J)
--
-- Los CT del cuadrante cubren los 4 días ENTRE las dos matrículas: el CT día
-- trabaja L M X J y libra el complemento (V S D). Un cuadrante es de >= 2 coches;
-- un coche suelto (sin cuadrante) es solo sus dos días, sin correturnos que
-- abarque nada. Por eso la pertenencia es opcional.
--
-- Lo que NO hace falta inventar: la libranza del fijo sigue siendo su
-- patron_libranza (los días de su bloque) y el CT sigue cubriendo por
-- asignacion_dia. El cuadrante solo AGRUPA los coches para que un CT se asigne
-- una vez y se reparta entre ellos. Ni f_cobertura ni v_plaza_ct_sugerida
-- cambian su regla.

BEGIN;

CREATE TABLE cuadrante (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre       VARCHAR(80) NOT NULL,
  base_zona_id SMALLINT    REFERENCES base_zona(id),
  usuario_id   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  baja_at      TIMESTAMPTZ
);
CREATE INDEX idx_cuadrante_vivo ON cuadrante (base_zona_id) WHERE baja_at IS NULL;

COMMENT ON TABLE cuadrante IS
  'Un grupo de coches (bloques de días) que comparten correturnos. El CT se asigna al cuadrante y se reparte entre sus coches';

-- Un coche pertenece como mucho a un cuadrante (o a ninguno: coche suelto).
ALTER TABLE vehiculo ADD COLUMN IF NOT EXISTS cuadrante_id BIGINT
  REFERENCES cuadrante(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehiculo_cuadrante ON vehiculo (cuadrante_id) WHERE cuadrante_id IS NOT NULL;

COMMENT ON COLUMN vehiculo.cuadrante_id IS
  'El cuadrante al que pertenece el coche, o NULL si va suelto (solo sus dos días de libranza)';

-- ── v_plaza, ahora con el cuadrante del coche ──────────────────────────────
-- Las columnas nuevas van al final: CREATE OR REPLACE VIEW exige conservar las
-- anteriores en su orden.
CREATE OR REPLACE VIEW v_plaza AS
SELECT p.id                                   AS plaza_id,
       p.vehiculo_id,
       v.matricula,
       v.estado_operativo,
       ev.es_operativo,
       ev.visible_cobertura,
       v.base_zona_id,
       bz.nombre                              AS zona,
       p.slot,
       s.turno_id,
       t.codigo                               AS turno_codigo,
       t.etiqueta                             AS turno,
       s.rol,
       s.orden_ct,
       p.orden_pantalla,
       v.cuadrante_id,
       cu.nombre                              AS cuadrante
  FROM plaza p
  JOIN vehiculo v              ON v.id = p.vehiculo_id AND v.baja_at IS NULL
  JOIN cat_slot s              ON s.slot = p.slot
  JOIN turno t                 ON t.id = s.turno_id
  JOIN cat_estado_vehiculo ev  ON ev.codigo = v.estado_operativo
  LEFT JOIN base_zona bz       ON bz.id = v.base_zona_id
  LEFT JOIN cuadrante cu       ON cu.id = v.cuadrante_id AND cu.baja_at IS NULL
 WHERE p.baja_at IS NULL;

COMMIT;
