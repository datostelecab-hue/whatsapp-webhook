// ============================================================
// AUDITORÍA DE LAS J Y LAS −J — quién, desde dónde y qué (db/228)
// ============================================================
// Camilo, 30/10/2026: «las −J y J tienen que ser bien auditadas en todo el
// flujo, asegura eso».
//
// El libro (`justificante_auditoria`) lo escribe la BASE con un disparador en
// `justificante` y en `menos_j`: cada alta, cambio o borrado deja su fila, con
// la fila de antes y la de después. Aquí solo se le dice, dentro de la MISMA
// transacción que escribe, quién lo hace y desde qué pantalla (`firmar`). Si un
// camino se olvida de firmar, el cambio se apunta igual —sin usuario, o con el
// de la columna que lo firme—: lo que no puede es no quedar.
//
// Por eso todo lo que escribe una J o una −J va en `db.transaccion` y llama
// primero a `firmar(cli, …)`: `set_config(…, true)` solo vale dentro de la
// transacción, y una consulta suelta del pool iría por otra conexión.

const db = require('../db');

const ACCIONES = {
  poner: 'Puesta', editar: 'Editada', aprobar: 'Aprobada', rechazar: 'Rechazada', anular: 'Anulada',
  cerrar: 'Cerrada', reabrir: 'Reabierta', borrar: 'Borrada', cambio: 'Cambiada',
};

/**
 * Firma lo que se va a escribir en esta transacción.
 *   usuarioId  quién (de la sesión)
 *   origen     la pantalla: 'bitacora', 'control', 'justificantes'…
 *   accion     opcional: si no, la deduce la base del cambio
 */
async function firmar(cli, { usuarioId, origen, accion } = {}) {
  const n = Number(usuarioId);
  await cli.query(
    `SELECT set_config('telecab.usuario_id', $1, true),
            set_config('telecab.origen', $2, true),
            set_config('telecab.accion', $3, true)`,
    [Number.isInteger(n) && n > 0 ? String(n) : '', String(origen || '').slice(0, 40), accion && ACCIONES[accion] ? accion : '']);
}

// Lo que se enseña de cada cambio: los campos que importan, con su nombre.
const CAMPOS = {
  horas_seg_momento: 'Horas', minutos: 'Tiempo', observacion: 'Motivo', motivo: 'Motivo', tipo: 'Área',
  casuistica: 'Casuística', companero_id: 'Compañero', aprobado_at: 'Aprobada', anulado_motivo: 'Motivo del rechazo',
  cerrada_nota: 'Nota del cierre', dia_operativo: 'Día',
};

/**
 * El historial de UNA J o UNA −J, del más viejo al más nuevo:
 * [{ accion, etiqueta, quien, origen, en, cambios: [{ campo, antes, despues }] }].
 */
async function historial(entidad, id) {
  if (!['j', 'menos_j'].includes(entidad)) throw new Error('No sé de qué es ese historial');
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Falta cuál');
  const r = await db.consulta(
    `SELECT a.accion, a.origen, a.cambios, a.despues,
            to_char(a.en AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') AS en,
            COALESCE(u.nombre, '') AS quien, a.bd_usuario
       FROM justificante_auditoria a
       LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE a.entidad = $1 AND a.registro_id = $2
      ORDER BY a.en, a.id`, [entidad, n]);
  return r.rows.map(x => ({
    accion: x.accion, etiqueta: ACCIONES[x.accion] || x.accion,
    quien: x.quien, origen: x.origen || '', en: x.en,
    cambios: Object.entries(x.cambios || {})
      .filter(([k]) => CAMPOS[k])
      .map(([k, [antes, despues]]) => ({ campo: CAMPOS[k], antes, despues, clave: k })),
    // Lo reconstruido de antes del libro trae una nota.
    nota: (x.despues && x.despues.nota) || '',
  }));
}

module.exports = { firmar, historial, ACCIONES };
