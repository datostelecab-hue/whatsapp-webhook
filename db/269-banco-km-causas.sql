-- ============================================================
-- 269 — EL BANCO DE KM: DE DÓNDE SALE CADA KM, EN LA FOTO
-- ============================================================
-- Camilo, 18/11/2026: «hay mucha gente haciendo KM por fuera, pero se meten
-- con los que se les olvida cerrar el turno; solo necesito esa capilaridad
-- extra de KM por fuera: cuál es el % de desconectado (desconectado +
-- descanso) y el % que se le imputa por no desfichar».
--
-- El desglose ya se calculaba al abrir la ficha de una persona (18/11,
-- bancoKm.desglose.js). Para verlo en la lista de toda la plantilla se guarda en
-- la foto de cada jornada, coche a coche, escalado a sus km (suman lo mismo):
--
--   km_descanso          conectado a BOLT en descanso
--   km_desconectado      desconectado y el último en BOLT con el coche
--   km_fichado_sin_bolt  con el coche fichado y nadie en BOLT
--   km_no_desfichar      con el coche fichado y OTRO en BOLT con él: su turno
--                        sin terminar
--
-- NULL = ese día no se pudo desglosar (la cifra de km_fuera sigue valiendo).
-- La foto se rehace sola con la regla nueva (km_banco_calculo.version 3).
--
-- Se puede pasar dos veces.
-- ============================================================

BEGIN;

ALTER TABLE km_banco_coche
  ADD COLUMN IF NOT EXISTS km_descanso         NUMERIC(8,1) CHECK (km_descanso >= 0),
  ADD COLUMN IF NOT EXISTS km_desconectado     NUMERIC(8,1) CHECK (km_desconectado >= 0),
  ADD COLUMN IF NOT EXISTS km_fichado_sin_bolt NUMERIC(8,1) CHECK (km_fichado_sin_bolt >= 0),
  ADD COLUMN IF NOT EXISTS km_no_desfichar     NUMERIC(8,1) CHECK (km_no_desfichar >= 0);

COMMENT ON COLUMN km_banco_coche.km_no_desfichar IS
  'De sus km fuera de BOLT ese día y en ese coche, los que se le imputan por no terminar el turno: tenía el coche fichado y quien estaba en BOLT con él era otro (db/269). NULL = sin desglose.';

COMMENT ON COLUMN km_banco_calculo.version IS
  'Con qué regla se calculó el día: 1 = 17,5 km por día que tocaba (db/267); 2 = 8,8 km por hora de viaje con tope de 53 (db/268); 3 = además, el desglose por causa de cada coche (db/269).';

COMMIT;
