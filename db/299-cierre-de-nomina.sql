-- ============================================================
-- 299 — EL CIERRE DE LA NÓMINA DEL MES (MÓDULO 4 DEL PLAN DE RR. HH.)
-- ============================================================
-- El encargo: «el periodo con sus etapas, la línea de progreso y el calendario
-- con tarjetas». Camilo, 26/11/2026, eligió cuatro etapas por mes de nómina
-- (el del 26 al 25), cada una con su fecha:
--
--   1. Proforma revisada          el 20  (se ve sola: no quedan casos en
--                                         Gestoría › Proforma; no se guarda aquí)
--   2. Variables y descuentos     el 25  (el corte: la variable del mes
--      enviados a la gestoría             congelada en /nominas y los
--                                         descuentos del mes cerrados)
--   3. Borrador revisado          el 28  (el borrador que devuelve la gestoría)
--   4. Nómina aprobada            el 30  (o el último día del mes). La aprueba
--                                         quien tiene la llave nueva
--                                         '/gestoria/nomina': Ignacio.
--
-- Los días, en Parámetros (`nomina.cierre_*`). Sobre cada fecha nace una
-- tarjeta en el tablero; se cierra al marcar la etapa.
--
-- `nomina_cierre_etapa`: cada etapa marcada de un mes, con quién y cuándo. Se
-- puede deshacer (con motivo) y queda la fila con quién la deshizo: una nueva
-- marca es otra fila. Solo una viva por mes y etapa.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/299', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS nomina_cierre_etapa (
  id               BIGSERIAL PRIMARY KEY,
  periodo          VARCHAR(7)   NOT NULL,
  etapa            VARCHAR(10)  NOT NULL,
  nota             TEXT,
  hecho_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  hecho_por        INTEGER REFERENCES usuario(id),
  deshecho_at      TIMESTAMPTZ,
  deshecho_por     INTEGER REFERENCES usuario(id),
  deshecho_motivo  TEXT,
  CONSTRAINT ck_cierre_etapa CHECK (etapa IN ('variables', 'borrador', 'aprobada')),
  CONSTRAINT ck_cierre_periodo CHECK (periodo ~ '^\d{4}-\d{2}$'),
  CONSTRAINT ck_cierre_deshecho CHECK (deshecho_at IS NULL OR btrim(COALESCE(deshecho_motivo, '')) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cierre_etapa_viva ON nomina_cierre_etapa (periodo, etapa) WHERE deshecho_at IS NULL;

COMMENT ON TABLE nomina_cierre_etapa IS
  'Módulo 4 (db/299): las etapas marcadas del cierre de cada mes de nómina (variables y descuentos enviados, borrador revisado, nómina aprobada). La proforma revisada se calcula sola.';

SELECT auditoria_vigilar('nomina_cierre_etapa');

-- ── La llave de aprobar la nómina del mes, a Ignacio. ──
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (1, 'Ignacio', '/gestoria/nomina')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
