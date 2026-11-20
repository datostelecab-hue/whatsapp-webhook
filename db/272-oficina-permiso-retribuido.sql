-- ============================================================
-- 272 — EL PERMISO RETRIBUIDO DE LA OFICINA (20/11/2026)
-- ============================================================
-- Camilo, 20/11/2026: «que aparezca en el mapa que hicimos de meses los permisos
-- especiales, permisos retribuidos y asuntos propios, a parte de apuntar asuntos
-- propios pasados o permisos especiales/retribuidos pasados».
--
-- Hasta ahora un permiso de la oficina (db/271) solo podía ser asuntos propios o
-- teletrabajo. Se añade el tercer tipo, «retribuido»: los permisos especiales y
-- retribuidos (matrimonio, nacimiento, fallecimiento, mudanza, médico…), siempre
-- con su motivo. No sale de ningún banco ni resta vacaciones.
--
-- Solo cambia la regla de la columna `tipo`. Se puede pasar dos veces.
-- ============================================================

BEGIN;

SELECT set_config('telecab.origen', 'migración db/272', true),
       set_config('telecab.usuario_id', '7', true);

ALTER TABLE oficina_permiso DROP CONSTRAINT IF EXISTS oficina_permiso_tipo_check;
ALTER TABLE oficina_permiso ADD CONSTRAINT oficina_permiso_tipo_check
  CHECK (tipo IN ('asuntos_propios', 'teletrabajo', 'retribuido'));

COMMENT ON TABLE oficina_permiso IS
  'Los permisos de la oficina (db/271 y db/272): asuntos propios (banco de 2 al año), teletrabajo y permisos retribuidos o especiales (con motivo). Una solicitud = sus días, con el mismo grupo. Histórico: no se borra, se resuelve o se anula.';

COMMIT;
