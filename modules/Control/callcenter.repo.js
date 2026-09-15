// ============================================================
// CALL CENTER — SQL
// ============================================================
// Guardar una llamada y cerrarla. La clasificación se valida ANTES, en el
// servicio: aquí ya llega buena.

const db = require('../../services/db');

// El resto del módulo (los KPIs, la pantalla) trabaja con `ts` en segundos
// desde 1970, que es lo que había en la hoja. Se sigue exponiendo así para no
// tocar una función pura que ya está probada: la columna es TIMESTAMPTZ, que es
// lo correcto, y la conversión se hace aquí, en un sitio.
const CAMPOS = `
  clave,
  EXTRACT(EPOCH FROM creado_at)::bigint  AS ts,
  EXTRACT(EPOCH FROM resuelto_at)::bigint AS ts_resuelta,
  agente, direccion, conductor_id, conductor, telefono, matricula, turno,
  cluster, subcluster, motivo, resultado, accion, notas,
  estado, resuelta_por, resolucion`;

const aLlamada = x => ({
  clave: x.clave, ts: Number(x.ts) || 0,
  agente: x.agente || '', direccion: x.direccion || '',
  conductorId: x.conductor_id ? String(x.conductor_id) : null,
  conductor: x.conductor || '', telefono: x.telefono || '',
  matricula: x.matricula || '', turno: x.turno || '',
  cluster: x.cluster || '', subcluster: x.subcluster || '',
  motivo: x.motivo || '', resultado: x.resultado || '',
  accion: x.accion || '', notas: x.notas || '',
  estado: x.estado || '', tsResuelta: Number(x.ts_resuelta) || 0,
  resueltaPor: x.resuelta_por || '', resolucion: x.resolucion || '',
});

/** Todas, de la más nueva a la más vieja. */
async function listar({ limite = 5000 } = {}) {
  const r = await db.consulta(
    `SELECT ${CAMPOS} FROM llamada_cc ORDER BY creado_at DESC LIMIT $1`, [limite]);
  return r.rows.map(aLlamada);
}

/** Guarda una llamada nueva. */
async function guardar(ll) {
  const r = await db.consulta(
    `INSERT INTO llamada_cc
       (clave, creado_at, agente, agente_id, direccion, conductor_id, conductor, telefono,
        matricula, turno, cluster, subcluster, motivo, resultado, accion, notas,
        estado, resuelto_at, resuelta_por, resolucion)
     VALUES ($1, to_timestamp($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, CASE WHEN $18::bigint > 0 THEN to_timestamp($18::bigint) END, $19, $20)
     RETURNING ${CAMPOS}`,
    [ll.clave, ll.ts, ll.agente || '', ll.agenteId || null, ll.direccion,
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

module.exports = { listar, una, guardar, cerrar, existe };
