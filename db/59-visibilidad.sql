-- ============================================================
-- 59 · VISIBILIDAD — horas de flota desde el núcleo (sustituye al "VISOR EN VIVO")
-- ============================================================
-- El VISOR de la hoja ("AMBAS FLOTAS": horas efectivas, utilización, ideal, crítico,
-- brecha) se reconstruye aquí SOBRE PostgreSQL. Los datos salen del núcleo (fv_tramo),
-- que es lo que ya ingiere BOLT — cero llamadas a la hoja, cero API en cada pintado.
--
-- Dos piezas:
--   · visibilidad_dia    — FOTO diaria de flota (la escribe un cron). Es el histórico
--                          que alimenta los gráficos del mes (por día, acumulado,
--                          brecha). Los KPIs "en vivo" (hoy, semana, turno) se calculan
--                          al momento; esto es solo la serie estable del pasado.
--   · visibilidad_config — parámetros editables: la meta diaria, el IDEAL de flota y
--                          (cuando llegue) la fórmula del CRÍTICO. Una fila 'parametros'
--                          en jsonb, para poder añadir campos sin migrar cada vez.

-- ── Foto diaria de flota (día natural, ambas flotas juntas) ───────────────────
CREATE TABLE IF NOT EXISTS visibilidad_dia (
  dia               date PRIMARY KEY,
  -- Segundos por situación de BOLT, sumados sobre toda la flota en el día natural
  -- (00:00→24:00 Europe/Madrid). "Efectivas" = viaje + espera (disponible para
  -- pedidos), que es lo que contaba la hoja; el descanso se guarda aparte por si
  -- luego hace falta.
  viaje_seg         bigint NOT NULL DEFAULT 0,
  espera_seg        bigint NOT NULL DEFAULT 0,
  descanso_seg      bigint NOT NULL DEFAULT 0,
  km_bolt           numeric(12,1) NOT NULL DEFAULT 0,   -- km rodados en viaje+espera
  conductores       int    NOT NULL DEFAULT 0,          -- distintos con viaje/espera ese día
  capturado_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE visibilidad_dia IS
  'Foto diaria de flota (núcleo fv_tramo) para los gráficos del mes en Visibilidad. La escribe el cron; el pasado queda estable, hoy/ayer se refrescan.';

-- ── Parámetros editables (IDEAL / CRÍTICO / meta) ─────────────────────────────
CREATE TABLE IF NOT EXISTS visibilidad_config (
  clave         text PRIMARY KEY,
  valor         jsonb NOT NULL,
  actualizado_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE visibilidad_config IS
  'Parametros del modulo Visibilidad (la pestana Config del VISOR). Fila "parametros": capacidad_diaria_h, meta, vehiculos, dias_del_mes. Editable desde la pantalla para recalcular ideal/critico/brecha.';

-- Semilla = la pestaña Config de la hoja, tal cual:
--   capacidad_diaria_h (B3) = 16   → horas/coche/día que puede dar la flota
--   meta               (B4) = 28157 → objetivo de horas del mes
--   vehiculos          (B5) = 73    → nº de coches
--   dias_del_mes       (B6) = null  → null = días reales del mes; se puede fijar a mano
-- Con esto:  IDEAL(d)   = meta/dias_del_mes * d
--            CRITICO(d) = MAX(0, meta - (dias_del_mes - d) * capacidad_diaria_h * vehiculos)
INSERT INTO visibilidad_config (clave, valor)
VALUES ('parametros', '{"capacidad_diaria_h": 16, "meta": 28157, "vehiculos": 73, "dias_del_mes": null}'::jsonb)
ON CONFLICT (clave) DO NOTHING;
