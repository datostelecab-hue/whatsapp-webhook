// ============================================================
// CALL CENTER — SQL
// ============================================================
// Guardar una llamada y cerrarla. La clasificación se valida ANTES, en el
// servicio: aquí ya llega buena.
//
// Aquí solo viven las llamadas TECLEADAS en el Call Center (y las que crea
// Flota Viva al justificar). Las del telefonito de Control viven en
// `llamada_seguimiento` y las lee `services/repo/llamadas.paraCallCenter`: el
// servicio junta las dos. Ver la nota de db/131.

const db = require('../../services/db');

// El resto del módulo (los KPIs, la pantalla) trabaja con `ts` en segundos
// desde 1970, que es lo que había en la hoja. Se sigue exponiendo así para no
// tocar una función pura que ya está probada: la columna es TIMESTAMPTZ, que es
// lo correcto, y la conversión se hace aquí, en un sitio.
const CAMPOS = `
  clave,
  EXTRACT(EPOCH FROM creado_at)::bigint  AS ts,
  EXTRACT(EPOCH FROM resuelto_at)::bigint AS ts_resuelta,
  agente, direccion, origen, conductor_id, conductor, telefono, matricula, turno,
  cluster, subcluster, motivo, resultado, accion, notas,
  estado, resuelta_por, resolucion`;

const aLlamada = x => ({
  clave: x.clave, ts: Number(x.ts) || 0,
  agente: x.agente || '', direccion: x.direccion || '',
  origen: x.origen || 'callcenter',
  conductorId: x.conductor_id ? String(x.conductor_id) : null,
  conductor: x.conductor || '', telefono: x.telefono || '',
  matricula: x.matricula || '', turno: x.turno || '',
  cluster: x.cluster || '', subcluster: x.subcluster || '',
  motivo: x.motivo || '', resultado: x.resultado || '',
  accion: x.accion || '', notas: x.notas || '',
  estado: x.estado || '', tsResuelta: Number(x.ts_resuelta) || 0,
  resueltaPor: x.resuelta_por || '', resolucion: x.resolucion || '',
});

/**
 * Las de una ventana, de la más nueva a la más vieja.
 *
 * `desde`/`hasta` son epoch en SEGUNDOS, no fechas. Es a propósito: comparar
 * una `date` con una `timestamptz` obliga a una conversión de zona horaria que
 * se hace al revés de lo que uno espera, y así la ventana la decide quien sabe
 * qué día pidió el usuario, una sola vez y arriba.
 */
async function listar({ desde = 0, hasta = 0, limite = 20000 } = {}) {
  const h = hasta || Math.floor(Date.now() / 1000) + 86400;
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM llamada_cc
      WHERE creado_at >= to_timestamp($1) AND creado_at < to_timestamp($2)
      ORDER BY creado_at DESC LIMIT $3`, [desde || 0, h, limite]);
  return r.rows.map(aLlamada);
}

/**
 * Las que siguen abiertas, de cualquier fecha y de la más vieja a la más nueva.
 * Van aparte del periodo a propósito: una llamada sin resolver de hace tres
 * días sigue sin resolver hoy.
 */
async function pendientes() {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM llamada_cc WHERE estado = 'pendiente' ORDER BY creado_at`);
  return r.rows.map(aLlamada);
}

/** Todas las de una persona, la última primero. Para su historia. */
async function deConductor(conductorId) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM llamada_cc WHERE conductor_id = $1 ORDER BY creado_at DESC LIMIT 2000`,
    [Number(conductorId)]);
  return r.rows.map(aLlamada);
}

/** Guarda una llamada nueva. */
async function guardar(ll) {
  const r = await db.consulta(
    `INSERT INTO llamada_cc
       (clave, creado_at, agente, agente_id, direccion, origen, conductor_id, conductor, telefono,
        matricula, turno, cluster, subcluster, motivo, resultado, accion, notas,
        estado, resuelto_at, resuelta_por, resolucion)
     VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16, $17, $18, CASE WHEN $19::bigint > 0 THEN to_timestamp($19::bigint) END, $20, $21)
     RETURNING ${CAMPOS}`,
    [ll.clave, ll.ts, ll.agente || '', ll.agenteId || null, ll.direccion, ll.origen || 'callcenter',
     ll.conductorId || null, ll.conductor, ll.telefono || '', ll.matricula || '', ll.turno || '',
     ll.cluster, ll.subcluster, ll.motivo, ll.resultado, ll.accion || '', ll.notas || '',
     ll.estado, ll.tsResuelta || 0, ll.resueltaPor || '', ll.resolucion || '']);
  return aLlamada(r.rows[0]);
}

/**
 * Cierra una llamada PENDIENTE. Devuelve null si ya no lo estaba.
 *
 * El `WHERE estado = 'pendiente'` es lo que impide que dos personas la cierren
 * a la vez. En la hoja esto era leer la fila, mirarla, y escribirla: entre lo
 * primero y lo último cabía la otra persona entera, y no había forma de
 * evitarlo.
 */
async function cerrar(clave, { resolucion, resultado, agente, agenteId, ts }) {
  const r = await db.consulta(
    `UPDATE llamada_cc
        SET estado = 'resuelta',
            resuelto_at = to_timestamp($2),
            resuelta_por = $3, agente_id = COALESCE(agente_id, $4),
            resolucion = $5,
            resultado = COALESCE($6, resultado)
      WHERE clave = $1 AND estado = 'pendiente'
      RETURNING ${CAMPOS}`,
    [clave, ts, agente || '', agenteId || null, resolucion, resultado || null]);
  return r.rows.length ? aLlamada(r.rows[0]) : null;
}

/** Una llamada por su clave. */
async function una(clave) {
  const r = await db.consulta(`SELECT ${CAMPOS} FROM llamada_cc WHERE clave = $1`, [clave]);
  return r.rows.length ? aLlamada(r.rows[0]) : null;
}

/** ¿Existe esa llamada? Sirve para distinguir "no está" de "ya estaba resuelta". */
async function existe(clave) {
  const r = await db.consulta('SELECT estado FROM llamada_cc WHERE clave = $1', [clave]);
  return r.rows.length ? r.rows[0].estado : null;
}

module.exports = { listar, pendientes, deConductor, una, guardar, cerrar, existe };
