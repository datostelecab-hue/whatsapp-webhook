-- ============================================================
-- 119 - LAS BANDEJAS, Y CÓMO SE LEE EL FORMULARIO
-- ============================================================
-- Dos cosas que la 118 dejó a medias.
--
-- ── 1. LOS QUE NO SE SABE CLASIFICAR TIENEN SU PROPIA BANDEJA ───────────────
-- El Apps Script mandaba a RRHH todo lo que no encajaba con ninguna regla, con
-- el subtipo SIN_CLASIFICAR. Eso los hacía desaparecer: caían en una bandeja de
-- 300 tickets entre vacaciones y nóminas, y nadie miraba específicamente los que
-- el sistema no había entendido.
--
-- Y son justo los que hay que mirar: un ticket sin clasificar es o una persona
-- pidiendo algo que no habíamos previsto, o una regla de reparto que se ha
-- quedado corta. Las dos cosas se arreglan viéndolas.
--
-- Pasan a OPERACIONES, con nombre propio: «Tickets sin traza».
--
-- ── 2. CÓMO SE LEEN LAS COLUMNAS DEL FORMULARIO ────────────────────────────
-- Las cabeceras de una hoja de respuestas son las PREGUNTAS del formulario, con
-- su redacción entera: "Indica tu DNI o NIE (con la letra)". Cambian en cuanto
-- alguien reescribe una pregunta, y el Apps Script las tenía clavadas en una
-- constante: al retocar el formulario, esa columna dejaba de leerse en silencio.
--
-- Aquí se buscan POR TROZO DE TEXTO. 'dni' encuentra la pregunta la escriba
-- quien la escriba. Y lo que no case con ningún campo conocido NO SE PIERDE: se
-- añade a la descripción del ticket como «Pregunta: respuesta». Así una pregunta
-- nueva del formulario aparece igual en el ticket desde el primer día, sin tocar
-- nada — que es lo contrario de lo que pasaba antes.

BEGIN;

-- ── La bandeja de los que no se entienden ──────────────────────────────────
INSERT INTO cat_ticket_area (codigo, etiqueta, prefijo, orden) VALUES
  ('OPERACIONES', 'Operaciones', 'OP', 5)
ON CONFLICT (codigo) DO NOTHING;

UPDATE cat_ticket_subtipo
   SET area_codigo = 'OPERACIONES',
       etiqueta    = 'Sin traza'
 WHERE codigo = 'SIN_CLASIFICAR';

-- ── Qué columna del formulario es qué ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_form_campo (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- El campo del ticket que se rellena.
  campo    VARCHAR(24) NOT NULL,
  -- Trozo de texto que se busca DENTRO de la cabecera, ya normalizado (sin
  -- tildes, en minúsculas). Gana el primero por `orden`, igual que en el
  -- reparto: una cabecera que diga "fecha de inicio de las vacaciones" tiene que
  -- encontrar 'fecha de inicio' antes que 'fecha'.
  patron   VARCHAR(120) NOT NULL,
  orden    SMALLINT    NOT NULL,
  -- Si esta columna, además de rellenar su campo, se cuenta en la descripción.
  -- Por omisión no: el DNI ya está en su sitio y repetirlo es ruido.
  en_desc  BOOLEAN     NOT NULL DEFAULT FALSE,
  UNIQUE (patron)
);

-- Lo más específico primero. El orden es la regla, como en ticket_routing.
INSERT INTO ticket_form_campo (campo, patron, orden) VALUES
  ('marca',         'marca temporal',      10),
  ('marca',         'timestamp',           11),
  ('email',         'direccion de correo', 20),
  ('email',         'correo electronico',  21),
  ('dni',           'dni',                 30),
  ('dni',           'nie',                 31),
  ('dni',           'documento de identidad', 32),
  ('nombre',        'nombre y apellidos',  40),
  ('nombre',        'nombre completo',     41),
  ('telefono',      'telefono',            50),
  ('telefono',      'movil',               51),
  ('gestion',       'que gestion',         60),
  ('gestion',       'tipo de gestion',     61),
  ('gestion',       'gestion',             62),
  ('gestion',       'que necesitas',       63),
  ('gestion',       'motivo de la solicitud', 64),
  ('dia_recupera',  'dia que recupera',    70),
  ('dia_recupera',  'dia a recuperar',     71),
  ('dia_recupera',  'recupera',            72),
  ('dia_librar',    'dia que quiere librar', 73),
  ('dia_librar',    'dia a librar',        74),
  ('dia_librar',    'librar',              75),
  ('fecha_fin',     'fecha de fin',        80),
  ('fecha_fin',     'fecha fin',           81),
  ('fecha_fin',     'hasta el dia',        82),
  ('fecha_fin',     'hasta',               83),
  ('fecha_ini',     'fecha de inicio',     84),
  ('fecha_ini',     'fecha inicio',        85),
  ('fecha_ini',     'desde el dia',        86),
  ('fecha_ini',     'desde',               87),
  ('matricula',     'matricula',           90),
  ('prioridad',     'prioridad',          100),
  ('prioridad',     'urgencia',           101)
ON CONFLICT (patron) DO NOTHING;

-- ── Hasta dónde se ha leído la hoja de respuestas ──────────────────────────
-- La marca de agua vive en `config_app`, que es donde viven los ajustes. No hace
-- falta tabla propia para un número.
INSERT INTO config_app (clave, valor) VALUES ('ticketera_ultima_fila', '0')
ON CONFLICT (clave) DO NOTHING;

COMMENT ON TABLE ticket_form_campo IS
  'Qué columna del formulario rellena qué campo. Por trozo de texto y en orden: las cabeceras son las preguntas y cambian';

COMMIT;
