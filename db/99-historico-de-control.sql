-- ============================================================
-- 99 — El Histórico pasa a ser de Control (adiós a Flota viva)
-- ============================================================
-- Las dos pantallas de Flota viva se retiran: el mural de coches y su histórico
-- de partes contaban un sistema de alertas de VEHÍCULO apagado desde el 08/09,
-- así que enseñaban una foto fija de un día que no era hoy. El Histórico vive
-- ahora en /control/historico y cuenta lo que de verdad hace falta saber al día
-- siguiente: quién no salió, qué alertas levantó, a quién se llamó, qué
-- contestó y qué horas quedaron justificadas.
--
-- Esta migración NO crea tablas: el parte se calcula, no se guarda (así el
-- pasado se recalcula con las reglas de hoy y no hay dos verdades). Lo único
-- que hay que mover es el PERMISO: quien tenía '/flota-viva' —que era, con ese
-- nombre, "Flota viva + Histórico"— tiene que seguir entrando al Histórico sin
-- que nadie vuelva a repartir permisos a mano.
--
-- Ojo al orden: primero se borra la fila nueva si ya existiera (a alguien se le
-- pudo dar desde /usuarios entre el despliegue y esto), porque la clave primaria
-- es (usuario_id, clave) y el UPDATE chocaría.

BEGIN;

DELETE FROM usuario_permiso u
 WHERE u.clave = '/control/historico'
   AND EXISTS (SELECT 1 FROM usuario_permiso v
                WHERE v.usuario_id = u.usuario_id AND v.clave = '/flota-viva');

UPDATE usuario_permiso SET clave = '/control/historico' WHERE clave = '/flota-viva';

COMMIT;
