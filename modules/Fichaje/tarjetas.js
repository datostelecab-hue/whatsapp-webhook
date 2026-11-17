// ============================================================
// LAS CORRECCIONES DE FICHAJE EN EL TABLERO (ítem 1, entrega 1c)
// ============================================================
// Cada corrección pedida (db/159) tiene su tarjeta a nombre de quien tiene la
// llave del registro de jornada ('/fichaje/revisar': la tiene una persona), con
// el plazo de las colas. La pidió quien la pidió: la ve en su tablero. Aprobarla,
// rechazarla o retirarla la cierra.
//
// El repaso lo hace services/tableroColas.js; fichaje.service lo pide tras
// pedir, retirar o resolver una corrección.
'use strict';

const db = require('../../services/db');
const colas = require('../../services/tableroColas');
const repo = require('./fichaje.repo');

const NOTA = { aprobada: 'Corrección aprobada', rechazada: 'Corrección rechazada', retirada: 'La retiró quien la pidió' };

colas.registrar('correccion_fichaje', {
  etiqueta: 'Corrección de fichaje',
  abrir: 'Abrir el registro de jornada',
  async abiertas() {
    const r = await db.consulta(
      `SELECT c.id::text AS id, c.usuario_id, to_char(c.dia, 'DD/MM') AS dia,
              NULLIF(btrim(concat_ws(' ', u.nombre, u.apellidos)), '') AS quien
         FROM fichaje_correccion c JOIN usuario u ON u.id = c.usuario_id
        WHERE c.estado = 'pendiente'
        ORDER BY c.id LIMIT 1000`);
    return r.rows.map(x => ({
      origenId: x.id, creadaPor: Number(x.usuario_id),
      titulo: `Corrección de fichaje · ${x.quien || 'Sin nombre'} · ${x.dia}`,
      enlace: '/fichaje',
    }));
  },
  responsable: async () => ((await repo.quienAprueba()) || {}).id || null,
  async comoAcabaron(ids) {
    const r = await db.consulta(
      `SELECT id::text AS id, estado, resuelta_por, respuesta FROM fichaje_correccion WHERE id = ANY($1::bigint[])`,
      [ids.map(Number)]);
    return new Map(r.rows.map(x => [x.id, {
      autorId: x.resuelta_por ? Number(x.resuelta_por) : null,
      nota: `${NOTA[x.estado] || 'Ya no está pendiente'}${x.estado === 'rechazada' && x.respuesta ? ': ' + x.respuesta : ''}`,
    }]));
  },
});

/** Lo llama fichaje.service tras pedir, retirar o resolver. Nunca lanza. */
const pedir = () => colas.pedir('correccion_fichaje');

module.exports = { pedir };
