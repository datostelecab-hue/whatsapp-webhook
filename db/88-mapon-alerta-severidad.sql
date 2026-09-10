-- ============================================================
-- EL ÍNDICE FILTRABA POR UNA SEVERIDAD QUE NO EXISTE
-- ============================================================
-- Puse `WHERE severidad = 'grave'` dando por hecho el vocabulario. El que usa
-- el módulo desde siempre es 'alta' / 'media' / 'baja' (services/mapon.js,
-- función `severidad`), así que el índice no cubría ni una fila: seguía ahí,
-- ocupando y sin servir para nada, que es peor que no tenerlo porque parece
-- que el caso está resuelto.

BEGIN;

DROP INDEX IF EXISTS idx_malerta_grave;
CREATE INDEX idx_malerta_grave ON mapon_alerta (ocurrido_at DESC) WHERE severidad = 'alta';

COMMENT ON COLUMN mapon_alerta.severidad IS
  'alta / media / baja, tal como las clasifica services/mapon.js. Las altas son las que se miran';

COMMIT;
