-- ============================================================
-- 128 - LA CANDIDATURA NO PUEDE IR DETRÁS DEL CONTRATO
-- ============================================================
-- Caso real, y se veía en la pantalla: Iván Martínez entró por la matriz de la
-- agencia el 14, se le dio de alta el 15 —contrato abierto, coche, BOLT
-- enlazado— y la lista de la ETT seguía enseñándolo en «Coordinación de
-- entrevista». Si se hubiera generado el Excel ese día, gigroup habría leído
-- «Pendiente» de alguien que llevaba un día conduciendo.
--
-- El motivo: el único camino que adelanta la candidatura es `pasarARRHH`. Dar
-- de alta desde el alta rápida o desde la ficha de Plantilla abre el contrato y
-- no toca el proceso, así que el proceso se queda donde estaba.
--
-- Ya no: las dos puertas llaman a `abrirContratada`, que adelanta la
-- candidatura viva hasta `listo_rrhh` y le escribe la fecha de alta. Esto
-- arregla a los que se quedaron atrás antes del cambio.
--
-- ── SOLO HACIA ADELANTE, Y SOLO DESDE EL EMBUDO ────────────────────────────
-- Lo dice el ORDEN del catálogo, no una lista escrita aquí:
--   · orden < 12 (`listo_rrhh`) son los estados del embudo → se adelantan.
--   · 12 a 15 (listo_rrhh, pendiente_pin, alta, asignado) ya están al final o
--     más allá → no se tocan, porque sería retroceder.
--   · 89 en adelante son SALIDAS (descartado, no se presentó, baja…) → tampoco.
--     Esas las decidió una persona y no las pisa una migración; si alguien
--     marcado "no se presentó" acabó contratado, eso se mira a mano.
--
-- Y la fecha: `inicio_previsto` se rellena con el alta de SU contrato abierto y
-- solo si estaba vacía. No es un adorno — es lo que hace que el Excel de la
-- agencia diga «Contratado» con su fecha en vez de contarlo como "sin decidir"
-- y negarse a generar la tanda entera.

BEGIN;

-- Sin LATERAL a proposito: en un UPDATE, el FROM no puede mirar a la tabla que
-- se actualiza, asi que el contrato se busca con subconsultas correlacionadas.
UPDATE candidatura k
   SET estado = 'listo_rrhh',
       inicio_previsto = COALESCE(k.inicio_previsto,
         (SELECT pe.alta FROM conductor_periodo_empleo pe
           WHERE pe.conductor_id = k.conductor_id AND pe.baja IS NULL
           ORDER BY pe.alta DESC LIMIT 1)),
       apto_at = COALESCE(k.apto_at, now()),
       actualizado_at = now()
  FROM cat_estado_candidatura e
 WHERE k.cerrado_at IS NULL
   AND e.codigo = k.estado
   AND e.orden < (SELECT orden FROM cat_estado_candidatura WHERE codigo = 'listo_rrhh')
   -- Solo a quien tiene el contrato ABIERTO: es lo que hace verdad la frase.
   AND EXISTS (SELECT 1 FROM conductor_periodo_empleo pe
                WHERE pe.conductor_id = k.conductor_id AND pe.baja IS NULL);

COMMIT;
