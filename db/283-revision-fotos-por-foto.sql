-- ============================================================
-- 283 — LA REVISIÓN DE FOTOS, FOTO A FOTO
-- ============================================================
-- Camilo, 24/11/2026, sobre la revisión de db/282: «la quiero tipo tinder
-- jajaj, toca aprobar cada foto con su némesis, además de que a parte toca
-- aprobar / con daños, también poder poner si una foto está mal tomada o no
-- muestra nada, para poder reportar al conductor por no hacer el trabajo, es
-- comparación por comparación, dos, dos, dos, dos y dos, cada una con aprobar
-- / con daños / Imagen no válida».
--
-- `taller_revision_foto`: el veredicto de CADA comparación (la foto n del lote
-- nuevo contra la n del anterior): aprobada, con daños (nota obligatoria) o
-- imagen no válida (mal hecha o no enseña nada: es del conductor del lote
-- nuevo, y el motivo es opcional).
--
-- `taller_revision_fotos` (db/282) queda como el CIERRE de la pareja: se
-- escribe al juzgar la quinta y su resultado sale de las cinco — con daños si
-- alguna lo tiene; si no, imagen no válida si alguna lo es; si no, aprobada.
-- La nota pasa a cada foto: la de la pareja deja de ser obligatoria.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/283', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS taller_revision_foto (
  id            BIGSERIAL PRIMARY KEY,
  turno_id      BIGINT NOT NULL REFERENCES fichaje_turno(id),
  n             SMALLINT NOT NULL,
  resultado     VARCHAR(10) NOT NULL,
  nota          TEXT,
  revisado_por  INTEGER REFERENCES usuario(id),
  revisado_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_revision_foto UNIQUE (turno_id, n),
  CONSTRAINT ck_revision_foto_n CHECK (n BETWEEN 1 AND 5),
  CONSTRAINT ck_revision_foto_resultado CHECK (resultado IN ('aprobada', 'danos', 'no_valida')),
  CONSTRAINT ck_revision_foto_nota CHECK (resultado <> 'danos' OR length(btrim(COALESCE(nota, ''))) > 0)
);

COMMENT ON TABLE taller_revision_foto IS
  'La revisión de fotos foto a foto (db/283): la foto n del lote nuevo contra la n del anterior del mismo coche. aprobada | danos (con nota) | no_valida (mal hecha o no enseña nada; motivo opcional).';
COMMENT ON COLUMN taller_revision_foto.n IS '1 lateral conductor, 2 frontal, 3 lateral copiloto, 4 trasera, 5 asientos';

SELECT auditoria_vigilar('taller_revision_foto');

-- La pareja: un resultado más, y la nota ya no es suya sino de cada foto.
ALTER TABLE taller_revision_fotos DROP CONSTRAINT IF EXISTS ck_revision_fotos_resultado;
ALTER TABLE taller_revision_fotos ADD CONSTRAINT ck_revision_fotos_resultado
  CHECK (resultado IN ('aprobada', 'danos', 'no_valida'));
ALTER TABLE taller_revision_fotos DROP CONSTRAINT IF EXISTS ck_revision_fotos_nota;

COMMENT ON COLUMN taller_revision_fotos.resultado IS
  'aprobada | danos | no_valida. Desde db/283 sale de las cinco fotos (taller_revision_foto): con daños si alguna; si no, no válida si alguna; si no, aprobada.';

COMMIT;
