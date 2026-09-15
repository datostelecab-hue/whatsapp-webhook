// ============================================================
// EL PADRÓN DE BOLT — quién tiene cuenta, desde cuándo y en qué estado
// ============================================================
// Existe porque la API de BOLT NO dice cuándo se creó un conductor. Así que la
// fecha nos la fabricamos nosotros: se lee el padrón entero cada poco y, la
// primera vez que se ve un `driver_uuid`, se le sella la fecha. Desde ese
// momento esa fecha es INMUTABLE, y con ella sabemos que alguien ha aparecido
// en BOLT sin esperar a que nos avisen — la señal del puente Selección → RRHH.
//
// ── LO QUE CAMBIA (15/09/2026): SE DEJA DE ESCRIBIR LA HOJA ─────────────────
// Esto mantenía una hoja `CONDUCTORES_BOLT` con su propio cron cada media hora.
// Y resulta que **la ingesta ya hacía exactamente lo mismo contra PostgreSQL**:
// la tarea `padron_bolt` llama cada hora a `cazamiento.sincronizarDesdeBolt()`,
// que pide el padrón al MISMO `traerDrivers()` y lo guarda en
// `conductor_externo`, sellando `visto_desde` la primera vez y sin volver a
// tocarlo nunca.
//
// Eran dos trabajos haciendo el mismo trabajo sobre la misma fuente, y por
// tanto dos sitios donde podía decirse una cosa distinta del mismo conductor.
// Se queda el de PostgreSQL, que es el que mira todo el ERP.
//
// La equivalencia, columna a columna:
//
//     hoja CONDUCTORES_BOLT          conductor_externo (sistema = 'bolt')
//     ─────────────────────          ────────────────────────────────────
//     driver_uuid                    externo_id
//     nombre / email / phone         externo_nombre / _email / _telefono
//     state                          estado_externo
//     created_at   (inmutable)       visto_desde  (default now(), el UPSERT no la toca)
//     updated_at                     visto_at
//
// No sobreviven `partner_uuid`, `flota` ni `veces_visto`: no los leía nadie.
//
// ── EL RESCATE DE LAS FECHAS, UNA SOLA VEZ ──────────────────────────────────
// La hoja lleva más tiempo funcionando que la base: en PostgreSQL casi todos
// tienen `visto_desde` del día de la migración (21/08/2026), no del día en que
// aparecieron de verdad. Eso es lo ÚNICO que la hoja tiene y la base no, y una
// vez perdido no se puede recuperar de ninguna API.
//
// Así que la primera lectura se trae de la hoja los `created_at` ANTERIORES a
// lo que diga la base y los guarda. Se apunta en `config_app` que ya se hizo,
// para que no se repita. Como con la configuración, se hace solo: los valores
// únicamente se pueden leer desde donde hay credenciales de Google —el
// servidor—, y pedir que alguien lance una migración a mano es pedir que se
// acuerde.

const db = require('./db');
const { traerDrivers } = require('./bolt');

// La hoja de la que se rescatan las fechas. Se conserva solo para eso.
const ID_PLANIFICADOR = '1Fe2LHbzf4_OyJkk3W08yJcm_1xJrZXG6U_z6-sIF35o';
const HOJA = 'CONDUCTORES_BOLT';
const CLAVE_RESCATE = 'padron_bolt_fechas_rescatadas';

// El padrón se pide al ADAPTADOR de BOLT, que es donde vive "cómo se le
// pregunta a BOLT". Se reexporta con el nombre de siempre para no romper a
// quien ya la llamaba.
const traerDriversBolt = () => traerDrivers();

/** Fecha de PostgreSQL → 'dd/mm/aaaa HH:mm:ss', que es como la daba la hoja. */
function fechaTxt(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const g = t => (p.find(x => x.type === t) || {}).value || '';
  return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

/** 'dd/mm/aaaa HH:mm:ss' de la hoja → Date, o null si no se entiende. */
function deLaHoja(txt) {
  const m = String(txt || '').trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  // Se construye en UTC a mediodía cuando no hay hora, para que ningún cambio de
  // huso lo mueva al día anterior. Con hora, se toma tal cual: una diferencia de
  // una o dos horas no cambia nada aquí, y lo que se compara son días.
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 12, +(m[5] || 0), +(m[6] || 0)));
  return isNaN(d) ? null : d;
}

/**
 * EL RESCATE, una sola vez: los `created_at` de la hoja que sean ANTERIORES a
 * lo que tiene la base pasan a `visto_desde`.
 *
 * Nunca hacia adelante: si la base dice una fecha más temprana que la hoja, la
 * de la base es la buena y se queda. Solo se corrige hacia atrás, que es la
 * dirección en la que la hoja sabe más.
 *
 * Si la hoja no se puede leer —lo normal fuera del servidor— no pasa nada y NO
 * se marca como hecho: se reintentará en la siguiente lectura.
 */
async function rescatarFechas() {
  const ya = await db.consulta('SELECT 1 FROM config_app WHERE clave = $1', [CLAVE_RESCATE]);
  if (ya.rows.length) return null;

  let filas;
  try {
    const { readSheet } = require('./sheets');
    filas = await readSheet(ID_PLANIFICADOR, `${HOJA}!A:K`);
  } catch (e) {
    console.error('⚠️  [PADRÓN] no se pudo mirar la hoja para rescatar las fechas:', e.message);
    return null;
  }

  const uuids = [], fechas = [];
  for (let i = 1; i < (filas || []).length; i++) {       // fila 0 = cabecera
    const uuid = (filas[i][0] || '').toString().trim();
    const f = deLaHoja(filas[i][7]);                      // col H = created_at
    if (uuid && f) { uuids.push(uuid); fechas.push(f.toISOString()); }
  }

  let corregidas = 0;
  if (uuids.length) {
    const r = await db.consulta(
      `UPDATE conductor_externo e
          SET visto_desde = x.creado
         FROM unnest($1::text[], $2::timestamptz[]) AS x(uuid, creado)
        WHERE e.sistema = 'bolt' AND e.externo_id = x.uuid
          AND x.creado < e.visto_desde
        RETURNING e.id`, [uuids, fechas]);
    corregidas = r.rowCount;
  }

  await db.consulta(
    `INSERT INTO config_app (clave, valor) VALUES ($1, $2)
     ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_at = now()`,
    [CLAVE_RESCATE, `${corregidas} de ${uuids.length} el ${new Date().toISOString().slice(0, 10)}`]);

  console.log(`⚙️  [PADRÓN] Rescatadas ${corregidas} fecha(s) de alta en BOLT de la hoja ` +
    `(${uuids.length} leídas). La hoja CONDUCTORES_BOLT ya no se vuelve a mirar.`);
  return corregidas;
}

/**
 * El padrón entero: { db: Map(driver_uuid → registro) }.
 *
 * El `filas` de antes —cuántas líneas físicas tenía la hoja— desaparece: solo
 * servía para saber cuántas había que sobrescribir al reescribirla.
 */
async function leerPadron() {
  await rescatarFechas().catch(e => console.error('⚠️  [PADRÓN] rescate:', e.message));

  const r = await db.consulta(
    `SELECT externo_id, externo_nombre, externo_email, externo_telefono,
            estado_externo, visto_desde, visto_at
       FROM conductor_externo
      WHERE sistema = 'bolt'
      ORDER BY lower(COALESCE(externo_nombre, ''))`);

  const mapa = new Map();
  for (const f of r.rows) {
    mapa.set(f.externo_id, {
      driver_uuid: f.externo_id,
      nombre: f.externo_nombre || '',
      email: f.externo_email || '',
      phone: f.externo_telefono || '',
      state: f.estado_externo || '',
      created_at: fechaTxt(f.visto_desde),
      updated_at: fechaTxt(f.visto_at),
    });
  }
  return { db: mapa };
}

/**
 * Un conductor por teléfono (últimos 9 dígitos). null si no está.
 *
 * Antes esto se leía el padrón ENTERO de la hoja y lo recorría buscando. Ahora
 * es una consulta sobre `externo_sufijo9`, que es una columna generada —los 9
 * últimos dígitos, sin signos— y tiene índice.
 */
async function buscarPorTelefono(tel) {
  const t = String(tel == null ? '' : tel).replace(/\D/g, '').slice(-9);
  if (t.length !== 9) return null;

  const r = await db.consulta(
    `SELECT externo_id, externo_nombre, estado_externo, externo_telefono
       FROM conductor_externo
      WHERE sistema = 'bolt' AND externo_sufijo9 = $1
      ORDER BY (estado_externo = 'active') DESC, visto_at DESC
      LIMIT 1`, [t]);
  if (!r.rows.length) return null;

  const d = r.rows[0];
  return {
    driver_uuid: d.externo_id,
    nombre: d.externo_nombre || '',
    estado: d.estado_externo || '',
    phone: d.externo_telefono || '',
  };
}

module.exports = { leerPadron, buscarPorTelefono, traerDriversBolt };
