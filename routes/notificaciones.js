const express = require('express');
const router = express.Router();
const { leerTickets, ESTADOS } = require('../services/tickets');
const { leerTablero, ESTADO_PENDIENTE } = require('../services/planificadorV2');

// El tablero es caro de recalcular, así que se cachea un minuto: aunque cada
// página pida las notificaciones al cargar, solo se recalcula una vez por minuto.
let cache = null, cacheTs = 0;
const TTL = 60 * 1000;

async function calcular() {
  const [{ lista }, tablero] = await Promise.all([leerTickets(), leerTablero().catch(() => null)]);
  const L = lista || [];

  const rechazadosRRHH = L.filter(t => t.estado === ESTADOS.RECHAZADO_RRHH);
  const porTramitar = L.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
  const pendienteAsignar = ((tablero && tablero.conductores) || [])
    .filter(c => c.estadoCalculado === ESTADO_PENDIENTE);

  return {
    // Reclutador (Selección): fichas que RRHH devolvió, para revisar. El enlace
    // abre directamente esa ficha en Selección.
    reclutador: {
      total: rechazadosRRHH.length,
      items: rechazadosRRHH.map(t => ({
        texto: `${t.nombre || t.id} — devuelto por RRHH`,
        detalle: t.motivo || '', href: `/seleccion?tel=${encodeURIComponent(t.id)}`
      }))
    },
    // RRHH: aprobados en BOLT esperando el alta. El enlace abre esa ficha en RRHH.
    rrhh: {
      total: porTramitar.length,
      items: porTramitar.map(t => ({
        texto: `${t.nombre || t.id} — aprobado en BOLT, pendiente de alta`,
        detalle: '', href: `/rrhh?tel=${encodeURIComponent(t.id)}`
      }))
    },
    // Tráfico: conductores dados de alta que esperan coche/turno.
    trafico: {
      total: pendienteAsignar.length,
      items: pendienteAsignar.map(c => ({
        texto: `${c.nombre || c.id} — pendiente de asignar coche/turno`,
        detalle: c.turno ? `Turno: ${c.turno}` : '', href: '/planificador'
      }))
    }
  };
}

router.get('/', async (req, res) => {
  try {
    if (!cache || Date.now() - cacheTs > TTL) { cache = await calcular(); cacheTs = Date.now(); }
    res.json({ status: 'ok', ...cache });
  } catch (error) {
    console.error('❌ [Notificaciones]:', error.message);
    res.status(500).json({ status: 'error', msg: error.message });
  }
});

module.exports = router;
