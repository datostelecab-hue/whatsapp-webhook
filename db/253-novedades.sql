-- ============================================================
-- 253 — LAS NOVEDADES: quién ha visto la ventana de cada versión
-- ============================================================
-- Con la V3 (16/11/2026) llega a todos una ventana con lo nuevo y lo que ya
-- trae el ERP, y un recorrido guiado opcional (Camilo: «se avisará en una
-- ventana en prod la actualización de toda la aplicación»). Sale UNA vez por
-- persona y versión, en cualquier dispositivo: por eso se guarda aquí y no en
-- el navegador. Y se puede medir quién la vio y quién hizo el recorrido.
--
-- Lo que dice cada versión está en public/assets/js/novedades.js; cuál es la
-- versión de ahora, en modules/Novedades/novedades.service.js.

BEGIN;

CREATE TABLE IF NOT EXISTS novedad_vista (
  usuario_id    INTEGER      NOT NULL REFERENCES usuario(id),
  version       VARCHAR(20)  NOT NULL CHECK (version ~ '^[a-z0-9][a-z0-9._-]*$'),
  vista_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- El recorrido guiado: 'hecho' (llegó al final) o 'saltado' (lo dejó a medias).
  -- Sin él, ni lo empezó.
  recorrido     VARCHAR(10)  CHECK (recorrido IN ('hecho', 'saltado')),
  recorrido_at  TIMESTAMPTZ,
  PRIMARY KEY (usuario_id, version),
  CONSTRAINT ck_novedad_recorrido CHECK ((recorrido IS NULL) = (recorrido_at IS NULL))
);

COMMENT ON TABLE novedad_vista IS
  'Quién ha visto la ventana de novedades de cada versión y si hizo el recorrido guiado (db/253). Ver modules/Novedades.';

COMMIT;
