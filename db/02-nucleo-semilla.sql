-- ============================================================
-- TELECAB — SEMILLA DEL NÚCLEO
-- ============================================================
-- Catálogos con los valores que hoy están escritos a mano en el código.
-- Es idempotente: se puede ejecutar varias veces sin duplicar nada.

BEGIN;

-- ── Estados de vehículo ─────────────────────────────────────────────────────
-- Vienen de ESTADOS_VEHICULO (services/planificadorV2.js) y de las etiquetas de
-- views/vehiculos.ejs. El operativo era el símbolo '✓' en la hoja y aquí es 'O':
-- en la base de datos no entran ni símbolos ni emojis.
INSERT INTO cat_estado_vehiculo (codigo, etiqueta, es_operativo, visible_cobertura, orden) VALUES
  ('O', 'Operativo',  TRUE,  TRUE,  1),
  ('R', 'Reservado',  FALSE, TRUE,  2),
  ('T', 'Transporte', FALSE, TRUE,  3),
  ('X', 'En taller',  FALSE, FALSE, 4),
  ('S', 'Siniestro',  FALSE, FALSE, 5),
  ('B', 'Baja',       FALSE, FALSE, 6)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta,
      es_operativo = EXCLUDED.es_operativo,
      visible_cobertura = EXCLUDED.visible_cobertura,
      orden = EXCLUDED.orden;

-- ── Roles ───────────────────────────────────────────────────────────────────
-- De ADMIN_TOTAL y del mapa ACCESO (services/sesion.js).
INSERT INTO rol (codigo, etiqueta, acceso_total) VALUES
  ('superadmin',    'Superadministrador', TRUE),
  ('desarrollador', 'Desarrollador',      TRUE),
  ('oficina',       'Oficina / RRHH',     FALSE),
  ('trafico',       'Tráfico',            FALSE)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, acceso_total = EXCLUDED.acceso_total;

-- ── Módulos ─────────────────────────────────────────────────────────────────
INSERT INTO cat_modulo (codigo, etiqueta) VALUES
  ('vacantes','Vacantes'), ('seleccion','Selección'), ('ett','ETT'),
  ('pendientes-bolt','Pendientes BOLT'), ('rrhh','RRHH'),
  ('administracion','Administración'), ('plantilla','Plantilla'),
  ('fichas','Fichas'), ('ticketera','Ticketera RRHH'), ('reportes','Reportes'),
  ('nominas','Nóminas extras'), ('incorporaciones','Incorporaciones'),
  ('planificador','Planificador'), ('planificador-v2','Planificador V2'),
  ('agenda','Agenda'), ('control','Control'), ('cobertura','Cobertura'),
  ('generador','Generar vacantes'), ('matching','Matching'),
  ('vehiculos','Vehículos'), ('operaciones','Operaciones'), ('horas','Horas'),
  ('sanciones','Sanciones velocidad'), ('callcenter','Call Center'),
  ('bitacora','Bitácora'), ('peticiones','Peticiones'), ('pendientes','Pendientes'),
  ('soporte','Soporte'), ('tickets-telecab','Tickets Telecab'),
  ('usuarios','Usuarios'), ('configuracion','Configuración'),
  ('libranzas','Libranzas'), ('documentos','Documentos'), ('resumen','Resumen')
ON CONFLICT (codigo) DO UPDATE SET etiqueta = EXCLUDED.etiqueta;

-- ── Permisos por rol ────────────────────────────────────────────────────────
-- Traducción literal del mapa ACCESO. Lo que allí no aparece queda accesible a
-- cualquier sesión (pendientes, peticiones, bitácora…), así que se da a los dos.
INSERT INTO rol_modulo (rol_id, modulo, puede_leer, puede_escribir)
SELECT r.id, m.modulo, TRUE, TRUE
FROM (VALUES
  ('oficina','vacantes'), ('oficina','seleccion'), ('oficina','ett'),
  ('oficina','pendientes-bolt'), ('oficina','rrhh'), ('oficina','administracion'),
  ('oficina','plantilla'), ('oficina','fichas'), ('oficina','ticketera'),
  ('oficina','reportes'), ('oficina','nominas'),
  ('trafico','incorporaciones'), ('trafico','planificador'), ('trafico','planificador-v2'),
  ('trafico','agenda'), ('trafico','control'), ('trafico','cobertura'),
  ('trafico','generador'), ('trafico','matching'), ('trafico','vehiculos'),
  ('trafico','operaciones'), ('trafico','horas'), ('trafico','sanciones'),
  ('trafico','callcenter'),
  ('oficina','bitacora'), ('oficina','peticiones'), ('oficina','pendientes'),
  ('oficina','soporte'), ('oficina','libranzas'), ('oficina','documentos'),
  ('trafico','bitacora'), ('trafico','peticiones'), ('trafico','pendientes'),
  ('trafico','soporte'), ('trafico','libranzas'), ('trafico','documentos'),
  ('trafico','resumen')
) AS m(rol, modulo)
JOIN rol r ON r.codigo = m.rol
ON CONFLICT (rol_id, modulo) DO NOTHING;

-- ── Flotas ──────────────────────────────────────────────────────────────────
-- De CONFIG_BOLT.flotas. La 63530 está cerrada pero sus conductores siguen
-- apareciendo en el histórico, así que la flota tiene que existir igualmente.
INSERT INTO flota (company_id, nombre, region, activa_desde, activa_hasta) VALUES
  (63530,  'Tibus Business Cars SL',       'Madrid', NULL, CURRENT_DATE),
  (143626, 'Tibus Luxury Services, S.L.',  'Madrid', NULL, NULL)
ON CONFLICT (company_id) DO UPDATE SET nombre = EXCLUDED.nombre;

-- ── Conductor centinela ─────────────────────────────────────────────────────
-- Recoge las horas cuyo conductor no se resuelve. Sin él, la clave primaria de
-- horas_conductor_dia obligaría a tirar esas horas.
INSERT INTO conductor (es_centinela, nombre, apellidos, empleo_vigente)
SELECT TRUE, '(sin mapear)', NULL, FALSE
WHERE NOT EXISTS (SELECT 1 FROM conductor WHERE es_centinela);

COMMIT;

-- Comprobación rápida de que la semilla ha entrado.
SELECT 'estados'  AS catalogo, count(*) FROM cat_estado_vehiculo
UNION ALL SELECT 'roles',      count(*) FROM rol
UNION ALL SELECT 'modulos',    count(*) FROM cat_modulo
UNION ALL SELECT 'permisos',   count(*) FROM rol_modulo
UNION ALL SELECT 'flotas',     count(*) FROM flota
UNION ALL SELECT 'centinela',  count(*) FROM conductor WHERE es_centinela;
