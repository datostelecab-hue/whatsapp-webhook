-- ============================================================
-- 282 — LA REVISIÓN DE LAS FOTOS DEL PORTAL, EN EL TALLER
-- ============================================================
-- Camilo, 24/11/2026: «un módulo en el ERP en taller, en el cual pueda comparar
-- las dos últimos lotes de fotos de los conductores (…) por cada dos últimas
-- fotos, debemos de comprobar a mano las fotos de los coches, para aprobar la
-- revisión, una vez calificada, esperamos el próximo ciclo de dos lotes».
--
-- UN LOTE son las cinco fotos que hace un conductor al desvincular el coche en
-- el portal (adjunto de tipo `turno_fotos`, cuyo dueño es su `fichaje_turno`).
-- Lo decidido en el chat:
--   · CADA LOTE CON EL ANTERIOR del mismo coche (A-B, B-C, C-D…): cada entrega
--     se revisa una vez, y un daño nuevo es del conductor del lote nuevo.
--   · Se califica «Aprobada» o «Con daños» (con nota y en qué fotos se ve).
--   · Los lotes CON DAÑOS no se borran a los 20 días (los dos de la pareja: el
--     de antes prueba que estaba bien). Lo demás caduca como siempre.
--
-- Una fila por lote calificado (`turno_id`, el nuevo). Con qué se comparó
-- (`turno_anterior_id`) se guarda al calificar: si el anterior ya se había
-- borrado, va vacío. Las parejas pendientes no se guardan: se calculan.
--
-- Bajo el libro de auditoría: quién calificó, quién lo cambió y cuándo.
--
-- Llaves: MIRAR '/revision-fotos' (quien ya mira Mantenimientos) y CALIFICAR
-- '/revision-fotos/calificar' (quien ya apunta en Mantenimientos).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/282', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS taller_revision_fotos (
  id                 BIGSERIAL PRIMARY KEY,
  turno_id           BIGINT NOT NULL REFERENCES fichaje_turno(id),
  turno_anterior_id  BIGINT REFERENCES fichaje_turno(id),
  vehiculo_id        BIGINT REFERENCES vehiculo(id),
  resultado          VARCHAR(10) NOT NULL,
  nota               TEXT,
  fotos              SMALLINT[] NOT NULL DEFAULT '{}',
  revisado_por       INTEGER REFERENCES usuario(id),
  revisado_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_revision_fotos_turno UNIQUE (turno_id),
  CONSTRAINT ck_revision_fotos_resultado CHECK (resultado IN ('aprobada', 'danos')),
  CONSTRAINT ck_revision_fotos_nota CHECK (resultado <> 'danos' OR length(btrim(COALESCE(nota, ''))) > 0),
  CONSTRAINT ck_revision_fotos_fotos CHECK (fotos <@ ARRAY[1, 2, 3, 4, 5]::SMALLINT[])
);

COMMENT ON TABLE taller_revision_fotos IS
  'La revisión de las fotos del portal en el taller (db/282): cada lote (las 5 fotos al desvincular) se compara con el anterior del mismo coche y se califica. Los lotes con daños no se borran a los 20 días.';
COMMENT ON COLUMN taller_revision_fotos.turno_id IS 'El lote calificado (el nuevo): el turno de fichaje dueño de sus fotos';
COMMENT ON COLUMN taller_revision_fotos.turno_anterior_id IS 'Con qué lote se comparó al calificar; vacío si no había (el primero del coche, o ya borrado)';
COMMENT ON COLUMN taller_revision_fotos.resultado IS 'aprobada | danos';
COMMENT ON COLUMN taller_revision_fotos.fotos IS 'Con daños: en qué fotos se ve (1 lateral conductor, 2 frontal, 3 lateral copiloto, 4 trasera, 5 asientos)';

SELECT auditoria_vigilar('taller_revision_fotos');

-- ── Quién la ve y quién califica ───────────────────────────────────────────
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/revision-fotos', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/revision-fotos');

INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT p.usuario_id, '/revision-fotos/calificar', NULL
  FROM usuario_permiso p
 WHERE p.clave = '/taller/apuntar'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = p.usuario_id AND q.clave = '/revision-fotos/calificar');

COMMIT;
