-- ============================================================
-- 19 - LA ETT ENTRA POR LA MISMA PUERTA
-- ============================================================
-- Los candidatos de la ETT vivian en su propia hoja, con sus propios estados y
-- su propia pantalla. Son lo mismo que los de Seleccion: personas en un proceso.
-- Lo unico distinto es como entran — una tabla pegada de un correo en vez de un
-- telefono escrito a mano — y cuanto se sabe de ellos.
--
-- Asi que entran en `candidatura`, con `canal = bolsa_ett`. Una tabla, una
-- pantalla, dos puertas.
--
-- Lo que si es propio de este canal y no tenia sitio:
--
--   · La CITA de la entrevista. La pone la agencia, no nosotros.
--   · Lo que PROPONE la agencia (jornada y turno). No es lo mismo que lo que
--     decidimos: `jornada_horas` y `turno_id` son nuestra decision, y estas dos
--     son la peticion. Guardarlas en las mismas columnas perderia justo la
--     diferencia que hay que poder mirar.

BEGIN;

ALTER TABLE candidatura ADD COLUMN IF NOT EXISTS entrevista_at TIMESTAMPTZ;
ALTER TABLE candidatura ADD COLUMN IF NOT EXISTS jornada_ett   VARCHAR(20);
ALTER TABLE candidatura ADD COLUMN IF NOT EXISTS turno_ett     VARCHAR(20);

COMMENT ON COLUMN candidatura.entrevista_at IS
  'Cita de la entrevista. En la via ETT la pone la agencia y viene en la matriz del correo';
COMMENT ON COLUMN candidatura.jornada_ett IS
  'La jornada que PIDE la agencia. Lo que decidimos nosotros va en jornada_horas';
COMMENT ON COLUMN candidatura.turno_ett IS
  'El turno que PIDE la agencia. Lo que decidimos nosotros va en turno_id';

-- ── Un estado que solo se da por esta via ───────────────────────────────────
-- "No se presento" no es un descarte: no llegamos a valorar a nadie. La
-- diferencia importa para saber cuanta gente manda la agencia que luego no
-- aparece, que es lo que se le reclama.
INSERT INTO cat_estado_candidatura
  (codigo, etiqueta, etapa, orden, en_funnel, es_salida, obsoleto) VALUES
  ('no_presentado', 'No se presentó', 'seleccion', 89, FALSE, TRUE, FALSE)
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, etapa = EXCLUDED.etapa, orden = EXCLUDED.orden,
  en_funnel = EXCLUDED.en_funnel, es_salida = EXCLUDED.es_salida, obsoleto = EXCLUDED.obsoleto;

-- ── La vista, con las tres columnas nuevas ──────────────────────────────────
-- Se rehace entera: las columnas van en medio y CREATE OR REPLACE solo sabe
-- añadir al final.
DROP VIEW IF EXISTS v_candidatura;

CREATE VIEW v_candidatura AS
SELECT k.id,
       k.conductor_id,
       btrim(COALESCE(c.apellidos || ', ', '') || c.nombre) AS quien,
       -- Los datos de la persona que edita el mismo formulario. Se exponen aqui
       -- para que la pantalla no tenga que pedir dos cosas y cruzarlas: siguen
       -- viviendo en `conductor`, esto solo los enseña.
       c.nombre, c.apellidos, c.dni_nie, c.dni_tipo, c.email,
       c.fecha_nacimiento, c.sexo, c.estado_civil, c.nacionalidad,
       c.naf, c.centro_codigo,
       c.via_tipo, c.via_nombre, c.via_numero, c.escalera, c.piso, c.puerta,
       c.direccion, c.codigo_postal, c.localidad, c.provincia,
       c.tel_emergencia, c.observaciones,
       CASE WHEN c.lat IS NULL OR c.lng IS NULL THEN NULL
            ELSE c.lat::text || ', ' || c.lng::text END      AS coordenadas,
       -- El IBAN NO sale de aqui: esta cifrado y un listado no tiene por que
       -- llevarlo. Se descifra solo al generar la ficha de alta.
       (c.iban_cifrado IS NOT NULL)                          AS tiene_iban,
       tel.e164                                             AS telefono,
       k.estado,
       e.etiqueta                                           AS estado_etiqueta,
       e.etapa,
       ep.etiqueta                                          AS etapa_etiqueta,
       e.en_funnel, e.es_salida, e.orden                    AS estado_orden,
       k.canal,
       ca.etiqueta                                          AS canal_etiqueta,
       k.experiencia, k.carne_vtc, k.prueba_conduccion, k.apto_medico,
       k.vacante_ref, k.turno_id, t.etiqueta                AS turno,
       k.base_zona_id, bz.nombre                            AS zona,
       k.inicio_previsto, k.jornada_horas, k.tipo_contrato,
       -- Lo propio de la via ETT: la cita y lo que pide la agencia.
       k.entrevista_at, k.jornada_ett, k.turno_ett,
       k.responsable, k.notas, k.motivo, k.num_hijos, k.tipo_carnet,
       k.creado_at, k.apto_at, k.alta_at, k.habilitado_at, k.asignado_at,
       k.cerrado_at, k.deteccion_at,
       k.excel_alta, k.pin_ballenoil, k.obs_ballenoil,
       -- Si esta persona ya tiene contrato abierto. Una candidatura viva de
       -- alguien que ya trabaja aqui es algo que hay que mirar.
       c.empleo_vigente
  FROM candidatura k
  JOIN conductor c              ON c.id = k.conductor_id
  JOIN cat_estado_candidatura e ON e.codigo = k.estado
  JOIN cat_etapa_candidatura ep ON ep.codigo = e.etapa
  LEFT JOIN cat_canal_candidatura ca ON ca.codigo = k.canal
  LEFT JOIN turno t             ON t.id = k.turno_id
  LEFT JOIN base_zona bz        ON bz.id = k.base_zona_id
  LEFT JOIN LATERAL (
    SELECT e164 FROM conductor_telefono
     WHERE conductor_id = c.id AND vigente_hasta IS NULL
     ORDER BY principal DESC, id LIMIT 1) tel ON TRUE;

COMMENT ON VIEW v_candidatura IS
  'El embudo con la persona ya resuelta: sustituye a cruzar la hoja TICKETS y la hoja ETT_CANDIDATOS en JavaScript';

COMMIT;
