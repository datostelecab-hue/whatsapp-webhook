-- ============================================================
-- 225 — ASUNTOS PROPIOS: UNA SITUACIÓN DE LA PLANTILLA, CON SU BANCO APARTE
-- ============================================================
-- Camilo, 29/10/2026: «siempre, por conductor, debe de sumarse dos días al año
-- de asuntos propios; si no lo ha usado, en vacaciones debe de quedarse el
-- banco de asuntos propios aparte. En la suma que haces me sale que resta a
-- las vacaciones: que no reste, él se restará solo» y «habrá una nueva
-- situación en la plantilla, aparte de suspendido, vacaciones, etc.: asuntos
-- propios, que resta él mismo en el módulo de vacaciones, pero ambos serán
-- separados». Y: «el único que tiene un día de asuntos propios este año es
-- VICTOR RAFAEL REQUENA OBISPO, ya está registrado en el ERP».
--
-- Hasta hoy un día de asuntos propios era un PERMISO retribuido con el tipo
-- del convenio PR_ASUNTOS_PROPIOS (db/31), y restaba un día del saldo de
-- vacaciones (14/10/2026). Desde aquí:
--
-- 1 · LA SITUACIÓN «ASUNTOS PROPIOS» en el catálogo. Se comporta como un
--     permiso en todo lo demás, que es lo que era:
--       · es ausencia: ese día no sale en el cuadrante;
--       · no libera la plaza: es un día, vuelve a su coche;
--       · tiene fecha de vuelta (fin previsible);
--       · en la bitácora es una «P», y en la nómina cuenta como un día de
--         permiso retribuido (las 8 h de siempre: nominas.repo);
--       · en el convenio, permiso retribuido (PAID_LEAVE).
--     Va justo detrás de «Permiso retribuido» en las listas.
--
-- 2 · EL DÍA DE VÍCTOR (fila 60, el 01/09/2026, db/196) pasa a esta situación,
--     y con él cualquier permiso que se pusiera con el tipo de asuntos propios.
--     La fila es la misma: conserva su motivo, quién la puso y su ticket. El
--     tipo del convenio se queda puesto, que es lo que es.
--
-- El banco (2 días al año, aparte de las vacaciones) lo cuenta el módulo de
-- Vacaciones (vacaciones.service.saldoDe): no se guarda, se calcula.

BEGIN;

-- Hueco detrás de «Permiso retribuido» (orden 3).
UPDATE cat_estado_conductor SET orden = orden + 1
 WHERE orden >= 4
   AND NOT EXISTS (SELECT 1 FROM cat_estado_conductor WHERE codigo = 'asuntos_propios');

INSERT INTO cat_estado_conductor
  (codigo, etiqueta, es_ausencia, libera_plaza, fin_previsible, marca_bitacora, orden, es_fin_contrato, ledger_tipo)
VALUES
  ('asuntos_propios', 'Asuntos propios', TRUE, FALSE, TRUE, 'P', 4, FALSE, 'PAID_LEAVE')
ON CONFLICT (codigo) DO UPDATE SET
  etiqueta = EXCLUDED.etiqueta, es_ausencia = EXCLUDED.es_ausencia, libera_plaza = EXCLUDED.libera_plaza,
  fin_previsible = EXCLUDED.fin_previsible, marca_bitacora = EXCLUDED.marca_bitacora,
  es_fin_contrato = EXCLUDED.es_fin_contrato, ledger_tipo = EXCLUDED.ledger_tipo;

UPDATE conductor_estado_hist
   SET estado = 'asuntos_propios'
 WHERE estado = 'permiso' AND leave_type_code = 'PR_ASUNTOS_PROPIOS';

COMMIT;
