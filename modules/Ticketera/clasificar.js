// ============================================================
// EL REPARTO — a qué área va cada cosa que se pide
// ============================================================
// Portado del Apps Script que hacía esto dentro de Google. La lógica es la
// misma y el ORDEN también, porque el orden ES la regla: se busca el texto
// dentro de la gestión que eligió el conductor y GANA LA PRIMERA que encaja.
//
// Un ejemplo de por qué importa: "baja por permiso retribuido" contiene «baja» y
// contiene «permiso». Cae en BAJA_AUSENCIA porque esa regla va antes, y es lo
// correcto: es una baja. Si alguien reordenara la tabla, ese ticket se iría a
// otra bandeja sin que nada fallara.
//
// ── LO QUE CAMBIA RESPECTO AL SCRIPT ────────────────────────────────────────
// Allí esto estaba PARTIDO EN DOS: una pestaña CONFIG que una persona podía
// editar (el «BLOQUE A») y una cascada de `if` escrita a mano dentro del código,
// con la pestaña ganando. Para saber a dónde iba una gestión había que mirar los
// dos sitios y saber cuál mandaba.
//
// Aquí es una sola tabla ordenada. Las reglas que puso una persona siguen yendo
// primero —llevan `manual` y un orden bajo—, pero se ven y se tocan donde las
// demás.

const db = require('../../services/db');

/**
 * El mismo `norm` del Apps Script: sin tildes, en minúsculas y sin dobles
 * espacios. Se aplica a los DOS lados, al patrón y a la gestión, o "Nómina" no
 * encontraría el patrón 'nomina'.
 */
function norm(v) {
  return String(v == null ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Las reglas cambian poco y esto se llama una vez por ticket entrante. Se
// guardan un minuto: suficiente para una pasada de la ingesta, poco para que
// alguien toque el reparto y no lo vea.
let cache = null, cacheTs = 0;
const TTL = 60 * 1000;

async function reglas() {
  const ahora = Date.now();
  if (cache && ahora - cacheTs < TTL) return cache;
  const r = await db.consulta(
    `SELECT r.patron, r.exacta, r.subtipo_codigo, s.area_codigo
       FROM ticket_routing r
       JOIN cat_ticket_subtipo s ON s.codigo = r.subtipo_codigo
      ORDER BY r.manual DESC, r.orden, r.id`);
  cache = r.rows.map(x => ({
    patron: norm(x.patron), exacta: x.exacta,
    subtipo: x.subtipo_codigo, area: x.area_codigo,
  }));
  cacheTs = ahora;
  return cache;
}

/** Se olvida el reparto guardado. La llama la pantalla al cambiar una regla. */
function olvidar() { cache = null; }

/**
 * A qué área y subtipo va una gestión. Nunca devuelve nada: si ninguna regla
 * encaja, sale SIN_CLASIFICAR y va a RRHH, igual que en el script.
 *
 * Eso NO es un fallo, es el diseño: un ticket que no se sabe clasificar tiene
 * que aparecer en una bandeja de alguien. Desaparecer sería lo malo.
 */
async function clasificar(gestion) {
  const g = norm(gestion);
  if (g) {
    for (const r of await reglas()) {
      if (!r.patron) continue;
      if (r.exacta ? g === r.patron : g.includes(r.patron)) {
        return { area: r.area, subtipo: r.subtipo, porRegla: r.patron };
      }
    }
  }
  return { area: 'RRHH', subtipo: 'SIN_CLASIFICAR', porRegla: null };
}

module.exports = { clasificar, norm, olvidar };
