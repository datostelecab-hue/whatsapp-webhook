-- ============================================================
-- 191 — LA BAJA CON FECHA FUTURA SE PROGRAMA
-- ============================================================
-- Camilo, 13/10/2026: «a los que les demos de baja por ejemplo el 15, hoy
-- estamos a 13, no les quites la plaza hasta ese día, que siga planificado;
-- simplemente el sistema sabe que lo quita automáticamente ese día y lo pone de
-- baja, no lo pone de baja de una vez».
--
-- Hasta hoy «Dar de baja» con fecha futura recortaba bien sus plazas hasta ese
-- día, pero CERRABA EL CONTRATO EN EL ACTO, y casi todo el sistema decide quién
-- está de alta por «contrato sin fecha de baja»: el planificador, el bot, la
-- plantilla... Desde ese momento la persona desaparecía como si ya se hubiera
-- ido. Le pasó a Dylan Hernández García (baja voluntaria el 15/10, dada el 13).
--
-- Ahora una baja con fecha futura se APUNTA aquí y el contrato sigue abierto:
-- la persona está de alta, en su plaza y en el bot hasta ese día, y sus plazas
-- quedan libres desde el día siguiente (para que Tráfico vea el hueco y busque
-- relevo). Cuando ese día termina —la jornada va de 05:00 a 05:00, por los
-- turnos de noche—, el ERP la da de baja solo, con la fecha y el motivo de
-- aquí (`plantilla.service.aplicarBajasProgramadas`, cada hora). Una por
-- contrato: la clave es el periodo de empleo.
BEGIN;

CREATE TABLE IF NOT EXISTS conductor_baja_programada (
  periodo_id   BIGINT       PRIMARY KEY REFERENCES conductor_periodo_empleo(id) ON DELETE CASCADE,
  conductor_id BIGINT       NOT NULL REFERENCES conductor(id) ON DELETE CASCADE,
  -- El último día de contrato, como la fecha de baja de siempre: ese día aún
  -- trabaja y sigue en su plaza.
  fecha        DATE         NOT NULL,
  motivo       VARCHAR(255),
  usuario_id   INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  creado_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_baja_programada_fecha ON conductor_baja_programada (fecha);
COMMENT ON TABLE conductor_baja_programada IS
  'Bajas con fecha futura: el contrato sigue abierto hasta que pasa ese día y el ERP da la baja solo (db/191)';

-- LAS QUE YA SE DIERON CON FECHA FUTURA vuelven a estar de alta hasta su día.
-- Sus plazas ya están recortadas a esa fecha (lo hizo la baja); lo que se
-- deshace es el cierre del contrato. Solo si es el único contrato de esa
-- persona con baja futura y no tiene otro abierto (el índice uq_empleo_abierto
-- no deja dos). El 13/10 eran dos: Lionar Abreu Heredia (14/10) y Dylan
-- Hernández García (15/10). Si esto se aplica cuando ya pasó su fecha, no hace
-- nada: ya están de baja como tocaba.
WITH hoy AS (SELECT (now() AT TIME ZONE 'Europe/Madrid')::date AS d),
futuras AS (
  SELECT e.id, e.conductor_id, e.baja, e.motivo_baja, e.usuario_id
    FROM conductor_periodo_empleo e, hoy
   WHERE e.baja > hoy.d
     AND NOT EXISTS (SELECT 1 FROM conductor_periodo_empleo o
                      WHERE o.conductor_id = e.conductor_id AND o.baja IS NULL)
     AND NOT EXISTS (SELECT 1 FROM conductor_periodo_empleo o2, hoy h2
                      WHERE o2.conductor_id = e.conductor_id AND o2.id <> e.id AND o2.baja > h2.d)
),
apuntadas AS (
  INSERT INTO conductor_baja_programada (periodo_id, conductor_id, fecha, motivo, usuario_id)
  SELECT id, conductor_id, baja, motivo_baja, usuario_id FROM futuras
  ON CONFLICT (periodo_id) DO NOTHING
  RETURNING periodo_id
)
UPDATE conductor_periodo_empleo e
   SET baja = NULL, motivo_baja = NULL
  FROM apuntadas a
 WHERE e.id = a.periodo_id;

COMMIT;
