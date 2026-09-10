-- ============================================================
-- 90 — La VACANTE deja de ser una fila de una hoja
-- ============================================================
-- Hasta ahora una vacante era una fila en la hoja VACANTES con las matrículas
-- metidas dentro de una celda en JSON, y el resto del sistema la señalaba con
-- un texto ('V…'). Eso tenía tres agujeros que se notaban al usarlo:
--
--   · NADIE PODÍA SABER QUÉ PLAZA ESTABA COMPROMETIDA. La vacante guardaba
--     matrículas, no plazas, así que el planificador no podía pintar "esta plaza
--     está en la vacante V123" y dos personas podían prometer el mismo sitio.
--     Al aceptar la incorporación se salía a BUSCAR una plaza libre de ese coche
--     y turno; si entre medias alguien la ocupaba, el alta fallaba en el último
--     paso, cuando la persona ya estaba contratada.
--
--   · NO EXISTÍA EL RECAMBIO. Solo se sabían generar vacantes de huecos VACÍOS.
--     Sacar a alguien y buscar quien lo sustituya —que es la mitad del trabajo—
--     no se podía ni escribir: la plaza no estaba libre, así que no era un hueco.
--
--   · EL ENLACE CON SELECCIÓN ERA UN TEXTO SUELTO. `candidatura.vacante_ref`
--     apuntaba a una hoja; nada garantizaba que esa vacante existiera, ni se
--     podía preguntar "quién viene a esta plaza y cuándo".
--
-- Aquí la vacante es una fila con sus PLAZAS REALES colgando, la candidatura la
-- señala por clave foránea, y el planificador puede leer de una vista quién está
-- comprometido dónde.

BEGIN;

-- ── La vacante ──────────────────────────────────────────────────────────────
CREATE TABLE vacante (
  id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El código legible ('V…'). Se conserva porque es lo que se dice en voz alta y
  -- lo que quedó escrito en las fichas viejas.
  codigo        VARCHAR(24) NOT NULL UNIQUE,

  estado        VARCHAR(12) NOT NULL DEFAULT 'abierta',
  -- Por qué existe. Una vacante de RECAMBIO no es un hueco: es una plaza que
  -- todavía tiene dueño y que se va a quedar libre. Se ven distinto y se llaman
  -- distinto, y mezclarlas era lo que hacía imposible generar la segunda.
  motivo        VARCHAR(12) NOT NULL DEFAULT 'nueva',

  rol           VARCHAR(8)  NOT NULL,                                    -- FIJO | CT
  turno_id      SMALLINT    REFERENCES turno(id)      ON DELETE SET NULL,
  base_zona_id  SMALLINT    REFERENCES base_zona(id)  ON DELETE SET NULL,

  -- La jornada que sale de las plazas que cubre, no de lo que teclee nadie:
  -- un FIJO son 40 h; un CT, 32 h salvo que llegue a los 6 días (3 coches), que
  -- entonces son 40 también. Se guarda calculada para que la vacante diga sola
  -- qué contrato se está ofreciendo.
  jornada_horas SMALLINT,

  -- A quién se sustituye (solo en las de recambio) y desde cuándo queda libre
  -- su sitio. Con esto el planificador puede decir "sale Ana el 30, entra quien
  -- salga de esta vacante".
  sustituye_a     BIGINT REFERENCES conductor(id) ON DELETE SET NULL,
  salida_prevista DATE,

  notas         TEXT,
  motivo_cierre VARCHAR(200),

  usuario_id    INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrado_at    TIMESTAMPTZ,

  CONSTRAINT ck_vacante_estado CHECK (estado IN ('abierta', 'proceso', 'cubierta', 'anulada')),
  CONSTRAINT ck_vacante_rol    CHECK (rol    IN ('FIJO', 'CT')),
  CONSTRAINT ck_vacante_motivo CHECK (motivo IN ('nueva', 'recambio')),
  -- Una de recambio sin nadie a quien sustituir es una de las dos cosas mal
  -- escrita. La base no deja elegir.
  CONSTRAINT ck_vacante_recambio CHECK (motivo <> 'recambio' OR sustituye_a IS NOT NULL)
);

CREATE INDEX idx_vacante_viva  ON vacante (creado_at) WHERE estado IN ('abierta', 'proceso');
CREATE INDEX idx_vacante_susti ON vacante (sustituye_a) WHERE sustituye_a IS NOT NULL;

COMMENT ON TABLE vacante IS
  'Un puesto que hay que cubrir, con las PLAZAS reales que se prometen. Sustituye a la hoja VACANTES';
COMMENT ON COLUMN vacante.estado IS
  'abierta = se recluta · proceso = ya tiene candidato · cubierta = alguien la ocupo · anulada = ya no hace falta';
COMMENT ON COLUMN vacante.jornada_horas IS
  'Calculada de las plazas: FIJO 40; CT 32, o 40 si cubre 6 dias (3 coches)';

-- ── Las plazas que se prometen ──────────────────────────────────────────────
-- La plaza REAL, no la matrícula. Una vacante de fijo trae una; una de
-- correturnos, dos o tres (un coche por bloque de descanso).
CREATE TABLE vacante_plaza (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vacante_id BIGINT NOT NULL REFERENCES vacante(id) ON DELETE CASCADE,
  plaza_id   BIGINT NOT NULL REFERENCES plaza(id)   ON DELETE CASCADE,
  UNIQUE (vacante_id, plaza_id)
);

CREATE INDEX idx_vacante_plaza_plaza ON vacante_plaza (plaza_id);

-- Los días que cubre en esa plaza. Vacío = toda la semana (es un fijo).
-- Normalizado como `asignacion_dia` y `vehiculo_descanso_dia`: en esta base los
-- días de la semana se guardan en filas, no en un array ni en una cadena.
CREATE TABLE vacante_plaza_dia (
  vacante_plaza_id BIGINT   NOT NULL REFERENCES vacante_plaza(id) ON DELETE CASCADE,
  dia_semana       SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  PRIMARY KEY (vacante_plaza_id, dia_semana)
);

-- ── El enlace con Selección ─────────────────────────────────────────────────
-- `vacante_ref` (texto, apuntando a la hoja) se queda para no perder lo escrito,
-- pero la verdad pasa a ser la clave foránea. Al cerrarse la candidatura la
-- vacante NO se borra: se libera, que es otra cosa.
ALTER TABLE candidatura
  ADD COLUMN IF NOT EXISTS vacante_id BIGINT REFERENCES vacante(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_cand_vacante ON candidatura (vacante_id) WHERE vacante_id IS NOT NULL;

COMMENT ON COLUMN candidatura.vacante_id IS
  'La vacante que este candidato viene a cubrir. Manda sobre vacante_ref, que era el id de la hoja';

-- La incorporación ya señalaba la vacante por su TEXTO ('V…'), y ese texto es
-- ahora `vacante.codigo`, que es único. No se renombra ni se añade nada: la
-- columna que había resuelve sola contra la tabla nueva.
--
-- Y no es pereza: esta migración se aplica desde el panel, con el código viejo
-- todavía corriendo. Renombrar `incorporacion.vacante_id` habría roto las
-- notificaciones —que preguntan por las incorporaciones pendientes en cada
-- refresco— entre el momento de aplicarla y el del despliegue. Una migración que
-- solo AÑADE se puede aplicar cuando se quiera.
COMMENT ON COLUMN incorporacion.vacante_id IS
  'El CODIGO de la vacante (vacante.codigo), no su id numerico. Se llama asi desde que la vacante vivia en una hoja';

-- ── Lo que lee la pantalla ──────────────────────────────────────────────────
-- Una plaza de vacante con todo resuelto: coche, zona, turno, rol, los días en
-- letras y —lo que no existía— QUIÉN LA OCUPA HOY. En una vacante de recambio,
-- ese es justo el que se va.
CREATE OR REPLACE VIEW v_vacante_plaza AS
SELECT vp.id                         AS vacante_plaza_id,
       vp.vacante_id,
       vp.plaza_id,
       p.vehiculo_id,
       v.matricula,
       COALESCE(bz.nombre, '')       AS zona,
       s.rol,
       s.orden_ct,
       s.turno_id,
       t.etiqueta                    AS turno,
       COALESCE(d.dias, ARRAY[]::smallint[])          AS dias,
       -- Las letras, en el orden de la semana, para no armarlas en JavaScript.
       COALESCE(d.letras, '')                          AS letras,
       -- Los días que descansa el coche: son los que cubre el correturnos y los
       -- que libra el fijo. Es la libranza de la plaza, dicha por el coche.
       COALESCE(des.dias, ARRAY[]::smallint[])         AS descanso_coche,
       a.conductor_id                                  AS ocupa_id,
       CASE WHEN a.conductor_id IS NULL THEN NULL
            ELSE COALESCE(NULLIF(btrim(c.nombre_bolt), ''),
                          btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))) END AS ocupa,
       a.hasta                                         AS ocupa_hasta
  FROM vacante_plaza vp
  JOIN plaza p       ON p.id = vp.plaza_id
  JOIN vehiculo v    ON v.id = p.vehiculo_id
  JOIN cat_slot s    ON s.slot = p.slot
  LEFT JOIN turno t      ON t.id = s.turno_id
  LEFT JOIN base_zona bz ON bz.id = v.base_zona_id
  LEFT JOIN LATERAL (
    SELECT array_agg(vpd.dia_semana ORDER BY vpd.dia_semana) AS dias,
           string_agg(CASE vpd.dia_semana WHEN 1 THEN 'L' WHEN 2 THEN 'M' WHEN 3 THEN 'X'
                                          WHEN 4 THEN 'J' WHEN 5 THEN 'V' WHEN 6 THEN 'S'
                                          ELSE 'D' END, ' ' ORDER BY vpd.dia_semana) AS letras
      FROM vacante_plaza_dia vpd WHERE vpd.vacante_plaza_id = vp.id) d ON TRUE
  LEFT JOIN LATERAL (
    SELECT array_agg(vdd.dia_semana ORDER BY vdd.dia_semana) AS dias
      FROM vehiculo_descanso vd
      JOIN vehiculo_descanso_dia vdd ON vdd.descanso_id = vd.id
     WHERE vd.vehiculo_id = p.vehiculo_id
       AND vd.desde <= CURRENT_DATE AND (vd.hasta IS NULL OR vd.hasta >= CURRENT_DATE)) des ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, conductor_id, hasta FROM asignacion
     WHERE plaza_id = vp.plaza_id AND retirada_at IS NULL
       AND desde <= CURRENT_DATE AND (hasta IS NULL OR hasta >= CURRENT_DATE)
     ORDER BY desde DESC LIMIT 1) a ON TRUE
  LEFT JOIN conductor c ON c.id = a.conductor_id;

COMMENT ON VIEW v_vacante_plaza IS
  'Cada plaza prometida en una vacante, con coche, zona, turno, dias y quien la ocupa hoy';

-- La vacante entera, con lo que hay que enseñar sin cruzar nada fuera.
CREATE OR REPLACE VIEW v_vacante AS
SELECT k.id, k.codigo, k.estado, k.motivo, k.rol, k.jornada_horas,
       k.turno_id, t.etiqueta AS turno,
       k.base_zona_id, bz.nombre AS zona,
       k.sustituye_a, k.salida_prevista, k.notas, k.motivo_cierre,
       k.creado_at, k.actualizado_at, k.cerrado_at,
       CASE WHEN k.sustituye_a IS NULL THEN NULL
            ELSE COALESCE(NULLIF(btrim(sc.nombre_bolt), ''),
                          btrim(sc.nombre || ' ' || COALESCE(sc.apellidos, ''))) END AS sustituye,
       COALESCE(pl.plazas, 0)                          AS plazas,
       COALESCE(pl.dias, 0)                            AS dias,
       COALESCE(pl.matriculas, '')                     AS matriculas,
       COALESCE(pl.zonas, '')                          AS zonas,
       -- La libranza que se ofrece: los días de la semana que NO cubre. En un
       -- fijo son los de descanso de su coche; en un correturnos, lo que le
       -- queda suelto.
       COALESCE(pl.libranzas, '')                      AS libranzas,
       kand.candidatura_id, kand.candidato, kand.estado_candidatura, kand.inicio_previsto
  FROM vacante k
  LEFT JOIN turno t       ON t.id = k.turno_id
  LEFT JOIN base_zona bz  ON bz.id = k.base_zona_id
  LEFT JOIN conductor sc  ON sc.id = k.sustituye_a
  LEFT JOIN LATERAL (
    SELECT count(*)::int                                          AS plazas,
           COALESCE(sum(cardinality(vp.dias)), 0)::int            AS dias,
           string_agg(DISTINCT vp.matricula, ' · ')               AS matriculas,
           string_agg(DISTINCT NULLIF(vp.zona, ''), ' · ')        AS zonas,
           (SELECT string_agg(l, ' ') FROM unnest(ARRAY['L','M','X','J','V','S','D']) WITH ORDINALITY u(l, n)
             WHERE NOT EXISTS (SELECT 1 FROM v_vacante_plaza w
                                WHERE w.vacante_id = k.id AND n::smallint = ANY(w.dias))) AS libranzas
      FROM v_vacante_plaza vp WHERE vp.vacante_id = k.id) pl ON TRUE
  -- El candidato enganchado, si lo hay. Es lo que contesta "quién viene y cuándo".
  LEFT JOIN LATERAL (
    SELECT kk.id AS candidatura_id, kk.estado AS estado_candidatura,
           kk.inicio_previsto,
           btrim(COALESCE(kc.apellidos || ', ', '') || kc.nombre) AS candidato
      FROM candidatura kk JOIN conductor kc ON kc.id = kk.conductor_id
     WHERE kk.vacante_id = k.id AND kk.cerrado_at IS NULL
     ORDER BY kk.creado_at DESC LIMIT 1) kand ON TRUE;

COMMENT ON VIEW v_vacante IS
  'La vacante lista para pintar: matriculas, zonas, libranzas, a quien sustituye y que candidato la tiene';

-- Qué plazas están comprometidas AHORA MISMO. Es lo que mira el planificador
-- para avisar antes de colocar a alguien donde ya se prometió otro sitio, y lo
-- que impide generar dos vacantes sobre la misma plaza.
CREATE OR REPLACE VIEW v_plaza_comprometida AS
SELECT vp.plaza_id, k.id AS vacante_id, k.codigo, k.estado, k.motivo, k.rol,
       k.sustituye_a, k.salida_prevista,
       w.letras, w.dias, w.matricula, w.turno, w.ocupa_id, w.ocupa,
       kand.candidato, kand.inicio_previsto
  FROM vacante_plaza vp
  JOIN vacante k ON k.id = vp.vacante_id AND k.estado IN ('abierta', 'proceso')
  LEFT JOIN v_vacante_plaza w ON w.vacante_plaza_id = vp.id
  LEFT JOIN LATERAL (
    SELECT btrim(COALESCE(kc.apellidos || ', ', '') || kc.nombre) AS candidato, kk.inicio_previsto
      FROM candidatura kk JOIN conductor kc ON kc.id = kk.conductor_id
     WHERE kk.vacante_id = k.id AND kk.cerrado_at IS NULL
     ORDER BY kk.creado_at DESC LIMIT 1) kand ON TRUE;

COMMENT ON VIEW v_plaza_comprometida IS
  'Plazas prometidas en una vacante viva: el planificador las pinta reservadas';

COMMIT;
