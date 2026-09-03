-- ============================================================
-- RESET DE MIGRACIÓN  —  DESTRUCTIVO. LEER ENTERO ANTES DE EJECUTAR.
-- ============================================================
-- Deja el DOMINIO en blanco y CONSERVA el núcleo BOLT/Mapon (fv_*), la ingesta,
-- los catálogos, el convenio, los USUARIOS y el ledger de migraciones.
--
-- CÓMO EJECUTARLO (una sola vez, a mano, sobre la MISMA base de test+prod):
--   · Ábrelo en un cliente SQL / consola psql de Render.
--   · Ejecuta TODO el bloque de abajo (va dentro de BEGIN, NO hace COMMIT solo).
--   · MIRA los mensajes NOTICE: TRUNCATE ... CASCADE lista las tablas que arrastra.
--     Deben ser TODAS de dominio (conductor, vehiculo, contrato, plaza, asignacion,
--     nóminas, candidaturas, documentos, justificante, bitacora_dia, jornada…).
--     Si aparece CUALQUIER cosa con `fv_`, `usuario`, `cat_`, `turno`, `_migracion`
--     o del convenio → algo va mal: escribe ROLLBACK; y avísame.
--   · Si todo es dominio → escribe COMMIT;   (si no → ROLLBACK;)
--
-- NO lo pongas en db/*.sql: el runner de migraciones lo aplicaría solo. Es manual.
--
-- CONSERVA: fv_* (14 tablas), ingesta_descarga/bolt_state_log/bolt_order/
--   mapon_zona_evento/ingesta_ejecucion, conductor_externo (padrón — se SUELTA de su
--   conductor y queda como "ID de BOLT libre"), todos los cat_*/convenio/turno,
--   usuario/rol/rol_modulo/usuario_acceso_log/cambio_campo/_migracion.
-- BORRA: todo el dominio (raíces conductor, vehiculo, contrato, periodo_nomina,
--   cuadrante, solicitud_ett; el CASCADE arrastra el resto).

BEGIN;

-- ── 1) Soltar los 2 FK CONSERVAR→conductor ───────────────────────────────────
-- El padrón de BOLT se queda, pero SIN dueño (es el estado deseado: cuentas libres
-- que se re-enlazarán por teléfono al cargar la plantilla). El CHECK ck_cext_enlace
-- exige que conductor_id y enlazado_at sean ambos NULL o ambos no-NULL: por eso se
-- anulan juntos.
UPDATE conductor_externo
   SET conductor_id = NULL, enlazado_at = NULL, origen_enlace = 'migracion'
 WHERE conductor_id IS NOT NULL;

UPDATE usuario SET conductor_id = NULL WHERE conductor_id IS NOT NULL;

-- Se sueltan por su columna (confrelid = conductor), sin depender del nombre exacto
-- del constraint.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT rel.relname AS tabla, con.conname AS constraint
      FROM pg_constraint con
      JOIN pg_class rel  ON rel.oid  = con.conrelid
      JOIN pg_class frel ON frel.oid = con.confrelid
     WHERE con.contype = 'f' AND frel.relname = 'conductor'
       AND rel.relname IN ('usuario', 'conductor_externo')
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tabla, r.constraint);
    RAISE NOTICE 'FK soltado: %.%', r.tabla, r.constraint;
  END LOOP;
END $$;

-- ── 2) Vaciar el DOMINIO ─────────────────────────────────────────────────────
-- Con los 2 FK fuera, el CASCADE ya solo alcanza tablas de dominio. Listar las
-- raíces basta; el CASCADE arrastra todo lo que cuelga de ellas (verifícalo en los
-- NOTICE, como dice la cabecera).
TRUNCATE
  conductor,
  vehiculo,
  contrato,
  periodo_nomina,
  cuadrante,
  solicitud_ett
  RESTART IDENTITY CASCADE;

-- ── 3) Re-crear los 2 FK, ahora AMBOS ON DELETE SET NULL (más seguro a futuro) ─
ALTER TABLE usuario
  ADD CONSTRAINT usuario_conductor_id_fkey
  FOREIGN KEY (conductor_id) REFERENCES conductor(id) ON DELETE SET NULL;
ALTER TABLE conductor_externo
  ADD CONSTRAINT conductor_externo_conductor_id_fkey
  FOREIGN KEY (conductor_id) REFERENCES conductor(id) ON DELETE SET NULL;

-- ── 4) (REVISAR) Conductor CENTINELA ─────────────────────────────────────────
-- Fila comodín para imputar horas cuyo conductor no se resuelve (conductor.es_centinela).
-- El TRUNCATE se la llevó. Si tu sistema la necesita, descoméntala y AJUSTA los campos
-- a tu semilla real. Si no la usa, déjala comentada (es inocua igual).
-- INSERT INTO conductor (es_centinela, nombre, apellidos)
--   SELECT TRUE, 'SIN', 'RESOLVER'
--    WHERE NOT EXISTS (SELECT 1 FROM conductor WHERE es_centinela);

-- ── FIN. Revisa los NOTICE de arriba. Si TODO es dominio:  COMMIT;  si no:  ROLLBACK; ──


-- ============================================================
-- OPCIONAL — PODAR EL NÚCLEO A LOS ÚLTIMOS 2 MESES
-- ============================================================
-- Solo si hay datos de BOLT/Mapon más viejos que quieras quitar. Va APARTE (fuera de
-- la transacción de arriba). No borra estructura, solo filas viejas. Sin FK al
-- dominio, es seguro. Ejecútalo por separado si lo necesitas:
--
-- DELETE FROM fv_ruta  WHERE inicio < now() - interval '2 months';
-- DELETE FROM fv_tramo WHERE desde  < now() - interval '2 months';
