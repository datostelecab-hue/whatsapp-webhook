-- ============================================================
-- RESET DE MIGRACIÓN  —  DESTRUCTIVO. LEER ENTERO ANTES DE EJECUTAR.
-- ============================================================
-- Deja TODO en blanco para arrancar de cero: el DOMINIO (plantilla, planificador,
-- nóminas…) Y el NÚCLEO de la ingesta BOLT/Mapon (fv_* de actividad + logs). La
-- ingesta vuelve a llenarse SOLA en cuanto arranque el motor; no queda ni un dato
-- de las pruebas. Se conservan solo los CATÁLOGOS, la config, los USUARIOS, el
-- padrón de cuentas de BOLT (suelto) y el ledger de migraciones.
--
-- CÓMO EJECUTARLO (una sola vez, a mano, sobre la base de PRODUCCIÓN):
--   · Ábrelo en un cliente SQL / consola psql de Render.
--   · Ejecuta TODO el bloque de abajo (va dentro de BEGIN, NO hace COMMIT solo).
--   · MIRA los mensajes NOTICE:
--       – Bloque 2 (TRUNCATE ... CASCADE del dominio): las tablas arrastradas deben
--         ser TODAS de dominio (conductor, vehiculo, contrato, plaza, asignacion,
--         nóminas, candidaturas, documentos, justificante, bitacora_dia, jornada…).
--         Si ahí aparece `usuario`, `cat_`, `turno`, `_migracion`, convenio o
--         `fv_matricula` → algo va mal: escribe ROLLBACK; y avísame.
--       – Bloque 3 (vaciado del núcleo/ingesta): irá nombrando fv_ruta, fv_tramo,
--         bolt_state_log, etc. Eso es lo esperado (empezar de 0).
--   · Si todo cuadra → escribe COMMIT;   (si algo chirría → ROLLBACK;)
--
-- NO lo pongas en db/*.sql: el runner de migraciones lo aplicaría solo. Es manual.
--
-- CONSERVA: fv_matricula (lista de coches vigilados = config, la lee el cargador de
--   flota), fv_cat_situacion/fv_estado_bolt/fv_franja/fv_cat_incidencia/fv_cat_gestion
--   (catálogos del núcleo), conductor_externo (padrón de cuentas de BOLT — se SUELTA
--   de su conductor y queda como "ID de BOLT libre" para re-enlazar por teléfono),
--   todos los cat_*/convenio/turno, usuario/rol/rol_modulo/usuario_acceso_log/
--   cambio_campo/_migracion.
-- BORRA: (a) todo el dominio (raíces conductor, vehiculo, contrato, periodo_nomina,
--   cuadrante, solicitud_ett; el CASCADE arrastra el resto). (b) todo el núcleo de
--   ACTIVIDAD e inventario de la ingesta (fv_ruta/tramo/vuelta/conductor/vehiculo/
--   corte/incidencia/seguimiento) y los LOGS (ingesta_descarga/ejecucion,
--   bolt_state_log, bolt_order, mapon_zona_evento) + fichajes de turno de prueba.

BEGIN;

-- ── 1) Soltar los 2 FK CONSERVAR→conductor ───────────────────────────────────
-- El padrón de BOLT (conductor_externo) se queda, pero SIN dueño (es el estado
-- deseado: cuentas libres que se re-enlazan por teléfono al cargar la plantilla).
-- El CHECK ck_cext_enlace exige que conductor_id y enlazado_at sean ambos NULL o
-- ambos no-NULL: por eso se anulan juntos.
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

-- ── 3) Vaciar el NÚCLEO de la ingesta + LOGS (empezar de 0) ───────────────────
-- La ingesta arranca limpia: fuera la actividad e inventario de BOLT/Mapon
-- acumulados en pruebas y todos los logs. El motor los repuebla solo al encenderse.
-- Se hace tabla a tabla y CON GUARDA `to_regclass` (si alguna no existe se salta y
-- avisa, en vez de abortar toda la transacción por un nombre que cambió).
-- OJO: aquí NO va fv_matricula ni los fv_cat_* — esos son catálogo/config y se
-- conservan (los necesita el cargador de flota).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- núcleo BOLT/Mapon (actividad + inventario)
    'fv_ruta','fv_tramo','fv_vuelta','fv_conductor','fv_vehiculo',
    'fv_corte','fv_incidencia','fv_seguimiento',
    -- staging / logs de ingesta
    'ingesta_descarga','ingesta_ejecucion','bolt_state_log','bolt_order','mapon_zona_evento',
    -- fichajes de turno (por si quedaron pruebas y el CASCADE de dominio no los pilló)
    'registro_jornada','solicitud_registro'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('TRUNCATE %I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'ingesta vaciada: %', t;
    ELSE
      RAISE NOTICE 'no existe (saltada): %', t;
    END IF;
  END LOOP;
END $$;

-- ── 4) Re-crear los 2 FK, ahora AMBOS ON DELETE SET NULL (más seguro a futuro) ─
ALTER TABLE usuario
  ADD CONSTRAINT usuario_conductor_id_fkey
  FOREIGN KEY (conductor_id) REFERENCES conductor(id) ON DELETE SET NULL;
ALTER TABLE conductor_externo
  ADD CONSTRAINT conductor_externo_conductor_id_fkey
  FOREIGN KEY (conductor_id) REFERENCES conductor(id) ON DELETE SET NULL;

-- ── 5) (REVISAR) Conductor CENTINELA ─────────────────────────────────────────
-- Fila comodín para imputar horas cuyo conductor no se resuelve (conductor.es_centinela).
-- El TRUNCATE se la llevó. Si tu sistema la necesita, descoméntala y AJUSTA los campos
-- a tu semilla real. Si no la usa, déjala comentada (es inocua igual).
-- INSERT INTO conductor (es_centinela, nombre, apellidos)
--   SELECT TRUE, 'SIN', 'RESOLVER'
--    WHERE NOT EXISTS (SELECT 1 FROM conductor WHERE es_centinela);

-- ── FIN. Revisa los NOTICE. Si el bloque 2 solo tocó dominio:  COMMIT;  si no:  ROLLBACK; ──
--
-- DESPUÉS DEL COMMIT (orden recomendado):
--   1. Arranca la app en Render. El motor sincroniza BOLT/Mapon → repuebla
--      conductor_externo, fv_conductor y fv_vehiculo, y empieza a ingerir fv_tramo/
--      fv_ruta desde AHORA.
--   2. Cuando el padrón de BOLT ya esté sincronizado, corre el cargador de plantilla
--      (node scripts/migrar-plantilla.js --go). Así su fase de re-enlace por teléfono
--      encuentra las cuentas de BOLT y ata cada conductor a la suya.
