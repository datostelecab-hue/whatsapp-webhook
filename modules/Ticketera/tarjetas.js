// ============================================================
// LAS TARJETAS DE LOS TICKETS — la ticketera en el tablero (ítem 1, 1a y 1c)
// ============================================================
// «Cada ticket nuevo crea su tarjeta» (Camilo, 16/11/2026), y la ticketera y el
// tablero se enganchan en los dos sentidos:
//
//   · NACE: un ticket abierto pedido desde el corte de las bandejas (lo que
//     ellas enseñan como pendiente: `ticketera_desde`, 24/09/2026) crea su
//     tarjeta «por asignar». Los de antes del corte no (Camilo, 16/11/2026: los
//     578 viejos se quedan en la ticketera). Las VACACIONES nacen ya asignadas
//     a quien tiene la llave de aprobarlas, con el plazo de las colas.
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
const colas = require('../../services/tableroColas');
const parametros = require('../../services/parametros');
const aprobarVacaciones = require('../../services/aprobarVacaciones');

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
  abrir: 'Abrir el ticket',
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
 * Los tickets abiertos pedidos desde el corte de las bandejas que aún no
 * tienen tarjeta: se la crea (o se reabre la cerrada, si el ticket se
 * reabrió; una anulada no vuelve). Se llama tras traer el formulario, tras abrir
 * un ticket de soporte y en el repaso diario de las colas. → cuántas creó
 */
async function deNuevos() {
  const desde = await ticketera().desdeCuando();
  const r = await db.consulta(
    `SELECT t.id, t.codigo, t.area_codigo, t.subtipo_codigo, s.etiqueta AS subtipo, t.nombre
       FROM ticket t
       JOIN cat_ticket_subtipo s ON s.codigo = t.subtipo_codigo
       JOIN cat_ticket_estado e ON e.codigo = t.estado
      WHERE NOT e.cierra
        AND COALESCE(t.marca_form, t.creado_at) >= ($1::date::timestamp AT TIME ZONE 'Europe/Madrid')
        AND NOT EXISTS (SELECT 1 FROM tarea x WHERE x.tipo = 'ticket' AND x.origen_id = t.id::text AND x.estado <> 'cerrada')
      ORDER BY t.id LIMIT 500`, [desde]);
  if (!r.rows.length) return 0;
  // Las vacaciones, directas a quien las aprueba (Camilo, 16/11/2026).
  const hayVacaciones = r.rows.some(x => x.subtipo_codigo === aprobarVacaciones.SUBTIPO);
  const vacaciones = hayVacaciones ? await aprobarVacaciones.quienId() : null;
  const plazoDias = hayVacaciones ? await parametros.valor(colas.PLAZO).catch(() => 2) : null;
  let nuevas = 0;
  for (const x of r.rows) {
    const esVacaciones = x.subtipo_codigo === aprobarVacaciones.SUBTIPO && vacaciones;
    const hecho = await libro.conFirma({ origen: 'tablero', accion: 'alta' }, cli => tablero.nacer(cli, {
      tipo: 'ticket', origenId: x.id, titulo: titulo(x), sensible: SENSIBLES.has(x.subtipo_codigo),
      enlace: `${BANDEJA[x.area_codigo] || '/ticketera'}?ticket=${encodeURIComponent(x.codigo)}`,
      responsableId: esVacaciones ? vacaciones : null, plazoDias: esVacaciones ? plazoDias : null,
    }));
    if (hecho.nueva || hecho.reabierta) { nuevas++; await tablero.avisar(hecho.id); }
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

/**
 * El repaso diario (services/tableroColas.js): las que falten y las de los
 * tickets que se cerraron sin que el tablero se enterara (por otro camino).
 */
async function sincronizar() {
  const nacen = await deNuevos();
  const r = await db.consulta(
    `SELECT x.origen_id FROM tarea x
       JOIN ticket t ON t.id::text = x.origen_id
       JOIN cat_ticket_estado e ON e.codigo = t.estado
      WHERE x.tipo = 'ticket' AND x.estado NOT IN ('cerrada', 'rechazada', 'anulada') AND e.cierra`);
  let cierran = 0;
  for (const x of r.rows) if (await alCambiar(Number(x.origen_id), null)) cierran++;
  return { nacen, cierran };
}
colas.registrar('ticket', { sincronizar });

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
