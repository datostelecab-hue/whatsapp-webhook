-- ============================================================
-- 239 — NÓMINAS: UN SOLO LISTÓN DE UTILIZACIÓN, EL 77 %
-- ============================================================
-- Camilo, 10/11/2026: «Necesito un ajuste importante en la nómina, tanto de ETT
-- como propia. No vamos a ser tan agresivos, deja que todo mundo tenga al menos
-- 77% de utilización, si tiene más de eso no le quitamos, si tiene menos de eso
-- entonces le quitamos hasta llegar al 77%».
--
-- Desde el 16/10/2026 había dos listones (regla 4 de nominas.service.js):
-- quien llegaba al 75 % (`utilUmbral`) no perdía nada, y a quien no llegaba se
-- le exigía el 85 % (`utilExigida`): se le quitaban horas de ESPERA hasta
-- dejarlo en el 85. Ahora los dos son el 77 %: quien llega no pierde nada, y a
-- quien no llega se le quita espera hasta dejarlo exactamente en el 77. Nunca
-- se quita viaje.
--
-- Los dos valores viven en nomina_config (se editan en el panel de /nominas) y
-- lo guardado manda sobre los de código, así que no basta con cambiar el
-- código: aquí se guardan los dos. Vale para la plantilla propia y para la ETT
-- (las dos pasan por el mismo recorte). Las nóminas congeladas no cambian —se
-- congelan con su configuración—; el 10/11/2026 no había ninguna.

BEGIN;

INSERT INTO nomina_config (clave, valor) VALUES ('utilUmbral', 0.77), ('utilExigida', 0.77)
ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, usuario_id = NULL, actualizado_at = now();

COMMIT;
