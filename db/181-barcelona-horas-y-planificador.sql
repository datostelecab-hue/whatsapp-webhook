-- ============================================================
-- 181 — BARCELONA: SUS HORAS, SUS COCHES Y SU PLANIFICADOR
-- ============================================================
-- Camilo, 07/10/2026: en el login se elige Madrid o Barcelona. Barcelona no
-- necesita fichas, altas ni libranzas: solo planificar a sus conductores de
-- BOLT (nombre y teléfono) en sus matrículas, de día o de noche, y sacar el
-- reporte de horas («No salió» cuando no hizo horas). Ver docs/nucleo/Sedes.md
-- y docs/modulos/Barcelona.md.
--
-- Todo lo de Barcelona va en TABLAS SUYAS, a propósito. Madrid lee las horas de
-- Flota viva (fv_tramo) y de bolt_state_log en Control, Visibilidad, la
-- Bitácora, el mapa y la foto del ahora; si las horas de Barcelona entraran ahí,
-- sus conductores (que no tienen ficha) saldrían como NN en todas esas
-- pantallas. Así Madrid no cambia en nada.
--
-- Las tablas llevan `sede` y no se llaman «barcelona»: la próxima sede entra con
-- su empresa de BOLT en `flota` y en CONFIG_BOLT.flotasOtrasSedes, sin tablas
-- nuevas.

BEGIN;

-- ── 1 · Los cambios de estado de BOLT de las empresas de otras sedes ─────────
-- Tal cual llegan, como bolt_state_log (db/37). De aquí salen sus horas: viaje
-- y espera, con el mismo catálogo de estados que Madrid (fv_estado_bolt).
CREATE TABLE IF NOT EXISTS sede_bolt_state_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede           varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  company_id     integer      NOT NULL REFERENCES flota(company_id),
  driver_uuid    varchar(64)  NOT NULL,
  vehiculo_uuid  varchar(64),
  estado         varchar(24)  NOT NULL,
  ocurrido_at    timestamptz  NOT NULL,   -- el `created` de BOLT: la hora real del cambio
  creado_at      timestamptz  NOT NULL DEFAULT now(),
  -- La misma clave que bolt_state_log: reingerir una ventana solapada no duplica.
  CONSTRAINT uq_sede_bsl UNIQUE (driver_uuid, ocurrido_at, estado)
);
CREATE INDEX IF NOT EXISTS ix_sede_bsl_sede_t   ON sede_bolt_state_log (sede, ocurrido_at);
CREATE INDEX IF NOT EXISTS ix_sede_bsl_driver_t ON sede_bolt_state_log (driver_uuid, ocurrido_at);

COMMENT ON TABLE sede_bolt_state_log IS
  'Los cambios de estado de BOLT de las empresas de OTRAS sedes (Barcelona), aparte de bolt_state_log para que Madrid no los lea (db/181).';

-- ── 2 · Los coches de BOLT de otras sedes ─────────────────────────────────
-- Para que el planificador de Barcelona ofrezca sus matrículas sin meterlas a
-- mano: lo que BOLT tiene dado de alta en esa empresa.
CREATE TABLE IF NOT EXISTS sede_bolt_vehiculo (
  uuid            varchar(64)  PRIMARY KEY,
  sede            varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  company_id      integer      NOT NULL REFERENCES flota(company_id),
  matricula       varchar(16)  NOT NULL,
  modelo          varchar(120),
  estado_bolt     varchar(24),                          -- el `state` de BOLT (p. ej. suspendido)
  primera_vez_at  timestamptz  NOT NULL DEFAULT now(),
  visto_at        timestamptz  NOT NULL DEFAULT now()   -- la última vez que BOLT lo devolvió
);
CREATE INDEX IF NOT EXISTS ix_sede_bveh_mat ON sede_bolt_vehiculo (sede, matricula);

COMMENT ON TABLE sede_bolt_vehiculo IS
  'Los coches que BOLT tiene en las empresas de OTRAS sedes (Barcelona). visto_at viejo = BOLT ya no lo devuelve (db/181).';

-- ── 3 · El planificador de otras sedes: asignaciones FIJAS ──────────────────
-- Camilo eligió «fija hasta cambiarla»: se pone a alguien en una matrícula y un
-- turno, y vale todos los días hasta que se cambie. No hay libranzas: el día en
-- que no hace horas, el reporte dice «No salió».
--
-- Un cambio no borra el pasado: cierra la asignación de antes (`hasta`) y abre
-- otra. Así el reporte de un día viejo sigue sabiendo a quién le tocaba.
CREATE TABLE IF NOT EXISTS sede_asignacion (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sede          varchar(16)  NOT NULL REFERENCES cat_sede(codigo),
  matricula     varchar(16)  NOT NULL,
  turno         varchar(6)   NOT NULL,
  driver_uuid   varchar(64)  NOT NULL,   -- la cuenta de BOLT: en Barcelona no hay ficha
  desde         date         NOT NULL,
  hasta         date,                    -- último día que vale; NULL = sigue
  creado_por    integer      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at     timestamptz  NOT NULL DEFAULT now(),
  cerrado_por   integer      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrado_at    timestamptz,
  CONSTRAINT ck_sede_asig_turno CHECK (turno IN ('dia', 'noche')),
  CONSTRAINT ck_sede_asig_rango CHECK (hasta IS NULL OR hasta >= desde)
);
-- Una persona por plaza (matrícula + turno), y una plaza por persona y turno.
-- Lo garantiza la base, no la pantalla.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_asig_plaza
  ON sede_asignacion (sede, matricula, turno) WHERE hasta IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sede_asig_conductor
  ON sede_asignacion (sede, driver_uuid, turno) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS ix_sede_asig_rango ON sede_asignacion (sede, desde, hasta);

COMMENT ON TABLE sede_asignacion IS
  'Planificador de OTRAS sedes (Barcelona): quién lleva cada matrícula de día o de noche, fijo hasta que se cambia (db/181).';

COMMIT;
