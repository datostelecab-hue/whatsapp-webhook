-- ============================================================
-- 238 — LAS HORAS DE CAVEREL, MES A MES
-- ============================================================
-- Camilo, 10/11/2026: «Tengo las horas de Caverel de mucho antes, resumida por
-- meses, vamos a hacer un apartado en la bitácora llamado "Horas Caverel", en la
-- cual vamos a poder visualizar las horas mensuales de este archivo por nombre,
-- que se vea la utilización, horas totales y desglosadas por espera y viaje por
-- el mes que se le ve ahí».
--
-- El archivo es el «Fleet Owner Earnings Report» de BOLT agrupado por meses
-- (columna «Dynamic Timeframe» = AAAA-MM): una fila por cuenta y mes, de
-- diciembre de 2024 en adelante. De ahí se guarda lo que la pantalla enseña:
--
--   · horas_online   «Total Online Hours»: el tiempo conectado (viaje + espera)
--   · ocupacion_pct  «Occupation Rate»: el % de ese tiempo con pasajero. Es la
--                    UTILIZACIÓN de la casa (viaje / viaje + espera). BOLT la da
--                    redondeada a un % entero.
--   · viajes         «Finished Trips Count»
--
-- El viaje y la espera NO se guardan: salen de las dos primeras (viaje = horas ×
-- ocupación; espera = el resto) y así nunca pueden contradecirse.
--
-- LOS DATOS NO VAN EN ESTA MIGRACIÓN: el repositorio es público y el archivo
-- trae el DNI de cada uno. Entran subiendo el CSV desde la pantalla
-- (/bitacora/caverel, «Subir CSV»), que los lee y los guarda aquí. Subirlo otra
-- vez SUSTITUYE las cifras de cada cuenta y mes (clave única): nada se duplica.

BEGIN;

CREATE TABLE IF NOT EXISTS bitacora_caverel_mes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mes            date          NOT NULL,                 -- el día 1 del mes
  cuenta         varchar(64)   NOT NULL,                 -- «Hashed External ID» de BOLT
  nombre         varchar(160)  NOT NULL,                 -- «Driver Name», tal cual
  dni            varchar(20),                            -- «Personal Code»: une con la ficha
  horas_online   numeric(8,2)  NOT NULL DEFAULT 0,
  ocupacion_pct  numeric(5,2),                           -- NULL si BOLT no la da
  viajes         integer       NOT NULL DEFAULT 0,
  importado_por  integer       REFERENCES usuario(id) ON DELETE SET NULL,
  importado_at   timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT ck_caverel_mes_dia1 CHECK (extract(day FROM mes) = 1),
  CONSTRAINT ck_caverel_horas CHECK (horas_online >= 0),
  CONSTRAINT ck_caverel_ocupacion CHECK (ocupacion_pct IS NULL OR ocupacion_pct BETWEEN 0 AND 100),
  CONSTRAINT ck_caverel_viajes CHECK (viajes >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_caverel_cuenta_mes ON bitacora_caverel_mes (cuenta, mes);
CREATE INDEX IF NOT EXISTS ix_caverel_mes ON bitacora_caverel_mes (mes);
CREATE INDEX IF NOT EXISTS ix_caverel_dni ON bitacora_caverel_mes (upper(btrim(dni))) WHERE dni IS NOT NULL;

COMMENT ON TABLE bitacora_caverel_mes IS
  'Horas de Caverel por cuenta de BOLT y mes (db/238), del «Fleet Owner Earnings Report» mensual que se sube en /bitacora/caverel. Las horas de antes de que el ERP tuviera las suyas. Subir el CSV otra vez sustituye cada cuenta y mes';
COMMENT ON COLUMN bitacora_caverel_mes.horas_online IS
  'Total Online Hours de BOLT: tiempo conectado (viaje + espera). Viaje = horas × ocupación; espera = el resto';
COMMENT ON COLUMN bitacora_caverel_mes.ocupacion_pct IS
  'Occupation Rate de BOLT (0-100): % del tiempo conectado con pasajero. Es la utilización de la casa. BOLT la redondea a un entero';
COMMENT ON COLUMN bitacora_caverel_mes.dni IS
  'Personal Code de BOLT: el DNI/NIE con el que se une a la ficha del conductor (conductor.dni_nie)';

COMMIT;
