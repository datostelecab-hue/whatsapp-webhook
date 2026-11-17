-- ============================================================
-- 252 — LAS COLAS EN EL TABLERO: quién lleva las J y las −J (ítem 1, 1c)
-- ============================================================
-- Entrega 1c del tablero de tareas (16/11/2026): las J, las −J, las
-- correcciones de fichaje y las vacaciones pendientes tienen su tarjeta, ya
-- asignada a quien las resuelve, y la cierra su cola (services/tableroColas.js).
-- Lo que decidió Camilo, con lo que hacía cada uno en los últimos 60 días:
--
--   · LAS J, POR SU TIPO, «como hoy»: Tráfico, BOLT y Por compañero, William;
--     Taller, Óscar; RR. HH., Laura. Y las −J, William. Son FUNCIONES de
--     Organización (A5): si mañana lo lleva otra persona, se cambia en
--     /organizacion, sin tocar código. Sin titular, la tarjeta nace «por
--     asignar» y la reparte Ignacio.
--   · Las correcciones de fichaje y las vacaciones van a quien tiene su llave
--     ('/fichaje/revisar' y '/vacaciones/aprobar'): no hace falta sembrar nada.
--   · El plazo, 2 días hábiles: el parámetro tablero.plazo_colas_dias_habiles
--     (services/parametros.js, sin migración).
--   · De los tickets abiertos pasan solo los pedidos desde el corte de las
--     bandejas (`ticketera_desde`, 24/09/2026): el tablero ya no mira desde
--     qué id, así que se quita el ajuste que puso db/251.
--
-- Lo pendiente pasa de una vez con el primer repaso de la tarea programada
-- `tablero.colas` (A10), no aquí: así sale con sus avisos y en el libro.

BEGIN;

SELECT set_config('telecab.origen', 'migración db/252', true),
       set_config('telecab.usuario_id', '7', true);

-- Por id y nombre, como db/248 y db/251: en otra base no le toca a nadie.
INSERT INTO usuario_funcion (usuario_id, funcion, suplente, nota, creado_por)
SELECT u.id, f.funcion, FALSE, 'Tablero de tareas, las colas (1c): decisión del 16/11/2026', 7
  FROM (VALUES (2,  'William', 'Reinoso', 'j_trafico'),
               (2,  'William', 'Reinoso', 'j_bolt'),
               (2,  'William', 'Reinoso', 'j_companero'),
               (2,  'William', 'Reinoso', 'menos_j'),
               (11, 'Oscar',   'Alvarez', 'j_taller'),
               (4,  'Laura',   'Blanco',  'j_rrhh')) AS f (id, nombre, apellidos, funcion)
  JOIN usuario u ON u.id = f.id AND u.nombre = f.nombre AND COALESCE(u.apellidos, '') = f.apellidos
 WHERE NOT EXISTS (SELECT 1 FROM usuario_funcion x
                    WHERE x.usuario_id = u.id AND x.funcion = f.funcion AND x.anulado_at IS NULL);

DELETE FROM config_app WHERE clave = 'tablero.tickets_desde_id';

COMMIT;
