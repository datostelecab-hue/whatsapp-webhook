// ============================================================
// HISTÓRICO DE CONTROL — repositorio
// ============================================================
// El SQL del parte, y nada más. Lo que se hace con estas filas —cruzarlas con
// el cockpit, con las J y con las alertas de franja— vive en `historico.service`.

const db = require('../../services/db');

/** Todas las llamadas de una jornada, con lo que se contestó de cada alerta. */
async function llamadasDelDia(dia) {
  const r = await db.consulta(
    `SELECT l.id, l.conductor_id, l.tipo, l.resultado, l.nota, l.origen, l.turno,
            l.creado_at,
            to_char(l.creado_at AT TIME ZONE 'Europe/Madrid', 'HH24:MI') AS hora,
            COALESCE(u.nombre, '(sin usuario)') AS agente,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'alerta', a.alerta, 'etiqueta', a.etiqueta, 'comentario', a.comentario)
                      ORDER BY a.id)
                 FROM llamada_alerta a WHERE a.llamada_id = l.id), '[]'::json) AS alertas
       FROM llamada_seguimiento l
       LEFT JOIN usuario u ON u.id = l.usuario_id
      WHERE l.dia_operativo = $1::date
      ORDER BY l.creado_at`, [dia]);
  return r.rows.map(x => ({
    id: String(x.id), conductorId: String(x.conductor_id), hora: x.hora, at: x.creado_at,
    agente: x.agente, tipo: x.tipo || '', resultado: x.resultado || '',
    nota: x.nota || '', origen: x.origen || '', turno: x.turno || '',
    alertas: x.alertas || [],
  }));
}

module.exports = { llamadasDelDia };
