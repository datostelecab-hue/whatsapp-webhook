-- ============================================================
-- 15 - "ESTA EN BOLT, PERO CON OTRO NUMERO"
-- ============================================================
-- En BOLT una cuenta se abre con un telefono: ahi no hay DNI, asi que el numero
-- es su identificador de hecho. Ese dato YA se guarda desde la migracion 07
-- (`conductor_externo.externo_telefono`) y la ingesta lo rellena.
--
-- Lo que faltaba no era guardarlo: era poder COMPARARLO con el nuestro y
-- contestar la pregunta que aparece al dar de alta a alguien:
--
--   "Esta persona ya esta en BOLT, pero con OTRO numero."
--
-- El caso: alguien esta en BOLT con el 640xxxxxx y en Seleccion le dan de alta
-- con el 689xxxxxx. BOLT no puede saber que son la misma persona. Nuestra base
-- si, porque el DNI es unico (uq_cond_dni) y el conflicto salta al crear la
-- ficha. Lo que no podia decir es CON QUE NUMERO esta, que es justo lo que hace
-- falta para decidir: o se usa ese, o se abre una cuenta nueva con el suyo y se
-- da de baja la anterior.

BEGIN;

-- ── Comparar telefonos, no cadenas ──────────────────────────────────────────
-- Los ultimos nueve digitos, igual que `conductor_telefono.sufijo9`. Asi el
-- +34 y los espacios dejan de importar, que es como se comparan los telefonos
-- en todo el sistema.
ALTER TABLE conductor_externo ADD COLUMN IF NOT EXISTS externo_sufijo9 CHAR(9)
  GENERATED ALWAYS AS (right(regexp_replace(COALESCE(externo_telefono, ''), '[^0-9]', '', 'g'), 9)) STORED;

CREATE INDEX IF NOT EXISTS idx_cext_sufijo ON conductor_externo (externo_sufijo9)
  WHERE externo_telefono IS NOT NULL;

-- ── Dos cuentas activas: se DETECTA, no se prohibe ──────────────────────────
-- La regla es que nadie puede tener dos cuentas de BOLT activas a la vez. La
-- tentacion es ponerlo como indice unico, y seria un error: `estado_externo` lo
-- dice BOLT, no nosotros. Un UNIQUE ahi no impediria nada en BOLT — solo haria
-- fallar la ingesta, que es critica, mientras el problema sigue igual al otro
-- lado.
--
-- Las restricciones van sobre los datos que uno controla. Sobre los que no, va
-- deteccion.
CREATE OR REPLACE VIEW v_bolt_doble_cuenta AS
SELECT x.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.dni_nie,
       count(*)                                             AS cuentas,
       array_agg(x.externo_id ORDER BY x.visto_desde)        AS uuids,
       array_agg(COALESCE(x.externo_telefono, '(sin telefono)')
                 ORDER BY x.visto_desde)                     AS telefonos
  FROM conductor_externo x
  JOIN conductor c ON c.id = x.conductor_id
 WHERE x.sistema = 'bolt'
   AND x.visto_hasta IS NULL
   AND x.estado_externo = 'active'
   AND NOT c.es_centinela
 GROUP BY x.conductor_id, c.apellidos, c.nombre, c.dni_nie
HAVING count(*) > 1;

COMMENT ON VIEW v_bolt_doble_cuenta IS
  'Personas con mas de una cuenta de BOLT activa. Esta prohibido: hay que dar de baja todas menos una';

-- ── El centro de trabajo de la Seguridad Social ─────────────────────────────
-- No es lo mismo que `flota`, que son las compañias de BOLT: eso es con quien
-- se conduce, esto es con quien se cotiza. En la plantilla de la gestoria hay
-- dos, y uno de ellos con una sola persona.
CREATE TABLE IF NOT EXISTS cat_centro_trabajo (
  codigo  VARCHAR(10)  PRIMARY KEY,
  nombre  VARCHAR(120) NOT NULL,
  activo  BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO cat_centro_trabajo (codigo, nombre) VALUES
  ('00003', 'TIBUS LUXURY SERVICES, SLU (TELECAB)'),
  ('00002', 'TIBUS LUXURY (NETWORK)')
ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre;

ALTER TABLE conductor ADD COLUMN IF NOT EXISTS centro_codigo VARCHAR(10)
  REFERENCES cat_centro_trabajo(codigo) ON DELETE SET NULL;

COMMENT ON COLUMN conductor.centro_codigo IS
  'Centro de trabajo de la Seguridad Social. Distinto de flota, que es la compañia de BOLT';

-- ── La situacion respecto a BOLT, ahora diciendo CON QUE NUMERO ─────────────
-- La misma vista de la migracion 10, con tres columnas mas: el telefono de la
-- cuenta de BOLT, su uuid, y si ese numero es el mismo que tenemos nosotros.
-- Cuando no lo es, la pantalla puede decirlo en vez de dejar a quien lo mira
-- adivinando por que no cuadra.
CREATE OR REPLACE VIEW v_conductor_alta_bolt AS
SELECT c.id AS conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.dni_nie,
       c.empleo_vigente,
       tel.e164              AS telefono,
       bolt.externo_telefono AS telefono_bolt,
       bolt.externo_id       AS uuid_bolt,
       bolt.externo_nombre   AS nombre_bolt,
       -- NULL cuando falta uno de los dos: no es ni que cuadren ni que no.
       CASE WHEN bolt.externo_sufijo9 IS NULL OR btrim(bolt.externo_sufijo9) = ''
              OR tel.sufijo9 IS NULL THEN NULL
            ELSE bolt.externo_sufijo9 = tel.sufijo9
       END AS mismo_telefono,
       CASE
         WHEN bolt.estado_externo = 'active' THEN 'enlazada'
         WHEN bolt.externo_id IS NOT NULL    THEN 'enlazada_inactiva'
         WHEN tel.e164 IS NULL               THEN 'sin_telefono'
         WHEN EXISTS (SELECT 1 FROM v_bolt_por_telefono v
                       WHERE v.conductor_id = c.id AND v.ya_enlazada_con IS NULL)
           THEN 'en_bolt_sin_enlazar'
         ELSE 'no_esta_en_bolt'
       END AS situacion_bolt
  FROM conductor c
  LEFT JOIN LATERAL (
    SELECT e164, sufijo9 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
  LEFT JOIN LATERAL (
    SELECT externo_id, externo_nombre, externo_telefono, externo_sufijo9, estado_externo
      FROM conductor_externo
     WHERE conductor_id = c.id AND sistema = 'bolt' AND visto_hasta IS NULL
     ORDER BY (estado_externo = 'active') DESC, visto_desde DESC LIMIT 1) bolt ON TRUE
 WHERE NOT c.es_centinela;

COMMENT ON VIEW v_conductor_alta_bolt IS
  'Situacion de cada persona respecto a BOLT, con el telefono de su cuenta. "no_esta_en_bolt" teniendo telefono es el caso grave: no la han dado de alta y no puede trabajar. `mismo_telefono` en falso es el otro: esta en BOLT, pero con un numero que no es el suyo';

COMMIT;
