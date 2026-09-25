-- ============================================================
-- 161 — INSPECCIÓN: ENTRAN EL GATO Y LA LLAVE, SALE EL BOTIQUÍN
-- ============================================================
-- Camilo, 25/09/2026: «que también me agregue el gato y la llave, y quitar lo
-- del botiquín». La llave es la de ruedas: va con el gato, que es lo que hace
-- falta para cambiar una rueda.
--
-- Es lo que preveía db/150: los elementos son un CATÁLOGO, así que revisar algo
-- más es una fila y dejar de revisarlo es apagarla.
--
-- EL BOTIQUÍN SE APAGA, NO SE BORRA. Hay 89 inspecciones que lo tienen apuntado
-- y son historia: borrarlo obligaría a borrar esas filas. Apagado deja de salir
-- en el formulario, en la importación del Excel, en las fichas y en la cuenta de
-- incidencias (la pantalla solo lee lo activo), y la base lo sigue guardando.

BEGIN;

UPDATE cat_elemento_inspeccion SET activo = FALSE WHERE codigo = 'botiquin';

INSERT INTO cat_elemento_inspeccion (codigo, etiqueta, grupo, orden, cabecera_excel) VALUES
  ('gato',         'Gato',            'Seguridad', 14, 'Gato'),
  ('llave_ruedas', 'Llave de ruedas', 'Seguridad', 15, 'Llave de ruedas')
ON CONFLICT (codigo) DO NOTHING;

-- El orden de Seguridad: las ruedas y, con ellas, lo que hace falta para
-- cambiarlas; después lo de la emergencia en carretera. El botiquín, apagado, al
-- final.
UPDATE cat_elemento_inspeccion SET orden = 13 WHERE codigo = 'ruedas';
UPDATE cat_elemento_inspeccion SET orden = 16 WHERE codigo = 'triangulos';
UPDATE cat_elemento_inspeccion SET orden = 17 WHERE codigo = 'v16';
UPDATE cat_elemento_inspeccion SET orden = 18 WHERE codigo = 'chaleco';
UPDATE cat_elemento_inspeccion SET orden = 99 WHERE codigo = 'botiquin';

COMMIT;
