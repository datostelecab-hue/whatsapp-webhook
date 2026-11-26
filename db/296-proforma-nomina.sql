-- ============================================================
-- 296 — LA PROFORMA DE A3: REVISARLA CONTRA EL ERP (MÓDULO 4)
-- ============================================================
-- La proforma es la nómina del mes que calcula A3NOM antes de las variables, y
-- que la gestoría manda para revisar. Camilo, 25/11/2026: que el ERP haga solo
-- el cruce que se hizo a mano ese día. Va en Gestoría (pestaña «Proforma»), con
-- sus mismas llaves ('/gestoria' mirar, '/gestoria/gestionar' subir y decidir).
--
-- `proforma_caso`: una cosa que no cuadra en la proforma de un mes (un código
-- que el ERP no tiene, una baja médica sin IT, una suspensión que no descuenta,
-- días cotizados que no son los del contrato…). Diana decide cada uno:
--   a3   corregir en A3 (va al correo a la gestoría)
--   erp  corregir en el ERP
--   bien está bien así
-- y si en una proforma nueva del mismo mes ya no sale, se cierra sola
-- (ya_no_sale). Uno por mes y caso (`clave`). Avisa, no frena: una tarjeta a
-- quien sube los listados de la gestoría, que vence el día del corte.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/296', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS proforma_caso (
  id                BIGSERIAL PRIMARY KEY,
  periodo           VARCHAR(7)   NOT NULL,
  clave             VARCHAR(80)  NOT NULL,
  tipo              VARCHAR(16)  NOT NULL,
  conductor_id      BIGINT REFERENCES conductor(id),
  legajo            VARCHAR(6),
  nombre_a3         VARCHAR(200),
  detalle           JSONB,
  fichero_id        BIGINT REFERENCES fichero_importado(id),
  ultimo_fichero_id BIGINT REFERENCES fichero_importado(id),
  decision          VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
  nota              TEXT,
  decidido_at       TIMESTAMPTZ,
  decidido_por      INTEGER REFERENCES usuario(id),
  enviada_at        TIMESTAMPTZ,
  enviada_por       INTEGER REFERENCES usuario(id),
  creado_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_proforma_caso UNIQUE (periodo, clave),
  CONSTRAINT ck_proforma_periodo CHECK (periodo ~ '^\d{4}-\d{2}$'),
  CONSTRAINT ck_proforma_tipo CHECK (tipo IN ('legajo', 'sin_contrato', 'baja_medica', 'suspension', 'dias', 'fuera')),
  CONSTRAINT ck_proforma_decision CHECK (decision IN ('pendiente', 'a3', 'erp', 'bien', 'ya_no_sale'))
);

CREATE INDEX IF NOT EXISTS ix_proforma_caso_pendiente ON proforma_caso (periodo) WHERE decision = 'pendiente';

COMMENT ON TABLE proforma_caso IS
  'Módulo 4 (db/296): lo que no cuadra entre la proforma de A3 de un mes y el ERP. Diana decide: corregir en A3 (correo a la gestoría), en el ERP o está bien.';

SELECT auditoria_vigilar('proforma_caso');

COMMIT;
