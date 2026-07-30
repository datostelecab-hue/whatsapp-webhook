const express = require('express');
const router = express.Router();
const { leerTickets, ESTADOS } = require('../services/tickets');
const { leerTablero, ESTADO_PENDIENTE } = require('../services/planificadorV2');
const { leerVacantesGuardadas } = require('../services/vacantes');
const { leerPeticiones } = require('../services/peticiones');

// El tablero es caro de recalcular, así que se cachea un minuto: aunque cada
// página pida las notificaciones al cargar, solo se recalcula una vez por minuto.
let cache = null, cacheTs = 0;
const TTL = 60 * 1000;

async function calcular() {
  const [{ lista }, tablero, vacantesAll, peticiones] = await Promise.all([
    leerTickets(),
    leerTablero().catch(() => null),
    leerVacantesGuardadas().catch(() => []),
    leerPeticiones().then(r => r.lista).catch(() => [])
  ]);
  const L = lista || [];

  const rechazadosRRHH = L.filter(t => t.estado === ESTADOS.RECHAZADO_RRHH);
  const porTramitar = L.filter(t => t.estado === ESTADOS.APROBADO_BOLT);
  const pendientesPin = L.filter(t => t.estado === ESTADOS.PENDIENTE_PIN);
  const petPendientes = (peticiones || []).filter(p => p.estado === 'Pendiente');
  const pendienteAsignar = ((tablero && tablero.conductores) || [])
    .filter(c => c.estadoCalculado === ESTADO_PENDIENTE);
  // Vacantes abiertas que Selección debe reclutar.
  const vacantesAbiertas = (vacantesAll || []).filter(v => v.estado !== 'Cerrada' && v.estado !== 'Cubierta');

  return {
    // Reclutador (Selección): vacantes abiertas por llenar + fichas que RRHH
    // devolvió. Cada enlace abre directamente lo que hay que resolver.
    reclutador: {
      total: vacantesAbiertas.length + rechazadosRRHH.length,
      items: [
        ...vacantesAbiertas.map(v => ({
          texto: `Vacante por reclutar: ${v.puesto || 'CT'}${v.zonas ? ' · ' + v.zonas : ''}`,
          detalle: v.libranzas ? `Libra: ${v.libranzas}` : '', href: '/vacantes'
        })),
        ...rechazadosRRHH.map(t => ({
          texto: `${t.nombre || t.id} — devuelto por RRHH`,
          detalle: t.motivo || '', href: `/seleccion?tel=${encodeURIComponent(t.id)}`
        }))
      ]
    },
    // RRHH: aprobados en BOLT esperando el alta + peticiones de Tráfico por resolver
    // + fichas en Administración esperando el PIN de Ballenoil (último paso).
    rrhh: {
      total: porTramitar.length + petPendientes.length + pendientesPin.length,
      items: [
        ...petPendientes.map(p => ({
          texto: `Petición: ${p.tipo} de ${p.conductor || p.id_conductor}`,
          detalle: p.desde ? `${p.desde} → ${p.hasta}` : (p.motivo || ''), href: '/peticiones'
        })),
        ...porTramitar.map(t => ({
          texto: `${t.nombre || t.id} — aprobado en BOLT, pendiente de alta`,
          detalle: '', href: `/rrhh?tel=${encodeURIComponent(t.id)}`
        })),
        ...pendientesPin.map(t => ({
          texto: `${t.nombre || t.id} — pendiente de alta en Ballenoil`,
          detalle: 'Administración', href: `/administracion?tel=${encodeURIComponent(t.id)}`
        }))
      ]
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
