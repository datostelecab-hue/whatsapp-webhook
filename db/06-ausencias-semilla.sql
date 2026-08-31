-- ============================================================
-- TELECAB — SEMILLA DE SITUACIONES DEL CONDUCTOR
-- ============================================================
-- Los valores reales de la columna ESTADO de AGENDA_V2, con la diferencia que
-- de verdad importa: cuáles tienen fin previsible y cuáles no.

BEGIN;

INSERT INTO cat_estado_conductor
  (codigo, etiqueta, es_ausencia, libera_plaza, fin_previsible, marca_bitacora, orden) VALUES
  ('activo',            'Activo',             FALSE, FALSE, FALSE, NULL, 1),
  -- Vacaciones y permisos SE PIDEN con fechas, así que el sistema puede
  -- cerrarlos solo cuando llega el día de vuelta.
  ('vacaciones',        'Vacaciones',         TRUE,  FALSE, TRUE,  'V',  2),
  ('permiso',           'Permiso retribuido', TRUE,  FALSE, TRUE,  'P',  3),
  -- Una baja médica NO tiene fecha de fin conocida: nadie sabe cuándo se
  -- recupera una persona. Se cierra a mano el día que se reincorpora.
  ('baja_medica',       'Baja médica',        TRUE,  FALSE, FALSE, 'B',  4),
  -- Suspendido libera la plaza: el coche tiene que salir con otro.
  ('suspendido',        'Suspendido',         TRUE,  TRUE,  FALSE, NULL, 5),
  ('pendiente_asignar', 'Pendiente asignar',  FALSE, FALSE, FALSE, NULL, 6),
  ('baja_empresa',      'Baja en la empresa', TRUE,  TRUE,  FALSE, NULL, 7)
ON CONFLICT (codigo) DO UPDATE
  SET etiqueta = EXCLUDED.etiqueta, es_ausencia = EXCLUDED.es_ausencia,
      libera_plaza = EXCLUDED.libera_plaza, fin_previsible = EXCLUDED.fin_previsible,
      marca_bitacora = EXCLUDED.marca_bitacora, orden = EXCLUDED.orden;

COMMIT;

SELECT codigo, etiqueta, es_ausencia, fin_previsible FROM cat_estado_conductor ORDER BY orden;
