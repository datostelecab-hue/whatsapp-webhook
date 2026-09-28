// ============================================================
// CÓDIGOS DE LAVADO BALLENOIL — la última tanda, hasta el 15/10/2026
// ============================================================
// Ballenoil se quitó del ERP el 24/09/2026 (ya se reposta en Petroprix), pero
// quedaba una tanda de bonos de lavado pagada: 566 códigos que vencen el 17/10
// (db/164). Camilo, 28/09/2026: el botón vuelve al bot «hasta el 15 de octubre,
// y el 15 lo quitamos».
//
// Por eso no vuelve nada más de lo que había: ni pantalla de Administración, ni
// importador, ni cron de limpieza. Solo repartir un código cuando un conductor
// lo pide, y apuntar a quién se le dio.
//
// EL BOTÓN SE VA SOLO: a partir del 16/10/2026 `visible()` dice que no y el bot
// deja de enseñarlo. Quitar el código entero es lo que queda para después.
//
// «Que no se reparta dos veces» lo garantiza la base, no el orden en que lleguen
// los mensajes: el `FOR UPDATE SKIP LOCKED` hace que dos conductores pidiendo a
// la vez se lleven códigos distintos.

const db = require('./db');

const TZ = 'Europe/Madrid';

// El último día en que el botón sale en el bot (incluido).
const LAVADO_HASTA = '2026-10-15';

// Un doble toque en el botón no puede gastar dos bonos: si el mismo teléfono ya
// se llevó uno hace menos de esto, se le repite ese mismo.
const REPETIR_MIN = 30;

const INSTRUCTIVO =
`📋 *Cómo se usa:*
1. Aparca el coche en una pista y fíjate en su número.
2. Ve al terminal Ballenoil Easy Wash y pasa el código por el lector.
3. Elige en la pantalla el número de tu pista.
4. Vuelve al coche e inicia el programa de lavado que quieras.
5. Durante el lavado puedes cambiar de programa las veces que quieras.

⚠️ El código es de *un solo uso*: no lo compartas.`;

const hoyMadrid = () => new Intl.DateTimeFormat('en-CA',
  { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const aEs = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** ¿Sale todavía el botón en el bot? */
const visible = (hoy = hoyMadrid()) => hoy <= LAVADO_HASTA;

/**
 * Un código para ese conductor, o null si no quedan.
 *
 * `repetido` dice que es el mismo que se le dio hace un momento: pulsó dos
 * veces, o volvió a pedirlo porque no lo encontraba en el chat.
 */
async function solicitar({ telefono, conductorId = null, idBolt = null } = {}) {
  const tel = String(telefono || '').replace(/\D/g, '');
  if (!tel) return null;

  const reciente = await db.consulta(
    `SELECT codigo, to_char(vence, 'YYYY-MM-DD') AS vence_iso
       FROM ballenoil_codigo
      WHERE right(regexp_replace(telefono, '[^0-9]', '', 'g'), 9) = right($1, 9)
        AND usado_at > now() - make_interval(mins => $2::int)
      ORDER BY usado_at DESC LIMIT 1`, [tel, REPETIR_MIN]);
  if (reciente.rowCount) {
    const x = reciente.rows[0];
    return { codigo: x.codigo, vence: aEs(x.vence_iso), repetido: true };
  }

  const r = await db.consulta(
    `UPDATE ballenoil_codigo c
        SET usado_at = now(), telefono = $1, id_bolt = $2, conductor_id = $3
      WHERE c.codigo = (
        SELECT codigo FROM ballenoil_codigo
         WHERE usado_at IS NULL AND (vence IS NULL OR vence >= (now() AT TIME ZONE '${TZ}')::date)
         -- El que antes caduca, primero: así no se pierden los que están a punto de vencer.
         ORDER BY vence NULLS LAST, codigo
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING c.codigo, to_char(c.vence, 'YYYY-MM-DD') AS vence_iso`,
    [tel, idBolt ? String(idBolt) : null, conductorId || null]);
  if (!r.rowCount) return null;
  return { codigo: r.rows[0].codigo, vence: aEs(r.rows[0].vence_iso), repetido: false };
}

/** El texto que se le manda con el código (o sin él, si no quedan). */
function mensaje(r) {
  if (!r) return '😕 Ahora mismo no quedan códigos de lavado. Avisa a la oficina, por favor.';
  return `🧽 *Código de lavado Ballenoil*\n\nTu código: *${r.codigo}*` +
    (r.vence ? `\nVálido hasta el ${r.vence}` : '') +
    (r.repetido ? '\n\n_Es el mismo que te di hace un momento._' : '') +
    `\n\n${INSTRUCTIVO}`;
}

module.exports = { visible, solicitar, mensaje, LAVADO_HASTA, INSTRUCTIVO };
