-- ============================================================
-- 135 — EL ÚLTIMO APUNTE DE BOLT, POR COCHE
-- ============================================================
-- `bolt_state_log` tenía índice por CONDUCTOR (idx_bsl_driver_dia) porque hasta
-- hoy solo se preguntaba "qué hizo esta persona". El mapa pregunta lo otro:
-- "¿cuál fue el último apunte de ESTE COCHE?", y eso iba a barrido.
--
-- Con 3.700 apuntes al día no se nota; con seis meses dentro, sí. Y el mapa lo
-- pide para los ~90 coches cada vez que alguien abre la pantalla.
--
-- ── POR QUÉ EL MAPA MIRA AQUÍ Y NO SOLO LOS TRAMOS ──────────────────────────
-- Los tramos los construye el motor de Flota viva, que hace mucho más y por eso
-- se rompe más: el 23/09/2026 estuvo dos horas sin terminar una vuelta —BOLT
-- contestando 429 y las vueltas pisándose— y el mapa acusó de «rueda sin nadie»
-- a conductores que estaban de viaje. Esta tabla la escribe la ingesta, que es
-- tonta y aguanta. El semáforo se apoya ahora en la más fresca de las dos.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_bsl_vehiculo_dia
  ON bolt_state_log (vehiculo_uuid, ocurrido_at DESC)
  WHERE vehiculo_uuid IS NOT NULL;

COMMIT;
