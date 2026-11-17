-- ============================================================
-- 258 — RR. HH., LEGAL Y SELECCIÓN, CADA UNO SU ÁREA; CAPTACIÓN, A ADMINISTRACIÓN
-- ============================================================
-- Camilo, 17/11/2026: «Hay que separar RR. HH. (Diana) de legal (Laura) y
-- selección (Víctor); a Mercedes déjala en administración junto con Daiane».
--
-- Va por PUESTOS (db/255), no por nombres: se mueven los puestos de área, y
-- quien los ocupe hoy o mañana va con ellos.
--   · RR. HH. se queda con «Administración de personal y nómina» (Diana).
--   · LEGAL, área nueva: el puesto de Laura, que pasa a llamarse «Legal». Sigue
--     reportando a Ignacio y conserva sus funciones, también las J de RR. HH.
--     (lo decidió Camilo el mismo día).
--   · SELECCIÓN, área nueva: «Selección y ETT» (Víctor).
--   · «Captación, documentación y altas» (Mercedes) pasa a ADMINISTRACIÓN, al
--     lado de Daiane, con sus mismas funciones.
-- Las dos áreas nuevas las dirige, como RR. HH., la Dirección de operaciones.
--
-- Si a alguien de estos puestos le habían puesto «RR. HH.» a mano (una
-- excepción encima de su puesto), se le quita: es justo lo que ya no es.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/258', true),
       set_config('telecab.usuario_id', '7', true);

-- ── Las dos áreas nuevas, y el orden de todas ──────────────────────────────
INSERT INTO cat_area (codigo, etiqueta, orden) VALUES
  ('seleccion', 'Selección', 3),
  ('legal',     'Legal',     4)
ON CONFLICT (codigo) DO NOTHING;

UPDATE cat_area a SET orden = x.orden
  FROM (VALUES ('direccion', 1), ('rrhh', 2), ('seleccion', 3), ('legal', 4), ('administracion', 5),
               ('planificacion', 6), ('control', 7), ('taller', 8), ('sistemas', 9)) AS x (codigo, orden)
 WHERE a.codigo = x.codigo AND a.orden IS DISTINCT FROM x.orden;

UPDATE cat_area SET responsable_puesto = 'direccion_operaciones'
 WHERE codigo IN ('seleccion', 'legal') AND responsable_puesto IS NULL
   AND EXISTS (SELECT 1 FROM puesto WHERE codigo = 'direccion_operaciones');

-- ── Los puestos, a su área (y en el orden del organigrama) ─────────────────
UPDATE puesto p SET area_codigo = x.area, nombre = x.nombre, orden = x.orden
  FROM (VALUES
    ('administracion_personal', 'rrhh',           'Administración de personal y nómina', 40),
    ('seleccion_ett',           'seleccion',      'Selección y ETT',                      50),
    ('rrhh_laboral',            'legal',          'Legal',                                60),
    ('administracion',          'administracion', 'Administración',                       70),
    ('captacion_altas',         'administracion', 'Captación, documentación y altas',     75)
  ) AS x (codigo, area, nombre, orden)
 WHERE p.codigo = x.codigo
   AND (p.area_codigo, p.nombre, p.orden) IS DISTINCT FROM (x.area, x.nombre, x.orden);

-- ── Quien tenía «RR. HH.» puesto a mano en uno de esos puestos, vuelve a ir
--    con su puesto ────────────────────────────────────────────────────────
UPDATE usuario SET area_codigo = NULL
 WHERE puesto_codigo IN ('rrhh_laboral', 'seleccion_ett', 'captacion_altas') AND area_codigo = 'rrhh';

COMMIT;
