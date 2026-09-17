-- ============================================================
-- 135 · CUENTAS FANTASMA — quién las toca, desde dónde y cuándo
-- ============================================================
-- Enlazar una cuenta fantasma MUEVE HORAS de una persona a otra, y las horas
-- son dinero: nómina, promedio, cuadrante y faltas. Es de las pocas acciones
-- del sistema en las que a alguien le compensaría de verdad entrar con la
-- cuenta de otro.
--
-- Por eso dos cosas:
--
-- 1. SOLO WILLIAM (y el desarrollador, que abre todo). Hasta ahora colgaba de
--    '/plantilla' entero, así que podía hacerlo cualquiera que entrara ahí,
--    incluido el rol de reclutador. Ahora tiene su propia clave.
--
-- 2. UN LIBRO, no unas columnas. Se apunta CADA acción —enlazar, cambiar las
--    fechas y anular— con quién, cuándo, desde qué IP y con qué dispositivo.
--    Con columnas en la tabla solo quedarían dos de las tres: cambiar las
--    fechas de un enlace no dejaba rastro ninguno, y es justo la acción con la
--    que se estiran unas horas sin que se note.
--
-- ── Qué vale y qué no vale esta traza ───────────────────────────────────────
-- La IP sale de la cabecera `X-Forwarded-For`, que es lo que pone el proxy de
-- Render. Sirve para ver que las acciones salen del sitio de siempre y para
-- notar un cambio raro; NO es una prueba: un cliente puede mandar esa cabecera
-- él mismo. Para que sea de fiar hay que poner `trust proxy` en Express, y eso
-- se decide aparte porque toca a toda la aplicación.
--
-- El DISPOSITIVO es el `User-Agent`, y sí distingue lo que hace falta aquí:
-- su ordenador de empresa del teléfono.

BEGIN;

CREATE TABLE cuenta_fantasma_log (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fantasma_id  BIGINT      NOT NULL REFERENCES cuenta_fantasma(id) ON DELETE CASCADE,
  accion       VARCHAR(12) NOT NULL,
  usuario_id   INTEGER     REFERENCES usuario(id) ON DELETE SET NULL,
  -- Se guarda también el NOMBRE de quien lo hizo, no solo su id: si algún día
  -- se borra el usuario, el libro tiene que seguir diciendo quién fue.
  usuario      VARCHAR(160),
  ip           VARCHAR(64),
  agente       TEXT,
  -- Lo que cambió: fechas antes y después, motivo, la cuenta. En JSON porque
  -- cada acción guarda cosas distintas y no merece una columna por cada una.
  detalle      JSONB,
  ocurrido_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_cfl_accion CHECK (accion IN ('enlazar', 'fechas', 'anular'))
);

CREATE INDEX idx_cfl_fantasma ON cuenta_fantasma_log (fantasma_id, ocurrido_at DESC);
CREATE INDEX idx_cfl_usuario  ON cuenta_fantasma_log (usuario_id, ocurrido_at DESC);

COMMENT ON TABLE cuenta_fantasma_log IS
  'Cada accion sobre una cuenta fantasma: quien, cuando, desde que IP y con que dispositivo. Enlazar mueve horas —y por tanto dinero— de una persona a otra';
COMMENT ON COLUMN cuenta_fantasma_log.ip IS
  'De X-Forwarded-For. Sirve para notar un cambio raro, no como prueba: sin trust proxy el cliente puede mandarla el';

-- Los enlaces que ya existen quedan en el libro con lo que se sabe de ellos.
-- Sin IP ni dispositivo, y DICIENDOLO: inventar un dato de origen en un libro
-- de auditoria es peor que no tenerlo.
INSERT INTO cuenta_fantasma_log (fantasma_id, accion, usuario_id, usuario, ip, agente, detalle, ocurrido_at)
SELECT f.id, 'enlazar', f.creado_por, u.nombre, NULL, NULL,
       jsonb_build_object('desde', f.desde, 'hasta', f.hasta,
                          'nota', 'anterior al libro: no se guardo IP ni dispositivo'),
       f.creado_at
  FROM cuenta_fantasma f
  LEFT JOIN usuario u ON u.id = f.creado_por;

-- ── El permiso ──────────────────────────────────────────────────────────────
-- Por CORREO y no por id: el id de un usuario no dice nada al leer esto dentro
-- de un ano, y si la fila no existe no se concede nada en vez de dárselo a
-- quien tenga ese número.
INSERT INTO usuario_permiso (usuario_id, clave, usuario_mod)
SELECT u.id, '/plantilla/fantasma', NULL
  FROM usuario u
 WHERE lower(u.email) = 'trafico@telecab.es'
   AND NOT EXISTS (SELECT 1 FROM usuario_permiso q
                    WHERE q.usuario_id = u.id AND q.clave = '/plantilla/fantasma');

COMMIT;
