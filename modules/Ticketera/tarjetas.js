// ============================================================
// LAS TARJETAS DE LOS TICKETS — la ticketera en el tablero (ítem 1, 1a)
// ============================================================
// «Cada ticket nuevo crea su tarjeta» (Camilo, 16/11/2026), y la ticketera y el
// tablero se enganchan en los dos sentidos:
//
//   · NACE: un ticket abierto que entra (formulario o soporte) crea su tarjeta
//     «por asignar». Solo los que entran desde que existe el tablero (db/251
//     guarda desde qué id); los que ya estaban abiertos pasan en la entrega 1c.
//   · SE ASIGNA: Ignacio le pone responsable y plazo en el tablero, y el ticket
//     queda a cargo de esa persona. Si alguien se hace cargo del ticket en su
//     bandeja, la tarjeta pasa a esa persona (sin plazo: lo pone Ignacio).
//   · SE CIERRA: cerrar la tarjeta cierra el ticket (con sus reglas: en qué
//     quedó, la llave de vacaciones, «aplicar» en las ausencias), y cerrar el
//     ticket en su bandeja cierra la tarjeta.
//
// LAS BAJAS MÉDICAS no salen en el tablero del equipo: su tarjeta solo dice el
// tipo y el código, y lo demás se mira en el ticket, con sus permisos.
'use strict';

const db = require('../../services/db');
const libro = require('../../services/libro');
const tablero = require('../../services/tablero');

// Dónde se abre cada ticket (las bandejas de ticketera.controller, y la de IT).
const BANDEJA = {
  RRHH: '/ticketera', ADMIN: '/administracion/tickets', TRAFICO: '/planificador/tickets',
  TALLER: '/taller/tickets', OPERACIONES: '/operaciones/sin-traza', IT: '/tickets-telecab',
};
// Los tipos de ticket con datos de salud: su tarjeta no lleva nombre.
const SENSIBLES = new Set(['BAJA_AUSENCIA']);

const ticketera = () => require('./ticketera.service');

async function nombreDe(usuarioId) {
  if (!usuarioId) return '';
  const r = await db.consulta(`SELECT btrim(concat_ws(' ', nombre, apellidos)) AS n FROM usuario WHERE id = $1`, [usuarioId]);
  return (r.rows[0] && r.rows[0].n) || '';
}

tablero.registrarTipo('ticket', {
  etiqueta: 'Ticket',
  // Cerrarla en el tablero es cerrar el ticket. Él la cierra a ella (alCambiar).
  async alCerrar(t, { quien, nota, estadoOrigen }) {
    await ticketera().cambiarEstado(Number(t.origen_id), { estado: estadoOrigen || 'ejecutado', resolucion: nota },
      { usuarioId: quien.id, nombre: await nombreDe(quien.id) });
  },
  async alAsignar(t, { responsable, quien }) {
    await ticketera().asignarA(Number(t.origen_id), { responsableId: responsable.id, nombre: responsable.nombre },
      { usuarioId: quien.id, nombre: await nombreDe(quien.id) });
  },
});

const titulo = x => (SENSIBLES.has(x.subtipo_codigo)
  ? `${x.subtipo} · ${x.codigo}`
  : `${x.subtipo}${x.nombre ? ' · ' + x.nombre : ''} · ${x.codigo}`);

/**
 * Los tickets abiertos que entraron desde que existe el tablero y aún no
 * tienen tarjeta: se la crea. Se llama tras traer el formulario y tras abrir
 * un ticket de soporte. → cuántas creó
 */
async function deNuevos() {
  const desde = await db.consulta(`SELECT valor FROM config_app WHERE clave = 'tablero.tickets_desde_id'`);
  if (!desde.rows[0]) return 0;
  const r = await db.consulta(
    `SELECT t.id, t.codigo, t.area_codigo, t.subtipo_codigo, s.etiqueta AS subtipo, t.nombre
       FROM ticket t
       JOIN cat_ticket_subtipo s ON s.codigo = t.subtipo_codigo
       JOIN cat_ticket_estado e ON e.codigo = t.estado
      WHERE t.id > $1 AND NOT e.cierra
        AND NOT EXISTS (SELECT 1 FROM tarea x WHERE x.tipo = 'ticket' AND x.origen_id = t.id::text AND x.estado <> 'anulada')
      ORDER BY t.id LIMIT 500`, [Number(desde.rows[0].valor) || 0]);
  let nuevas = 0;
  for (const x of r.rows) {
    const hecho = await libro.conFirma({ origen: 'tablero', accion: 'alta' }, cli => tablero.nacer(cli, {
      tipo: 'ticket', origenId: x.id, titulo: titulo(x), sensible: SENSIBLES.has(x.subtipo_codigo),
      enlace: `${BANDEJA[x.area_codigo] || '/ticketera'}?ticket=${encodeURIComponent(x.codigo)}`,
    }));
    if (hecho.nueva) { nuevas++; await tablero.avisar(hecho.id); }
  }
  return nuevas;
}

/** El ticket cambió de estado en su bandeja (o desde el tablero): si se cerró, su tarjeta también. */
async function alCambiar(ticketId, usuarioId) {
  const r = await db.consulta(
    `SELECT t.estado, t.resolucion, e.etiqueta, e.cierra FROM ticket t JOIN cat_ticket_estado e ON e.codigo = t.estado
      WHERE t.id = $1`, [ticketId]);
  const x = r.rows[0];
  if (!x || !x.cierra) return null;
  const id = await libro.conFirma({ usuarioId, origen: 'tablero', accion: 'cierre' }, cli => tablero.cerrarPorOrigen(cli, {
    tipo: 'ticket', origenId: ticketId, autorId: usuarioId || null,
    nota: `Ticket ${String(x.etiqueta).toLowerCase()}${x.resolucion ? ': ' + x.resolucion : ''}`,
  }));
  if (id) await tablero.avisar(id);
  return id;
}

/** Alguien se hizo cargo del ticket en su bandeja: la tarjeta, si estaba por asignar, pasa a esa persona. */
async function alAsignar(ticketId, usuarioId) {
  const r = await db.consulta('SELECT responsable_id FROM ticket WHERE id = $1', [ticketId]);
  const resp = r.rows[0] && r.rows[0].responsable_id;
  if (!resp) return null;
  const id = await libro.conFirma({ usuarioId, origen: 'tablero', accion: 'asignacion' }, cli => tablero.asignarPorOrigen(cli, {
    tipo: 'ticket', origenId: ticketId, responsableId: resp, autorId: usuarioId || null,
  }));
  if (id) await tablero.avisar(id);
  return id;
}

/** Cada hook, sin romper lo que lo provocó: el ticket ya está hecho. */
const seguro = (fn, que) => async (...args) => {
  try { return await fn(...args); } catch (e) { console.error(`❌ [Tablero] ${que}:`, e.message); return null; }
};

module.exports = {
  deNuevos: seguro(deNuevos, 'tarjetas de los tickets nuevos'),
  alCambiar: seguro(alCambiar, 'cerrar la tarjeta de un ticket'),
  alAsignar: seguro(alAsignar, 'asignar la tarjeta de un ticket'),
  BANDEJA, SENSIBLES,
};
