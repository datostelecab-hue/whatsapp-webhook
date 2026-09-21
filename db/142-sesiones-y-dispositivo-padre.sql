-- ============================================================
-- 142 · LAS SESIONES ABIERTAS, Y EL DISPOSITIVO PADRE
-- ============================================================
-- Hasta ahora la sesion era una cookie firmada y nada mas: el servidor no sabia
-- cuantas habia abiertas ni desde donde. Cortar solo se podia HACIA TODAS a la
-- vez (`usuario.sesiones_desde`, db/105), que sirve para bloquear a alguien y no
-- sirve para "cierrame la del movil que me lo dejo en el coche".
--
-- Aqui empiezan a existir las dos cosas que faltaban:
--
--   · LA SESION, una fila por inicio de sesion, con su `sid` dentro del token.
--     Cerrarla es marcarla, y la siguiente peticion de ese navegador se
--     encuentra con la puerta cerrada.
--   · EL DISPOSITIVO, que NO es la sesion. Un PC del que sales y vuelves a
--     entrar sigue siendo el mismo PC, y eso es lo que hace falta para la regla
--     de abajo. Se reconoce por una cookie propia que no se borra al salir.
--
-- ── LA REGLA DEL DISPOSITIVO PADRE ──────────────────────────────────────────
--
-- Solo el dispositivo con el PRIMER inicio de sesion mas antiguo puede cerrar
-- las sesiones de los demas. Si entraste por primera vez en el PC en abril y en
-- el movil en mayo, el PC manda: desde el movil no se puede echar al PC.
--
-- El motivo es que un robo de sesion se parece mucho a esta pantalla. Quien te
-- coge el movil desbloqueado no puede usarlo para dejarte fuera de tu propio
-- ordenador; lo unico que puede hacer desde ahi es cerrar lo que ya tiene.
--
-- Y por eso manda el PRIMER VISTO DEL DISPOSITIVO y no el inicio de la sesion
-- en curso: si mandara la sesion, bastaria con que el padre caducara una noche
-- para que el telefono heredara el mando a la mañana siguiente.
--
-- `principal_forzado` es la unica forma de mover el mando, y no hay pantalla
-- que lo toque: se escribe en la base, a mano, y eso es a proposito. Si se
-- pudiera cambiar desde dentro de la aplicacion, la regla no protegeria de nada
-- —el que entrase se haria padre y luego echaria al de verdad—.

BEGIN;

-- ── El dispositivo: sobrevive a cerrar sesion ───────────────────────────────
CREATE TABLE IF NOT EXISTS usuario_dispositivo (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id        INTEGER      NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  -- El identificador que viaja en su propia cookie. No identifica a la persona:
  -- identifica al navegador, y por eso se guarda junto al usuario y no suelto.
  dispositivo       VARCHAR(64)  NOT NULL,
  -- Como se llama en pantalla: "Windows · Chrome", "Android · Chrome". Sale del
  -- user-agent, que miente con facilidad, asi que es una AYUDA para reconocerlo
  -- y nunca lo que decide nada.
  etiqueta          VARCHAR(80),
  -- LA FECHA QUE MANDA. La primera vez que esta persona entro desde aqui.
  primer_visto_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ultimo_visto_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- LA PUERTA DEL DESARROLLADOR. Ninguna pantalla la escribe.
  principal_forzado BOOLEAN      NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_usuario_dispositivo UNIQUE (usuario_id, dispositivo)
);

CREATE INDEX IF NOT EXISTS ix_usuario_dispositivo_orden
  ON usuario_dispositivo (usuario_id, primer_visto_at);

COMMENT ON COLUMN usuario_dispositivo.primer_visto_at IS
  'La primera vez que este usuario entro desde este dispositivo. Decide cual es el '
  'padre: el mas antiguo manda y puede cerrar las sesiones de los demas.';
COMMENT ON COLUMN usuario_dispositivo.principal_forzado IS
  'Mueve el mando a este dispositivo pase lo que pase con las fechas. SOLO se escribe '
  'desde la base de datos, a mano: si la aplicacion pudiera cambiarlo, la regla no '
  'protegeria de nada.';

-- ── La sesion: una fila por inicio de sesion ────────────────────────────────
CREATE TABLE IF NOT EXISTS usuario_sesion (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Lo que viaja dentro del token firmado. Es lo que permite cerrar UNA.
  sid            VARCHAR(64)  NOT NULL UNIQUE,
  usuario_id     INTEGER      NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  dispositivo_id BIGINT       REFERENCES usuario_dispositivo(id) ON DELETE SET NULL,
  creada_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Cuando se vio por ultima vez. No se escribe en cada peticion: seria una
  -- escritura por clic. Se refresca cada pocos minutos.
  vista_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expira_at      TIMESTAMPTZ  NOT NULL,
  larga          BOOLEAN      NOT NULL DEFAULT FALSE,
  ip             VARCHAR(64),
  agente         VARCHAR(300),
  cerrada_at     TIMESTAMPTZ,
  -- Quien la cerro y por que. Sin esto, una sesion cerrada y una caducada se
  -- parecen demasiado, y la diferencia importa: una la cerro alguien.
  cerrada_por    INTEGER      REFERENCES usuario(id) ON DELETE SET NULL,
  cerrada_motivo VARCHAR(40)
);

-- Las ABIERTAS de una persona, que es lo unico que se consulta a menudo.
CREATE INDEX IF NOT EXISTS ix_usuario_sesion_abiertas
  ON usuario_sesion (usuario_id, creada_at DESC) WHERE cerrada_at IS NULL;

COMMENT ON TABLE usuario_sesion IS
  'Una fila por inicio de sesion. El sid viaja en el token firmado; cerrar una sesion '
  'es marcar su fila, y la siguiente peticion de ese navegador se queda fuera.';

COMMIT;
