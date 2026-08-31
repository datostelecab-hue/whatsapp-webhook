-- ============================================================
-- 10 · ¿ESTÁ DADO DE ALTA EN BOLT? — se pregunta por el TELÉFONO
-- ============================================================
-- El nombre no identifica a nadie y por eso el enlace con BOLT se hace a mano.
-- Pero el TELÉFONO sí: es obligatorio en la ficha de contratación y la cuenta
-- de BOLT se da de alta obligatoriamente con ese mismo número. Dos sitios, la
-- misma norma, y un número no se escribe de dos maneras distintas.
--
-- Con eso se pueden responder dos preguntas que hoy nadie puede:
--
--   · ¿Está esta persona dada de alta en BOLT?
--     Se busca su teléfono en el padrón de BOLT. Si aparece, está.
--
--   · Esta cuenta de BOLT sin dueño, ¿de quién es?
--     Del que tenga ese teléfono. Y si no cuadra con nadie, es un aviso: o le
--     dieron de alta con otro número, o esa cuenta no es de los nuestros.
--
-- SIGUE SIN ENLAZARSE NADA SOLO. Esto propone; enlaza una persona. La
-- diferencia importa: un teléfono reutilizado o mal tecleado enlazaría a quien
-- no es, y las horas se le imputarían a otro.
--
-- Los dos lados se comparan por los ÚLTIMOS 9 DÍGITOS, que es como cruza ya el
-- bot de WhatsApp: con prefijo o sin él, con espacios o sin ellos, el número
-- es el mismo.

BEGIN;

-- `unaccent` hace falta para comparar nombres sin tildes. NO estaba instalada,
-- y `cazamientoBolt.libres(q)` ya la usaba: buscar en ese desplegable habría
-- fallado con "function unaccent(text) does not exist". No se notó porque nada
-- llamaba nunca a esa función.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Los 9 dígitos del teléfono que BOLT tiene guardado. `conductor_telefono` ya
-- lo trae calculado en su columna `sufijo9`; aquí hace falta el del otro lado.
CREATE INDEX IF NOT EXISTS idx_cext_tel9
  ON conductor_externo (right(regexp_replace(externo_telefono, '[^0-9]', '', 'g'), 9))
  WHERE sistema = 'bolt' AND externo_telefono IS NOT NULL;

-- ── Quién casa con quién, por teléfono ──────────────────────────────────────
CREATE OR REPLACE VIEW v_bolt_por_telefono AS
SELECT ce.id                AS cuenta_id,
       ce.externo_id        AS driver_uuid,
       ce.externo_nombre    AS nombre_en_bolt,
       ce.externo_telefono,
       ce.estado_externo,
       ce.conductor_id      AS ya_enlazada_con,
       ct.conductor_id,
       ct.e164              AS telefono_nuestro,
       right(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g'), 9) AS tel9
  FROM conductor_externo ce
  JOIN conductor_telefono ct
    ON ct.vigente_hasta IS NULL
   AND ct.sufijo9 = right(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g'), 9)
 WHERE ce.sistema = 'bolt'
   AND ce.externo_telefono IS NOT NULL
   AND length(regexp_replace(ce.externo_telefono, '[^0-9]', '', 'g')) >= 9;

COMMENT ON VIEW v_bolt_por_telefono IS
  'Cuentas de BOLT que casan con un teléfono nuestro. Es una PROPUESTA, no un enlace: enlazar lo decide una persona';

-- ── Lo que ve la pantalla: cuentas libres con dueño propuesto ───────────────
CREATE OR REPLACE VIEW v_bolt_sugerencia AS
SELECT t.cuenta_id,
       t.driver_uuid,
       t.nombre_en_bolt,
       t.externo_telefono,
       t.estado_externo,
       t.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.dni_nie,
       c.empleo_vigente,
       -- Si el nombre también se parece, es que no hay duda. Si no coincide,
       -- NO invalida la propuesta: la gente se casa, se cambia de apellido y en
       -- BOLT se teclea como sea. Solo se enseña para que quien decida lo vea.
       (unaccent(lower(t.nombre_en_bolt)) = unaccent(lower(
          btrim(c.nombre || ' ' || COALESCE(c.apellidos, ''))))) AS coincide_nombre
  FROM v_bolt_por_telefono t
  JOIN conductor c ON c.id = t.conductor_id
 WHERE t.ya_enlazada_con IS NULL      -- la cuenta no tiene dueño todavía
   AND NOT c.es_centinela
   -- Y esa persona no tiene ya una cuenta de BOLT vigente.
   AND NOT EXISTS (
     SELECT 1 FROM conductor_externo x
      WHERE x.conductor_id = c.id AND x.sistema = 'bolt' AND x.visto_hasta IS NULL);

COMMENT ON VIEW v_bolt_sugerencia IS
  'Cuenta de BOLT libre + la persona cuyo teléfono coincide. Lo que se ofrece para enlazar de un clic';

-- ── El revés: ¿a quién le falta el alta en BOLT? ────────────────────────────
-- No es lo mismo "no tiene cuenta enlazada" que "no está dado de alta en BOLT".
-- Lo primero puede ser papeleo pendiente; lo segundo es que esa persona NO
-- PUEDE TRABAJAR, y hasta ahora las dos cosas se veían igual.
CREATE OR REPLACE VIEW v_conductor_alta_bolt AS
SELECT c.id AS conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       c.dni_nie,
       c.empleo_vigente,
       tel.e164 AS telefono,
       CASE
         WHEN EXISTS (SELECT 1 FROM conductor_externo x
                       WHERE x.conductor_id = c.id AND x.sistema = 'bolt'
                         AND x.visto_hasta IS NULL AND x.estado_externo = 'active')
           THEN 'enlazada'
         WHEN EXISTS (SELECT 1 FROM conductor_externo x
                       WHERE x.conductor_id = c.id AND x.sistema = 'bolt' AND x.visto_hasta IS NULL)
           THEN 'enlazada_inactiva'
         WHEN tel.e164 IS NULL
           THEN 'sin_telefono'
         WHEN EXISTS (SELECT 1 FROM v_bolt_por_telefono v
                       WHERE v.conductor_id = c.id AND v.ya_enlazada_con IS NULL)
           THEN 'en_bolt_sin_enlazar'
         ELSE 'no_esta_en_bolt'
       END AS situacion_bolt
  FROM conductor c
  LEFT JOIN LATERAL (
    SELECT e164 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE
 WHERE NOT c.es_centinela;

COMMENT ON VIEW v_conductor_alta_bolt IS
  'Situación de cada persona respecto a BOLT. "no_esta_en_bolt" con teléfono es el caso grave: no la han dado de alta y no puede trabajar';

COMMIT;
