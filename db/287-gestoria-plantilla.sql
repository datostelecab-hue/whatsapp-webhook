-- ============================================================
-- 287 — LA PLANTILLA DE LA GESTORÍA: EL CRUCE Y SUS DISCREPANCIAS
-- ============================================================
-- Módulo 8 del plan de RR. HH. y nóminas (docs/Plan RRHH y nominas.md).
-- Camilo, 25/11/2026: «Sí, arranca el módulo 8 con la proforma». El problema:
-- aparecen en la nómina conductores ya finiquitados, hay bajas que la gestoría
-- nunca tramitó (y se sigue cotizando) y altas que nunca llegaron.
--
-- Se sube el listado de la gestoría (la proforma de A3NOM, o el listado de
-- plantilla en alta cuando llegue), se cruza por LEGAJO con la plantilla propia
-- y cada discrepancia queda aquí, viva hasta que se resuelve:
--   · alta_gestoria_baja_nuestra  la gestoría la tiene y para nosotros se fue
--   · alta_nuestra_no_gestoria    la tenemos de alta y la gestoría no
--   · legajo_desconocido          un legajo de la gestoría que el ERP no tiene
--   · legajo_cambiado             la misma persona con otro legajo en la gestoría
--   · nombre_distinto             el legajo es de otra persona en el ERP
--   · sin_legajo                  de alta con nosotros y sin legajo: no se puede cruzar
-- La misma discrepancia no se repite entre cargas (una viva por `clave`). Si en
-- la carga siguiente ya no sale, se resuelve sola, diciendo con qué listado.
--
-- Y quién sube el listado cada lunes: la función de Organización
-- «plantilla_gestoria», que se pone al puesto «Administración de personal y
-- nómina» (el de Diana). Llaves: '/gestoria' (mirar) y '/gestoria/gestionar'
-- (subir y resolver).
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/287', true),
       set_config('telecab.usuario_id', '7', true);

CREATE TABLE IF NOT EXISTS gestoria_discrepancia (
  id              BIGSERIAL PRIMARY KEY,
  clave           VARCHAR(80)  NOT NULL,
  tipo            VARCHAR(30)  NOT NULL,
  conductor_id    BIGINT REFERENCES conductor(id),
  legajo          VARCHAR(6),
  nombre_gestoria VARCHAR(200),
  detalle         JSONB,
  fichero_id      BIGINT REFERENCES fichero_importado(id),
  ultimo_fichero_id BIGINT REFERENCES fichero_importado(id),
  estado          VARCHAR(12)  NOT NULL DEFAULT 'pendiente',
  nota            TEXT,
  enviada_at      TIMESTAMPTZ,
  enviada_por     INTEGER REFERENCES usuario(id),
  resuelta_at     TIMESTAMPTZ,
  resuelta_por    INTEGER REFERENCES usuario(id),
  creado_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT ck_gestoria_disc_tipo CHECK (tipo IN ('alta_gestoria_baja_nuestra', 'alta_nuestra_no_gestoria', 'legajo_cambiado',
                                                   'legajo_desconocido', 'nombre_distinto', 'sin_legajo')),
  CONSTRAINT ck_gestoria_disc_estado CHECK (estado IN ('pendiente', 'resuelta', 'descartada')),
  CONSTRAINT ck_gestoria_disc_cierre CHECK ((estado = 'pendiente') = (resuelta_at IS NULL))
);

-- Una viva por discrepancia: la misma no se apunta dos veces.
CREATE UNIQUE INDEX IF NOT EXISTS uq_gestoria_disc_viva ON gestoria_discrepancia (clave) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS ix_gestoria_disc_estado ON gestoria_discrepancia (estado, creado_at DESC);

COMMENT ON TABLE gestoria_discrepancia IS
  'Módulo 8 (db/287): lo que no cuadra entre el listado de la gestoría y la plantilla propia, cruzado por legajo. Viva hasta resolverla; si deja de salir en un listado, se resuelve sola.';

SELECT auditoria_vigilar('gestoria_discrepancia');

-- ── Quién sube el listado del lunes: la función, en el puesto de Diana ─────
INSERT INTO puesto_funcion (puesto_codigo, funcion, suplente)
SELECT 'administracion_personal', 'plantilla_gestoria', FALSE
 WHERE EXISTS (SELECT 1 FROM puesto WHERE codigo = 'administracion_personal')
   AND NOT EXISTS (SELECT 1 FROM puesto_funcion
                    WHERE puesto_codigo = 'administracion_personal' AND funcion = 'plantilla_gestoria' AND anulado_at IS NULL);

-- ── Las llaves ──────────────────────────────────────────────────────────────
-- Mirar y gestionar: Diana (id y nombre, como db/285). Mirar: Ignacio.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, c.clave, NULL
  FROM usuario u
  JOIN (VALUES (20, 'Diana', '/gestoria'), (20, 'Diana', '/gestoria/gestionar'), (1, 'Ignacio', '/gestoria')) AS c (id, nombre, clave)
    ON c.id = u.id AND c.nombre = u.nombre
 WHERE NOT EXISTS (SELECT 1 FROM usuario_permiso p WHERE p.usuario_id = u.id AND p.clave = c.clave);

COMMIT;
