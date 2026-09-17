-- ============================================================
-- 137 · AUDITORIA DE FLOTA — con que vara se midieron esos km
-- ============================================================
-- La auditoria tenia UNA fuente de km: la distancia que Mapon calcula uniendo
-- los puntos del GPS. Ahora tiene dos, y no valen lo mismo:
--
--   · can  El odometro del propio coche, leido de su bus CAN. No se estima: es
--          el numero del cuadro. Es el bueno.
--   · gps  La estimacion de Mapon. Corta las curvas y, cuando el equipo pierde
--          cobertura, pierde el trozo entero. Se queda un 4 % por debajo de
--          media, y en un coche suelto mucho mas (el 0454MMZ: 45 km contra 518
--          reales el 16/09/2026).
--
-- Se usa el CAN siempre que el coche lo de. Nueve coches llevan un equipo que no
-- lo lee, y algun otro calla a ratos: esos van por GPS, y esta columna es lo que
-- permite que el informe lo diga en vez de dar los dos numeros por igual de
-- firmes. Sin esto, una fila corta y una fila buena se leen igual.
--
-- Las filas viejas se quedan en NULL a proposito: se calcularon antes de que
-- hubiera odometro y no se puede saber a posteriori con que se midieron. NULL
-- es "no consta", que es la verdad; ponerles 'gps' seria inventar.

BEGIN;

ALTER TABLE auditoria_km
  ADD COLUMN fuente_km VARCHAR(8);

COMMENT ON COLUMN auditoria_km.fuente_km IS
  'can = odometro del coche (bus CAN), gps = estimacion de Mapon con los puntos, NULL = calculado antes de haber odometro';

COMMIT;
