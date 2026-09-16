-- ============================================================
-- 133 - ÓSCAR LLEVA LAS FACTURAS DEL TALLER
-- ============================================================
-- El submódulo /facturas nació con la 132 y sus permisos no los reparte ningún
-- rol: se dan persona a persona, como el resto de llaves finas del sistema.
--
-- Óscar (taller@telecab.es) es quien mete las facturas, así que se le dan las
-- dos: entrar a mirarlas y darlas de alta o anularlas. Ya tenía '/taller' y
-- '/taller/apuntar', que es el mismo reparto para los mantenimientos.
--
-- NO se le da '/vehiculos/sedes': Óscar mantiene la flota de Madrid, y los cinco
-- coches que se llevaron a Barcelona no son cosa suya. Esa llave se da a quien
-- tenga que ver las dos operaciones.
--
-- Se busca por CORREO y no por id: el id es un número que puede significar otra
-- cosa en otra base, y esta migración tiene que poder correrse en cualquiera.

BEGIN;

INSERT INTO usuario_permiso (usuario_id, clave)
SELECT u.id, c.clave
  FROM usuario u
  CROSS JOIN (VALUES ('/facturas'), ('/facturas/apuntar')) AS c(clave)
 WHERE lower(btrim(u.email)) = 'taller@telecab.es'
ON CONFLICT DO NOTHING;

COMMIT;
